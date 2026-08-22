// Device storage that also syncs to the account, so this context's state
// survives a reinstall and follows the user to a new phone. Same API.
import AsyncStorage from "@/services/syncedStorage";
import { chatJSON, isAIConfigured } from "@/services/aiClient";
import { useCV } from "@/context/CVContext";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";

// ─── Skill Status ─────────────────────────────────────────────────────────────
export type SkillStatus = "Pending" | "Learning" | "Mastered" | "Expert";

// ─── Skill ────────────────────────────────────────────────────────────────────
export interface Skill {
  id: string;
  name: string;
  status: SkillStatus;
  prerequisites: string[];
  /**
   * Days this skill is expected to take. Skills are not equal in size — a CSS
   * refresher is not a fortnight of distributed systems — so the roadmap
   * estimates each one instead of forcing everything into a uniform week.
   */
  estimatedDays: number;
  xpPoints: number;
  inCareerTrack: boolean;
}

// ─── RoadmapWeek ──────────────────────────────────────────────────────────────
export interface RoadmapWeek {
  id: string;
  weekNumber: number;
  topic: string;
  description: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  tasks: string[];
  resources: { title: string; url: string; type: "video" | "article" | "course" }[];
  skills: Skill[];
  isCompleted: boolean;
  isUnlocked: boolean;
  track: "job" | "career";
  addedAt: string;
}

// ─── Temporal Risk ────────────────────────────────────────────────────────────
export type RiskLevel = "SAFE" | "WATCH" | "ALERT" | "CRITICAL" | "EXPIRED";

export interface EmergencyStrategy {
  id: "accelerated" | "minimum_viable" | "apply_early" | "alternative_jobs";
  title: string;
  description: string;
  icon: string;
}

export interface AlternativeJob {
  id: string;
  title: string;
  company: string;
  matchPct: number;
  url: string;
}

export interface JobDeadline {
  jobId: string;
  jobTitle: string;
  company: string;
  deadlineDate: string;
  weeksToDeadline: number;
  riskLevel: RiskLevel;
  emergencyStrategies: EmergencyStrategy[];
  isExpired: boolean;
  alternativeJobs?: AlternativeJob[];
}

// ─── Legacy types (backward compat) ──────────────────────────────────────────
export interface RoadmapModule {
  id: string;
  week: number;
  topic: string;
  description: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  tasks: string[];
  resources: { title: string; url: string; type: "video" | "article" | "course" }[];
  completed: boolean;
}

export interface LegacyRoadmap {
  id: string;
  userId: string;
  title: string;
  role: string;
  level: string;
  modules: RoadmapModule[];
  createdAt: string;
}

// keep the old name exported for any remaining imports
export type Roadmap = LegacyRoadmap;

// ─── Context shape ────────────────────────────────────────────────────────────
export interface RoadmapState {
  // new API
  weeks: RoadmapWeek[];
  isGenerating: boolean;
  isDynamic: boolean;
  macroProgress: number;
  targetRole: string;
  careerTrackSkills: Skill[];
  jobDeadlines: JobDeadline[];
  lastRegeneratedAt: string | null;
  totalWeeks: number;
  completedWeeks: number;
  viewMode: "calendar" | "list";
  reducedMotion: boolean;
  highContrast: boolean;
  generateRoadmap: (
    skillGaps: string[],
    targetRole: string,
    experienceLevel?: string,
    jobDeadline?: { jobId: string; jobTitle: string; company: string; deadlineDate: string }
  ) => Promise<void>;
  toggleSkillStatus: (weekId: string, skillId: string) => Promise<void>;
  markWeekComplete: (weekId: string) => Promise<void>;
  clearRoadmap: () => Promise<void>;
  setViewMode: (mode: "calendar" | "list") => void;
  setReducedMotion: (v: boolean) => void;
  setHighContrast: (v: boolean) => void;
  switchTargetRole: (newRole: string) => Promise<void>;
  applyEmergencyStrategy: (jobId: string, strategyId: EmergencyStrategy["id"]) => void;
  promoteSkillToCareerTrack: (skillId: string) => Promise<void>;
  dismissExpiredJob: (jobId: string) => Promise<void>;
  // legacy compat
  roadmap: LegacyRoadmap | null;
  generateRoadmapLegacy: (skillGaps: string[], targetRole: string, experienceLevel?: string) => Promise<void>;
  toggleModule: (moduleId: string) => Promise<void>;
}

// ─── Emergency strategies ─────────────────────────────────────────────────────
const EMERGENCY_STRATEGIES: EmergencyStrategy[] = [
  { id: "accelerated", title: "Accelerated Path", description: "Focus on top 3 skills only. Cut each week to 3 days of intensive study.", icon: "⚡" },
  { id: "minimum_viable", title: "Minimum Viable Skills", description: "Apply with current skills. Many companies train on the job.", icon: "🎯" },
  { id: "apply_early", title: "Apply Early", description: "Send your application now while continuing to learn. Show momentum.", icon: "🚀" },
  { id: "alternative_jobs", title: "Alternative Jobs", description: "Explore similar roles with better timeline alignment.", icon: "🔄" },
];

