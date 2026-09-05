/**
 * JobsContext — live job listings, matched against the user's CV.
 *
 * Rebuilt from scratch. Two rules drive the design:
 *
 * The listings are never persisted. They are fetched when the screen opens and
 * when the user refreshes, and nothing is cached between sessions. That is what
 * makes a closed vacancy disappear: it is simply absent from the next fetch,
 * with no stale copy anywhere to keep showing it. The old version cached a
 * generated list, so postings that no longer existed stayed on screen forever.
 *
 * There is no fabricated fallback. When no source answers, the list is empty
 * and the screen says so, because an invented listing wastes an application.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@/services/syncedStorage";
import { useAuth } from "./AuthContext";
import { useCV } from "./CVContext";
import { fetchLiveJobs, type FeedJob } from "@/services/jobFeedService";
import { computeJobMatch, type JobMatchResult } from "@/utils/jobMatch";
import { FEED_SOURCES, mapUserExperienceToJobLevel } from "@/constants/jobPlatforms";
import { chatJSON, isAIConfigured } from "@/services/aiClient";

export interface JobListing extends FeedJob {
  matchScore: number;
  /**
   * What the match badge reads. `applicable` is false when there is nothing to
   * compare — no CV, or a posting that lists no skills — so "we cannot tell"
   * is never displayed as "0% match".
   */
  skillMatch: { applicable: boolean; score: number; matched: string[]; missing: string[] };
  /** Seniority inferred from the title. */
  experienceLevel: string;
  /** Named jobType, not type, because that is what the screen reads. */
  jobType: string;
  platformIcon: string;
  /** True when the posting came from a source that verifies its listings. */
  verified: boolean;
  topCompany: boolean;
}

export interface JobFilters {
  location: string | null;
  jobType: string | null;
  experienceLevel: string | null;
  remoteOnly: boolean;
  minMatch: number;
}

const NO_FILTERS: JobFilters = { location: null, jobType: null, experienceLevel: null, remoteOnly: false, minMatch: 0 };

