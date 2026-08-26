/**
 * Scoring a job against the candidate's CV.
 *
 * The only evidence used is the skills their CV actually shows. A match
 * percentage that came from anywhere else — the role title, wishful defaults,
 * a random seed — tells the user nothing and quietly misleads them about where
 * they stand.
 */
import { canonicalizeSkill } from "./skillsExtract";

export interface JobMatchResult {
  /** 0-100. */
  score: number;
  matched: string[];
  missing: string[];
  /** Same as `missing`, under the name the jobs screen reads. */
  gapAnalysis: string[];
  /** Short, honest sentence about the fit. */
  rationale: string;
  /** Present once a letter has been written for this job in this session. */
  coverLetter?: string;
}

export type MatchTier = "high" | "medium" | "low";

export function matchTier(score: number): MatchTier {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/**
 * Compares the job's required skills with the candidate's.
 *
 * Canonicalised on both sides so "Node" and "Node.js", or "React.js" and
 * "React", count as the same thing — otherwise a candidate is marked down for
 * how a posting happened to spell a technology.
 */
export function computeJobMatch(jobSkills: string[], cvSkills: string[]): JobMatchResult {
  const required = [...new Set(jobSkills.filter(Boolean))];

  // No requirements parsed from the posting means no basis for a score. Zero is
  // the honest answer; inventing a number here would be worse than none.
  if (required.length === 0) {
    return { score: 0, matched: [], missing: [], gapAnalysis: [], rationale: "This posting doesn't list specific skills to match against." };
  }
  if (cvSkills.length === 0) {
    return { score: 0, matched: [], missing: required, gapAnalysis: required, rationale: "Upload a CV to see how well you match this role." };
  }

  const have = new Set(cvSkills.map(canonicalizeSkill));
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of required) {
    if (have.has(canonicalizeSkill(skill))) matched.push(skill);
    else missing.push(skill);
  }

  const score = Math.round((matched.length / required.length) * 100);

  const rationale =
    score >= 70 ? `You have ${matched.length} of ${required.length} skills this role asks for.`
    : score >= 40 ? `You match ${matched.length} of ${required.length}. The gap is ${missing.slice(0, 3).join(", ")}.`
    : `You match ${matched.length} of ${required.length}. This role mainly wants ${missing.slice(0, 3).join(", ")}.`;

  return { score, matched, missing, gapAnalysis: missing, rationale };
}
