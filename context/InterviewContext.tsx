/**
 * InterviewContext — sessions, retention and progress.
 *
 * Storage keys are `iv_*`, deliberately not the `interview_*` key the previous
 * engine used. That data is still in the account and has a different shape;
 * reusing the key would load it into this model and crash the tab on open,
 * which is exactly how the rebuilt CV engine broke on its first run.
 *
 * Everything is scoped per role. A user targeting two roles has two banks of
 * weak questions, two streaks of mastery and two histories, because progress
 * against "Backend Engineer" says nothing about "Product Manager".
 */
import AsyncStorage from "@/services/syncedStorage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { drawQuestions, describeDrawFailure, type BankQuestion, type Difficulty } from "@/services/interviewApi";
import { reviewAnswer, quickScore } from "@/services/interviewAI";
import { scoreAnswer, MASTERY_THRESHOLD } from "@/services/interviewScoring";

// ─── Model ────────────────────────────────────────────────────────────────────
export type Preset = "standard" | "quickfire";
export const SESSION_LENGTHS = [5, 10, 15, 20] as const;

export interface SessionConfig {
  difficulty: Difficulty;
  length: number;
  timed: boolean;
  preset: Preset;
}

export const DEFAULT_CONFIG: SessionConfig = {
  difficulty: "Mid",
  length: 10,
  timed: false,
  preset: "standard",
};

/** Seconds allowed per question when timed, by difficulty. */
export const TIME_LIMITS: Record<Difficulty, number> = { Junior: 90, Mid: 120, Senior: 180 };

export interface AnswerRecord {
  questionId: string;
  question: string;
  idealAnswer: string;
  keywords: string[];
  competency: string;
  difficulty: Difficulty;
  type: string;
  userAnswer: string;
  score: number;
  takeaways: string[];
  matched: string[];
  missed: string[];
  /** 1-5, or null if the user skipped the confidence check. */
  confidence: number | null;
  secondsTaken: number;
  reviewedByAI: boolean;
  /** True when this question was resurfaced by The Comeback. */
  isComeback: boolean;
}

export interface StoredSession {
  id: string;
  role: string;
  difficulty: Difficulty;
  preset: Preset;
  timed: boolean;
  startedAt: string;
  completedAt: string;
  overallScore: number;
  xpEarned: number;
  answers: AnswerRecord[];
}

/** A question answered below the mastery threshold, kept for recall. */
export interface WeakQuestion {
  questionId: string;
  question: string;
  idealAnswer: string;
  keywords: string[];
  competency: string;
  difficulty: Difficulty;
  type: string;
  lastScore: number;
  attempts: number;
  lastSeenAt: string;
}

export interface Progress {
  xp: number;
  streakCount: number;
  /** YYYY-MM-DD of the last day a session was completed. */
  lastPracticeDay: string | null;
  badges: string[];
  /** Ids already asked, so a session does not repeat itself. */
  seenQuestionIds: string[];
  weakQuestions: WeakQuestion[];
}

const EMPTY_PROGRESS: Progress = {
  xp: 0, streakCount: 0, lastPracticeDay: null, badges: [], seenQuestionIds: [], weakQuestions: [],
};

/** A live session in progress. */
export interface ActiveSession {
  id: string;
  role: string;
  config: SessionConfig;
  questions: (BankQuestion & { isComeback: boolean })[];
  answers: AnswerRecord[];
  index: number;
  startedAt: string;
}