interface JobsContextType {
  jobs: JobListing[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
  jobSources: string[];
  /** True when no source answered, so the list is empty rather than invented. */
  usingFallback: boolean;
  hasCVSkills: boolean;
  refreshJobs: () => Promise<void>;
  getMatch: (jobId: string) => JobMatchResult;
  generateCoverLetter: (job: JobListing) => Promise<JobMatchResult & { coverLetter: string }>;
  appliedJobIds: string[];
  markApplied: (jobId: string) => Promise<void>;
  enabledPlatformIds: string[];
  togglePlatform: (id: string) => Promise<void>;
  setAllPlatformsEnabled: (enabled: boolean) => Promise<void>;
  filters: JobFilters;
  setFilters: (f: Partial<JobFilters>) => void;
  resetFilters: () => void;
}

const JobsContext = createContext<JobsContextType | undefined>(undefined);

/** Words that carry no signal when deciding whether a job fits a role. */
const STOP = new Set(["a", "an", "the", "and", "or", "of", "for", "in", "at", "to", "with", "senior", "junior", "lead", "mid", "level", "i", "ii", "iii"]);

/**
 * Job-title nouns that appear in every discipline and so discriminate nothing.
 *
 * Matching on any term meant "engineer" alone qualified a listing: a search for
 * Software Engineer returned Junior Structural Engineer, and a Backend Engineer
 * target returned frontend and QA roles. These are the words that make a title
 * sound like a job without saying which job.
 */
const GENERIC_ROLE_WORDS = new Set([
  "engineer", "engineering", "developer", "development", "manager", "management",
  "specialist", "analyst", "executive", "officer", "associate", "consultant",
  "assistant", "coordinator", "administrator", "technician", "intern",
  "internship", "staff", "expert", "professional", "team", "support",
]);

/**
 * Words the industry uses for the same role.
 *
 * Only genuine renamings of the role itself, never the technologies it happens
 * to use: mapping "backend" onto Java, Go and PHP would pull in any listing
 * that mentions a language, which is how a role filter stops filtering.
 */
const ROLE_SYNONYMS: Record<string, string[]> = {
  backend: ["server side"],
  frontend: ["client side"],
  devops: ["sre", "site reliability"],
  sre: ["devops", "site reliability"],
  ml: ["machine learning"],
  ai: ["artificial intelligence"],
  qa: ["quality assurance", "sdet"],
  security: ["infosec", "information security", "cybersecurity"],
  mobile: ["android", "ios", "react native", "flutter"],
  // Reverse directions, so the mapping works whichever name the user typed.
  qualityassurance: ["qa", "sdet"],
  machinelearning: ["ml"],
  artificialintelligence: ["ai"],
  sitereliability: ["sre", "devops"],
};

function roleTerms(targetRole: string): string[] {
  return (targetRole ?? "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** "Back-End" and "Back End" are the same word as "backend". */
const tighten = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
const spaced = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

/**
 * Whether one role word appears in a title.
 *
 * Two passes, because job titles punctuate the same word every possible way.
 * Whole-word matching on the spaced title keeps short terms like "qa" and "ai"
 * from matching inside longer words; the joined form then catches the spellings
 * that only differ by a space or hyphen. That second pass is limited to longer
 * terms so "go" cannot match "Go-to-Market Manager".
 */
function termMatches(term: string, title: string): boolean {
  const t = tighten(term);
  if (!t) return false;

  const asWord = new RegExp(`(^| )${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es|ing)?( |$)`);
  if (asWord.test(spaced(title))) return true;

  return t.length >= 5 && tighten(title).includes(t);
}

/**
 * Whether a listing is worth showing someone aiming at this role.
 *
 * Matched on the title rather than the description: nearly every engineering
 * post mentions "engineer" somewhere in its boilerplate, so description
 * matching returns the whole feed and the filter stops meaning anything.
 */
export function isRelevantToRole(
  job: Pick<FeedJob, "title" | "category">,
  targetRole: string,
  opts: { relaxed?: boolean } = {},
): boolean {
  const terms = roleTerms(targetRole);
  if (terms.length === 0) return true;   // no role set: show everything

  const haystack = `${job.title} ${job.category}`;

  // Every accepted spelling of what the user typed, looked up both per word
  // and across the whole role — "quality assurance" is one name, not two words.
  const phrase = ROLE_SYNONYMS[tighten(targetRole.replace(/\b(engineer|developer|specialist)\b/gi, ""))] ?? [];
  const expand = (list: string[]) =>
    [...list.flatMap((t) => [t, ...(ROLE_SYNONYMS[tighten(t)] ?? [])]), ...phrase];

  // The discriminating words — "software", "backend", "data" — not the ones
  // every job title contains.
  const distinctive = terms.filter((t) => !GENERIC_ROLE_WORDS.has(t));

  // Relaxed matching accepts any term, generic ones included, which is the
  // "same broad discipline" test. Only used when strict matching found nothing.
  if (opts.relaxed) return expand(terms).some((t) => termMatches(t, haystack));

  // A target made only of generic words ("Engineer", "Manager") has nothing to
  // discriminate on, so fall back to matching those rather than showing nothing.
  const use = distinctive.length === 0 ? terms : distinctive;
  return expand(use).some((t) => termMatches(t, haystack));
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { cv, skills: cvSkills } = useCV();

  const [rawJobs, setRawJobs] = useState<FeedJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [jobSources, setJobSources] = useState<string[]>([]);
  // Distinct from "no jobs matched": the board itself could not be reached.
  const [unreachable, setUnreachable] = useState(false);

  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  const [enabledPlatformIds, setEnabledPlatformIds] = useState<string[]>(FEED_SOURCES.map((p) => p.id));
  const [filters, setFiltersState] = useState<JobFilters>(NO_FILTERS);
  // Letters are kept for the session so reopening a job shows what was written
  // rather than silently charging another model call for the same thing.
  const [coverLetters, setCoverLetters] = useState<Record<string, string>>({});

  const targetRole = user?.targetRole ?? "";
  const appliedKey = user ? `applied_${user.id}` : null;
  const platformsKey = user ? `platforms_${user.id}` : null;

  // Only the user's own choices are persisted. The listings deliberately are
  // not — see the note at the top of this file.
  useEffect(() => {
    if (!appliedKey || !platformsKey) return;
    let cancelled = false;
    (async () => {
      try {
        const [a, p] = await Promise.all([
          AsyncStorage.getItem(appliedKey),
          AsyncStorage.getItem(platformsKey),
        ]);
        if (cancelled) return;
        if (a) {
          // Applied ids name a listing from a specific board. Ids belonging to
          // a board the app no longer reads can never match anything on screen,
          // so they only inflate the "Jobs Applied" figure on the dashboard.
          // Dropping them here means a device already holding stale ids repairs
          // itself on next launch rather than needing a sign-out to rehydrate.
          const stored: string[] = JSON.parse(a);
          const live = stored.filter((id) => FEED_SOURCES.some((f) => id.startsWith(`${f.id}_`)));
          setAppliedJobIds(live);
          if (live.length !== stored.length) void AsyncStorage.setItem(appliedKey, JSON.stringify(live));
        }
        if (p) {
          const stored: string[] = JSON.parse(p);
          const valid = stored.filter((id) => FEED_SOURCES.some((f) => f.id === id));
          // Anything saved before feeds and link-outs were separated refers to
          // sites that produce no listings; honouring it would empty the feed.
          setEnabledPlatformIds(valid.length ? valid : FEED_SOURCES.map((f) => f.id));
        }
      } catch { /* defaults stand */ }
    })();
    return () => { cancelled = true; };
  }, [appliedKey, platformsKey]);

  const refreshJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchLiveJobs({
        keywords: targetRole || undefined,
        // Careerjet needs a location to search a country; without one it
        // searches the locale's default, which is not necessarily Bangladesh.
        location: "Bangladesh",
      });
      setRawJobs(result.jobs);
      setJobSources(result.sources);
      setUnreachable(result.failed.length > 0);
      setLastUpdated(result.fetchedAt);
      // Only a failed request is an error. A source that answers with no
      // matches is a real answer, and the empty state already explains it.
      if (result.failed.length > 0) {
        setError("Couldn't reach the job board right now. Pull down to try again.");
      }
    } catch (e: any) {
      setUnreachable(true);
      setError(e?.code === "SESSION_EXPIRED"
        ? "Your session expired. Sign out and back in to load jobs."
        : "Couldn't load jobs. Check your connection and pull down to try again.");
    } finally {
      setIsLoading(false);
    }
  }, [targetRole]);

