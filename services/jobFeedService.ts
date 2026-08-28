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
 * Both sources are public, need no key, and send permissive CORS headers, so
 * they work from the browser build and a device alike.
 *
 * Worth being straight about the coverage: neither source indexes Bangladesh.
 * Bdjobs, Chakri and the other local boards publish no public API, so local
 * roles are reached by linking out to those sites rather than by inventing
 * listings for them.
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
const REMOTIVE = "https://remotive.com/api/remote-jobs";
const ARBEITNOW = "https://www.arbeitnow.com/api/job-board-api";
const TIMEOUT_MS = 15_000;

/**
 * AbortSignal.timeout is absent from React Native's polyfill, so the deadline
 * is built from an AbortController.
 */
async function getJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const cleanHtml = (s: string): string =>
  (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (s: string) => (s ?? "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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

/** Infers seniority from the title, since neither source states it. */
function levelFromTitle(title: string): string {
  const t = (title ?? "").toLowerCase();
  if (/\b(senior|sr\.?|lead|principal|staff|head|director)\b/.test(t)) return "Senior";
  if (/\b(junior|jr\.?|intern|entry|graduate|trainee)\b/.test(t)) return "Entry";
  return "Mid";
}

function mapRemotive(j: any): FeedJob | null {
  const title = (j?.title ?? "").trim();
  const url = (j?.url ?? "").trim();
  if (!title || !url) return null;

  const description = cleanHtml(j.description ?? "");
  const tags: string[] = Array.isArray(j.tags) ? j.tags : [];

  return {
    id: `remotive_${j.id}`,
    title,
    company: (j.company_name ?? "Unknown").trim(),
    location: (j.candidate_required_location || "Remote").trim(),
    description,
    requiredSkills: [...new Set([...extractSkills(`${title} ${description}`), ...tags.map(titleCase).filter((t) => SKILL_VOCAB.some((s) => s.toLowerCase() === t.toLowerCase()))])],
    type: titleCase(j.job_type ?? "Full-time"),
    salary: (j.salary ?? "").trim() || "Not disclosed",
    postedAt: j.publication_date ?? new Date().toISOString(),
    remote: true,
    category: titleCase(j.category ?? levelFromTitle(title)),
    originalUrl: url,
    sourceLabel: "Remotive",
    platformId: "remotive",
    platformName: "Remotive",
  };
}

function mapArbeitnow(j: any): FeedJob | null {
  const title = (j?.title ?? "").trim();
  const url = (j?.url ?? "").trim();
  if (!title || !url) return null;

  const description = cleanHtml(j.description ?? "");
  const tags: string[] = Array.isArray(j.tags) ? j.tags : [];

  return {
    id: `arbeitnow_${j.slug ?? url}`,
    title,
    company: (j.company_name ?? "Unknown").trim(),
    location: (j.location || (j.remote ? "Remote" : "")).trim() || "Not stated",
    description,
    requiredSkills: [...new Set([...extractSkills(`${title} ${description}`), ...tags.map(titleCase).filter((t) => SKILL_VOCAB.some((s) => s.toLowerCase() === t.toLowerCase()))])],
    type: Array.isArray(j.job_types) && j.job_types.length ? titleCase(j.job_types[0]) : "Full-time",
    salary: "Not disclosed",
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : new Date().toISOString(),
    remote: Boolean(j.remote),
    category: levelFromTitle(title),
    originalUrl: url,
    sourceLabel: "Arbeitnow",
    platformId: "arbeitnow",
    platformName: "Arbeitnow",
  };
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
  return [...best.values()];
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
    console.warn("[jobs] Careerjet request failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Fetches every source in parallel and merges them.
 *
 * `keywords` and `location` steer Careerjet only — the other two boards have no
 * server-side search worth using here, and are filtered client-side by role.
 */
export async function fetchLiveJobs(opts: { keywords?: string; location?: string } = {}): Promise<FeedResult> {
  const [remotive, arbeitnow, careerjet] = await Promise.all([
    getJson(`${REMOTIVE}?limit=200`),
    getJson(ARBEITNOW),
    fetchCareerjet(opts),
  ]);

  const sources: string[] = [];
  const failed: string[] = [];
  const jobs: FeedJob[] = [];

  if (Array.isArray(remotive?.jobs)) {
    sources.push("Remotive");
    jobs.push(...remotive.jobs.map(mapRemotive).filter(Boolean as any as (j: FeedJob | null) => j is FeedJob));
  } else failed.push("Remotive");

  if (Array.isArray(arbeitnow?.data)) {
    sources.push("Arbeitnow");
    jobs.push(...arbeitnow.data.map(mapArbeitnow).filter(Boolean as any as (j: FeedJob | null) => j is FeedJob));
  } else failed.push("Arbeitnow");

  // Null means unavailable or unconfigured, which is not a failure worth
  // reporting to the user — an empty array is a real answer.
  if (careerjet !== null) {
    if (careerjet.length > 0) sources.push("Careerjet");
    jobs.push(...careerjet);
  }

  return { jobs: dedupe(jobs), sources, failed, fetchedAt: new Date().toISOString() };
}
