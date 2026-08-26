/**
 * roadmapAI — generation for the roadmap.
 *
 * Step 1 of the rebuild: turn a CV and a target role into an ordered list of
 * milestones. Status, completion and chat are deliberately not here yet.
 *
 * Provider is Gemini through the app's own proxy (/api/ai/chat), so the key
 * stays server-side. Hawk is not involved: its own evaluation puts
 * roadmap_generator at gap_F1 48.8 and records that the fine-tune cost it its
 * long-form ability, which is exactly what this task needs.
 */
import { chatJSON, isAIConfigured } from "./aiClient";

// ─── Model ────────────────────────────────────────────────────────────────────
export interface Milestone {
  id: string;
  title: string;
  /** Why this matters for the target role specifically. */
  why: string;
  /** The gap skills this milestone closes. */
  skills: string[];
  actions: string[];
  resources: string[];
  successCriteria: string;
  /**
   * Honest effort for THIS skill — "~4 days", "~3 weeks".
   *
   * Not a deadline and not a schedule slot. The old roadmap gave every user the
   * same eight weeks regardless of what they already knew, which made the
   * number meaningless. Here it varies with the depth of the individual gap,
   * and no total is implied or shown.
   */
  estimate: string;
}

export interface Roadmap {
  targetRole: string;
  profileSummary: string;
  gapAnalysis: string;
  milestones: Milestone[];
  generatedAt: string;
}

export interface GenerateInput {
  targetRole: string;
  cvText: string;
  cvSkills: string[];
  experienceLevel?: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM = `You are an expert career coach. Analyse the user's CV against their target role and produce a milestone roadmap that closes the gap between the two.

Rules:
- Work from THIS person's actual CV. Never give generic advice that would suit anyone.
- Skip anything the CV already demonstrates. Do not teach them what they can already do.
- Order milestones so each depends only on the ones before it.
- Give every milestone its own honest time estimate, based on how long that specific skill genuinely takes to reach working competence. Estimates must differ from each other — a small library is days, a new language or a production system is weeks or months. Never make them uniform and never round them to fit a tidy total.
- Do not give an overall timeline, a deadline, a start date or an end date. Only per-milestone estimates.
- Choose however many milestones the real gap needs. A near-ready candidate may need three; a career changer may need a dozen.
- Return valid JSON only. No markdown, no preamble, no explanation.`;

const SHAPE = `{
  "profile_summary": "honest assessment of where this candidate is now",
  "gap_analysis": "what stands between this CV and this target role",
  "milestones": [
    {
      "id": "m1",
      "title": "short imperative title",
      "why": "why this matters for this target role",
      "skills": ["skill this closes"],
      "actions": ["concrete step"],
      "resources": ["specific book, course or tool"],
      "success_criteria": "how they know this is done",
      "estimate": "~2 weeks"
    }
  ]
}`;

function buildPrompt(input: GenerateInput): string {
  return `${SYSTEM}

TARGET ROLE: ${input.targetRole}
EXPERIENCE LEVEL: ${input.experienceLevel || "unspecified"}
SKILLS DETECTED IN THEIR CV: ${input.cvSkills.length ? input.cvSkills.join(", ") : "none detected automatically — read the CV below"}

THEIR CV:
${input.cvText.slice(0, 8000)}

Return JSON in exactly this shape:
${SHAPE}`;
}

// ─── Validation ───────────────────────────────────────────────────────────────
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

const strArray = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, max) : [];

/**
 * Rejects anything that would render as a broken card.
 *
 * A malformed milestone does not throw when drawn — it renders as an empty
 * section, which looks like a product bug rather than a bad response. Checking
 * the shape here keeps that failure visible and recoverable.
 */
export function validateRoadmap(raw: any, targetRole: string): Roadmap | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.milestones)) return null;

  const milestones = raw.milestones
    .slice(0, 20)
    .map((m: any, i: number): Milestone | null => {
      const title = str(m?.title);
      if (!title) return null;
      return {
        id: str(m?.id, `m${i + 1}`),
        title,
        why: str(m?.why),
        skills: strArray(m?.skills, 8),
        actions: strArray(m?.actions, 10),
        resources: strArray(m?.resources, 8),
        successCriteria: str(m?.success_criteria),
        estimate: str(m?.estimate, "—"),
      };
    })
    .filter(Boolean) as Milestone[];

  if (!milestones.length) return null;

  // Ids key the list and, later, per-milestone state — duplicates would collide.
  const seen = new Set<string>();
  milestones.forEach((m, i) => {
    if (seen.has(m.id)) m.id = `m${i + 1}_${Math.random().toString(36).slice(2, 6)}`;
    seen.add(m.id);
  });

  return {
    targetRole,
    profileSummary: str(raw.profile_summary),
    gapAnalysis: str(raw.gap_analysis),
    milestones,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Generation ───────────────────────────────────────────────────────────────
export type GenerateResult =
  | { ok: true; roadmap: Roadmap }
  | { ok: false; reason: "no_ai" | "unreachable" | "bad_output" };

/**
 * Generates a roadmap, retrying once on unusable output.
 *
 * The result is a tagged union rather than `Roadmap | null` so the screen can
 * say which thing went wrong. "The AI is not configured" and "the AI returned
 * nonsense" need different messages and different fixes, and collapsing them
 * into null is what made the previous version undiagnosable.
 */
export async function generateRoadmap(input: GenerateInput): Promise<GenerateResult> {
  if (!isAIConfigured) return { ok: false, reason: "no_ai" };

  const base = buildPrompt(input);
  let reached = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON(
      attempt === 0
        ? base
        : `${base}\n\nYour previous reply was not valid JSON in the required shape. Return ONLY the JSON object.`,
    );
    if (raw !== null) reached = true;

    const validated = validateRoadmap(raw, input.targetRole);
    if (validated) return { ok: true, roadmap: validated };
  }

  return { ok: false, reason: reached ? "bad_output" : "unreachable" };
}
