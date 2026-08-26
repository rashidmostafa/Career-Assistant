/**
 * AI routes — /api/ai/*
 *
 * Every model call the app makes goes through here. Before this existed the
 * mobile client talked to Gemini directly with EXPO_PUBLIC_OPENAI_API_KEY,
 * which Expo inlines into the JS bundle at build time — meaning the key
 * shipped inside the APK and could be extracted by anyone who unzipped it.
 * The key now lives only in this process's environment.
 *
 * Two upstreams, deliberately kept separate:
 *
 *   POST /api/ai/chat        general-purpose LLM (OpenAI wire format, so
 *                            OpenAI / Gemini / Groq are all drop-in)
 *   POST /api/ai/hawk/:task  the self-hosted fine-tuned Hawk model
 *   GET  /api/ai/status      what is configured and reachable
 *
 * Both return HTTP 200 with `data: null` when the upstream is unconfigured,
 * unreachable, or produced unusable output. That is not laziness — every
 * caller in the app already treats null as "use the local deterministic
 * fallback", so a model outage degrades a feature instead of erroring a
 * screen. Non-2xx is reserved for problems with the *request* (bad input,
 * no auth, rate limited), which the client genuinely should not retry.
 */
const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const { aiLimiter }    = require("../middleware/rateLimiter");

