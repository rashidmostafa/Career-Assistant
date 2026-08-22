/**
 * roadmapAI — every model call the roadmap makes.
 *
 * Two providers, split by what each is measurably good at:
 *
 *   Gemini (via /api/ai/chat)  generation, re-prioritisation, level-up, chat.
 *   Hawk   (via /api/ai/hawk)  a supplementary skill-gap signal only.
 *
 * Hawk is deliberately not asked to produce the roadmap. Its own evaluation
 * puts roadmap_generator at gap_F1 48.8 with a 4-key output shape, and
 * docs/HAWK_INTEGRATION.md records that the fine-tune cost it its long-form
 * ability. It is good at naming missing skills, so that is all it is asked for,
 * and its answer is fed to Gemini as a hint rather than shown to the user.
 *
 * Every function resolves to null rather than throwing, matching the contract
 * the rest of the app uses: the caller keeps its previous state instead of
 * showing an error screen.
 */
import { chatJSON, chatText, streamChat, isAIConfigured } from "./aiClient";
import { generateRoadmap as hawkGapSignal, isHawkConfigured } from "./hawkClient";

// ─── Types ────────────────────────────────────────────────────────────────────
export type MilestoneStatus = "locked" | "in_progress" | "completed";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  why: string;
  skills_addressed: string[];
  actions: string[];
  resources: string[];
  success_criteria: string;
  status: MilestoneStatus;
}

export interface MilestoneRoadmap {
  profile_summary: string;
  gap_analysis: string;
  milestones: Milestone[];
  next_focus: string;
  targetRole: string;
  updatedAt: string;
}

