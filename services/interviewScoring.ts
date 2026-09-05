/**
 * interviewScoring — what a user's answer was worth, decided on the device.
 *
 * The score is the fraction of the question's keywords the answer covered.
 * That is deliberately a mechanical rule rather than a model's judgement, for
 * three reasons: it is instant, so feedback appears the moment an answer is
 * submitted; it costs nothing, which matters when a 20-question session would
 * otherwise be 20 model calls against a free tier; and it is explainable —
 * every point is attributable to a term the user did or did not say, which is
 * exactly what the Keyword Detective then colours in.
 *
 * The honest limitation, stated rather than hidden: an answer can be correct in
 * substance while using different words, and this will under-score it. So the
 * keyword score is the floor, and `services/interviewAI.ts` may raise it after
 * reading the answer properly. What it must never do is leave the user with no
 * score at all because a model was unreachable.
 */

export interface KeywordScore {
  /** 0-100. The share of expected terms the answer contained. */
  score: number;
  matched: string[];
  missed: string[];
}

/** One run of the ideal answer, coloured by whether the user covered it. */
export interface AnswerSegment {
  text: string;
  status: "plain" | "hit" | "miss";
}

/**
 * Word-ish comparison of a keyword against free text.
 *
 * Keywords are often multi-word ("circuit breaker", "read replica") or carry
 * punctuation ("ohm's law", "c++", "429"), so a naive word-array intersection
 * misses most of them. Matching on the raw string at word boundaries handles
 * all three, and a small plural/tense allowance stops "retries" failing to
 * match "retry" — which in testing was the single most common false miss.
 */
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function keywordPattern(keyword: string): RegExp | null {
  const k = keyword.trim().toLowerCase();
  if (!k) return null;

  // Whitespace in the keyword should tolerate any whitespace in the text.
  let body = k.replace(ESCAPE, "\\$&").replace(/\s+/g, "\\s+");

  // A consonant + "y" pluralises by replacing the y, so a suffix rule alone can
  // never reach it: "retry" has to match "retries", where the stem itself
  // changes. This was the one plural form the suffix list could not cover.
  body = body.replace(/([b-df-hj-np-tv-z])y$/i, "$1(?:y|ies)");

  // A trailing letter may be followed by a suffix: retry/retries, index/indexes,
  // shard/sharding. Bounded to three characters so "cache" cannot match
  // "cached-out-of-band" style coincidences in longer words.
  const suffix = /[a-z]$/.test(k) ? "(?:e?[sd]|ing|es|ies)?" : "";

  // \b does not work against "c++" or "c#", whose last character is not a word
  // character, so the boundary is expressed as "not a letter or digit".
  const left = /^[a-z0-9]/.test(k) ? "(?<![a-z0-9])" : "";
  const right = /[a-z0-9]$/.test(k) ? "(?![a-z0-9])" : "";

  try {
    return new RegExp(`${left}${body}${suffix}${right}`, "i");
  } catch {
    return null;
  }
}

/**
 * Scores an answer by how many of the expected terms it contains.
 *
 * A question with no keywords scores 0 and reports nothing matched, rather than
 * scoring 100 for an empty answer — the same rule the job matcher uses, where
 * "nothing to compare" must never read as a perfect result.
 */
export function scoreAnswer(answer: string, keywords: string[]): KeywordScore {
  const text = String(answer ?? "");
  const unique = [...new Set((keywords ?? []).map((k) => String(k ?? "").toLowerCase().trim()).filter(Boolean))];
  if (unique.length === 0) return { score: 0, matched: [], missed: [] };
  if (!text.trim()) return { score: 0, matched: [], missed: unique };

  const matched: string[] = [];
  const missed: string[] = [];
  for (const k of unique) {
    const re = keywordPattern(k);
    (re && re.test(text) ? matched : missed).push(k);
  }

  return { score: Math.round((matched.length / unique.length) * 100), matched, missed };
}

/**
 * Splits the ideal answer so each keyword occurrence can be coloured.
 *
 * Longer keywords are matched first: with "circuit" and "circuit breaker" both
 * expected, matching the short one first would colour half of the long one and
 * leave "breaker" looking like prose.
 */
export function segmentIdealAnswer(
  idealAnswer: string,
  keywords: string[],
  matched: string[],
): AnswerSegment[] {
  const text = String(idealAnswer ?? "");
  if (!text) return [];

  const hit = new Set((matched ?? []).map((m) => m.toLowerCase()));
  const ordered = [...new Set((keywords ?? []).map((k) => String(k ?? "").toLowerCase().trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  // Claim character ranges, longest keyword first, so nothing overlaps.
  const claims: { start: number; end: number; status: "hit" | "miss" }[] = [];
  const taken = new Array(text.length).fill(false);

  for (const k of ordered) {
    const single = keywordPattern(k);
    if (!single) continue;
    const re = new RegExp(single.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const start = m.index;
      const end = start + m[0].length;
      let free = true;
      for (let i = start; i < end; i++) if (taken[i]) { free = false; break; }
      if (!free) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      claims.push({ start, end, status: hit.has(k) ? "hit" : "miss" });
    }
  }

  claims.sort((a, b) => a.start - b.start);

  const out: AnswerSegment[] = [];
  let cursor = 0;
  for (const c of claims) {
    if (c.start > cursor) out.push({ text: text.slice(cursor, c.start), status: "plain" });
    out.push({ text: text.slice(c.start, c.end), status: c.status });
    cursor = c.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), status: "plain" });
  return out;
}

/**
 * Hides the expected terms in the ideal answer, for flashcard recall.
 *
 * Blanks are sized to the word they replace so the shape of the sentence
 * survives, which is what makes the gap answerable rather than a guess.
 */
export function blankIdealAnswer(idealAnswer: string, keywords: string[]): AnswerSegment[] {
  return segmentIdealAnswer(idealAnswer, keywords, []).map((s) =>
    s.status === "miss" ? { ...s, text: "_".repeat(Math.min(s.text.length, 14)) } : s,
  );
}

/** The band a score falls in, used for colour and wording. */
export function scoreTier(score: number): "strong" | "fair" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 40) return "fair";
  return "weak";
}

/** Below this, the question becomes a flashcard and returns in The Comeback. */
export const MASTERY_THRESHOLD = 70;
