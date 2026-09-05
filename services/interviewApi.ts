/**
 * interviewApi — questions, from the bank on the server.
 *
 * There is no local question list and no fallback set. A question the app
 * invented on the device would not be tagged, would not be shared with the next
 * user of the same role, and could not be excluded from a later session — so an
 * empty result is reported as an empty result, with the reason, rather than
 * papered over with something plausible.
 */
import { apiFetch } from "./authApiService";

const TIMEOUT_MS = 150_000;

export type Difficulty = "Junior" | "Mid" | "Senior";
export const DIFFICULTIES: Difficulty[] = ["Junior", "Mid", "Senior"];

export interface BankQuestion {
  id: string;
  question: string;
  idealAnswer: string;
  keywords: string[];
  competency: string;
  difficulty: Difficulty;
  type: "Technical" | "Behavioral" | "System Design";
}

export interface QuestionDraw {
  questions: BankQuestion[];
  /** Rows the server generated to satisfy this request. */
  generated: number;
  /** How many the bank now holds for this role and level. */
  available: number;
  /** Present only when generation was attempted and did not fully succeed. */
  reason: string | null;
  retryAfterSec: number | null;
}

/**
 * Draws a session's worth of questions.
 *
 * The first request for an unseeded role waits on generation, which was
 * measured at around 29 seconds against the live model — hence a timeout well
 * above the app's usual one. Every later request for that role is a database
 * read and returns immediately.
 */
export async function drawQuestions(opts: {
  role: string;
  difficulty: Difficulty;
  count: number;
  /** Question ids to leave out, so a session does not repeat what was just asked. */
  exclude?: string[];
}): Promise<QuestionDraw> {
  const params = new URLSearchParams({
    role: opts.role,
    difficulty: opts.difficulty,
    count: String(opts.count),
  });
  // Capped: the exclusion list grows without bound as someone practises, and a
  // URL long enough to be rejected would fail the whole draw.
  const exclude = (opts.exclude ?? []).slice(-120);
  if (exclude.length) params.set("exclude", exclude.join(","));

  try {
    const res = await apiFetch<any>(
      `/api/interview/questions?${params}`,
      { timeoutMs: TIMEOUT_MS },
      true,
    );
    return {
      questions: Array.isArray(res?.questions) ? res.questions : [],
      generated: res?.generated ?? 0,
      available: res?.available ?? 0,
      reason: res?.generationReason ?? null,
      retryAfterSec: res?.retryAfterSec ?? null,
    };
  } catch (e: any) {
    return {
      questions: [],
      generated: 0,
      available: 0,
      reason: e?.message?.includes("abort") ? "timeout" : "unreachable",
      retryAfterSec: null,
    };
  }
}

/** Turns a draw's failure reason into something worth showing a person. */
export function describeDrawFailure(draw: QuestionDraw, role: string): string {
  if (draw.questions.length > 0) return "";
  switch (draw.reason) {
    case "rate_limited":
      return draw.retryAfterSec
        ? `The question writer is rate limited. Try again in about ${draw.retryAfterSec}s.`
        : "The question writer is rate limited right now. Try again shortly.";
    case "timeout":
      return `Building the first question set for "${role}" took too long. Pull to retry — the work so far is saved.`;
    case "unreachable":
      return "Couldn't reach the server. Check your connection and try again.";
    case "not_configured":
      return "The question writer isn't configured on the server yet.";
    default:
      return `No questions yet for "${role}". Pull to retry.`;
  }
}