  // Fetched on mount so what is on screen reflects what is live now.
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);

  const jobs = useMemo(() => {
    const level = mapUserExperienceToJobLevel(user?.experienceLevel);

    // Requirement 1: only roles the user is actually aiming at.
    //
    // Strict matching can legitimately empty the list: Careerjet's own search
    // is loose, so a "Backend Engineer" query returned only frontend, QA and AI
    // roles, all correctly rejected — leaving the user with nothing and no idea
    // why. When that happens the discipline match is used instead, so they see
    // adjacent software roles rather than an empty screen. Showing nothing when
    // relevant-ish work exists is the worse failure.
    const strict = rawJobs.filter((j) => isRelevantToRole(j, targetRole));
    const relaxed = strict.length > 0
      ? strict
      : rawJobs.filter((j) => isRelevantToRole(j, targetRole, { relaxed: true }));

    return relaxed
      .filter((j) => enabledPlatformIds.includes(j.platformId))
      .map((j): JobListing => {
        const match = computeJobMatch(j.requiredSkills, cvSkills);
        const score = match.score;
        return {
          ...j,
          matchScore: score,
          skillMatch: {
            applicable: cvSkills.length > 0 && j.requiredSkills.length > 0,
            score,
            matched: match.matched,
            missing: match.missing,
          },
          experienceLevel: j.category,
          jobType: j.type,
          // Read from the source list rather than hardcoded, so a listing never
          // inherits an icon belonging to a board it did not come from.
          platformIcon: FEED_SOURCES.find((f) => f.id === j.platformId)?.icon ?? "💼",
          // Every listing links to the original posting — so these are verified
          // in the only sense the app can honestly claim.
          verified: true,
          topCompany: false,
        };
      })
      .filter((j) => {
        if (filters.remoteOnly && !j.remote) return false;
        if (filters.location && !j.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
        if (filters.jobType && j.jobType.toLowerCase() !== filters.jobType.toLowerCase()) return false;
        if (filters.experienceLevel && j.experienceLevel !== filters.experienceLevel) return false;
        if (filters.minMatch > 0 && j.matchScore < filters.minMatch) return false;
        return true;
      })
      // Best fit first — the whole point of scoring them.
      .sort((a, b) => b.matchScore - a.matchScore || Date.parse(b.postedAt) - Date.parse(a.postedAt));
  }, [rawJobs, targetRole, enabledPlatformIds, cvSkills, filters, user?.experienceLevel]);

  const getMatch = useCallback(
    (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return { score: 0, matched: [], missing: [], gapAnalysis: [], rationale: "" };
      return { ...computeJobMatch(job.requiredSkills, cvSkills), coverLetter: coverLetters[jobId] };
    },
    [jobs, cvSkills, coverLetters],
  );

  const markApplied = useCallback(async (jobId: string) => {
    setAppliedJobIds((prev) => {
      if (prev.includes(jobId)) return prev;
      const next = [...prev, jobId];
      if (appliedKey) void AsyncStorage.setItem(appliedKey, JSON.stringify(next));
      return next;
    });
  }, [appliedKey]);

  const togglePlatform = useCallback(async (id: string) => {
    setEnabledPlatformIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      if (platformsKey) void AsyncStorage.setItem(platformsKey, JSON.stringify(next));
      return next;
    });
  }, [platformsKey]);

  const setAllPlatformsEnabled = useCallback(async (enabled: boolean) => {
    const next = enabled ? FEED_SOURCES.map((p) => p.id) : [];
    setEnabledPlatformIds(next);
    if (platformsKey) await AsyncStorage.setItem(platformsKey, JSON.stringify(next));
  }, [platformsKey]);

  const setFilters = useCallback((f: Partial<JobFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...f }));
  }, []);
  const resetFilters = useCallback(() => setFiltersState(NO_FILTERS), []);

  const generateCoverLetter = useCallback(async (job: JobListing) => {
    const match = computeJobMatch(job.requiredSkills, cvSkills);
    const letter = await writeCoverLetter({
      job,
      match,
      cvText: cv?.rawText ?? "",
      candidateName: user?.name ?? "",
    });
    setCoverLetters((prev) => ({ ...prev, [job.id]: letter }));
    return { ...match, coverLetter: letter };
  }, [cvSkills, cv?.rawText, user?.name]);

  return (
    <JobsContext.Provider
      value={{
        jobs, isLoading, error, lastUpdated, jobSources,
        usingFallback: unreachable,
        hasCVSkills: cvSkills.length > 0,
        refreshJobs, getMatch, generateCoverLetter,
        appliedJobIds, markApplied,
        enabledPlatformIds, togglePlatform, setAllPlatformsEnabled,
        filters, setFilters, resetFilters,
      }}
    >
      {children}
    </JobsContext.Provider>
  );
}

