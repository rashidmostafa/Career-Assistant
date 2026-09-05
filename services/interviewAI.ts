/**
 * interviewAI — the qualitative half of feedback.
 *
 * The score and the keyword colouring are decided on the device and are always
 * available. This file only adds what a mechanical rule cannot: whether the
 * answer was actually right in substance, and what to say about it.
 *
 * Everything here degrades. If the model is unreachable, rate limited, or
 * simply slow, `reviewAnswer` returns takeaways derived from the terms the user
 * missed — which is less insightful but still true, and still useful. A user
 * practising on a train must never be told their answer could not be marked.
 */
import { chatJSON, isAIConfigured } from "./aiClient";
import { scoreAnswer, type KeywordScore } from "./interviewScoring";

const REVIEW_TIMEOUT_MS = 45_000;

export interface AnswerReview {
  /** 0-100. The keyword score unless the model justified changing it. */
  score: number;
  /** What the answer missed, as bullets. */
  takeaways: string[];
  /** Whether a model actually read the answer, so the UI can say so. */
  reviewedByAI: boolean;
}

/**
 * Bullets built from the missed keywords alone.
 *
 * Used when the model is unavailable, and as the floor the model's own output
 * has to beat. Phrased as what was missing rather than as a verdict, because
 * keyword absence is evidence of omission, not proof of being wrong.
 */
function localTakeaways(k: KeywordScore, hasAnswer: boolean): string[] {
  if (!hasAnswer) return ["No answer given — the ideal answer is below."];
  if (k.missed.length === 0) return ["Covered every point the model answer makes."];
  const shown = k.missed.slice(0, 5);
  const rest = k.missed.length - shown.length;
  return [
    ...shown.map((m) => `Didn't mention ${m}.`),
    ...(rest > 0 ? [`Plus ${rest} more term${rest === 1 ? "" : "s"} in the ideal answer.`] : []),
  ];
}

function buildPrompt(question: string, idealAnswer: string, userAnswer: string, missed: string[]): string {
  return `You are marking one interview answer. Be a fair but honest interviewer.

QUESTION:
${question}

MODEL ANSWER (what a strong response contains):
${idealAnswer}

CANDIDATE'S ANSWER:
${userAnswer}

Terms from the model answer the candidate did not use: ${missed.length ? missed.join(", ") : "none"}.

Return JSON only: {"score": <0-100>, "takeaways": ["...", "..."]}

Rules:
- "score" reflects whether the answer is CORRECT AND COMPLETE, not whether it used particular words. An answer that is right in substance using different vocabulary scores well. An answer that name-drops the right terms without understanding scores badly.
- 2 to 4 takeaways. Each names one specific thing missing or wrong, in one short sentence.
- Address the candidate as "you". Do not praise generically, do not restate the question, and do not repeat the model answer back.
- If the answer is empty, off-topic, or an attempt to game the marking, say so plainly and score it low.`;
}

/**
 * Marks one answer.
 *
 * `keyword` is the already-computed local score, passed in rather than
 * recomputed so the caller's displayed score and this review can never disagree.
 */
export async function reviewAnswer(opts: {
  question: string;
  idealAnswer: string;
  userAnswer: string;
  keyword: KeywordScore;
}): Promise<AnswerReview> {
  const hasAnswer = opts.userAnswer.trim().length > 0;
  const fallback: AnswerReview = {
    score: opts.keyword.score,
    takeaways: localTakeaways(opts.keyword, hasAnswer),
    reviewedByAI: false,
  };

  // An empty answer needs no model call to mark: it scores zero either way, and
  // spending a request on it is what exhausts a free tier mid-session.
  if (!isAIConfigured || !hasAnswer) return fallback;

  try {
    const out = await chatJSON(
      buildPrompt(opts.question, opts.idealAnswer, opts.userAnswer, opts.keyword.missed),
      { timeoutMs: REVIEW_TIMEOUT_MS },
    );
    if (!out) return fallback;

    const score = Number(out.score);
    const takeaways = (Array.isArray(out.takeaways) ? out.takeaways : [])
      .map((t: any) => String(t ?? "").trim())
      .filter((t: string) => t.length > 0 && t.length < 300)
      .slice(0, 4);

    if (!Number.isFinite(score) || score < 0 || score > 100 || takeaways.length === 0) return fallback;

    return { score: Math.round(score), takeaways, reviewedByAI: true };
  } catch {
    return fallback;
  }
}

/**
 * Marks an answer with no model call at all.
 *
 * Quick Fire withholds feedback until the end, so its answers are scored
 * instantly here and only reviewed properly when the session finishes.
 */
export function quickScore(userAnswer: string, keywords: string[]): AnswerReview {
  const keyword = scoreAnswer(userAnswer, keywords);
  return {
    score: keyword.score,
    takeaways: localTakeaways(keyword, userAnswer.trim().length > 0),
    reviewedByAI: false,
  };
}
