/**
 * Scores how well a user's CV skills cover a job's requirements.
 *
 * Required skills carry full weight and preferred/nice-to-have skills carry
 * half, so missing a core requirement costs more than missing a bonus one.
 */
import { canonicalizeSkill } from "./skillsExtract";

export interface JobMatchResult {
  /** 0-100 coverage of the job's weighted requirements. */
  score: number;
  /** Job skills the CV demonstrates (canonical names, job's original order). */
  matched: string[];
  /** Job skills absent from the CV (canonical names, job's original order). */
  missing: string[];
  /**
   * False when the job lists no skills at all — the score is meaningless and
   * the UI should show "N/A" rather than 0%.
   */
  applicable: boolean;
}

const PREFERRED_WEIGHT = 0.5;
const REQUIRED_WEIGHT = 1;

const EMPTY_RESULT: JobMatchResult = { score: 0, matched: [], missing: [], applicable: false };

/**
 * Compare a CV's skills against a job's requirements.
 *
 * Both sides are canonicalised first so equivalent spellings across the two
 * data sources still line up ("Node" on the CV vs "Node.js" on the listing).
 */
export function computeJobMatch(
  cvSkills: string[],
  requiredSkills: string[],
  preferredSkills: string[] = []
): JobMatchResult {
  const hasRequirements = requiredSkills.length > 0 || preferredSkills.length > 0;
  if (!hasRequirements) return EMPTY_RESULT;

  const cvSet = new Set(cvSkills.map(canonicalizeSkill).filter(Boolean));

  const matched: string[] = [];
  const missing: string[] = [];
  let earned = 0;
  let total = 0;

  const score = (skills: string[], weight: number) => {
    for (const skill of skills) {
      const canonical = canonicalizeSkill(skill);
      if (!canonical) continue;
      total += weight;
      if (cvSet.has(canonical)) {
        earned += weight;
        matched.push(canonical);
      } else {
        missing.push(canonical);
      }
    }
  };

  score(requiredSkills, REQUIRED_WEIGHT);
  score(preferredSkills, PREFERRED_WEIGHT);

  if (total === 0) return EMPTY_RESULT;

  return {
    score: Math.round((earned / total) * 100),
    matched,
    missing,
    applicable: true,
  };
}

export type MatchTier = "high" | "medium" | "low";

/** 70+ strong candidate · 40-69 some gaps · below 40 needs improvement. */
export function matchTier(score: number): MatchTier {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}
