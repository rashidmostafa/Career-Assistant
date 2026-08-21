import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { JOB_PLATFORMS, mapUserExperienceToJobLevel } from "@/constants/jobPlatforms";
import { generateAllBDJobs } from "@/data/bdJobs";
import { fetchLiveJobs } from "@/services/jobFeedService";
import { computeJobMatch, type JobMatchResult } from "@/utils/jobMatch";
import { useAuth } from "./AuthContext";
import { useCV } from "./CVContext";
import { chatJSON, isAIConfigured } from "@/services/aiClient";

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  requiredSkills: string[];
  matchScore: number;
  type: string;
  salary: string;
  postedAt: string;
  remote: boolean;
  category: string;
  originalUrl: string;
  sourceLabel: string;
  platformId: string;
  platformName: string;
  platformIcon: string;
  jobType: string;
  experienceLevel: string;
  verified: boolean;
  topCompany: boolean;
  /**
   * How well the user's uploaded CV covers this job's requirements.
   * Undefined until a CV with detected skills exists — the UI prompts the
   * user to upload one instead of showing a misleading 0%.
   */
  skillMatch?: JobMatchResult;
}

export interface ApplicationMatch {
  id: string;
  userId: string;
  jobId: string;
  gapAnalysis: string[];
  coverLetter: string;
  appliedAt: string;
}

export interface JobFilters {
  location: string | null;
  jobType: string | null;
  experienceLevel: string | null;
}

interface JobsContextType {
  jobs: JobListing[];
  allRoleJobs: JobListing[];
  matches: ApplicationMatch[];
  appliedJobIds: string[];
  isGenerating: boolean;
  isLoading: boolean;
  lastUpdated: string | null;
  enabledPlatformIds: string[];
  filters: JobFilters;
  /** Canonical skills detected in the user's CV (empty when no CV uploaded). */
  cvSkills: string[];
  /** True once a CV with at least one recognised skill exists. */
  hasCVSkills: boolean;
  /** Live sources that answered, e.g. ["Remotive", "Arbeitnow"]. */
  jobSources: string[];
  /** True when no live source could be reached and sample data is showing. */
  usingFallback: boolean;
  /** Re-fetches from the live sources. */
  refreshJobs: () => Promise<void>;
  generateCoverLetter: (job: JobListing) => Promise<ApplicationMatch>;
  getMatch: (jobId: string) => ApplicationMatch | undefined;
  filterByRole: (role: string) => JobListing[];
  markApplied: (jobId: string) => Promise<void>;
  togglePlatform: (platformId: string) => void;
  setAllPlatformsEnabled: (enabled: boolean) => void;
  setFilters: (filters: Partial<JobFilters>) => void;
  resetFilters: () => void;
}

/**
 * Fallback only. generateAllBDJobs() invents listings from role templates and
 * company names — they are not real vacancies, so they are used solely when
 * every live source is unreachable, and the UI says so when they are showing.
 */
const FALLBACK_JOBS: JobListing[] = generateAllBDJobs();

const ROLE_KEYWORD_MAP: Record<string, string[]> = {
  "react developer": ["react developer", "react engineer", "react frontend"],
  "react native developer": ["react native"],
  "frontend developer": ["frontend", "front-end", "front end", "ui engineer", "react developer", "react engineer", "react frontend"],
  "backend developer": ["backend", "back-end", "back end", "api engineer", "api developer"],
  "full stack developer": ["full stack", "fullstack", "full-stack", "mern"],
  "full stack engineer": ["full stack", "fullstack", "full-stack", "mern"],
  "data scientist": ["data scientist", "data science"],
  "data engineer": ["data engineer"],
  "data analyst": ["data analyst"],
  "machine learning engineer": ["machine learning", "ml engineer"],
  "devops engineer": ["devops", "sre", "site reliability", "platform engineer", "cloud engineer"],
  "mobile developer": ["mobile developer", "mobile app", "ios mobile", "android mobile", "android developer"],
  "marketing manager": ["marketing", "digital marketing", "seo"],
  "digital marketing specialist": ["marketing", "digital marketing", "seo"],
  "business analyst": ["business analyst", "sales manager", "brand strategist"],
  "sales manager": ["sales", "business analyst"],
  "brand strategist": ["brand", "marketing"],
  "seo specialist": ["seo", "digital marketing"],
  "financial analyst": ["financial analyst", "accountant", "finance"],
  "accountant": ["accountant", "financial analyst", "finance"],
  "tax consultant": ["tax", "financial analyst"],
  "civil engineer": ["civil engineer", "site engineer", "structural engineer"],
  "structural engineer": ["structural engineer", "civil engineer"],
  "electrical engineer": ["electrical engineer", "power systems", "electronics engineer"],
  "electronics engineer": ["electronics engineer", "electrical engineer"],
  "mechanical engineer": ["mechanical engineer", "cad designer", "manufacturing engineer"],
  "cad designer": ["cad designer", "mechanical engineer"],
};