export interface CompetencyMastery {
  competency: string;
  /** Mean score across every answer in this competency, 0-100. */
  score: number;
  answered: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const dayOf = (iso: string) => iso.slice(0, 10);

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * The streak after practising on `day`.
 *
 * Practising twice in one day does not advance it, and a missed day resets to
 * 1 rather than 0 — the session that broke the streak is itself day one of the
 * next one, and resetting to zero would make a returning user feel they had
 * earned nothing.
 */
export function nextStreak(lastPracticeDay: string | null, day: string, current: number): number {
  if (lastPracticeDay === day) return Math.max(current, 1);
  if (lastPracticeDay && daysBetween(lastPracticeDay, day) === 1) return current + 1;
  return 1;
}

/**
 * XP for one answer.
 *
 * Scaled by score so a wrong answer still earns something for the attempt —
 * practice that is punished is practice that stops — but a strong answer is
 * worth several times as much. Harder levels pay more because the same score is
 * harder to reach there.
 */
const DIFFICULTY_XP: Record<Difficulty, number> = { Junior: 1, Mid: 1.5, Senior: 2 };
export function xpForAnswer(score: number, difficulty: Difficulty): number {
  return Math.round((2 + (score / 100) * 10) * DIFFICULTY_XP[difficulty]);
}

/** Evocative names for the competencies the seed bank uses most. */
const BADGE_TITLES: Record<string, string> = {
  "system design": "Design Guru",
  "algorithms": "Algorithm Ace",
  "fundamentals": "Fundamentals Ace",
  "data structures": "Structure Sage",
  "databases": "Query Master",
  "concurrency": "Race Condition Wrangler",
  "security": "Threat Hunter",
  "scalability": "Scale Architect",
  "reliability": "Uptime Keeper",
  "communication": "Clear Communicator",
  "react": "React Ace",
  "javascript": "JavaScript Ace",
  "performance": "Speed Merchant",
  "accessibility": "Access Champion",
  "statistics": "Stats Sage",
  "modelling": "Model Maker",
  "experimentation": "Experiment Designer",
  "prioritisation": "Ruthless Prioritiser",
  "stakeholders": "Stakeholder Whisperer",
};

export function badgeNameFor(competency: string): string {
  return BADGE_TITLES[competency.toLowerCase().trim()] ?? `${competency} Ace`;
}

/** A competency is mastered at 80+ across at least five answers. */
const BADGE_MIN_ANSWERS = 5;
const BADGE_MIN_SCORE = 80;

export function earnedBadges(mastery: CompetencyMastery[], sessions: StoredSession[], streak: number): string[] {
  const out = new Set<string>();
  for (const m of mastery) {
    if (m.answered >= BADGE_MIN_ANSWERS && m.score >= BADGE_MIN_SCORE) out.add(badgeNameFor(m.competency));
  }
  if (sessions.length >= 1) out.add("First Session");
  if (sessions.length >= 10) out.add("Ten Sessions");
  if (sessions.length >= 50) out.add("Fifty Sessions");
  if (streak >= 3) out.add("3-Day Streak");
  if (streak >= 7) out.add("7-Day Streak");
  if (streak >= 30) out.add("30-Day Streak");
  if (sessions.some((s) => s.overallScore === 100)) out.add("Flawless");
  return [...out];
}

/**
 * Average score per competency across every answer.
 *
 * Derived rather than stored, so it can never drift from the sessions it is
 * supposed to summarise.
 */
export function masteryFrom(sessions: StoredSession[]): CompetencyMastery[] {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const s of sessions) {
    for (const a of s.answers) {
      const key = a.competency || "General";
      const cur = acc.get(key) ?? { sum: 0, n: 0 };
      acc.set(key, { sum: cur.sum + a.score, n: cur.n + 1 });
    }
  }
  return [...acc.entries()]
    .map(([competency, v]) => ({ competency, score: Math.round(v.sum / v.n), answered: v.n }))
    .sort((a, b) => b.answered - a.answered);
}

/**
 * How well calibrated the user's self-assessment is.
 *
 * Confidence is 1-5 and scores are 0-100, so confidence is scaled onto the same
 * range before comparing. A positive gap means they thought they knew it better
 * than they did, which is the blind spot worth surfacing.
 */
export function confidenceGap(sessions: StoredSession[]): { gap: number; samples: number } {
  let sum = 0, n = 0;
  for (const s of sessions) {
    for (const a of s.answers) {
      if (a.confidence == null) continue;
      sum += ((a.confidence - 1) / 4) * 100 - a.score;
      n++;
    }
  }
  return { gap: n ? Math.round(sum / n) : 0, samples: n };
}

// Sessions are kept for the history chart and mastery. Capped because the whole
// list is one synced document, and an unbounded one eventually fails to save.
const MAX_SESSIONS = 60;
const MAX_WEAK = 80;
const MAX_SEEN = 400;