// ─── Risk calculation ─────────────────────────────────────────────────────────
function calcRisk(daysToDeadline: number, daysOfWorkLeft: number): RiskLevel {
  if (daysToDeadline <= 0) return "EXPIRED";
  if (daysOfWorkLeft <= 0) return "SAFE";
  // Comparing estimated study days against calendar days left answers the real
  // question — is this reachable? Counting whole weeks against a week count
  // ignored that skills differ wildly in size.
  const ratio = daysToDeadline / daysOfWorkLeft;
  if (ratio > 1.5) return "SAFE";
  if (ratio > 1.1) return "WATCH";
  if (ratio > 0.8) return "ALERT";
  return "CRITICAL";
}

// ─── Role templates ───────────────────────────────────────────────────────────
type WeekTemplate = Pick<RoadmapWeek, "topic" | "description" | "level" | "tasks" | "resources">;

const TEMPLATES: Record<string, WeekTemplate[]> = {
  "frontend developer": [
    { topic: "Modern HTML & CSS Mastery", description: "Semantic HTML5, CSS Grid, Flexbox, responsive design.", level: "Beginner", tasks: ["Build a responsive portfolio", "Implement CSS Grid layouts", "Master Flexbox"], resources: [{ title: "CSS Grid — Kevin Powell", url: "https://www.youtube.com/watch?v=rg7Fvvl3taU", type: "video" }, { title: "MDN CSS", url: "https://developer.mozilla.org/en-US/docs/Web/CSS", type: "article" }] },
    { topic: "JavaScript Deep Dive", description: "Closures, async/await, the event loop, and prototype chain.", level: "Intermediate", tasks: ["Solve 10 JS challenges", "Build a Promise-based API client", "Understand the event loop"], resources: [{ title: "JavaScript.info", url: "https://javascript.info", type: "article" }, { title: "Async JS — freeCodeCamp", url: "https://www.freecodecamp.org/news/asynchronous-javascript/", type: "article" }] },
    { topic: "React & State Management", description: "Hooks, context, React Query, and performance patterns.", level: "Intermediate", tasks: ["Build a CRUD app with hooks", "Implement optimistic updates", "Add React Query"], resources: [{ title: "React Docs", url: "https://react.dev", type: "article" }, { title: "TanStack Query", url: "https://tanstack.com/query", type: "article" }] },
    { topic: "TypeScript Essentials", description: "Types, generics, strict mode, and utility types.", level: "Intermediate", tasks: ["Convert a JS project to TS", "Write 5 custom generic types", "Enable strict mode"], resources: [{ title: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs/handbook/", type: "article" }] },
    { topic: "Performance Optimization", description: "Lighthouse, bundle optimization, code splitting, lazy loading.", level: "Advanced", tasks: ["Achieve 90+ Lighthouse score", "Implement code splitting", "Reduce bundle size 30%"], resources: [{ title: "Web.dev Performance", url: "https://web.dev/performance", type: "article" }] },
    { topic: "Testing & CI/CD", description: "Unit, integration, E2E testing and deployment pipelines.", level: "Advanced", tasks: ["Write 20 unit tests", "Set up CI pipeline", "Add E2E with Playwright"], resources: [{ title: "Testing Library", url: "https://testing-library.com", type: "article" }] },
  ],
  "react native developer": [
    { topic: "React Native Fundamentals", description: "Components, StyleSheet, Flexbox in mobile context.", level: "Beginner", tasks: ["Build a Hello World app", "Style with StyleSheet", "Navigate between screens"], resources: [{ title: "React Native Docs", url: "https://reactnative.dev/docs/getting-started", type: "article" }] },
    { topic: "Navigation & Routing", description: "Expo Router and React Navigation patterns.", level: "Intermediate", tasks: ["Implement tab navigation", "Add stack navigation", "Handle deep links"], resources: [{ title: "Expo Router", url: "https://expo.github.io/router", type: "article" }] },
    { topic: "State & AsyncStorage", description: "Context, Zustand, and persistent storage patterns.", level: "Intermediate", tasks: ["Build a persistent todo app", "Add context for auth", "Implement a Zustand store"], resources: [{ title: "AsyncStorage Docs", url: "https://react-native-async-storage.github.io/async-storage/", type: "article" }] },
    { topic: "Animations with Reanimated", description: "Smooth 60fps animations using react-native-reanimated.", level: "Intermediate", tasks: ["Build a swipe card", "Implement spring animations", "Add gesture handling"], resources: [{ title: "Reanimated Docs", url: "https://docs.swmansion.com/react-native-reanimated/", type: "article" }] },
    { topic: "Native APIs & Permissions", description: "Camera, location, notifications, and device APIs.", level: "Advanced", tasks: ["Add camera support", "Request location permission", "Schedule a push notification"], resources: [{ title: "Expo SDK", url: "https://docs.expo.dev/versions/latest/", type: "article" }] },
    { topic: "Publishing & Performance", description: "EAS Build, OTA updates, and app store submission.", level: "Advanced", tasks: ["Configure EAS Build", "Submit to Play Store", "Set up OTA updates"], resources: [{ title: "EAS Build Docs", url: "https://docs.expo.dev/build/introduction/", type: "article" }] },
  ],
  "backend developer": [
    { topic: "Node.js & Express", description: "REST APIs, middleware, and request handling.", level: "Beginner", tasks: ["Build a REST API", "Add middleware chain", "Handle errors globally"], resources: [{ title: "Express.js Docs", url: "https://expressjs.com", type: "article" }] },
    { topic: "Database Design", description: "PostgreSQL, ORMs, and relational data modeling.", level: "Intermediate", tasks: ["Design a schema", "Write CRUD queries", "Add indexes"], resources: [{ title: "PostgreSQL Docs", url: "https://www.postgresql.org/docs/", type: "article" }] },
    { topic: "Authentication & Security", description: "JWT, OAuth, password hashing, and HTTPS.", level: "Intermediate", tasks: ["Implement JWT auth", "Add rate limiting", "Secure env vars"], resources: [{ title: "OWASP Top 10", url: "https://owasp.org/www-project-top-ten/", type: "article" }] },
    { topic: "Caching & Performance", description: "Redis, CDN, and query optimization.", level: "Advanced", tasks: ["Add Redis caching", "Optimize slow queries", "Profile API response times"], resources: [{ title: "Redis Docs", url: "https://redis.io/docs/", type: "article" }] },
    { topic: "Microservices & Docker", description: "Containerization, Docker Compose, service architecture.", level: "Advanced", tasks: ["Dockerize your app", "Set up Docker Compose", "Add health checks"], resources: [{ title: "Docker Docs", url: "https://docs.docker.com", type: "article" }] },
    { topic: "CI/CD & Deployment", description: "GitHub Actions, cloud deployment, monitoring.", level: "Advanced", tasks: ["Set up GitHub Actions", "Deploy to Railway or Render", "Add logging and alerts"], resources: [{ title: "GitHub Actions Docs", url: "https://docs.github.com/en/actions", type: "article" }] },
  ],
  "data scientist": [
    { topic: "Python for Data Science", description: "NumPy, Pandas, and data wrangling fundamentals.", level: "Beginner", tasks: ["Clean a real dataset", "Compute descriptive stats", "Plot distributions with matplotlib"], resources: [{ title: "Kaggle Python", url: "https://www.kaggle.com/learn/python", type: "course" }] },
    { topic: "Exploratory Data Analysis", description: "Visualization, correlation, and feature understanding.", level: "Intermediate", tasks: ["Create 5 insight charts", "Find top correlated features", "Write an EDA report"], resources: [{ title: "Seaborn Docs", url: "https://seaborn.pydata.org", type: "article" }] },
    { topic: "Machine Learning Foundations", description: "Scikit-learn, supervised learning, model evaluation.", level: "Intermediate", tasks: ["Train a classification model", "Compare 3 algorithms", "Tune hyperparameters"], resources: [{ title: "Scikit-learn Docs", url: "https://scikit-learn.org/stable/", type: "article" }] },
    { topic: "Deep Learning Basics", description: "Neural networks with TensorFlow/Keras.", level: "Advanced", tasks: ["Build an image classifier", "Train an LSTM", "Use transfer learning"], resources: [{ title: "TensorFlow Tutorials", url: "https://www.tensorflow.org/tutorials", type: "article" }] },
    { topic: "MLOps & Deployment", description: "Model serving, MLflow, and production pipelines.", level: "Advanced", tasks: ["Deploy model as API", "Track experiments with MLflow", "Build a retraining pipeline"], resources: [{ title: "MLflow Docs", url: "https://mlflow.org/docs/latest/index.html", type: "article" }] },
    { topic: "Portfolio & Communication", description: "Kaggle competitions, GitHub, and stakeholder storytelling.", level: "Advanced", tasks: ["Enter a Kaggle comp", "Write a case study blog post", "Build a Streamlit dashboard"], resources: [{ title: "Kaggle Competitions", url: "https://www.kaggle.com/competitions", type: "course" }] },
  ],
};

const DEFAULT_TEMPLATE: WeekTemplate[] = [
  { topic: "Core Foundations", description: "Master the fundamental concepts and tooling for your target role.", level: "Beginner", tasks: ["Complete the setup guide", "Run your first project", "Review core concepts"], resources: [{ title: "Official Documentation", url: "https://developer.mozilla.org", type: "article" }] },
  { topic: "Essential Skills I", description: "Build the primary skill set required for entry-level work.", level: "Beginner", tasks: ["Build a sample project", "Study real-world examples", "Practice daily exercises"], resources: [{ title: "freeCodeCamp", url: "https://freecodecamp.org", type: "course" }] },
  { topic: "Essential Skills II", description: "Deepen your understanding with hands-on challenges.", level: "Intermediate", tasks: ["Solve 5 practice problems", "Read industry articles", "Join a community"], resources: [{ title: "Dev.to Community", url: "https://dev.to", type: "article" }] },
  { topic: "Real-World Project", description: "Apply your skills to a real project from scratch.", level: "Intermediate", tasks: ["Plan your project", "Build an MVP", "Write documentation"], resources: [{ title: "GitHub", url: "https://github.com", type: "article" }] },
  { topic: "Advanced Concepts", description: "Dive into patterns, best practices, and performance.", level: "Advanced", tasks: ["Study architecture patterns", "Optimize your project", "Add automated tests"], resources: [{ title: "Web.dev", url: "https://web.dev", type: "article" }] },
  { topic: "Portfolio & Interview Prep", description: "Polish your portfolio and prepare for technical interviews.", level: "Advanced", tasks: ["Deploy your project", "Prep 10 interview questions", "Update your resume"], resources: [{ title: "LeetCode", url: "https://leetcode.com", type: "course" }] },
];

const CAREER_EXTRAS: WeekTemplate[] = [
  { topic: "Soft Skills & Communication", description: "Communicate effectively in technical teams.", level: "Beginner", tasks: ["Write a technical blog post", "Do a mock presentation", "Contribute to open source"], resources: [{ title: "Communication Skills", url: "https://www.coursera.org/learn/communication-skills", type: "course" }] },
  { topic: "Career Growth & Networking", description: "LinkedIn, portfolio, and professional network.", level: "Intermediate", tasks: ["Optimize LinkedIn profile", "Attend a virtual meetup", "Send 5 connection requests with notes"], resources: [{ title: "LinkedIn Learning", url: "https://linkedin.com/learning", type: "course" }] },
];

function getTemplate(role: string): WeekTemplate[] {
  return TEMPLATES[role.toLowerCase()] ?? DEFAULT_TEMPLATE;
}

/** Baseline effort by difficulty. Advanced material genuinely takes longer. */
const DAYS_BY_LEVEL: Record<WeekTemplate["level"], number> = {
  Beginner: 3,
  Intermediate: 5,
  Advanced: 8,
};

function buildSkills(
  topic: string,
  weekId: string,
  prevIds: string[],
  level: WeekTemplate["level"] = "Intermediate",
): Skill[] {
  const names = topic.split(/\s*[&+]\s*|\s+and\s+/i).flatMap((s) => s.trim().split(/\s*,\s*/)).filter(Boolean).slice(0, 3);
  return names.map((name, i) => ({
    id: `${weekId}_s${i}`,
    name: name.trim(),
    status: "Pending" as SkillStatus,
    prerequisites: i > 0 ? prevIds.slice(0, 1) : [],
    // Later skills in a topic build on the earlier ones, so they run slightly
    // longer; the first is the entry point.
    estimatedDays: DAYS_BY_LEVEL[level] + i,
    xpPoints: 0,
    inCareerTrack: false,
  }));
}

/**
 * Backfills estimatedDays on roadmaps saved before skills carried durations.
 * Without this an existing roadmap reports every stage as ~0 days, and the
 * deadline feasibility check silently concludes there is no work left.
 */
function withEstimates(weeks: RoadmapWeek[]): RoadmapWeek[] {
  return weeks.map((w) => ({
    ...w,
    skills: w.skills.map((s, i) =>
      s.estimatedDays
        ? s
        : { ...s, estimatedDays: (DAYS_BY_LEVEL[w.level] ?? 5) + i },
    ),
  }));
}

/** Days a week of work actually represents — the sum of its skills. */
export function weekDays(week: RoadmapWeek): number {
  return week.skills.reduce((sum, s) => sum + (s.estimatedDays || 0), 0);
}

/** Estimated days of study still outstanding across the roadmap. */
export function remainingDays(weeks: RoadmapWeek[]): number {
  return weeks
    .filter((w) => !w.isCompleted)
    .reduce(
      (sum, w) =>
        sum + w.skills.filter((s) => s.status !== "Mastered" && s.status !== "Expert")
          .reduce((a, s) => a + (s.estimatedDays || 0), 0),
      0,
    );
}

/**
 * Days until a deadline, computed from the date every time it is read.
 * It was previously stored on the deadline at creation and never recomputed,
 * so the countdown sat frozen at whatever it was when the roadmap was built.
 */
export function daysUntil(deadlineDate: string): number {
  return Math.ceil((new Date(deadlineDate).getTime() - Date.now()) / 86_400_000);
}

// ─── AI-generated plan ────────────────────────────────────────────────────────
/**
 * Builds the week list from the candidate's actual CV and target role.
 *
 * The roadmap used to come from getTemplate(role): four hand-written templates
 * of six weeks each, plus two career extras, so every plan was exactly eight
 * weeks and any role outside those four got a generic default. The skill gaps
 * were passed into generateRoadmap and then ignored — the parameter was even
 * named `_skillGaps`. Two people with the same target role and completely
 * different CVs received identical plans.
 *
 * The length is deliberately not fixed. Someone missing one framework needs a
 * few weeks; someone changing discipline needs far more, and padding the first
 * or truncating the second is what made the old output feel canned.
 *
 * Returns null when unavailable or malformed, and the caller falls back to the
 * templates — the same contract every other AI call in this app uses.
 */
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
const RESOURCE_TYPES = ["video", "article", "course"] as const;

function sanitizeWeeks(raw: any): WeekTemplate[] | null {
  const list = Array.isArray(raw?.weeks) ? raw.weeks : null;
  if (!list?.length) return null;

  const weeks = list.slice(0, 16).map((w: any): WeekTemplate | null => {
    const topic = typeof w?.topic === "string" ? w.topic.trim() : "";
    if (!topic) return null;
    const tasks = Array.isArray(w?.tasks)
      ? w.tasks.filter((t: any) => typeof t === "string" && t.trim()).slice(0, 6)
      : [];
    const resources = Array.isArray(w?.resources)
      ? w.resources
          .filter((r: any) => typeof r?.title === "string" && typeof r?.url === "string")
          .slice(0, 4)
          .map((r: any) => ({
            title: r.title,
            url: r.url,
            type: RESOURCE_TYPES.includes(r.type) ? r.type : "article",
          }))
      : [];
    return {
      topic,
      description: typeof w?.description === "string" ? w.description : "",
      level: LEVELS.includes(w?.level) ? w.level : "Intermediate",
      tasks: tasks.length ? tasks : ["Study the core concepts", "Build something with it", "Review and take notes"],
      resources,
    };
  }).filter(Boolean) as WeekTemplate[];

  return weeks.length ? weeks : null;
}

async function generatePlanWithAI(opts: {
  role: string;
  experienceLevel: string;
  gaps: string[];
  cvSkills: string[];
  cvText: string;
}): Promise<WeekTemplate[] | null> {
  if (!isAIConfigured) return null;
  const { role, experienceLevel, gaps, cvSkills, cvText } = opts;

  const prompt = `You are building a personalised learning roadmap for a candidate.

TARGET ROLE: ${role}
STATED EXPERIENCE LEVEL: ${experienceLevel}
SKILLS THE CANDIDATE ALREADY HAS (from their CV): ${cvSkills.length ? cvSkills.join(", ") : "unknown"}
KNOWN GAPS FOR THIS ROLE: ${gaps.length ? gaps.join(", ") : "infer them from the CV and target role"}

CV EXCERPT:
${(cvText || "No CV text supplied.").slice(0, 4000)}

Produce a roadmap that closes the distance between this specific CV and this specific target role.

Rules:
- Do NOT teach what the candidate already demonstrably knows. Skip it entirely.
- Choose the NUMBER of weeks based on how large the real gap is: as few as 3 if they are nearly ready, as many as 16 for a career change. Do not default to a round number.
- Order weeks so each builds on the previous one.
- "level" must be exactly one of: Beginner, Intermediate, Advanced.
- Every resource URL must be a real, well-known, currently live page (official docs, freeCodeCamp, MDN, Coursera and similar). Never invent a URL.
- 3 to 5 concrete, checkable tasks per week.

Return ONLY JSON:
{"weeks":[{"topic":"string","description":"string","level":"Beginner|Intermediate|Advanced","tasks":["string"],"resources":[{"title":"string","url":"string","type":"video|article|course"}]}]}`;

  try {
    return sanitizeWeeks(await chatJSON(prompt));
  } catch {
    return null;
  }
}

function buildWeeks(templates: WeekTemplate[], track: "job" | "career", startWeek = 1): RoadmapWeek[] {
  let prevIds: string[] = [];
  return templates.map((t, i) => {
    const id = `w${startWeek + i}_${track}_${Date.now() + i}`;
    const skills = buildSkills(t.topic, id, prevIds, t.level);
    prevIds = skills.map((s) => s.id);
    return {
      id,
      weekNumber: startWeek + i,
      topic: t.topic,
      description: t.description,
      level: t.level,
      tasks: t.tasks,
      resources: t.resources,
      skills,
      isCompleted: false,
      isUnlocked: i === 0 && startWeek === 1,
      track,
      addedAt: new Date().toISOString(),
    } satisfies RoadmapWeek;
  });
}

// ─── Context ──────────────────────────────────────────────────────────────────
const RoadmapContext = createContext<RoadmapState | null>(null);

export function RoadmapProvider({ children }: { children: React.ReactNode }) {
  // The roadmap is only meaningful against the candidate's actual CV.
  const { cvProfile } = useCV();
  const { user } = useAuth();
  // Every stored key is scoped to the active role: two target roles mean two
  // independent roadmaps, and without this the second would overwrite the first.
  const roleKey = user?.activeRoleId || "default";
  const [weeks, setWeeks] = useState<RoadmapWeek[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [targetRole, setTargetRole] = useState("");
  const [careerTrackSkills, setCareerTrackSkills] = useState<Skill[]>([]);
  const [jobDeadlines, setJobDeadlines] = useState<JobDeadline[]>([]);
  const [lastRegeneratedAt, setLastRegeneratedAt] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<"calendar" | "list">("list");
  const [reducedMotion, setReducedMotionState] = useState(false);
  const [highContrast, setHighContrastState] = useState(false);
  const lastDynamicUpdate = useRef<number>(0);

  // ── Persist helpers ──────────────────────────────────────────────────────────
  const save = useCallback(
    async (w: RoadmapWeek[], c: Skill[], d: JobDeadline[], r: string) => {
      if (!user) return;
      await Promise.all([
        AsyncStorage.setItem(`rm_weeks_${user.id}_${roleKey}`, JSON.stringify(w)),
        AsyncStorage.setItem(`rm_career_${user.id}_${roleKey}`, JSON.stringify(c)),
        AsyncStorage.setItem(`rm_dead_${user.id}_${roleKey}`, JSON.stringify(d)),
        AsyncStorage.setItem(`rm_role_${user.id}_${roleKey}`, r),
      ]);
    },
    [user]
  );

  const saveSettings = useCallback(
    async (vm: "calendar" | "list", rm: boolean, hc: boolean) => {
      if (!user) return;
      await AsyncStorage.setItem(`rm_settings_${user.id}_${roleKey}`, JSON.stringify({ vm, rm, hc }));
    },
    [user]
  );

  // ── Load on mount ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [wRaw, cRaw, dRaw, rRaw, sRaw] = await Promise.all([
          AsyncStorage.getItem(`rm_weeks_${user.id}_${roleKey}`),
          AsyncStorage.getItem(`rm_career_${user.id}_${roleKey}`),
          AsyncStorage.getItem(`rm_dead_${user.id}_${roleKey}`),
          AsyncStorage.getItem(`rm_role_${user.id}_${roleKey}`),
          AsyncStorage.getItem(`rm_settings_${user.id}_${roleKey}`),
          // also check legacy key
          AsyncStorage.getItem(`roadmap_${user.id}`),
        ]);
        // Assign unconditionally, including the empty case. Switching to a
        // role that has no roadmap yet must clear the previous role's data —
        // otherwise the new role appears to already have a roadmap, and the
        // next save would write the old weeks under the new role's key.
        setWeeks(wRaw ? withEstimates(JSON.parse(wRaw)) : []);
        setCareerTrackSkills(cRaw ? JSON.parse(cRaw) : []);
        setJobDeadlines(dRaw ? JSON.parse(dRaw) : []);
        setTargetRole(rRaw ?? "");
        if (sRaw) {
          const s = JSON.parse(sRaw);
          if (s.vm) setViewModeState(s.vm);
          if (typeof s.rm === "boolean") setReducedMotionState(s.rm);
          if (typeof s.hc === "boolean") setHighContrastState(s.hc);
        }
      } catch (_) {}
    })();
  }, [user, roleKey]);

  // ── Computed ─────────────────────────────────────────────────────────────────
  const completedWeeks = weeks.filter((w) => w.isCompleted).length;
  const totalWeeks = weeks.length;
  const macroProgress = totalWeeks > 0 ? Math.round((completedWeeks / totalWeeks) * 100) : 0;

  // ── Dynamic duration engine ───────────────────────────────────────────────────
  const applyDynamic = useCallback(
    (current: RoadmapWeek[], role: string): RoadmapWeek[] => {
      const now = Date.now();
      // Throttle: max 2 structural changes per 12 hours
      if (now - lastDynamicUpdate.current < 43_200_000) return current;
      lastDynamicUpdate.current = now;

      const done = current.filter((w) => w.isCompleted).length;
      const pace = done / Math.max(current.length, 1);
      let next = [...current];

      // Fast learner (>70% done and < 12 weeks) → add advanced week
      if (pace > 0.7 && next.length < 12) {
        const last = next[next.length - 1];
        const id = `w_extra_${now}`;
        next.push({
          id,
          weekNumber: next.length + 1,
          topic: "Advanced Specialization",
          description: "Go deeper with advanced patterns and real-world architecture challenges.",
          level: "Advanced",
          tasks: ["Study system design", "Build a complex feature", "Review senior-level code"],
          resources: [{ title: "System Design Primer", url: "https://github.com/donnemartin/system-design-primer", type: "article" }],
          skills: buildSkills("Advanced Specialization", id, last?.skills.map((s) => s.id) ?? [], "Advanced"),
          isCompleted: false,
          isUnlocked: last?.isCompleted ?? false,
          track: "career",
          addedAt: new Date().toISOString(),
        });
      }

      // Stalled learner (0% after 4+ weeks) → trim last uncompleted week
      if (pace === 0 && next.length > 4) {
        const lastUncompleted = [...next].reverse().find((w) => !w.isCompleted);
        if (lastUncompleted) next = next.filter((w) => w.id !== lastUncompleted.id);
      }

      return next;
    },
    []
  );

  // ── Generate ─────────────────────────────────────────────────────────────────
  const generateRoadmap = useCallback(
    async (
      skillGaps: string[],
      role: string,
      experienceLevel = "Intermediate",
      jobDeadline?: { jobId: string; jobTitle: string; company: string; deadlineDate: string }
    ) => {
      if (!user) return;
      setIsGenerating(true);
      try {
        // Ask for a plan built from this CV and this role. Its length reflects
        // the size of the real gap rather than a fixed six-week template.
        const aiWeeks = await generatePlanWithAI({
          role,
          experienceLevel,
          gaps: skillGaps ?? [],
          cvSkills: cvProfile?.skills ?? [],
          cvText: cvProfile?.rawText ?? "",
        });

        const jobWeeks = buildWeeks(aiWeeks ?? getTemplate(role), "job", 1);
        // The career track stays template-driven on purpose: communication,
        // open-source contribution and portfolio work do not vary by target
        // role the way technical gaps do.
        const careerWeeks = buildWeeks(CAREER_EXTRAS, "career", jobWeeks.length + 1);
        const allWeeks = [...jobWeeks, ...careerWeeks];

        const newDeadlines = [...jobDeadlines];
        if (jobDeadline) {
          const daysLeft = daysUntil(jobDeadline.deadlineDate);
          const dl: JobDeadline = {
            ...jobDeadline,
            weeksToDeadline: Math.round(daysLeft / 7),
            riskLevel: calcRisk(daysLeft, remainingDays(allWeeks)),
            emergencyStrategies: EMERGENCY_STRATEGIES,
            isExpired: daysLeft <= 0,
            alternativeJobs: [],
          };
          const idx = newDeadlines.findIndex((d) => d.jobId === jobDeadline.jobId);
          if (idx >= 0) newDeadlines[idx] = dl;
          else newDeadlines.push(dl);
        }

        setWeeks(allWeeks);
        setTargetRole(role);
        setJobDeadlines(newDeadlines);
        setLastRegeneratedAt(new Date().toISOString());
        await save(allWeeks, careerTrackSkills, newDeadlines, role);
      } finally {
        setIsGenerating(false);
      }
    },
    [user, jobDeadlines, careerTrackSkills, save]
  );

  // ── Toggle skill ─────────────────────────────────────────────────────────────
  const toggleSkillStatus = useCallback(
    async (weekId: string, skillId: string) => {
      const CYCLE: SkillStatus[] = ["Pending", "Learning", "Mastered", "Expert"];
      const next = weeks.map((w) => {
        if (w.id !== weekId) return w;
        const skills = w.skills.map((s) => {
          if (s.id !== skillId) return s;
          const idx = CYCLE.indexOf(s.status);
          return { ...s, status: CYCLE[(idx + 1) % CYCLE.length], xpPoints: Math.min(100, s.xpPoints + 25) };
        });
        return { ...w, skills };
      });

      // Unlock next week when all current week skills are Mastered/Expert
      const withUnlock = next.map((w, i) => {
        if (i === 0) return { ...w, isUnlocked: true };
        const prev = next[i - 1];
        const allDone = prev.skills.every((s) => s.status === "Mastered" || s.status === "Expert");
        return allDone ? { ...w, isUnlocked: true } : w;
      });

      setWeeks(withUnlock);
      await save(withUnlock, careerTrackSkills, jobDeadlines, targetRole);
    },
    [weeks, careerTrackSkills, jobDeadlines, targetRole, save]
  );

  // ── Mark week complete ────────────────────────────────────────────────────────
  const markWeekComplete = useCallback(
    async (weekId: string) => {
      const updated = weeks.map((w, i) => {
        if (w.id === weekId) {
          return { ...w, isCompleted: true, skills: w.skills.map((s) => ({ ...s, status: "Mastered" as SkillStatus, xpPoints: 100 })) };
        }
        if (i > 0 && weeks[i - 1].id === weekId) return { ...w, isUnlocked: true };
        return w;
      });

      const withDynamic = applyDynamic(updated, targetRole);

      // Promote skills to career track
      const completedWeek = weeks.find((w) => w.id === weekId);
      const newCareer = [...careerTrackSkills];
      if (completedWeek) {
        completedWeek.skills.forEach((s) => {
          if (!newCareer.find((c) => c.name === s.name)) {
            newCareer.push({ ...s, inCareerTrack: true, status: "Mastered" });
          }
        });
      }

      // Refresh deadlines risk level
      const newDeadlines = jobDeadlines.map((d) => {
        const daysLeft = daysUntil(d.deadlineDate);
        return {
          ...d,
          weeksToDeadline: Math.round(daysLeft / 7),
          isExpired: daysLeft <= 0,
          riskLevel: calcRisk(daysLeft, remainingDays(withDynamic)),
        };
      });

      setWeeks(withDynamic);
      setCareerTrackSkills(newCareer);
      setJobDeadlines(newDeadlines);
      setLastRegeneratedAt(new Date().toISOString());
      await save(withDynamic, newCareer, newDeadlines, targetRole);
    },
    [weeks, targetRole, careerTrackSkills, jobDeadlines, save, applyDynamic]
  );

  // ── Switch role ───────────────────────────────────────────────────────────────
  const switchTargetRole = useCallback(
    async (newRole: string) => {
      await generateRoadmap([], newRole, "Intermediate");
    },
    [generateRoadmap]
  );

  // ── Emergency strategy ────────────────────────────────────────────────────────
  const applyEmergencyStrategy = useCallback(
    (_jobId: string, strategyId: EmergencyStrategy["id"]) => {
      if (strategyId === "accelerated") {
        setWeeks((w) => w.filter((wk) => wk.track === "job").map((wk) => ({ ...wk, tasks: wk.tasks.slice(0, 2) })));
      } else if (strategyId === "minimum_viable") {
        setWeeks((w) => w.map((wk) => ({ ...wk, isUnlocked: wk.level === "Beginner" ? true : wk.isUnlocked })));
      }
      // apply_early and alternative_jobs are informational only
    },
    []
  );

  // ── Promote skill to career track ─────────────────────────────────────────────
  const promoteSkillToCareerTrack = useCallback(
    async (skillId: string) => {
      let found: Skill | null = null;
      weeks.forEach((w) => { const s = w.skills.find((sk) => sk.id === skillId); if (s) found = s; });
      if (!found || careerTrackSkills.find((s) => s.id === skillId)) return;
      const foundSkill = found as Skill;
      const updated = [...careerTrackSkills, { ...foundSkill, inCareerTrack: true, status: "Mastered" as SkillStatus }];
      setCareerTrackSkills(updated);
      await save(weeks, updated, jobDeadlines, targetRole);
    },
    [weeks, careerTrackSkills, jobDeadlines, targetRole, save]
  );

  // ── Dismiss expired job ───────────────────────────────────────────────────────
  const dismissExpiredJob = useCallback(
    async (jobId: string) => {
      const newDeadlines = jobDeadlines.filter((d) => d.jobId !== jobId);
      const newWeeks = weeks.map((w) => (w.track === "job" ? { ...w, track: "career" as const } : w));
      setJobDeadlines(newDeadlines);
      setWeeks(newWeeks);
      await save(newWeeks, careerTrackSkills, newDeadlines, targetRole);
    },
    [weeks, jobDeadlines, careerTrackSkills, targetRole, save]
  );

  // ── Clear ─────────────────────────────────────────────────────────────────────
  const clearRoadmap = useCallback(async () => {
    if (!user) return;
    setWeeks([]); setCareerTrackSkills([]); setJobDeadlines([]); setTargetRole("");
    await Promise.all([
      AsyncStorage.removeItem(`rm_weeks_${user.id}_${roleKey}`),
      AsyncStorage.removeItem(`rm_career_${user.id}_${roleKey}`),
      AsyncStorage.removeItem(`rm_dead_${user.id}_${roleKey}`),
      AsyncStorage.removeItem(`rm_role_${user.id}_${roleKey}`),
      AsyncStorage.removeItem(`roadmap_${user.id}`), // legacy
    ]);
  }, [user, roleKey]);

  // ── Settings ──────────────────────────────────────────────────────────────────
  const setViewMode = useCallback((m: "calendar" | "list") => { setViewModeState(m); saveSettings(m, reducedMotion, highContrast); }, [reducedMotion, highContrast, saveSettings]);
  const setReducedMotion = useCallback((v: boolean) => { setReducedMotionState(v); saveSettings(viewMode, v, highContrast); }, [viewMode, highContrast, saveSettings]);
  const setHighContrast = useCallback((v: boolean) => { setHighContrastState(v); saveSettings(viewMode, reducedMotion, v); }, [viewMode, reducedMotion, saveSettings]);

  // ── Legacy compat ─────────────────────────────────────────────────────────────
  const legacyRoadmap: LegacyRoadmap | null = weeks.length > 0 ? {
    id: `lr_${user?.id}`,
    userId: user?.id ?? "",
    title: `${targetRole} Roadmap`,
    role: targetRole,
    level: "Intermediate",
    modules: weeks.map((w) => ({ id: w.id, week: w.weekNumber, topic: w.topic, description: w.description, level: w.level, tasks: w.tasks, resources: w.resources, completed: w.isCompleted })),
    createdAt: lastRegeneratedAt ?? new Date().toISOString(),
  } : null;

  const generateRoadmapLegacy = useCallback(
    (skillGaps: string[], role: string, experienceLevel?: string) => generateRoadmap(skillGaps, role, experienceLevel),
    [generateRoadmap]
  );

  const toggleModule = useCallback(
    async (moduleId: string) => {
      const w = weeks.find((wk) => wk.id === moduleId);
      if (!w) return;
      if (w.isCompleted) {
        const u = weeks.map((wk) => wk.id === moduleId ? { ...wk, isCompleted: false } : wk);
        setWeeks(u); await save(u, careerTrackSkills, jobDeadlines, targetRole);
      } else {
        await markWeekComplete(moduleId);
      }
    },
    [weeks, careerTrackSkills, jobDeadlines, targetRole, save, markWeekComplete]
  );

  return (
    <RoadmapContext.Provider value={{
      weeks, isGenerating, isDynamic: true, macroProgress, targetRole,
      careerTrackSkills, jobDeadlines, lastRegeneratedAt, totalWeeks, completedWeeks,
      viewMode, reducedMotion, highContrast,
      generateRoadmap, toggleSkillStatus, markWeekComplete, clearRoadmap,
      setViewMode, setReducedMotion, setHighContrast,
      switchTargetRole, applyEmergencyStrategy, promoteSkillToCareerTrack, dismissExpiredJob,
      roadmap: legacyRoadmap, generateRoadmapLegacy, toggleModule,
    }}>
      {children}
    </RoadmapContext.Provider>
  );
}

export function useRoadmap() {
  const ctx = useContext(RoadmapContext);
  if (!ctx) throw new Error("useRoadmap must be used within RoadmapProvider");
  return ctx;
}
