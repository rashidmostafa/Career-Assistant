/**
 * jobFeedService — real job listings from public APIs.
 *
 * The job list used to come from data/bdJobs.ts, which fabricated listings by
 * combining role templates with Bangladeshi company names. They looked real and
 * were not: the companies were never hiring for those roles, and every
 * "Apply" led to a search page rather than the posting.
 *
 * These two sources are public, need no API key, and send
 * `access-control-allow-origin: *`, so they work from the browser build and the
 * APK alike without a backend proxy.
 *
 * A limitation worth being straight about: neither covers Bangladesh. Bdjobs,
 * Chakri and the other local boards publish no public API. Local roles are
 * therefore reached by linking out to those sites (see constants/jobPlatforms),
 * rather than by inventing listings for them.
 */
import type { JobListing } from "@/context/JobsContext";

const REMOTIVE = "https://remotive.com/api/remote-jobs";
const ARBEITNOW = "https://www.arbeitnow.com/api/job-board-api";

/** Requests are abandoned rather than left to hang the jobs screen. */
const TIMEOUT_MS = 12_000;

async function getJson(url: string): Promise<any | null> {
  // AbortSignal.timeout is absent from React Native's AbortSignal polyfill, so
  // this threw on every device call and the job feed silently fell back to an
  // empty list — the listings never loaded outside a browser.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline, timed out, or the source is down — the caller falls back.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const cleanHtml = (s: string): string =>
  (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Infers seniority from the title, since neither source states it. */
function levelFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/\b(senior|sr\.?|lead|principal|staff|head)\b/.test(t)) return "Senior";
  if (/\b(junior|jr\.?|intern|entry|graduate|trainee)\b/.test(t)) return "Entry";
  return "Mid";
}

function mapRemotive(j: any): JobListing {
  const tags: string[] = Array.isArray(j.tags) ? j.tags : [];
  return {
    id: `remotive_${j.id}`,
    title: j.title ?? "Untitled role",
    company: j.company_name ?? "Unknown",
    location: j.candidate_required_location || "Remote",
    description: cleanHtml(j.description).slice(0, 600),
    requiredSkills: tags.slice(0, 8).map(titleCase),
    matchScore: 0,
    type: j.job_type ? titleCase(j.job_type) : "Full-time",
    // Most postings omit pay; an empty string is honest where "0 BDT" is not.
    salary: j.salary || "",
    postedAt: j.publication_date ?? new Date().toISOString(),
    remote: true,
    category: j.category ?? "General",
    originalUrl: j.url,
    sourceLabel: "Remotive",
    platformId: "remotive",
    platformName: "Remotive",
    platformIcon: "🌍",
    jobType: j.job_type ? titleCase(j.job_type) : "Full-time",
    experienceLevel: levelFromTitle(j.title ?? ""),
    verified: true,
    topCompany: false,
  };
}

function mapArbeitnow(j: any): JobListing {
  const tags: string[] = Array.isArray(j.tags) ? j.tags : [];
  const types: string[] = Array.isArray(j.job_types) ? j.job_types : [];
  return {
    id: `arbeitnow_${j.slug}`,
    title: j.title ?? "Untitled role",
    company: j.company_name ?? "Unknown",
    location: j.location || (j.remote ? "Remote" : "—"),
    description: cleanHtml(j.description).slice(0, 600),
    requiredSkills: tags.slice(0, 8).map(titleCase),
    matchScore: 0,
    type: types[0] ?? "Full-time",
    salary: "",
    // created_at is a unix timestamp in seconds.
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : new Date().toISOString(),
    remote: !!j.remote,
    category: tags[0] ? titleCase(tags[0]) : "General",
    originalUrl: j.url,
    sourceLabel: "Arbeitnow",
    platformId: "arbeitnow",
    platformName: "Arbeitnow",
    platformIcon: "🇪🇺",
    jobType: types[0] ?? "Full-time",
    experienceLevel: levelFromTitle(j.title ?? ""),
    verified: true,
    topCompany: false,
  };
}

export interface JobFeedResult {
  jobs: JobListing[];
  /** Sources that answered, for showing the user where the list came from. */
  sources: string[];
  /** True when nothing could be reached, so the caller can say so plainly. */
  offline: boolean;
}

/**
 * Fetches from both sources in parallel. One source failing is not fatal —
 * a partial list beats an empty screen.
 */
export async function fetchLiveJobs(search?: string): Promise<JobFeedResult> {
  const query = search?.trim();
  const remotiveUrl = query
    ? `${REMOTIVE}?search=${encodeURIComponent(query)}&limit=60`
    : `${REMOTIVE}?limit=60`;

  const [remotive, arbeitnow] = await Promise.all([getJson(remotiveUrl), getJson(ARBEITNOW)]);

  const jobs: JobListing[] = [];
  const sources: string[] = [];

  if (remotive?.jobs?.length) {
    jobs.push(...remotive.jobs.map(mapRemotive));
    sources.push("Remotive");
  }
  if (arbeitnow?.data?.length) {
    // Arbeitnow has no search parameter, so filter client-side to keep the
    // list relevant to what the user asked for.
    const all = arbeitnow.data.map(mapArbeitnow);
    const filtered = query
      ? all.filter((j: JobListing) =>
          `${j.title} ${j.company} ${j.requiredSkills.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
        )
      : all;
    jobs.push(...filtered);
    sources.push("Arbeitnow");
  }

  // Same role cross-posted to both boards should appear once.
  const seen = new Set<string>();
  const deduped = jobs.filter((j) => {
    const key = `${j.title}::${j.company}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

  return { jobs: deduped, sources, offline: sources.length === 0 };
}