// ── General LLM ───────────────────────────────────────────────────────────────
const AI_API_KEY   = process.env.AI_API_KEY ?? "";
const AI_BASE_URL  = (process.env.AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
// gemini-3.5-flash-lite, not gemini-3.6-flash.
//
// The free tier allows only 20 requests per DAY against 3.6-flash, which a
// single session of testing exhausts — after which every feature reports being
// unable to reach the AI. The lite model has a far more generous allowance and,
// measured on the same prompts, is no worse: it scored a CV in 3.8s instead of
// 24s and caught the same reverse-chronological and misplaced-section faults,
// and generated a roadmap in 4.8s with correctly varied estimates.
const AI_MODEL     = process.env.AI_MODEL ?? "gemini-3.5-flash-lite";
// 120s, not 30s. Scoring a CV and generating a roadmap are long generations —
// measured at 24-26 seconds against a warm provider — so a 30s ceiling left
// about four seconds of margin and aborted on any variance. The client then
// reported "couldn't reach the AI", which pointed at the network rather than at
// this line. The client budget is the same, so whichever gives up first gives
// up for a real reason.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 120000);

// ── Hawk ──────────────────────────────────────────────────────────────────────
const HAWK_URL        = (process.env.HAWK_URL ?? "").replace(/\/$/, "");
const HAWK_SECRET     = process.env.HAWK_SECRET ?? "";
const HAWK_TIMEOUT_MS = Number(process.env.HAWK_TIMEOUT_MS ?? 60000);

// The adapter was fine-tuned on exactly these six tasks. Validating against
// the set also stops `:task` being used to reach an arbitrary path on the
// Hawk host, which matters once Hawk is behind a tunnel.
const HAWK_TASKS = new Set([
  "nlp_analyzer",
  "skill_extractor",
  "job_matcher",
  "ats_scorer",
  "roadmap_generator",
  "interview_bank",
]);

// Roughly 6k tokens. Hawk's own window is 1536 and it clips server-side; this
// cap is about not paying to send a runaway payload upstream at all.
const MAX_INPUT_CHARS = 24000;

/** fetch with an AbortController timeout — Node 18+ has both built in. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
// Hawk health is cached briefly: the app asks on screen focus, and an
// unreachable host costs a full connect timeout to discover.
let hawkHealthCache = { at: 0, ok: false };
const HAWK_HEALTH_TTL_MS = 30000;

async function hawkReachable() {
  if (!HAWK_URL) return false;
  if (Date.now() - hawkHealthCache.at < HAWK_HEALTH_TTL_MS) return hawkHealthCache.ok;
  let ok = false;
  try {
    // serve_hawk.py gates /health on the shared secret too — its response
    // names the adapter path and device, which is exactly what an
    // unauthenticated prober would want. Omitting the header here made this
    // report Hawk unreachable while task calls were succeeding.
    const headers = HAWK_SECRET ? { "X-Hawk-Secret": HAWK_SECRET } : {};
    const res = await fetchWithTimeout(`${HAWK_URL}/health`, { headers }, 5000);
    ok = res.ok && (await res.json())?.status === "ok";
  } catch (_) {
    ok = false;
  }
  hawkHealthCache = { at: Date.now(), ok };
  return ok;
}

router.get("/status", authenticate, async (_req, res) => {
  // baseUrl and keyLength are here for diagnosis: "configured: true" only means
  // the key is non-empty, which cannot distinguish a working setup from a base
  // URL with a stray quote in it. Neither value is secret.
  res.json({
    general: {
      configured: AI_API_KEY.length > 0,
      model: AI_MODEL,
      baseUrl: AI_BASE_URL,
      keyLength: AI_API_KEY.length,
      timeoutMs: AI_TIMEOUT_MS,
    },
    hawk: { configured: HAWK_URL.length > 0, reachable: await hawkReachable() },
  });
});

// ─── General LLM ──────────────────────────────────────────────────────────────
router.post("/chat", authenticate, aiLimiter, async (req, res) => {
  // `json: false` returns the model's prose instead of forcing a JSON object.
  // The roadmap's per-milestone chat needs an answer a person reads; every
  // other caller wants a parseable object, so JSON stays the default.
  const { prompt, json = true, system } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ message: "A non-empty `prompt` string is required." });
  }
  if (prompt.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `Prompt exceeds ${MAX_INPUT_CHARS} characters.` });
  }
  if (typeof system === "string" && system.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `System prompt exceeds ${MAX_INPUT_CHARS} characters.` });
  }
  if (!AI_API_KEY) {
    return res.json({ data: null, reason: "not_configured" });
  }

  const retries = 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const upstream = await fetchWithTimeout(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            ...(typeof system === "string" && system.trim()
              ? [{ role: "system", content: system }]
              : []),
            { role: "user", content: prompt },
          ],
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      }, AI_TIMEOUT_MS);

      // 429 is a quota block, not a blip. Gemini's free tier allows 20 requests
      // a minute and states how long to wait — typically ~25 seconds. Retrying
      // inside that window cannot succeed and each attempt counts against the
      // same quota, so the old 800ms/1600ms retries turned one tap into three
      // failures and made the block last longer. Report it instead, with the
      // wait, so the caller can say something true.
      if (upstream.status === 429) {
        const body = await upstream.text().catch(() => "");
        const m = body.match(/retry in ([\d.]+)s/i);
        const retryAfterSec = m ? Math.ceil(Number(m[1])) : null;
        console.warn(`[AI] rate limited by provider${retryAfterSec ? `, retry in ${retryAfterSec}s` : ""}`);
        return res.json({ data: null, reason: "rate_limited", retryAfterSec });
      }

      // 503 genuinely is transient — the model is momentarily overloaded.
      if (upstream.status === 503 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }

      if (!upstream.ok) {
        // The upstream body can echo request details; log it here, never
        // forward it to a mobile client.
        console.warn(`[AI] ${AI_MODEL} responded HTTP ${upstream.status}`);
        return res.json({ data: null, reason: `upstream_${upstream.status}` });
      }

      // Named `completion`, not `json`: a second `const json` in this scope put
      // the `json` request flag read above into a temporal dead zone, so every
      // call threw "Cannot access 'json' before initialization" before it sent
      // anything. Silent, because callers treat a throw as a soft failure.
      const completion = await upstream.json();
      const content = completion?.choices?.[0]?.message?.content;
      if (!content) {
        // Some models spend their whole budget on internal reasoning and
        // return an empty message; a retry usually produces a usable reply.
        if (attempt < retries) continue;
        return res.json({ data: null, reason: "empty_completion" });
      }

      if (!json) return res.json({ data: content });

      try {
        return res.json({ data: JSON.parse(content) });
      } catch (_) {
        return res.json({ data: null, reason: "unparseable_json" });
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      if (attempt < retries) continue;
      console.warn(`[AI] request ${aborted ? `timed out after ${AI_TIMEOUT_MS}ms` : "failed"}:`, e.message, e.cause?.message ?? "");
      return res.json({
        data: null,
        reason: aborted ? "timeout" : "network_error",
        detail: aborted ? undefined : `${e.name}: ${e.message}${e.cause?.message ? ` (${e.cause.message})` : ""}`,
      });
    }
  }
  return res.json({ data: null, reason: "exhausted_retries" });
});

// ─── Hawk ─────────────────────────────────────────────────────────────────────
router.post("/hawk/:task", authenticate, aiLimiter, async (req, res) => {
  const { task } = req.params;
  const { input } = req.body ?? {};

  if (!HAWK_TASKS.has(task)) {
    return res.status(404).json({ message: `Unknown Hawk task '${task}'.` });
  }
  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ message: "A non-empty `input` string is required." });
  }
  if (input.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `Input exceeds ${MAX_INPUT_CHARS} characters.` });
  }
  if (!HAWK_URL) {
    return res.json({ ok: false, data: null, reason: "not_configured" });
  }

  try {
    const headers = { "Content-Type": "application/json" };
    // serve_hawk.py ships with no authentication of its own. Once it is
    // reachable off the LAN this header is the only thing standing between
    // the model and the open internet, so it is sent whenever it is set.
    if (HAWK_SECRET) headers["X-Hawk-Secret"] = HAWK_SECRET;

    const upstream = await fetchWithTimeout(`${HAWK_URL}/v1/hawk/${task}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input }),
    }, HAWK_TIMEOUT_MS);

    if (!upstream.ok) {
      console.warn(`[Hawk] ${task} responded HTTP ${upstream.status}`);
      return res.json({ ok: false, data: null, reason: `upstream_${upstream.status}` });
    }

    // Forwarded verbatim: the envelope's `ok`, `data` and `meta` are exactly
    // what services/hawkClient.ts already knows how to read, so putting this
    // proxy in front of Hawk required no change to how callers interpret it.
    return res.json(await upstream.json());
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.warn(`[Hawk] ${task} ${aborted ? `timed out after ${HAWK_TIMEOUT_MS}ms` : "request failed"}`);
    return res.json({ ok: false, data: null, reason: aborted ? "timeout" : "network_error" });
  }
});

module.exports = router;
