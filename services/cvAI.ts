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
