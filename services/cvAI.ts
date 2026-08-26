/**
 * cvAI — scoring an uploaded CV.
 *
 * Scored against the format the user said they wrote it in, because the
 * conventions genuinely differ: Harvard leads with Education, MIT expects a
 * dedicated Technical Skills block right after it and treats Projects as a
 * first-class section, and a corporate CV opens with a Professional Summary and
 * a keyword-dense competencies block. Judging all three by one rubric would
 * report correct choices as mistakes.
 *
 * Skill gaps are measured against the user's target role. Without one they are
 * omitted rather than invented — a gap has no meaning with nothing to be a gap
 * from.
 */
import { chatJSON, isAIConfigured, lastRateLimitSeconds } from "./aiClient";

export type Severity = "high" | "medium" | "low";

export interface CVIssue {
  severity: Severity;
  title: string;
  /** What is wrong, in the user's CV specifically. */
  detail: string;
  /** What to do about it. */
  fix: string;
}

export interface ATSDimension {
  key: string;
  label: string;
  score: number;   // 0-100
  note: string;
}

export interface SkillGap {
  skill: string;
  why: string;
}

export interface CVReport {
  score: number;                 // 0-100 overall
  verdict: string;               // one honest line about where this CV stands
  dimensions: ATSDimension[];
  formattingIssues: CVIssue[];
  essentials: CVIssue[];
  skillGaps: SkillGap[];
  scoredFormat: string;
  targetRole: string;
  scoredAt: string;
}

// The dimensions real applicant tracking systems actually gate on. Fixed, so a
// score means the same thing between two runs and two users.
const DIMENSIONS = [
  { key: "parseability",  label: "Parseability" },
  { key: "format",        label: "Format compliance" },
  { key: "keywords",      label: "Keyword match" },
  { key: "achievements",  label: "Evidence & impact" },
  { key: "completeness",  label: "Completeness" },
  { key: "clarity",       label: "Clarity & consistency" },
] as const;

const SYSTEM = `You are an ATS (applicant tracking system) auditor. You score CVs the way real screening software and recruiters do, and you are candid rather than encouraging.

Scoring rules:
- Score each dimension 0-100 on evidence in THIS CV. Do not award marks for things that are absent.
- parseability: can software reliably extract sections, dates, contacts? Penalise tables, columns, graphics, headers/footers, unusual headings.
- format: does it follow the conventions of the format the candidate says they used? Judge it by that format's rules, not another's.
- keywords: does it carry the terms this target role is screened on?
- achievements: quantified outcomes and strong action verbs, versus duty lists.
- completeness: are the sections that format and role require present and populated?
- clarity: consistent tense, dates, punctuation and structure; no filler.
- The overall score is your honest weighted judgement of employability through an ATS, not an average.
- Be specific. Quote or name the actual line, section or omission. Never give advice that would fit any CV.
- Return valid JSON only. No markdown, no preamble, no explanation.`;

function buildPrompt(input: ScoreInput): string {
  const roleLine = input.targetRole
    ? `TARGET ROLE: ${input.targetRole}`
    : `TARGET ROLE: not set — score keywords generically and return an empty skill_gaps array.`;

  return `${SYSTEM}

${roleLine}
FORMAT THE CANDIDATE SAYS THEY USED: ${input.sourceFormat}

THEIR CV (extracted text):
${input.cvText.slice(0, 12000)}

Return JSON in exactly this shape:
{
  "score": 0-100,
  "verdict": "one honest sentence about where this CV stands for this role",
  "dimensions": [
    { "key": "parseability", "score": 0-100, "note": "specific to this CV" },
    { "key": "format", "score": 0-100, "note": "" },
    { "key": "keywords", "score": 0-100, "note": "" },
    { "key": "achievements", "score": 0-100, "note": "" },
    { "key": "completeness", "score": 0-100, "note": "" },
    { "key": "clarity", "score": 0-100, "note": "" }
  ],
  "formatting_issues": [
    { "severity": "high|medium|low", "title": "", "detail": "what is wrong in this CV", "fix": "what to change" }
  ],
  "essentials": [
    { "severity": "high|medium|low", "title": "", "detail": "missing or weak thing every CV needs", "fix": "" }
  ],
  "skill_gaps": [
    { "skill": "", "why": "why this role screens for it and this CV does not show it" }
  ]
}`;
}

export interface ScoreInput {
  cvText: string;
  sourceFormat: string;
  targetRole: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────
const str = (v: unknown, fb = ""): string => (typeof v === "string" && v.trim() ? v.trim() : fb);
const clamp = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
};
const SEVERITIES: Severity[] = ["high", "medium", "low"];

