/**
 * jobFeedService — live job listings.
 *
 * Every listing here comes from a real posting fetched at request time. The
 * previous version fell back to data/bdJobs.ts, which manufactured listings by
 * combining role templates with real company names: they looked genuine, the
 * companies were not hiring for them, and every "Apply" led to a search page.
 * That file is gone and there is no fallback — an empty list is the correct
 * answer when nothing real is available, and the screen says so.
 *
 * The single source is Careerjet, reached through our own backend because the
 * API key must not ship in the app. It is an aggregator, so one request covers
 * many underlying boards, and it indexes Bangladesh.
 *
 * Remotive and Arbeitnow were fetched here too and have been removed. They were
 * measured rather than assumed: of 175 Arbeitnow listings, none were in
 * Bangladesh, 59 were in Germany and roughly as many in London, almost all
 * on-site and so needing a visa and relocation. Remotive returned 19 jobs, of
 * which 6 were open worldwide. Between them they supplied 160 of 179 results —
 * a feed dominated by roles its users could not apply to.
 *
 * Bdjobs, Chakri and the other local boards publish no public API, and LinkedIn
 * restricts job search to its Talent Solutions partners, so those are reached
 * by linking out rather than by inventing listings for them.
 */
export interface FeedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  requiredSkills: string[];
  type: string;
  salary: string;
  postedAt: string;
  remote: boolean;
  category: string;
  /** The real posting. Apply Now opens exactly this. */
  originalUrl: string;
  sourceLabel: string;
  platformId: string;
  platformName: string;
}

/** Extracts skills from free text using the shared vocabulary. */
export function skillsFromText(text: string): string[] {
  return extractSkills(text);
}

export interface FeedResult {
  jobs: FeedJob[];
  /** Sources that answered, for the UI to report honestly. */
  sources: string[];
  /** Sources that were tried and failed. */
  failed: string[];
  fetchedAt: string;
}

import { apiFetch } from "./authApiService";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
const TIMEOUT_MS = 15_000;

/**
 * Skill terms worth matching a CV against.
 *
 * Deliberately a known vocabulary rather than "capitalised words in the
 * description": job posts are full of company names, benefits and legal
 * boilerplate, and treating those as required skills produced match
 * percentages that meant nothing.
 */
const SKILL_VOCAB = [
  "JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "Go", "Rust", "Ruby", "PHP", "C#", "C++", "Scala", "Elixir",
  "React", "React Native", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express", "NestJS", "Django", "Flask",
  "FastAPI", "Spring", "Rails", "Laravel", ".NET",
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "DynamoDB", "Elasticsearch", "GraphQL", "REST", "gRPC",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Jenkins", "CI/CD", "Git", "Linux", "Nginx",
  "HTML", "CSS", "Tailwind", "SASS", "Figma", "Webpack", "Vite",
  "Jest", "Cypress", "Playwright", "Selenium", "Pytest",
  "Machine Learning", "TensorFlow", "PyTorch", "Pandas", "NumPy", "Scikit-learn", "SQL", "Tableau", "Power BI", "Excel",
  "Agile", "Scrum", "Jira",
];

function extractSkills(text: string): string[] {
  const haystack = ` ${text.toLowerCase()} `;
  return SKILL_VOCAB.filter((skill) => {
    const needle = skill.toLowerCase();
    // Word-boundary-ish check so "go" does not match "going" and "c#" survives.
    return new RegExp(`(^|[^a-z0-9+#.])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9+#.]|$)`, "i").test(haystack);
  });
}

/**
 * A key identifying the same opening regardless of which board carries it.
 *
 * Company and title only: the same role is routinely syndicated to several
 * boards with different ids, descriptions and formatting, and showing it three
 * times makes a feed look padded and wastes the user's attention.
 */