// ─── Context ──────────────────────────────────────────────────────────────────
interface InterviewContextType {
  ready: boolean;
  role: string;
  config: SessionConfig;
  setConfig: (patch: Partial<SessionConfig>) => void;

  sessions: StoredSession[];
  progress: Progress;
  mastery: CompetencyMastery[];
  flashcards: WeakQuestion[];

  active: ActiveSession | null;
  isStarting: boolean;
  isSubmitting: boolean;
  startError: string;

  startSession: () => Promise<boolean>;
  submitAnswer: (text: string, confidence: number | null, secondsTaken: number) => Promise<AnswerRecord | null>;
  finishSession: () => Promise<StoredSession | null>;
  abandonSession: () => void;
  /** Marks a flashcard recalled, removing it once it has been recalled twice. */
  practiseFlashcard: (questionId: string, recalled: boolean) => void;
}

const Ctx = createContext<InterviewContextType | null>(null);

export function InterviewProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const role = user?.targetRole ?? "";
  const roleSlug = role.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "none";

  const [ready, setReady] = useState(false);
  const [config, setConfigState] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startError, setStartError] = useState("");

  const sessionsKey = user ? `iv_sessions_${user.id}_${roleSlug}` : null;
  const progressKey = user ? `iv_progress_${user.id}_${roleSlug}` : null;
  const configKey   = user ? `iv_config_${user.id}` : null;

  // Reads inside callbacks go through refs. The submit handler runs while the
  // user is typing and would otherwise close over the state as it was when the
  // session started — the same stale-closure fault that silently wiped the
  // portfolio's links.
  const progressRef = useRef(progress);
  const sessionsRef = useRef(sessions);
  const activeRef   = useRef(active);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeRef.current = active; }, [active]);

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionsKey || !progressKey || !configKey) { setReady(true); return; }
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        const [s, p, c] = await Promise.all([
          AsyncStorage.getItem(sessionsKey),
          AsyncStorage.getItem(progressKey),
          AsyncStorage.getItem(configKey),
        ]);
        if (cancelled) return;
        setSessions(parseSessions(s));
        setProgress(parseProgress(p));
        if (c) {
          const parsed = JSON.parse(c);
          setConfigState({ ...DEFAULT_CONFIG, ...parsed });
        }
      } catch {
        // A record we cannot read is cleared rather than crashing the tab.
        setSessions([]);
        setProgress(EMPTY_PROGRESS);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionsKey, progressKey, configKey]);

  const persistSessions = useCallback((next: StoredSession[]) => {
    setSessions(next);
    if (sessionsKey) void AsyncStorage.setItem(sessionsKey, JSON.stringify(next));
  }, [sessionsKey]);

  const persistProgress = useCallback((next: Progress) => {
    setProgress(next);
    if (progressKey) void AsyncStorage.setItem(progressKey, JSON.stringify(next));
  }, [progressKey]);

  const setConfig = useCallback((patch: Partial<SessionConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...patch };
      // Quick Fire is a fixed shape: five questions, timed, feedback withheld.
      if (patch.preset === "quickfire") { next.length = 5; next.timed = true; }
      if (configKey) void AsyncStorage.setItem(configKey, JSON.stringify(next));
      return next;
    });
  }, [configKey]);

  // ── Start ───────────────────────────────────────────────────────────────────
  const startSession = useCallback(async (): Promise<boolean> => {
    if (!role) { setStartError("Set a target role in your profile first."); return false; }
    setIsStarting(true);
    setStartError("");
    try {
      const cfg = config;
      const prog = progressRef.current;

      // The Comeback: one or two questions previously answered below mastery,
      // oldest first so the same two do not recur every session.
      const comeback = [...prog.weakQuestions]
        .filter((w) => w.difficulty === cfg.difficulty)
        .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
        .slice(0, cfg.preset === "quickfire" ? 1 : 2);

      const fresh = Math.max(cfg.length - comeback.length, 1);
      const draw = await drawQuestions({
        role,
        difficulty: cfg.difficulty,
        count: fresh,
        // Weak questions are re-asked deliberately, so they are not excluded.
        exclude: prog.seenQuestionIds.filter((id) => !comeback.some((c) => c.questionId === id)),
      });

      if (draw.questions.length === 0 && comeback.length === 0) {
        setStartError(describeDrawFailure(draw, role));
        return false;
      }

      const questions = [
        ...comeback.map((w) => ({
          id: w.questionId, question: w.question, idealAnswer: w.idealAnswer,
          keywords: w.keywords, competency: w.competency, difficulty: w.difficulty,
          type: w.type as BankQuestion["type"], isComeback: true,
        })),
        ...draw.questions.map((q) => ({ ...q, isComeback: false })),
      ];

      setActive({
        id: `iv_${Date.now()}`,
        role,
        config: cfg,
        questions,
        answers: [],
        index: 0,
        startedAt: new Date().toISOString(),
      });
      return true;
    } finally {
      setIsStarting(false);
    }
  }, [role, config]);

  // ── Answer ──────────────────────────────────────────────────────────────────
  const submitAnswer = useCallback(async (
    text: string,
    confidence: number | null,
    secondsTaken: number,
  ): Promise<AnswerRecord | null> => {
    const cur = activeRef.current;
    if (!cur) return null;
    const q = cur.questions[cur.index];
    if (!q) return null;

    setIsSubmitting(true);
    try {
      const keyword = scoreAnswer(text, q.keywords);

      // Quick Fire withholds feedback until the end, so it scores locally and
      // spends no model call mid-session — which is what keeps it quick.
      const review = cur.config.preset === "quickfire"
        ? quickScore(text, q.keywords)
        : await reviewAnswer({
            question: q.question, idealAnswer: q.idealAnswer, userAnswer: text, keyword,
          });

      const record: AnswerRecord = {
        questionId: q.id,
        question: q.question,
        idealAnswer: q.idealAnswer,
        keywords: q.keywords,
        competency: q.competency,
        difficulty: q.difficulty,
        type: q.type,
        userAnswer: text,
        score: review.score,
        takeaways: review.takeaways,
        // Colouring always reflects the words actually used, even when the
        // model raised the score for an answer phrased differently.
        matched: keyword.matched,
        missed: keyword.missed,
        confidence,
        secondsTaken,
        reviewedByAI: review.reviewedByAI,
        isComeback: q.isComeback,
      };

      setActive((prev) => prev && ({ ...prev, answers: [...prev.answers, record], index: prev.index + 1 }));
      return record;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  // ── Finish ──────────────────────────────────────────────────────────────────
  const finishSession = useCallback(async (): Promise<StoredSession | null> => {
    const cur = activeRef.current;
    if (!cur || cur.answers.length === 0) { setActive(null); return null; }

    const completedAt = new Date().toISOString();
    const overall = Math.round(cur.answers.reduce((s, a) => s + a.score, 0) / cur.answers.length);
    const xpEarned = cur.answers.reduce((s, a) => s + xpForAnswer(a.score, a.difficulty), 0);

    const session: StoredSession = {
      id: cur.id,
      role: cur.role,
      difficulty: cur.config.difficulty,
      preset: cur.config.preset,
      timed: cur.config.timed,
      startedAt: cur.startedAt,
      completedAt,
      overallScore: overall,
      xpEarned,
      answers: cur.answers,
    };

    const nextSessions = [session, ...sessionsRef.current].slice(0, MAX_SESSIONS);

    // Streak: consecutive calendar days. Practising twice in one day does not
    // advance it, and a missed day resets it to one rather than to zero —
    // today's session is itself the first day of the new streak.
    const prev = progressRef.current;
    const day = dayOf(completedAt);
    const streak = nextStreak(prev.lastPracticeDay, day, prev.streakCount);

    // Weak questions: added below mastery, removed once answered above it.
    const weak = new Map(prev.weakQuestions.map((w) => [w.questionId, w]));
    for (const a of cur.answers) {
      if (a.score >= MASTERY_THRESHOLD) { weak.delete(a.questionId); continue; }
      const existing = weak.get(a.questionId);
      weak.set(a.questionId, {
        questionId: a.questionId,
        question: a.question,
        idealAnswer: a.idealAnswer,
        keywords: a.keywords,
        competency: a.competency,
        difficulty: a.difficulty,
        type: a.type,
        lastScore: a.score,
        attempts: (existing?.attempts ?? 0) + 1,
        lastSeenAt: completedAt,
      });
    }

    const seen = [...new Set([...prev.seenQuestionIds, ...cur.answers.map((a) => a.questionId)])].slice(-MAX_SEEN);
    const mastery = masteryFrom(nextSessions);

    const nextProgress: Progress = {
      xp: prev.xp + xpEarned,
      streakCount: streak,
      lastPracticeDay: day,
      badges: earnedBadges(mastery, nextSessions, streak),
      seenQuestionIds: seen,
      weakQuestions: [...weak.values()].slice(-MAX_WEAK),
    };

    persistSessions(nextSessions);
    persistProgress(nextProgress);
    setActive(null);
    return session;
  }, [persistSessions, persistProgress]);

  const abandonSession = useCallback(() => setActive(null), []);

  /**
   * Two successful recalls retire a flashcard.
   *
   * One is not enough — recalling immediately after reading the answer proves
   * short-term memory, not retention.
   */
  const practiseFlashcard = useCallback((questionId: string, recalled: boolean) => {
    const prev = progressRef.current;
    const next = prev.weakQuestions
      .map((w) => {
        if (w.questionId !== questionId) return w;
        const attempts = recalled ? w.attempts - 1 : w.attempts + 1;
        return { ...w, attempts, lastSeenAt: new Date().toISOString() };
      })
      .filter((w) => w.attempts > -2);
    persistProgress({ ...prev, weakQuestions: next });
  }, [persistProgress]);

  const mastery = useMemo(() => masteryFrom(sessions), [sessions]);
  const flashcards = useMemo(
    () => [...progress.weakQuestions].sort((a, b) => a.lastScore - b.lastScore),
    [progress.weakQuestions],
  );

  const value = useMemo<InterviewContextType>(() => ({
    ready, role, config, setConfig,
    sessions, progress, mastery, flashcards,
    active, isStarting, isSubmitting, startError,
    startSession, submitAnswer, finishSession, abandonSession, practiseFlashcard,
  }), [ready, role, config, setConfig, sessions, progress, mastery, flashcards, active,
       isStarting, isSubmitting, startError, startSession, submitAnswer, finishSession,
       abandonSession, practiseFlashcard]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInterview() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInterview must be used within InterviewProvider");
  return ctx;
}

// ─── Stored-shape validation ──────────────────────────────────────────────────
/**
 * Anything unrecognised is discarded rather than rendered.
 *
 * A record written by an older build reaches this on the next launch, and a
 * screen that reads `.answers.map` on something without an answers array
 * crashes the tab before the user can do anything about it.
 */
function parseSessions(raw: string | null): StoredSession[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((s) =>
      s && typeof s.id === "string"
      && typeof s.overallScore === "number"
      && typeof s.completedAt === "string"
      && Array.isArray(s.answers)
      && s.answers.every((a: any) => a && typeof a.score === "number" && typeof a.competency === "string"),
    );
  } catch { return []; }
}

function parseProgress(raw: string | null): Progress {
  if (!raw) return EMPTY_PROGRESS;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return EMPTY_PROGRESS;
    return {
      xp: Number.isFinite(v.xp) ? v.xp : 0,
      streakCount: Number.isFinite(v.streakCount) ? v.streakCount : 0,
      lastPracticeDay: typeof v.lastPracticeDay === "string" ? v.lastPracticeDay : null,
      badges: Array.isArray(v.badges) ? v.badges.filter((b: any) => typeof b === "string") : [],
      seenQuestionIds: Array.isArray(v.seenQuestionIds) ? v.seenQuestionIds.filter((b: any) => typeof b === "string") : [],
      weakQuestions: Array.isArray(v.weakQuestions)
        ? v.weakQuestions.filter((w: any) => w && typeof w.questionId === "string" && Array.isArray(w.keywords))
        : [],
    };
  } catch { return EMPTY_PROGRESS; }
}