function issues(v: unknown, max = 10): CVIssue[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((i: any): CVIssue | null => {
      const title = str(i?.title);
      if (!title) return null;
      return {
        severity: SEVERITIES.includes(i?.severity) ? i.severity : "medium",
        title,
        detail: str(i?.detail),
        fix: str(i?.fix),
      };
    })
    .filter(Boolean)
    .slice(0, max) as CVIssue[];
}

export function validateReport(raw: any, input: ScoreInput): CVReport | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.score !== "number" && typeof raw.score !== "string") return null;

  // Dimensions are pinned to our fixed list rather than taken from the reply,
  // so a missing or renamed one shows as unscored instead of silently vanishing
  // and making the report look complete when it is not.
  const byKey = new Map<string, any>(
    Array.isArray(raw.dimensions) ? raw.dimensions.filter((d: any) => d?.key).map((d: any) => [d.key, d]) : [],
  );
  const dimensions: ATSDimension[] = DIMENSIONS.map(({ key, label }) => {
    const d = byKey.get(key);
    return { key, label, score: clamp(d?.score), note: str(d?.note) };
  });

  return {
    score: clamp(raw.score),
    verdict: str(raw.verdict),
    dimensions,
    formattingIssues: issues(raw.formatting_issues),
    essentials: issues(raw.essentials),
    // A gap needs something to be a gap from.
    skillGaps: input.targetRole
      ? (Array.isArray(raw.skill_gaps) ? raw.skill_gaps : [])
          .map((g: any) => ({ skill: str(g?.skill), why: str(g?.why) }))
          .filter((g: SkillGap) => !!g.skill)
          .slice(0, 12)
      : [],
    scoredFormat: input.sourceFormat,
    targetRole: input.targetRole,
    scoredAt: new Date().toISOString(),
  };
}

/**
 * Scoring a CV takes about 25 seconds against a warm server, and the free tier
 * spins down after 15 minutes idle — so a cold instance adds roughly another
 * 22s before the model is even reached. A 45s budget failed on exactly that
 * combination, which is the common case for the first score of a session.
 */
const SCORE_TIMEOUT_MS = 120_000;

export type ScoreResult =
  | { ok: true; report: CVReport }
  | { ok: false; reason: "no_ai" | "unreachable" | "bad_output" | "rate_limited"; retryAfterSec?: number };