export function dedupeKey(job: Pick<FeedJob, "title" | "company">): string {
  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")                    // "(remote)", "(m/f/d)"
      .replace(/\b(m\/f\/d|f\/m\/d|w\/m\/d|all genders?|remote|hybrid|onsite|full[- ]time|part[- ]time)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(job.company)}::${norm(job.title)}`;
}

/**
 * Collapses duplicates, keeping the richest copy.
 *
 * "Richest" is the one with the most parsed skills, then the longest
 * description — the version most likely to give an accurate match score.
 */
export function dedupe(jobs: FeedJob[]): FeedJob[] {
  const best = new Map<string, FeedJob>();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = best.get(key);
    if (!existing) { best.set(key, job); continue; }
    const better =
      job.requiredSkills.length > existing.requiredSkills.length ||
      (job.requiredSkills.length === existing.requiredSkills.length &&
        job.description.length > existing.description.length);
    if (better) best.set(key, job);
  }

  // Ids come from whichever board supplied the listing, so a bug there can hand
  // the list two rows with one key. That surfaced once as a React duplicate-key
  // warning, but the damage was quieter: every card read the first job's match
  // score, and marking one applied marked them all. Two distinct openings that
  // share an id is a source fault, so the later one is dropped rather than
  // rendered under a key that already means another job.
  const seen = new Set<string>();
  return [...best.values()].filter((j) => {
    if (!j.id || seen.has(j.id)) {
      console.warn(`[jobs] dropped a listing with a duplicate id: ${j.id || "(empty)"} — ${j.title}`);
      return false;
    }
    seen.add(j.id);
    return true;
  });
}

/**
 * Careerjet, through our own backend.
 *
 * Its results arrive with no parsed skills — it returns an excerpt rather than
 * tags — so skills are extracted here with the same vocabulary used for the
 * other boards. Without that, every Bangladeshi listing would score 0% and
 * look like a worse match than a remote job the user is less suited to.
 */
async function fetchCareerjet(opts: { keywords?: string; location?: string }): Promise<FeedJob[] | null> {
  if (!API_URL) return null;
  try {
    const params = new URLSearchParams();
    if (opts.keywords) params.set("keywords", opts.keywords);
    if (opts.location) params.set("location", opts.location);

    const res = await apiFetch<{ jobs: FeedJob[]; available: boolean; reason?: string }>(
      `/api/jobs/search?${params}`,
      { timeoutMs: TIMEOUT_MS },
      true,
    );

    if (!res?.available) {
      if (res?.reason && res.reason !== "not_configured") {
        console.warn(`[jobs] Careerjet unavailable: ${res.reason}`);
      }
      return null;
    }

    return (res.jobs ?? []).map((j) => ({
      ...j,
      requiredSkills: extractSkills(`${j.title} ${j.description}`),
    }));
  } catch (e: any) {
    // A dead session is not a Careerjet fault, and reporting it as one sends
    // the user to check the job board while the real fix is signing in again.
    if (e?.code === "SESSION_EXPIRED" || e?.status === 401) {
      console.warn("[jobs] session expired while loading jobs");
      throw Object.assign(new Error("session_expired"), { code: "SESSION_EXPIRED" });
    }
    console.warn("[jobs] Careerjet request failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Fetches the feed.
 *
 * `keywords` and `location` are passed straight to Careerjet's own search,
 * which is stricter and cheaper than pulling everything and filtering here.
 */
export async function fetchLiveJobs(opts: { keywords?: string; location?: string } = {}): Promise<FeedResult> {
  // Deliberately not caught here: an expired session is the caller's problem to
  // report, and swallowing it would show an empty job list to someone who is
  // simply signed out.
  const careerjet = await fetchCareerjet(opts);

  // Null means unreachable or unconfigured. With one source there is nothing to
  // fall back to, so this is reported rather than hidden behind other results.
  if (careerjet === null) {
    return { jobs: [], sources: [], failed: ["Careerjet"], fetchedAt: new Date().toISOString() };
  }

  return {
    jobs: dedupe(careerjet),
    sources: careerjet.length > 0 ? ["Careerjet"] : [],
    failed: [],
    fetchedAt: new Date().toISOString(),
  };
}
