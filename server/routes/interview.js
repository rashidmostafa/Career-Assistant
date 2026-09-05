/**
 * routes/interview — the question bank.
 *
 *   GET /api/interview/questions   draw a session's questions for a role
 *   GET /api/interview/bank        what the bank holds, for diagnosis
 *
 * Questions come from MongoDB, never from the request. Generation happens here
 * rather than on the device for two reasons: the bank is shared between every
 * user, so a client that could write to it could poison what everyone else is
 * asked; and a role only ever has to be generated once, which a client cannot
 * coordinate.
 *
 * The bank fills itself. A role nobody has practised yet has no rows, so the
 * first request generates a batch, stores it, and answers from storage — the
 * second person to target that role gets an instant, already-curated set.
 */
const express = require("express");
const mongoose = require("mongoose");
const router  = express.Router();

const { authenticate } = require("../middleware/authMiddleware");
const { aiLimiter }    = require("../middleware/rateLimiter");
const InterviewQuestion = require("../models/InterviewQuestion");
const { roleKeyOf } = require("../models/InterviewQuestion");
const { seedDocuments } = require("../data/interviewSeed");

const AI_API_KEY    = process.env.AI_API_KEY ?? "";
const AI_BASE_URL   = (process.env.AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
const AI_MODEL      = process.env.AI_MODEL ?? "gemini-3.5-flash-lite";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 120000);

const DIFFICULTIES = ["Junior", "Mid", "Senior"];
const TYPES = ["Technical", "Behavioral", "System Design"];

/** How many rows a role should hold per difficulty before generation stops. */
const TARGET_PER_DIFFICULTY = 12;
/** Ceiling on one generation call, to bound both latency and cost. */
const GENERATE_BATCH = 12;

// ─── Seeding ──────────────────────────────────────────────────────────────────
let seedPromise = null;

/**
 * Writes the curated questions if they are absent.
 *
 * Runs lazily on first request rather than at boot: Render's free tier restarts
 * often, and a boot-time write would run on every cold start. The unique index
 * on (roleKey, question) makes this idempotent, so a concurrent second call
 * cannot duplicate anything.
 */
async function ensureSeeded() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const docs = seedDocuments().map((d) => ({ ...d, roleKey: roleKeyOf(d.role) }));
    await InterviewQuestion.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { roleKey: doc.roleKey, question: doc.question },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  })().catch((e) => {
    // A failed seed must not poison the cache — the next request retries.
    seedPromise = null;
    throw e;
  });
  return seedPromise;
}

// ─── Generation ───────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(role, difficulty, existingQuestions) {
  const avoid = existingQuestions.length
    ? `\n\nThe bank already contains these, so do not repeat them or ask a near-duplicate:\n${existingQuestions.map((q) => `- ${q}`).join("\n")}`
    : "";

  return `You are writing an interview question bank for the role "${role}" at ${difficulty} level.

Return JSON only, shaped exactly:
{"questions":[{"competency":"...","type":"Technical|Behavioral|System Design","question":"...","idealAnswer":"...","keywords":["...","..."]}]}

Rules:
- Produce exactly ${GENERATE_BATCH} questions.
- They must be questions a real interviewer for "${role}" would ask at ${difficulty} level. If the role is not a software role, ask about that role's actual work — do not default to programming.
- "competency" is the skill being tested, 1-3 words, e.g. "System Design", "Stakeholder Management", "Circuit Analysis". Use between 4 and 7 distinct competencies across the batch so progress can be tracked per skill.
- "idealAnswer" is 2-5 sentences of what a strong answer contains. Write it as the substance of an answer, not as advice about answering.
- "keywords" are 5-8 lowercase terms a correct answer would genuinely contain. They are used to score the candidate's answer by overlap, so choose words a person would actually say, not jargon that merely sounds relevant. No duplicates.
- Vary the type: include behavioural questions, not only technical ones.${avoid}`;
}