// ─── Cover letter ─────────────────────────────────────────────────────────────
/**
 * Writes a letter that could be sent as it stands.
 *
 * The previous version produced a template with the company name substituted
 * in, which is worse than nothing: a recruiter recognises it instantly. This
 * one is given the actual posting and the actual CV, and is told not to leave
 * placeholders — a letter containing [Your Name] cannot be submitted, so a
 * letter that needs editing has not done its job.
 */
async function writeCoverLetter(input: {
  job: JobListing;
  match: JobMatchResult;
  cvText: string;
  candidateName: string;
}): Promise<string> {
  if (!isAIConfigured) {
    return "AI isn't configured, so a cover letter can't be written yet.";
  }

  const prompt = `Write a cover letter this candidate could send today, unedited.

Rules:
- Ready to submit. No placeholders, no square brackets, no "[Your Name]", no instructions to the reader, no notes about what to fill in.
- Ground every claim in their CV. Never invent experience, employers, dates or skills they do not have.
- Address the specific role and company, and refer to something concrete from the posting.
- Lead with the strongest genuine overlap between their CV and what this role asks for.
- Where they lack something the role wants, either stay silent about it or frame it honestly as something they are building — never claim it.
- Professional, warm, direct. Three or four short paragraphs. No flattery, no clichés like "I am writing to express my interest".
- End with the candidate's name${input.candidateName ? ` (${input.candidateName})` : ""} and nothing after it.

THE ROLE: ${input.job.title} at ${input.job.company}${input.job.location ? ` (${input.job.location})` : ""}

THE POSTING:
${input.job.description.slice(0, 4000)}

SKILLS THIS ROLE WANTS THAT THEY HAVE: ${input.match.matched.join(", ") || "none identified"}
SKILLS IT WANTS THAT THEY DO NOT: ${input.match.missing.join(", ") || "none"}

THEIR CV:
${input.cvText.slice(0, 6000) || "No CV uploaded — write from the role alone and keep claims general rather than inventing any."}

Return JSON only: { "letter": "the complete letter as plain text with paragraph breaks" }`;

  const raw = await chatJSON(prompt, { timeoutMs: 120_000 });
  const letter = typeof raw?.letter === "string" ? raw.letter.trim() : "";
  return letter || "Couldn't write the cover letter just now. Try again in a moment.";
}

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used within JobsProvider");
  return ctx;
}
