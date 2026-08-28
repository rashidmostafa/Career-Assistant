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
import { JOB_PLATFORMS, mapUserExperienceToJobLevel } from "@/constants/jobPlatforms";
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

function roleTerms(targetRole: string): string[] {
  return (targetRole ?? "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Whether a listing is worth showing someone aiming at this role.
 *
 * Matched on the title rather than the description: nearly every engineering
 * post mentions "engineer" somewhere in its boilerplate, so description
 * matching returns the whole feed and the filter stops meaning anything.
 * A term also matches its own stem, so "engineering" satisfies "engineer".
 */
export function isRelevantToRole(job: Pick<FeedJob, "title" | "category">, targetRole: string): boolean {
  const terms = roleTerms(targetRole);
  if (terms.length === 0) return true;   // no role set: show everything

  const haystack = `${job.title} ${job.category}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { cv, skills: cvSkills } = useCV();

  const [rawJobs, setRawJobs] = useState<FeedJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [jobSources, setJobSources] = useState<string[]>([]);

  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  const [enabledPlatformIds, setEnabledPlatformIds] = useState<string[]>(JOB_PLATFORMS.map((p) => p.id));
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
        if (a) setAppliedJobIds(JSON.parse(a));
        if (p) setEnabledPlatformIds(JSON.parse(p));
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
      setLastUpdated(result.fetchedAt);
      if (result.sources.length === 0) {
        setError("Couldn't reach any job board right now. Pull to refresh to try again.");
      } else if (result.failed.length > 0) {
        setError(`${result.failed.join(" and ")} didn't respond, so some listings may be missing.`);
      }
    } catch (e: any) {
      setError("Couldn't load jobs. Check your connection and pull to refresh.");
    } finally {
      setIsLoading(false);
    }
  }, [targetRole]);

  // Fetched on mount so what is on screen reflects what is live now.
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);

  const jobs = useMemo(() => {
    const level = mapUserExperienceToJobLevel(user?.experienceLevel);

    return rawJobs
      // Requirement 1: only roles the user is actually aiming at.
      .filter((j) => isRelevantToRole(j, targetRole))
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
          platformIcon: j.platformId === "remotive" ? "🌍" : "💼",
          // Both sources publish only postings submitted by the employer, and
          // every listing links to the original — so these are verified in the
          // only sense the app can honestly claim.
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
    const next = enabled ? JOB_PLATFORMS.map((p) => p.id) : [];
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
        usingFallback: jobSources.length === 0,
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
