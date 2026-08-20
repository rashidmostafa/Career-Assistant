/**
 * hawkClient — client for the self-hosted Hawk AI model (fine-tuned
 * Qwen2.5-0.5B-Instruct + LoRA adapter, served by scripts/serve_hawk.py).
 *
 * Hawk is a NARROW model. It was fine-tuned on exactly six extraction and
 * scoring tasks and nothing else, so this client exposes exactly those six and
 * refuses to be a general-purpose LLM entry point. Free-form generation (cover
 * letters, CV rewrites, interview answer feedback) must keep going through
 * `aiClient`, which talks to a general model — see docs/HAWK_INTEGRATION.md for
 * the measurements behind that split.
 *
 * Configure via .env:
 *   EXPO_PUBLIC_HAWK_URL=http://192.168.1.20:8000     # LAN dev
 *   EXPO_PUBLIC_HAWK_URL=https://<tunnel>.ngrok.app   # phone off-LAN
 *
 * When the URL is unset or the server is unreachable, every call resolves to
 * null and callers keep their existing deterministic fallback, so the app stays
 * fully functional with no model running.
 */

const BASE_URL = (process.env.EXPO_PUBLIC_HAWK_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_HAWK_TIMEOUT_MS ?? 20000);

export const isHawkConfigured = BASE_URL.length > 0;

export type HawkTask =
  | "nlp_analyzer"
  | "skill_extractor"
  | "job_matcher"
  | "ats_scorer"
  | "roadmap_generator"
  | "interview_bank";

/** Shape returned by POST /v1/hawk/{task}. */
interface HawkEnvelope<T> {
  task: HawkTask;
  ok: boolean;
  data: T | null;
  raw: string | null;
  meta: {
    input_tokens: number;
    output_tokens: number;
    truncated: boolean;
    input_was_clipped: boolean;
    missing_keys: string[];
    latency_ms: number;
  };
}

// ---------------------------------------------------------------------------
// Task result types — these mirror the JSON schemas the adapter was trained on.
// ---------------------------------------------------------------------------

export interface HawkCVAnalysis {
  extracted_info: { full_name: string; email: string; phone: string; location: string };
  professional_summary: { current_title: string; total_experience_years: number; industry: string };
  skills_analysis: {
    technical: { expert: string[]; proficient: string[]; familiar: string[] };
    soft: string[];
  };
  experience?: Array<{
    company: string;
    title: string;
    duration: string;
    responsibilities: string[];
    technologies_used: string[];
  }>;
  education?: Array<{ degree: string; institution: string; year: number }>;
}

export interface HawkSkills {
  job_title: string;
  category: string;
  required_skills: string[];
}

export interface HawkJobMatch {
  match_percentage: number;
  fit_category: string;
  rationale: string;
}

export interface HawkATSScore {
  overall: number;
  breakdown: {
    format_structure: number;
    keyword_optimization: number;
    content_quality: number;
    parsing_ability: number;
  };
  optimization_tips: {
    missing_keywords: string[];
    formatting_issues: string[];
    content_improvements: string[];
    priority_fixes: string[];
  };
}

export interface HawkRoadmap {
  current_state: { career_stage: string; skill_level: string; market_readiness: string };
  skill_gap_analysis: {
    missing_skills: Array<{ skill: string; priority: string; learning_resources: string[] }>;
    upgrade_skills: unknown[];
  };
  timeline?: {
    week_1_2: string[];
    month_1_3: string[];
    month_3_6: string[];
    month_6_12: string[];
  };
  short_term_goals?: Array<{
    task: string;
    time_commitment: string;
    expected_outcome: string;
    priority: string;
    progress: number;
  }>;
  cv_impact?: {
    ats_score_before: number;
    ats_score_after: number;
    match_rate_before: number;
    match_rate_after: number;
  };
}

export interface HawkInterviewQuestion {
  category: string;
  question: string;
}

/**
 * Posts to a Hawk task endpoint. Returns null on any failure — unconfigured,
 * unreachable, timed out, or a reply the server itself flagged as incomplete —
 * so callers can treat null uniformly as "fall back to the local heuristic".
 */
async function callHawk<T>(task: HawkTask, input: string): Promise<T | null> {
  if (!isHawkConfigured || !input.trim()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/v1/hawk/${task}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[hawk] ${task} failed: HTTP ${res.status}`);
      return null;
    }

    const envelope = (await res.json()) as HawkEnvelope<T>;

    // `ok:false` means the server got a reply it could not parse or that was
    // missing required keys. A partial object is worse than no object here,
    // because the caller's fallback produces a complete one.
    if (!envelope.ok || !envelope.data) {
      console.warn(`[hawk] ${task} returned unusable output`, envelope.meta?.missing_keys);
      return null;
    }
    if (envelope.meta?.input_was_clipped) {
      console.warn(`[hawk] ${task}: input exceeded the model's 1536-token window and was clipped`);
    }
    return envelope.data;
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.warn(`[hawk] ${task} ${aborted ? `timed out after ${TIMEOUT_MS}ms` : "request error"}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the Hawk server is up and has its adapter loaded. */
export async function hawkHealth(): Promise<boolean> {
  if (!isHawkConfigured) return false;
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) return false;
    const body = await res.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}

/** Parse raw CV text into structured profile fields and graded skills. */
export function analyzeCVText(rawText: string) {
  return callHawk<HawkCVAnalysis>("nlp_analyzer", rawText);
}

/** Pull the required-skill list out of a job description. */
export function extractJobSkills(jobDescription: string) {
  return callHawk<HawkSkills>("skill_extractor", jobDescription);
}

/** Score a CV against one job description, with a short rationale. */
export function matchJob(cvText: string, jobDescription: string) {
  return callHawk<HawkJobMatch>(
    "job_matcher",
    `Resume:\n${cvText}\n\nJob Description:\n${jobDescription}`
  );
}

/** ATS scoring on Hawk's four trained dimensions. */
export function scoreATS(cvText: string, jobDescription: string) {
  return callHawk<HawkATSScore>(
    "ats_scorer",
    `CV:\n${cvText}\n\nJob Description:\n${jobDescription}`
  );
}

/** Skill-gap roadmap from current skills toward a target role. */
export function generateRoadmap(currentSkills: string[], targetRole: string) {
  return callHawk<HawkRoadmap>(
    "roadmap_generator",
    `Current skills: ${currentSkills.join(", ")}\nTarget role: ${targetRole}`
  );
}

/** Generate ONE interview question for a role/topic prompt. */
export function generateInterviewQuestion(prompt: string) {
  return callHawk<HawkInterviewQuestion>("interview_bank", prompt);
}
