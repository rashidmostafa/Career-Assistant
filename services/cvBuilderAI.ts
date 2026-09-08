/**
 * cvBuilderAI — rewriting one line the user wrote, never inventing a new one.
 *
 * The rest of the CV engine is built on a single rule: it will not put anything
 * on a CV the candidate cannot defend in an interview. That rule is easier to
 * break here than anywhere else, because a half-finished bullet like "made a
 * website" is an open invitation to embellish — a model asked to "improve" it
 * will happily add a framework, a team size and a percentage that were never
 * mentioned.
 *
 * So the prompt forbids new facts, and `addedFacts` checks the result rather
 * than trusting it: a rewrite that introduces numbers or technologies absent
 * from the original is rejected and the user keeps what they wrote.
 */
import { chatJSON, isAIConfigured } from "./aiClient";

const REWRITE_TIMEOUT_MS = 30_000;

export interface RewriteResult {
  /** The improved line, or the original when nothing better was possible. */
  text: string;
  changed: boolean;
  /** Set when a rewrite was produced but rejected for inventing something. */
  rejected?: string;
}

/**
 * Numbers and capitalised terms present in the rewrite but not the original.
 *
 * A deliberately blunt check. It cannot catch every fabrication, but it catches
 * the two the model actually commits — inventing a metric, and inventing a
 * technology — and those are the ones an interviewer asks about.
 */
export function addedFacts(original: string, rewritten: string): string[] {
  const numbersIn = (s: string) => new Set((s.match(/\d[\d,.]*\s*%?/g) ?? []).map((n) => n.replace(/[\s,]/g, "")));
  const before = numbersIn(original);
  const added = [...numbersIn(rewritten)].filter((n) => !before.has(n));

  // Capitalised or punctuated words look like product names: React, MySQL,
  // Node.js, C++. Sentence-initial words are excluded — capitalising the first
  // word of a rewritten line is grammar, not invention.
  // matchAll, not match: with /g, String.match discards capture groups and
  // returns the whole match, which dragged the preceding character in with it
  // and made every comparison miss.
  const terms = (s: string) =>
    new Set(
      [...s.matchAll(/(?:^|[^.!?]\s)([A-Z][A-Za-z0-9+#.]*)/g)]
        .map((m) => m[1].replace(/[.,;:]+$/, "").toLowerCase())
        .filter((t) => t.length > 1),
    );
  const knownTerms = terms(` ${original}`);
  for (const t of terms(` ${rewritten}`)) if (!knownTerms.has(t)) added.push(t);

  return [...new Set(added)];
}

function buildPrompt(line: string, context: string): string {
  return `Rewrite one line from a CV so it reads like an achievement rather than a duty.

THE LINE:
${line}

WHERE IT APPEARS: ${context || "a CV"}

Return JSON only: {"text": "..."}

Rules, in order of importance:
- Introduce NO new facts. No technology, tool, company, team size, percentage,
  duration or metric that is not already in the line. If the line has no number,
  the rewrite has no number. Inventing one puts a claim on this person's CV that
  they will be asked about in an interview and cannot defend.
- Lead with a strong past-tense verb: built, designed, automated, reduced, led.
- Keep it to one line, under 200 characters, no trailing full stop needed.
- Keep the candidate's own scope. "Helped with" does not become "led".
- If the line is already a good achievement bullet, return it unchanged.`;
}

/**
 * Improves one bullet.
 *
 * Returns the original on every failure path — unreachable model, malformed
 * reply, or a rewrite caught inventing something. The user is mid-sentence in a
 * form; an error dialog here would cost them more than the improvement was
 * worth.
 */
export async function rewriteBullet(line: string, context = ""): Promise<RewriteResult> {
  const original = line.trim();
  if (!original || !isAIConfigured) return { text: original, changed: false };

  try {
    const out = await chatJSON(buildPrompt(original, context), { timeoutMs: REWRITE_TIMEOUT_MS });
    const text = String(out?.text ?? "").trim().replace(/^[-•*]\s*/, "");
    if (!text || text.length > 300) return { text: original, changed: false };
    if (text.toLowerCase() === original.toLowerCase()) return { text: original, changed: false };

    const invented = addedFacts(original, text);
    if (invented.length > 0) {
      return {
        text: original,
        changed: false,
        rejected: `Kept your wording — the suggestion added ${invented.slice(0, 3).join(", ")}, which isn't in what you wrote.`,
      };
    }
    return { text, changed: true };
  } catch {
    return { text: original, changed: false };
  }
}

/**
 * A summary line from what the user has already entered.
 *
 * Same rule: it may only summarise the draft, never add to it.
 */
export async function suggestSummary(input: {
  role: string;
  education: string;
  skills: string[];
  projects: string[];
}): Promise<string> {
  if (!isAIConfigured) return "";
  const prompt = `Write a two-sentence professional summary for the top of a CV.

TARGET ROLE: ${input.role || "not stated"}
EDUCATION: ${input.education || "not stated"}
SKILLS THEY LISTED: ${input.skills.join(", ") || "none listed"}
PROJECTS THEY LISTED: ${input.projects.join("; ") || "none listed"}

Return JSON only: {"text": "..."}

Rules:
- Use ONLY what is above. No invented experience, employers, or years.
- If they are a student with no jobs, say so plainly and lead with what they
  have built. Do not imply professional experience they do not have.
- Two sentences at most, under 300 characters, first person implied but not
  written ("Final-year computer science student who…", not "I am…").`;

  try {
    const out = await chatJSON(prompt, { timeoutMs: REWRITE_TIMEOUT_MS });
    const text = String(out?.text ?? "").trim();
    return text.length > 400 ? "" : text;
  } catch {
    return "";
  }
}