/** What changed between two roadmaps, for the post-completion summary. */
export interface RoadmapDiff {
  unlocked: string[];
  completed: string[];
  added: string[];
  removed: string[];
  reprioritized: number;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert career coach. Analyze the user's CV and target role, then generate a personalized milestone-based career roadmap.

Rules:
- NO time estimates, deadlines, or durations — ever
- Order milestones by priority and logical dependency
- Be specific to THIS person's actual gaps, not generic advice
- Return valid JSON only. No markdown, no preamble, no explanation.`;

const SHAPE = `{
  "profile_summary": "string",
  "gap_analysis": "string",
  "milestones": [
    {
      "id": "m1",
      "title": "string",
      "description": "string",
      "why": "string",
      "skills_addressed": ["skill"],
      "actions": ["concrete action"],
      "resources": ["book/course/tool"],
      "success_criteria": "string",
      "status": "in_progress"
    }
  ],
  "next_focus": "string"
}`;

// ─── Validation ───────────────────────────────────────────────────────────────
const STATUSES: MilestoneStatus[] = ["locked", "in_progress", "completed"];

const asStringArray = (v: unknown, max = 8): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max) : [];

const asString = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

/**
 * Rejects anything that would render as a broken card.
 *
 * A model asked for JSON usually returns JSON, but "usually" is what makes the
 * failure hard to see: one milestone missing `actions` renders an empty section
 * rather than an error, so the shape is checked here instead of at the point it
 * is drawn.
 */
export function validateRoadmap(raw: any, targetRole: string): MilestoneRoadmap | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.milestones) || raw.milestones.length === 0) return null;

  const milestones: Milestone[] = raw.milestones
    .slice(0, 20)
    .map((m: any, i: number): Milestone | null => {
      const title = asString(m?.title);
      if (!title) return null;
      return {
        id: asString(m?.id, `m${i + 1}`),
        title,
        description: asString(m?.description),
        why: asString(m?.why),
        skills_addressed: asStringArray(m?.skills_addressed),
        actions: asStringArray(m?.actions, 10),
        resources: asStringArray(m?.resources, 8),
        success_criteria: asString(m?.success_criteria),
        status: STATUSES.includes(m?.status) ? m.status : "locked",
      };
    })
    .filter(Boolean) as Milestone[];

  if (!milestones.length) return null;

  // Ids must be unique — the UI keys cards and chat history off them.
  const seen = new Set<string>();
  milestones.forEach((m, i) => {
    if (seen.has(m.id)) m.id = `m${i + 1}_${Math.random().toString(36).slice(2, 6)}`;
    seen.add(m.id);
  });

  return {
    profile_summary: asString(raw.profile_summary),
    gap_analysis: asString(raw.gap_analysis),
    milestones: enforceStatuses(milestones),
    next_focus: asString(raw.next_focus),
    targetRole,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Exactly one milestone is in progress, and it is the first unfinished one.
 *
 * The model is asked for this and mostly complies, but "mostly" would leave the
 * user with two Mark Complete buttons or none, so it is imposed rather than
 * trusted.
 */
export function enforceStatuses(milestones: Milestone[]): Milestone[] {
  let activeAssigned = false;
  return milestones.map((m) => {
    if (m.status === "completed") return m;
    if (!activeAssigned) {
      activeAssigned = true;
      return { ...m, status: "in_progress" as const };
    }
    return { ...m, status: "locked" as const };
  });
}

// ─── Hawk: supplementary gap signal ───────────────────────────────────────────
async function hawkGaps(cvSkills: string[], targetRole: string): Promise<string[]> {
  if (!isHawkConfigured || !targetRole) return [];
  try {
    const out = await hawkGapSignal(cvSkills, targetRole);
    const missing = out?.skill_gap_analysis?.missing_skills;
    if (!Array.isArray(missing)) return [];
    return missing
      .map((m: any) => (typeof m === "string" ? m : asString(m?.skill)))
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

// ─── Generation ───────────────────────────────────────────────────────────────
export interface GenerateInput {
  cvText: string;
  cvSkills: string[];
  targetRole: string;
  experienceLevel?: string;
  extraContext?: string;
}

function buildGenerationPrompt(input: GenerateInput, gapHint: string[]): string {
  return `TARGET ROLE: ${input.targetRole}
STATED EXPERIENCE LEVEL: ${input.experienceLevel || "unspecified"}
SKILLS DETECTED IN CV: ${input.cvSkills.length ? input.cvSkills.join(", ") : "none detected"}
${gapHint.length ? `POSSIBLE GAPS (hint from a separate model — verify against the CV, ignore if wrong): ${gapHint.join(", ")}` : ""}
${input.extraContext ? `RECENT UPDATE FROM THE USER: ${input.extraContext}` : ""}

CV:
${(input.cvText || "No CV text was supplied. Base the roadmap on the target role and state this limitation in profile_summary.").slice(0, 8000)}

Return JSON in exactly this shape:
${SHAPE}

The first milestone must have status "in_progress". Every other milestone must have status "locked".`;
}

/**
 * Generates a roadmap, retrying once if the reply is not usable.
 *
 * The retry is not superstition: JSON mode makes malformed output uncommon but
 * not impossible, and a single failure would otherwise leave the user staring
 * at an empty roadmap after a ten-second wait.
 */
export async function generateMilestoneRoadmap(input: GenerateInput): Promise<MilestoneRoadmap | null> {
  if (!isAIConfigured) return null;

  const gapHint = await hawkGaps(input.cvSkills, input.targetRole);
  const prompt = buildGenerationPrompt(input, gapHint);

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON(
      attempt === 0
        ? `${SYSTEM_PROMPT}\n\n${prompt}`
        : `${SYSTEM_PROMPT}\n\n${prompt}\n\nYour previous reply was not valid JSON in the required shape. Return ONLY the JSON object.`,
    );
    const validated = validateRoadmap(raw, input.targetRole);
    if (validated) return validated;
    console.warn(`[roadmapAI] generation attempt ${attempt + 1} produced unusable output`);
  }
  return null;
}

// ─── Update after completion ──────────────────────────────────────────────────
export async function updateRoadmapAfterCompletion(
  roadmap: MilestoneRoadmap,
  completedIds: string[],
): Promise<MilestoneRoadmap | null> {
  if (!isAIConfigured) return null;

  const prompt = `The user is working through this roadmap toward "${roadmap.targetRole}".

CURRENT ROADMAP:
${JSON.stringify({ ...roadmap, targetRole: undefined, updatedAt: undefined })}

MILESTONES THE USER HAS NOW COMPLETED: ${completedIds.join(", ")}

Re-plan from here. Keep completed milestones with status "completed". Re-order what remains by priority and dependency given the new skills. Drop milestones that no longer make sense and add any that the completion now makes worthwhile. Exactly one remaining milestone must be "in_progress"; the rest "locked".

Return JSON in exactly this shape:
${SHAPE}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chatJSON(`${SYSTEM_PROMPT}\n\n${prompt}`);
    const validated = validateRoadmap(raw, roadmap.targetRole);
    if (validated) {
      // The model is asked to preserve completions; enforce it, because losing
      // a user's progress is far worse than an imperfect re-plan.
      const done = new Set(completedIds);
      const merged = validated.milestones.map((m) =>
        done.has(m.id) ? { ...m, status: "completed" as const } : m,
      );
      return { ...validated, milestones: enforceStatuses(merged) };
    }
  }
  return null;
}

