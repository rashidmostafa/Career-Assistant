export type PlatformCategory = "general" | "blue-collar" | "international";

export interface JobPlatform {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  category: PlatformCategory;
  baseUrl: string;
}

export const JOB_PLATFORMS: JobPlatform[] = [
  { id: "bdjobs", name: "Bdjobs.com", shortName: "Bdjobs", icon: "🇧🇩", category: "general", baseUrl: "https://www.bdjobs.com" },
  { id: "careerjet", name: "Careerjet.com.bd", shortName: "Careerjet", icon: "🌐", category: "general", baseUrl: "https://www.careerjet.com.bd" },
  { id: "atbjobs", name: "atB Jobs", shortName: "atB Jobs", icon: "🇧🇩", category: "general", baseUrl: "https://www.atbjobs.com" },
  { id: "shomvob", name: "Shomvob", shortName: "Shomvob", icon: "🛠️", category: "blue-collar", baseUrl: "https://shomvob.co" },
  { id: "ezjobs", name: "EZ Jobs", shortName: "EZ Jobs", icon: "🛠️", category: "blue-collar", baseUrl: "https://ezjobs.io" },
  { id: "bikroy", name: "Bikroy.com/Jobs", shortName: "Bikroy Jobs", icon: "📱", category: "blue-collar", baseUrl: "https://bikroy.com/en/jobs" },
  { id: "linkedin", name: "LinkedIn", shortName: "LinkedIn", icon: "🔗", category: "international", baseUrl: "https://www.linkedin.com/jobs" },
  { id: "indeed", name: "Indeed", shortName: "Indeed", icon: "🔗", category: "international", baseUrl: "https://www.indeed.com" },
  { id: "wellfound", name: "Wellfound", shortName: "Wellfound", icon: "🚀", category: "international", baseUrl: "https://wellfound.com" },
];

export const PLATFORM_CATEGORY_LABELS: Record<PlatformCategory, string> = {
  general: "General & Corporate",
  "blue-collar": "Blue-Collar & Entry-Level",
  international: "International, Remote & Specialized",
};

/**
 * Search-result URLs per platform, with {q} replaced by the user's target role.
 *
 * Sending someone to a site's homepage makes them retype what the app already
 * knows. Platforms without a documented search URL simply open their base URL.
 */
// Verified by request, not assumed. Entries omitted here fall back to the
// platform's base URL, which is correct for sites with no usable search path —
// better than a guessed query string that 404s.
const SEARCH_URLS: Record<string, string> = {
  // bdjobs.com/h/jobs/ loads; adding ?txtsearch= 302s to nowhere followable —
  // their current site is a JS app and that legacy parameter no longer works.
  // Open the listings page and let the user search there.
  bdjobs:     "https://bdjobs.com/h/jobs/",
  careerjet:  "https://www.careerjet.com.bd/jobs?s={q}",
  linkedin:   "https://www.linkedin.com/jobs/search/?keywords={q}",
  indeed:     "https://www.indeed.com/jobs?q={q}",
  wellfound:  "https://wellfound.com/jobs?query={q}",
  shomvob:    "https://shomvob.co/jobs",
  bikroy:     "https://bikroy.com/en/ads/bangladesh/jobs?query={q}",
  // ezjobs.io and atbjobs expose no working search path — /search and /jobs
  // both 404 — so they open their home page.
};

export function getPlatformSearchUrl(platform: JobPlatform, query?: string): string {
  const template = SEARCH_URLS[platform.id];
  const q = query?.trim();
  if (!template || !q) return platform.baseUrl;
  return template.replace("{q}", encodeURIComponent(q));
}

export function getPlatformById(id: string): JobPlatform | undefined {
  return JOB_PLATFORMS.find((p) => p.id === id);
}

export const BD_LOCATIONS = ["Dhaka", "Chittagong", "Rajshahi", "Khulna", "Sylhet", "Barisal", "Remote"];
export const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Freelance"];
export const JOB_EXPERIENCE_LEVELS = ["Entry", "Mid", "Senior"];

export function mapUserExperienceToJobLevel(experienceLevel: string | undefined): string | null {
  if (!experienceLevel) return null;
  const v = experienceLevel.toLowerCase();
  if (v.includes("student") || v.includes("entry")) return "Entry";
  if (v.includes("mid")) return "Mid";
  if (v.includes("senior") || v.includes("lead")) return "Senior";
  return null;
}