function strictRoleFilter(jobs: JobListing[], role: string): JobListing[] {
  if (!role) return jobs;
  const normalized = role.toLowerCase().trim();
  const keywords = ROLE_KEYWORD_MAP[normalized] || [normalized];

  const strict = jobs.filter((j) => {
    const t = j.title.toLowerCase();
    const c = j.category.toLowerCase();
    return keywords.some((kw) => t.includes(kw) || c.includes(kw));
  });

  if (strict.length > 0) return strict.sort((a, b) => b.matchScore - a.matchScore);

  const words = normalized.split(/\s+/).filter((w) => w.length > 3);
  const loose = jobs.filter((j) => {
    const t = j.title.toLowerCase();
    const c = j.category.toLowerCase();
    return words.some((w) => t.includes(w) || c.includes(w));
  });
  return loose.sort((a, b) => b.matchScore - a.matchScore);
}

const DEFAULT_FILTERS: JobFilters = { location: null, jobType: null, experienceLevel: null };

const JobsContext = createContext<JobsContextType | null>(null);

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Matches and applications belong to the role they were made for.
  const roleKey = user?.activeRoleId || "default";
  const { cvProfile } = useCV();
  const [matches, setMatches] = useState<ApplicationMatch[]>([]);
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading] = useState(false);
  const [lastUpdated] = useState<string>(new Date().toLocaleDateString());
  const [enabledPlatformIds, setEnabledPlatformIds] = useState<string[]>(JOB_PLATFORMS.map((p) => p.id));
  const [filters, setFiltersState] = useState<JobFilters>(DEFAULT_FILTERS);

  const load = useCallback(async () => {
    if (!user) { setMatches([]); setAppliedJobIds([]); setEnabledPlatformIds(JOB_PLATFORMS.map((p) => p.id)); return; }
    // Assigned unconditionally: switching to a role with no matches yet has to
    // clear the previous role's, or its cover letters and applied flags would
    // appear to belong to the new role.
    const data = await AsyncStorage.getItem(`matches_${user.id}_${roleKey}`);
    setMatches(data ? JSON.parse(data) : []);
    const applied = await AsyncStorage.getItem(`applied_${user.id}_${roleKey}`);
    setAppliedJobIds(applied ? JSON.parse(applied) : []);
    const platforms = await AsyncStorage.getItem(`platforms_${user.id}`);
    if (platforms) {
      setEnabledPlatformIds(JSON.parse(platforms));
    } else {
      setEnabledPlatformIds(JOB_PLATFORMS.map((p) => p.id));
    }
    // roleKey included so a role switch reloads that role's matches.
  }, [user, roleKey]);

  useEffect(() => { load(); }, [load]);

  const persistPlatforms = useCallback(async (ids: string[]) => {
    if (!user) return;
    await AsyncStorage.setItem(`platforms_${user.id}`, JSON.stringify(ids));
  }, [user]);

  const togglePlatform = (platformId: string) => {
    setEnabledPlatformIds((prev) => {
      const next = prev.includes(platformId) ? prev.filter((id) => id !== platformId) : [...prev, platformId];
      persistPlatforms(next);
      return next;
    });
  };

  const setAllPlatformsEnabled = (enabled: boolean) => {
    const next = enabled ? JOB_PLATFORMS.map((p) => p.id) : [];
    setEnabledPlatformIds(next);
    persistPlatforms(next);
  };

  const setFilters = (partial: Partial<JobFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...partial }));
  };

  const resetFilters = () => setFiltersState(DEFAULT_FILTERS);

  const [liveJobs, setLiveJobs] = useState<JobListing[]>([]);
  const [jobSources, setJobSources] = useState<string[]>([]);
  const [usingFallback, setUsingFallback] = useState(false);
  const [isFetchingJobs, setIsFetchingJobs] = useState(false);

  const refreshJobs = useCallback(async () => {
    setIsFetchingJobs(true);
    try {
      const { jobs: fetched, sources, offline } = await fetchLiveJobs(user?.targetRole);
      if (offline || fetched.length === 0) {
        // Keep the screen usable without a connection, but flag it rather than
        // passing invented listings off as real vacancies.
        setLiveJobs(FALLBACK_JOBS);
        setUsingFallback(true);
        setJobSources([]);
      } else {
        setLiveJobs(fetched);
        setUsingFallback(false);
        setJobSources(sources);
      }
    } finally {
      setIsFetchingJobs(false);
    }
  }, [user?.targetRole]);

  useEffect(() => { refreshJobs(); }, [refreshJobs]);

  const cvSkills = useMemo(() => cvProfile?.skills ?? [], [cvProfile?.skills]);
  const hasCVSkills = cvSkills.length > 0;

  const allRoleJobs = useMemo(() => {
    // Live results are already query-filtered at the source; applying the
    // strict local role filter on top would discard relevant postings whose
    // titles simply word things differently.
    const roleJobs = usingFallback
      ? strictRoleFilter(liveJobs, user?.targetRole || "")
      : liveJobs;
    if (!hasCVSkills) return roleJobs;
    // Score every role-matched job against the CV, then surface the jobs the
    // user is most qualified for first (spec: sort by match %, highest first).
    return roleJobs
      .map((job) => ({ ...job, skillMatch: computeJobMatch(cvSkills, job.requiredSkills) }))
      .sort((a, b) => b.skillMatch.score - a.skillMatch.score);
  }, [user?.targetRole, cvSkills, hasCVSkills, liveJobs, usingFallback]);

  const jobs = useMemo(() => {
    return allRoleJobs.filter((j) => {
      if (!enabledPlatformIds.includes(j.platformId)) return false;
      if (filters.location && j.location !== filters.location && !(filters.location === "Remote" && j.remote)) return false;
      if (filters.jobType && j.jobType !== filters.jobType) return false;
      if (filters.experienceLevel && j.experienceLevel !== filters.experienceLevel) return false;
      return true;
    });
  }, [allRoleJobs, enabledPlatformIds, filters]);

  const generateCoverLetter = async (job: JobListing): Promise<ApplicationMatch> => {
    if (!user) throw new Error("Not authenticated");
    setIsGenerating(true);
    try {
      const apiKey = isAIConfigured;
      const cvText = cvProfile?.fullOptimizedCV || cvProfile?.rawText || "";
      let coverLetter = `Dear Hiring Manager,\n\nI am excited to apply for the ${job.title} position at ${job.company}. With my background in ${user.targetRole || "software engineering"} and ${user.experienceLevel} of experience, I am confident in my ability to make a meaningful contribution.\n\nThe opportunity at ${job.company} particularly excites me because of ${job.description.split(".")[0].toLowerCase()}. I bring expertise in ${job.requiredSkills.slice(0, 3).join(", ")}, which directly aligns with your requirements.\n\nI would welcome the opportunity to discuss how I can contribute to ${job.company}'s mission.\n\nBest regards,\n${user.name}`;
      let gapAnalysis = job.requiredSkills.slice(0, 3).map((skill) => `Strengthen your ${skill} skills to stand out for this role`);

      if (apiKey) {
        try {
          const prompt = `Write a compelling, personalized cover letter for:
Job: ${job.title} at ${job.company} (${job.salary}) via ${job.platformName}
Description: ${job.description}
Required: ${job.requiredSkills.join(", ")}
Candidate CV: ${cvText.slice(0, 800)}
Candidate: ${user.name}, ${user.experienceLevel} level, targeting ${user.targetRole}

Return JSON: { coverLetter: "3-paragraph professional letter", gapAnalysis: ["3 specific skills to develop for this role"] }`;
          const parsed = await chatJSON(prompt);
          if (parsed?.coverLetter) coverLetter = parsed.coverLetter;
          if (Array.isArray(parsed?.gapAnalysis)) gapAnalysis = parsed.gapAnalysis;
        } catch { /* use defaults */ }
      }

      const match: ApplicationMatch = { id: Date.now().toString(), userId: user.id, jobId: job.id, gapAnalysis, coverLetter, appliedAt: new Date().toISOString() };
      const updated = [...matches.filter((m) => m.jobId !== job.id), match];
      await AsyncStorage.setItem(`matches_${user.id}_${roleKey}`, JSON.stringify(updated));
      setMatches(updated);
      return match;
    } finally {
      setIsGenerating(false);
    }
  };

  const markApplied = async (jobId: string) => {
    if (!user) return;
    const updated = [...appliedJobIds.filter((id) => id !== jobId), jobId];
    await AsyncStorage.setItem(`applied_${user.id}_${roleKey}`, JSON.stringify(updated));
    setAppliedJobIds(updated);
  };

  const getMatch = (jobId: string) => matches.find((m) => m.jobId === jobId);
  const filterByRole = (role: string) => strictRoleFilter(liveJobs, role);

  return (
    <JobsContext.Provider
      value={{
        jobs,
        allRoleJobs,
        matches,
        appliedJobIds,
        isGenerating,
        isLoading: isLoading || isFetchingJobs,
        lastUpdated,
        enabledPlatformIds,
        filters,
        cvSkills,
        hasCVSkills,
        jobSources,
        usingFallback,
        refreshJobs,
        generateCoverLetter,
        getMatch,
        filterByRole,
        markApplied,
        togglePlatform,
        setAllPlatformsEnabled,
        setFilters,
        resetFilters,
      }}
    >
      {children}
    </JobsContext.Provider>
  );
}

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used within JobsProvider");
  return ctx;
}
