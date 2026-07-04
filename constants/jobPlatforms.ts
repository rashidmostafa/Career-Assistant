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
  { id: "chakri", name: "Chakri.com", shortName: "Chakri", icon: "🇧🇩", category: "general", baseUrl: "https://www.chakri.com" },
  { id: "careerjet", name: "Careerjet.com.bd", shortName: "Careerjet", icon: "🌐", category: "general", baseUrl: "https://www.careerjet.com.bd" },
  { id: "atbjobs", name: "atB Jobs", shortName: "atB Jobs", icon: "🇧🇩", category: "general", baseUrl: "https://www.atbjobs.com" },
  { id: "everjobs", name: "Everjobs Bangladesh", shortName: "Everjobs", icon: "🌍", category: "general", baseUrl: "https://www.everjobs.com.bd" },
  { id: "globexhire", name: "GlobexHire.com", shortName: "GlobexHire", icon: "🇧🇩", category: "general", baseUrl: "https://www.globexhire.com" },
  { id: "shomvob", name: "Shomvob", shortName: "Shomvob", icon: "🛠️", category: "blue-collar", baseUrl: "https://www.shomvob.jobs" },
  { id: "ezjobs", name: "EZ Jobs", shortName: "EZ Jobs", icon: "🛠️", category: "blue-collar", baseUrl: "https://ezjobs.io" },
  { id: "bikroy", name: "Bikroy.com/Jobs", shortName: "Bikroy Jobs", icon: "📱", category: "blue-collar", baseUrl: "https://bikroy.com/en/jobs" },
  { id: "kormo", name: "Kormo Jobs", shortName: "Kormo Jobs", icon: "📱", category: "blue-collar", baseUrl: "https://kormo.google.com" },
  { id: "linkedin", name: "LinkedIn", shortName: "LinkedIn", icon: "🔗", category: "international", baseUrl: "https://www.linkedin.com/jobs" },
  { id: "indeed", name: "Indeed", shortName: "Indeed", icon: "🔗", category: "international", baseUrl: "https://www.indeed.com" },
  { id: "wellfound", name: "Wellfound", shortName: "Wellfound", icon: "🚀", category: "international", baseUrl: "https://wellfound.com" },
];

export const PLATFORM_CATEGORY_LABELS: Record<PlatformCategory, string> = {
  general: "General & Corporate",
  "blue-collar": "Blue-Collar & Entry-Level",
  international: "International, Remote & Specialized",
};

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