// ─── Level up ─────────────────────────────────────────────────────────────────
export async function applyLevelUp(
  roadmap: MilestoneRoadmap,
  update: string,
  input: GenerateInput,
): Promise<MilestoneRoadmap | null> {
  return generateMilestoneRoadmap({
    ...input,
    extraContext: `Since the current roadmap was written, the user reports: ${update}\n\nPrevious roadmap milestones: ${roadmap.milestones.map((m) => `${m.title} (${m.status})`).join("; ")}\n\nDo not re-teach anything this update shows they have achieved.`,
  });
}

// ─── Diff ─────────────────────────────────────────────────────────────────────
/** Human-readable summary of what a re-plan changed. */
export function diffRoadmaps(before: MilestoneRoadmap, after: MilestoneRoadmap): RoadmapDiff {
  const beforeById = new Map(before.milestones.map((m) => [m.id, m]));
  const afterById = new Map(after.milestones.map((m) => [m.id, m]));
  const beforeOrder = before.milestones.map((m) => m.id);
  const afterOrder = after.milestones.map((m) => m.id);

  const unlocked = after.milestones
    .filter((m) => m.status !== "locked" && beforeById.get(m.id)?.status === "locked")
    .map((m) => m.title);

  const completed = after.milestones
    .filter((m) => m.status === "completed" && beforeById.get(m.id)?.status !== "completed")
    .map((m) => m.title);

  const added = after.milestones.filter((m) => !beforeById.has(m.id)).map((m) => m.title);
  const removed = before.milestones.filter((m) => !afterById.has(m.id)).map((m) => m.title);

  // Only count survivors that moved, so additions and removals are not
  // double-reported as reprioritisations.
  const reprioritized = afterOrder.filter((id, i) => {
    if (!beforeById.has(id)) return false;
    return beforeOrder.indexOf(id) !== i;
  }).length;

  return { unlocked, completed, added, removed, reprioritized };
}

export function describeDiff(d: RoadmapDiff): string {
  const parts: string[] = [];
  if (d.completed.length) parts.push(`${d.completed.length} completed`);
  if (d.unlocked.length) parts.push(`${d.unlocked.length} unlocked`);
  if (d.added.length) parts.push(`${d.added.length} added`);
  if (d.removed.length) parts.push(`${d.removed.length} removed`);
  if (d.reprioritized) parts.push(`${d.reprioritized} reprioritized`);
  return parts.length ? parts.join(" · ") : "No changes to your plan";
}

// ─── Per-milestone chat ───────────────────────────────────────────────────────
export interface ChatTurn { role: "user" | "assistant"; content: string }

function buildChatPrompt(
  milestone: Milestone,
  roadmap: MilestoneRoadmap,
  history: ChatTurn[],
  question: string,
): string {
  return `The user is working toward "${roadmap.targetRole}".

THE MILESTONE THEY ARE ASKING ABOUT:
${JSON.stringify(milestone)}

WHERE IT SITS IN THEIR ROADMAP:
${roadmap.milestones.map((m, i) => `${i + 1}. ${m.title} [${m.status}]`).join("\n")}

THEIR PROFILE: ${roadmap.profile_summary}
KNOWN GAPS: ${roadmap.gap_analysis}
${history.length ? `\nCONVERSATION SO FAR:\n${history.map((t) => `${t.role === "user" ? "User" : "You"}: ${t.content}`).join("\n")}` : ""}

USER'S QUESTION: ${question}`;
}

const CHAT_SYSTEM = `You are an expert career coach helping someone work through one specific milestone of their career roadmap.

Answer only what they asked, grounded in the milestone and roadmap given. Be concrete and practical.
Never give time estimates, deadlines or durations.
Keep it short — a few sentences or a short list. Plain text, no markdown headings.`;

/** Streams an answer, falling back to a single non-streamed reply. */
export async function askAboutMilestone(
  milestone: Milestone,
  roadmap: MilestoneRoadmap,
  history: ChatTurn[],
  question: string,
  onToken: (chunk: string, full: string) => void,
  signal?: { aborted: boolean },
): Promise<string | null> {
  const prompt = buildChatPrompt(milestone, roadmap, history, question);

  const streamed = await streamChat(prompt, { system: CHAT_SYSTEM, onToken, signal });
  if (streamed) return streamed;

  // Streaming can fail on networks that buffer the whole response; a plain
  // request still answers the question.
  const whole = await chatText(prompt, CHAT_SYSTEM);
  if (whole) onToken(whole, whole);
  return whole;
}