/** Scores a CV, retrying once if the reply cannot be used. */
export async function scoreCV(input: ScoreInput): Promise<ScoreResult> {
  if (!isAIConfigured) return { ok: false, reason: "no_ai" };

  const base = buildPrompt(input);
  let reached = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON(
      attempt === 0 ? base : `${base}\n\nYour previous reply was not valid JSON in the required shape. Return ONLY the JSON object.`,
      { timeoutMs: SCORE_TIMEOUT_MS },
    );

    const report = validateReport(raw, input);
    if (report) return { ok: true, report };

    // Retry only when the model actually answered and the answer was unusable.
    // Retrying an unreachable server just makes the user wait the whole budget
    // twice before being told the same thing.
    if (raw === null) {
      // Checked as a number, not `!== null`: an absent value is undefined, and
      // `undefined !== null` is true — which would report every unreachable
      // server as a rate limit.
      if (typeof lastRateLimitSeconds === "number") {
        return { ok: false, reason: "rate_limited", retryAfterSec: lastRateLimitSeconds };
      }
      return { ok: false, reason: "unreachable" };
    }
    reached = true;
  }
  return { ok: false, reason: reached ? "bad_output" : "unreachable" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimised CV
// ─────────────────────────────────────────────────────────────────────────────
import { extractSkillsFromText, canonicalizeSkill } from "@/utils/skillsExtract";

export interface OptimiseInput {
  cvText: string;
  /** The format the rewritten CV should follow — may differ from the source. */
  targetFormat: string;
  targetRole: string;
  /** Skills the CV already evidences. */
  cvSkills: string[];
  /**
   * Skills the user has since genuinely acquired, e.g. by completing roadmap
   * milestones. Empty until roadmap completion tracking exists.
   */
  gainedSkills?: string[];
  /** Problems the score found, so the rewrite actually addresses them. */
  issues?: string[];
}

export interface OptimisedCV {
  text: string;
  targetFormat: string;
  /**
   * Skills that appeared in the rewrite but are not evidenced anywhere.
   *
   * Empty is the goal. Non-empty is surfaced to the user rather than hidden:
   * a CV that quietly claims skills they do not have is worse than no rewrite,
   * because they only discover it in an interview.
   */
  flagged: string[];
  generatedAt: string;
}

const OPTIMISE_TIMEOUT_MS = 120_000;

const HONESTY_RULES = `Absolute rules — these override every other consideration:
- You may ONLY present skills, tools, technologies, employers, titles, dates, qualifications and achievements that appear in the source CV or the explicitly permitted list below.
- Never add a skill to raise the score. Never imply experience with something not evidenced. Never invent a metric, a percentage, an employer, a date or a certification.
- You may rephrase, restructure, reorder, tighten wording, use stronger verbs, surface things buried in prose, and apply the target format's conventions. That is the whole of what you may do.
- If the CV is weak in an area, leave it weak. Do not paper over it. The candidate has to defend every line of this in an interview.`;

function buildOptimisePrompt(input: OptimiseInput): string {
  const permitted = [...new Set([...(input.cvSkills ?? []), ...(input.gainedSkills ?? [])])];
  return `You are rewriting a candidate's CV to score better with applicant tracking systems, without making a single claim that is not true.

${HONESTY_RULES}

PERMITTED SKILLS (from their CV${input.gainedSkills?.length ? " and skills they have since genuinely acquired" : ""}):
${permitted.length ? permitted.join(", ") : "none detected automatically — use only what the source CV shows"}

TARGET ROLE: ${input.targetRole || "not specified"}
WRITE IT IN THIS FORMAT: ${input.targetFormat}
${input.issues?.length ? `\nPROBLEMS THE SCORE FOUND — fix these:\n${input.issues.map((i) => `- ${i}`).join("\n")}` : ""}

SOURCE CV:
${input.cvText.slice(0, 12000)}

Return JSON only:
{ "cv": "the complete rewritten CV as plain text, with section headings, ready to paste" }`;
}

/**
 * Names skills the rewrite claims that nothing supports.
 *
 * The prompt forbids invention, and mostly it complies — but "mostly" is not
 * good enough when the consequence is a candidate being asked about Kubernetes
 * in an interview because we put it on their CV. So the output is checked
 * against the source text and the permitted list, not trusted.
 */
export function findUnsupportedSkills(
  optimised: string,
  input: Pick<OptimiseInput, "cvText" | "cvSkills" | "gainedSkills">,
): string[] {
  // The baseline is derived with the same extractor that reads the rewrite, so
  // both sides infer alike. Without this, a CV listing Node.js and Express
  // yields "JavaScript" from the rewrite but not from the caller's skill list,
  // and an entirely reasonable mention gets reported as a fabrication.
  const permitted = new Set(
    [
      ...extractSkillsFromText(input.cvText ?? ""),
      ...(input.cvSkills ?? []),
      ...(input.gainedSkills ?? []),
    ].map(canonicalizeSkill),
  );

  // Anything written in the source is evidence too, even where the extractor
  // does not name it as a skill.
  const sourceLower = (input.cvText ?? "").toLowerCase();

  return extractSkillsFromText(optimised)
    .filter((skill) => {
      if (permitted.has(canonicalizeSkill(skill))) return false;
      return !sourceLower.includes(skill.toLowerCase());
    })
    .slice(0, 15);
}

export type OptimiseResult =
  | { ok: true; cv: OptimisedCV }
  | { ok: false; reason: "no_ai" | "unreachable" | "bad_output" | "rate_limited"; retryAfterSec?: number };

/**
 * Rewrites the CV, then checks it did not invent anything.
 *
 * On finding unsupported claims it asks once more, naming them — which is
 * usually enough. Anything still present is returned in `flagged` rather than
 * silently accepted or silently stripped, because the candidate is the one who
 * knows whether they can defend it.
 */
export async function generateOptimisedCV(input: OptimiseInput): Promise<OptimiseResult> {
  if (!isAIConfigured) return { ok: false, reason: "no_ai" };

  let prompt = buildOptimisePrompt(input);

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON(prompt, { timeoutMs: OPTIMISE_TIMEOUT_MS });

    if (raw === null) {
      if (typeof lastRateLimitSeconds === "number") {
        return { ok: false, reason: "rate_limited", retryAfterSec: lastRateLimitSeconds };
      }
      return { ok: false, reason: "unreachable" };
    }

    const text = str(raw?.cv);
    if (!text || text.length < 120) {
      prompt = `${buildOptimisePrompt(input)}\n\nYour previous reply was empty or truncated. Return ONLY the JSON object with the complete CV.`;
      continue;
    }

    const flagged = findUnsupportedSkills(text, input);
    if (flagged.length === 0 || attempt === 1) {
      return {
        ok: true,
        cv: { text, targetFormat: input.targetFormat, flagged, generatedAt: new Date().toISOString() },
      };
    }

    prompt = `${buildOptimisePrompt(input)}

Your previous attempt introduced these, which do not appear in the source CV and are not permitted: ${flagged.join(", ")}.
Remove every one of them and rewrite. Do not substitute other unsupported claims.`;
  }

  return { ok: false, reason: "bad_output" };
}