/**
 * Generates questions for a role and writes them into the bank.
 *
 * Returns { inserted, reason } rather than a bare count. An earlier version
 * returned 0 for every failure, which made a transient 503 from an overloaded
 * model indistinguishable from "this role produced nothing usable" — the caller
 * reported an empty bank and the real cause never reached anyone.
 *
 * Retry policy matches routes/ai.js, for the reasons recorded there: 503 is
 * transient and worth retrying, 429 is a quota that retries only deepen, so it
 * is reported with the wait the provider asked for.
 */
async function generateInto(role, difficulty, retries = 2) {
  if (!AI_API_KEY) return { inserted: 0, reason: "not_configured" };

  const existing = await InterviewQuestion
    .find({ roleKey: roleKeyOf(role), difficulty })
    .select("question").limit(40).lean();

  let parsed = null;
  let reason = "unknown";

  for (let attempt = 0; attempt <= retries; attempt++) {
    let upstream;
    try {
      upstream = await fetchWithTimeout(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "user", content: buildPrompt(role, difficulty, existing.map((e) => e.question)) }],
          response_format: { type: "json_object" },
        }),
      }, AI_TIMEOUT_MS);
    } catch (e) {
      reason = e?.name === "AbortError" ? "timeout" : "network_error";
      if (attempt < retries) continue;
      return { inserted: 0, reason };
    }

    if (upstream.status === 429) {
      const body = await upstream.text().catch(() => "");
      const m = body.match(/retry in ([\d.]+)s/i);
      const retryAfterSec = m ? Math.ceil(Number(m[1])) : null;
      console.warn(`[interview] rate limited by provider${retryAfterSec ? `, retry in ${retryAfterSec}s` : ""}`);
      return { inserted: 0, reason: "rate_limited", retryAfterSec };
    }

    if (upstream.status === 503 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      reason = "upstream_503";
      continue;
    }

    if (!upstream.ok) {
      console.warn(`[interview] ${AI_MODEL} responded HTTP ${upstream.status} generating ${role}/${difficulty}`);
      return { inserted: 0, reason: `upstream_${upstream.status}` };
    }

    const completion = await upstream.json().catch(() => null);
    const content = completion?.choices?.[0]?.message?.content;
    if (!content) {
      reason = "empty_completion";
      if (attempt < retries) continue;
      return { inserted: 0, reason };
    }

    try {
      parsed = JSON.parse(content);
      break;
    } catch {
      reason = "malformed_json";
      if (attempt < retries) continue;
      return { inserted: 0, reason };
    }
  }

  if (!parsed) return { inserted: 0, reason };

  const rows = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const roleKey = roleKeyOf(role);

  // Validated field by field. A model that returns a wrong enum or an empty
  // ideal answer would otherwise put a question into the shared bank that every
  // future user of this role is asked.
  const clean = rows.map((r) => {
    const question    = String(r?.question ?? "").trim();
    const idealAnswer = String(r?.idealAnswer ?? "").trim();
    const competency  = String(r?.competency ?? "").trim().slice(0, 80);
    const type        = TYPES.includes(r?.type) ? r.type : "Technical";
    const keywords    = [...new Set(
      (Array.isArray(r?.keywords) ? r.keywords : [])
        .map((k) => String(k ?? "").toLowerCase().trim())
        .filter((k) => k.length > 1 && k.length <= 40),
    )].slice(0, 24);

    if (!question || idealAnswer.length < 40 || !competency || keywords.length < 3) return null;
    return { roleKey, role, competency, difficulty, type, question, idealAnswer, keywords, source: "ai" };
  }).filter(Boolean);

  if (!clean.length) return { inserted: 0, reason: "no_valid_questions" };

  const result = await InterviewQuestion.bulkWrite(
    clean.map((doc) => ({
      updateOne: {
        filter: { roleKey: doc.roleKey, question: doc.question },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return { inserted: result.upsertedCount ?? 0, reason: "ok" };
}

// One generation per (role, difficulty) at a time. Without this, opening the
// screen twice for an unseeded role runs two identical generations and pays
// twice for rows the unique index then discards.
const inFlight = new Map();
function generateOnce(role, difficulty) {
  const key = `${roleKeyOf(role)}::${difficulty}`;
  if (!inFlight.has(key)) {
    inFlight.set(key, generateInto(role, difficulty).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * Draws a session's questions.
 *
 * `exclude` carries the ids this user has already answered so a session does
 * not repeat itself; the client sends its own history because the bank is
 * shared and holds no per-user state.
 */
router.get("/questions", authenticate, aiLimiter, async (req, res) => {
  const role = String(req.query.role ?? "").trim();
  if (!role) return res.status(400).json({ message: "role is required." });

  const difficulty = DIFFICULTIES.includes(req.query.difficulty) ? req.query.difficulty : "Mid";
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 10, 1), 20);
  const exclude = String(req.query.exclude ?? "")
    .split(",").map((s) => s.trim()).filter((s) => /^[a-f0-9]{24}$/.test(s));

  try {
    await ensureSeeded();
    const roleKey = roleKeyOf(role);

    const draw = () => InterviewQuestion.aggregate([
      { $match: { roleKey, difficulty, ...(exclude.length ? { _id: { $nin: exclude.map((id) => new mongoose.Types.ObjectId(id)) } } : {}) } },
      { $sample: { size: count } },
    ]);

    let picked = await draw();
    let generated = 0;
    let genReason = null;
    let retryAfterSec = null;

    // Top up when the bank cannot fill a session. Also tops up when it is only
    // just large enough, so the next session is not forced to repeat.
    const total = await InterviewQuestion.countDocuments({ roleKey, difficulty });
    if (picked.length < count || total < TARGET_PER_DIFFICULTY) {
      const gen = await generateOnce(role, difficulty);
      generated = gen.inserted;
      genReason = gen.reason;
      retryAfterSec = gen.retryAfterSec ?? null;
      if (generated > 0) picked = await draw();
    }

    res.json({
      role,
      roleKey,
      difficulty,
      generated,
      // Passed through so the client can say what actually went wrong instead
      // of showing an empty list and blaming the role.
      generationReason: genReason,
      retryAfterSec,
      // Reported so the client can say "the bank has 6 questions for this role"
      // rather than silently serving a shorter session than was asked for.
      available: await InterviewQuestion.countDocuments({ roleKey, difficulty }),
      questions: picked.map((q) => ({
        id: String(q._id),
        question: q.question,
        idealAnswer: q.idealAnswer,
        keywords: q.keywords ?? [],
        competency: q.competency,
        difficulty: q.difficulty,
        type: q.type,
      })),
    });
  } catch (e) {
    res.status(500).json({ message: "Could not load questions.", detail: e?.message });
  }
});

/** What the bank holds for a role, per difficulty. Diagnosis only. */
router.get("/bank", authenticate, async (req, res) => {
  const role = String(req.query.role ?? "").trim();
  try {
    await ensureSeeded();
    const match = role ? { roleKey: roleKeyOf(role) } : {};
    const rows = await InterviewQuestion.aggregate([
      { $match: match },
      { $group: { _id: { roleKey: "$roleKey", difficulty: "$difficulty", source: "$source" }, n: { $sum: 1 } } },
      { $sort: { "_id.roleKey": 1 } },
    ]);
    res.json({
      total: await InterviewQuestion.countDocuments(match),
      breakdown: rows.map((r) => ({ ...r._id, count: r.n })),
    });
  } catch (e) {
    res.status(500).json({ message: "Could not read the bank.", detail: e?.message });
  }
});

module.exports = router;
// Exported for tests: generation is the part that cannot be exercised through
// the route without a signed-in user and a live model.
module.exports.__internals = { generateInto, ensureSeeded, roleKeyOf };
