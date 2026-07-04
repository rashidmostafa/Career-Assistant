import { JOB_PLATFORMS, BD_LOCATIONS, JOB_TYPES, JOB_EXPERIENCE_LEVELS, JobPlatform } from "@/constants/jobPlatforms";
import type { JobListing } from "@/context/JobsContext";

interface RoleTemplate {
  category: string;
  titles: string[];
  skills: string[];
  salaryRangeBDT: [number, number];
}

const ROLE_TEMPLATES: RoleTemplate[] = [
  { category: "React Developer", titles: ["Senior React Developer", "React Developer", "React Frontend Engineer"], skills: ["React", "TypeScript", "Redux", "CSS", "REST API"], salaryRangeBDT: [70, 180] },
  { category: "Full Stack Developer", titles: ["Full Stack Engineer", "Full Stack Developer", "MERN Stack Developer"], skills: ["React", "Node.js", "MongoDB", "Express", "TypeScript"], salaryRangeBDT: [80, 200] },
  { category: "Backend Developer", titles: ["Backend Developer", "Senior Backend Engineer", "API Developer"], skills: ["Node.js", "PHP", "Laravel", "MySQL", "REST API"], salaryRangeBDT: [60, 170] },
  { category: "Data Scientist", titles: ["Data Scientist", "Data Analyst", "Machine Learning Engineer"], skills: ["Python", "SQL", "Pandas", "Machine Learning", "Statistics"], salaryRangeBDT: [70, 190] },
  { category: "DevOps Engineer", titles: ["DevOps Engineer", "Cloud Engineer", "Site Reliability Engineer"], skills: ["AWS", "Docker", "Kubernetes", "CI/CD", "Linux"], salaryRangeBDT: [80, 200] },
  { category: "Mobile Developer", titles: ["Mobile App Developer", "React Native Developer", "Android Developer"], skills: ["React Native", "Kotlin", "Swift", "Flutter", "Firebase"], salaryRangeBDT: [60, 170] },
  { category: "Frontend Developer", titles: ["Frontend Developer", "UI Engineer", "Web Developer"], skills: ["HTML", "CSS", "JavaScript", "React", "Figma"], salaryRangeBDT: [45, 130] },
  { category: "Marketing Manager", titles: ["Marketing Manager", "Digital Marketing Specialist", "SEO Specialist"], skills: ["SEO", "Google Ads", "Content Strategy", "Analytics", "Social Media"], salaryRangeBDT: [40, 150] },
  { category: "Business Analyst", titles: ["Business Analyst", "Sales Manager", "Brand Strategist"], skills: ["Market Research", "Excel", "Stakeholder Management", "Presentation", "CRM"], salaryRangeBDT: [45, 140] },
  { category: "Financial Analyst", titles: ["Financial Analyst", "Accountant", "Tax Consultant"], skills: ["Excel", "Financial Modeling", "Accounting", "Taxation", "Reporting"], salaryRangeBDT: [40, 130] },
  { category: "Civil Engineer", titles: ["Civil Engineer", "Site Engineer", "Structural Engineer"], skills: ["AutoCAD", "Structural Design", "Project Management", "Site Supervision", "Estimation"], salaryRangeBDT: [35, 120] },
  { category: "Electrical Engineer", titles: ["Electrical Engineer", "Power Systems Engineer", "Electronics Engineer"], skills: ["Circuit Design", "PLC", "Power Systems", "AutoCAD Electrical", "Embedded Systems"], salaryRangeBDT: [35, 120] },
  { category: "Mechanical Engineer", titles: ["Mechanical Engineer", "CAD Designer", "Manufacturing Engineer"], skills: ["SolidWorks", "CAD", "Manufacturing", "AutoCAD", "Quality Control"], salaryRangeBDT: [35, 120] },
  { category: "Customer Service", titles: ["Customer Support Representative", "Call Center Agent", "Sales Executive"], skills: ["Communication", "CRM", "Problem Solving", "Bengali/English", "Customer Service"], salaryRangeBDT: [15, 45] },
  { category: "Blue Collar", titles: ["Warehouse Associate", "Garments Production Supervisor", "Logistics Coordinator", "Delivery Rider", "Hospitality Staff"], skills: ["Teamwork", "Physical Stamina", "Basic Literacy", "Attention to Detail", "Time Management"], salaryRangeBDT: [12, 35] },
];

const BD_COMPANIES = [
  "bKash", "Pathao", "Chaldal", "Grameenphone", "Robi Axiata", "Banglalink",
  "BRAC Bank", "City Bank", "Evaly", "Daraz Bangladesh", "Kaz Software",
  "Therap BD", "Enosis Solutions", "Brain Station 23", "Selise Digital Platforms",
  "Rangs Group", "Square Group", "Walton Hi-Tech", "PRAN-RFL Group", "ACI Limited",
  "Beximco", "Summit Group", "Berger Paints Bangladesh", "Nagad", "upay",
  "IFIC Bank", "Dutch-Bangla Bank", "Standard Chartered Bangladesh",
];

const INTL_COMPANIES = [
  "Stripe", "Automattic", "GitLab", "Zapier", "Deel", "Remote.com",
  "Toptal", "Doist", "InVision", "Buffer",
];

const PLATFORM_TEMPLATE_MAP: Record<string, string[]> = {
  bdjobs: ["React Developer", "Full Stack Developer", "Backend Developer", "Data Scientist", "DevOps Engineer", "Mobile Developer", "Frontend Developer", "Marketing Manager", "Business Analyst", "Financial Analyst", "Civil Engineer", "Electrical Engineer", "Mechanical Engineer"],
  chakri: ["React Developer", "Backend Developer", "DevOps Engineer", "Financial Analyst", "Civil Engineer", "Electrical Engineer", "Mechanical Engineer"],
  careerjet: ["Full Stack Developer", "Data Scientist", "Marketing Manager", "Business Analyst", "Financial Analyst"],
  atbjobs: ["React Developer", "Frontend Developer", "Marketing Manager", "Business Analyst"],
  everjobs: ["Backend Developer", "Marketing Manager", "Business Analyst", "Financial Analyst"],
  globexhire: ["Full Stack Developer", "DevOps Engineer", "Financial Analyst", "Business Analyst"],
  shomvob: ["Customer Service"],
  ezjobs: ["Customer Service", "Blue Collar"],
  bikroy: ["Customer Service", "Blue Collar"],
  kormo: ["Customer Service", "Blue Collar"],
  linkedin: ["React Developer", "Full Stack Developer", "Backend Developer", "Data Scientist", "DevOps Engineer", "Marketing Manager", "Financial Analyst"],
  indeed: ["React Developer", "Full Stack Developer", "Backend Developer", "Mobile Developer", "Marketing Manager", "Business Analyst", "Customer Service"],
  wellfound: ["React Developer", "Full Stack Developer", "Backend Developer", "DevOps Engineer", "Data Scientist", "Mobile Developer"],
};

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function formatBDT(min: number, max: number): string {
  return `৳${min},000 - ৳${max},000/month`;
}

function buildJobId(platformId: string, category: string, index: number): string {
  return `${platformId}_${category.toLowerCase().replace(/\s+/g, "-")}_${index}`;
}

function generateJobsForPlatform(platform: JobPlatform): JobListing[] {
  const templateCategories = PLATFORM_TEMPLATE_MAP[platform.id] || [];
  const jobs: JobListing[] = [];
  const isInternational = platform.category === "international";
  const companyPool = isInternational ? INTL_COMPANIES : BD_COMPANIES;

  templateCategories.forEach((catName, catIdx) => {
    const template = ROLE_TEMPLATES.find((t) => t.category === catName);
    if (!template) return;

    const postings = platform.category === "blue-collar" ? 3 : 2;
    for (let i = 0; i < postings; i++) {
      const seedStr = `${platform.id}-${catName}-${i}`;
      const seed = hashSeed(seedStr);
      const title = pick(template.titles, seed + i);
      const company = pick(companyPool, seed + i * 7);
      const location = isInternational
        ? (seed % 3 === 0 ? "Remote" : pick(BD_LOCATIONS, seed))
        : pick(BD_LOCATIONS, seed + i);
      const jobType = pick(JOB_TYPES, seed + catIdx);
      const experienceLevel = pick(JOB_EXPERIENCE_LEVELS, seed + i * 3);
      const [salMin, salMax] = template.salaryRangeBDT;
      const spread = (seed % 5) * 5;
      const salaryMin = salMin + spread;
      const salaryMax = salMax - (seed % 4) * 5;
      const matchScore = 55 + (hashSeed(seedStr + "match") % 40);
      const postedOptions = ["1 hour ago", "3 hours ago", "Today", "Yesterday", "2 days ago", "5 days ago", "1 week ago"];
      const verified = seed % 3 === 0;
      const topCompany = seed % 4 === 0;

      jobs.push({
        id: buildJobId(platform.id, catName, i),
        title,
        company,
        location: location === "Remote" ? "Remote" : `${location}, Bangladesh`,
        description: `Join ${company} as a ${title}. Work with a growing team on impactful projects in the ${catName} space, using ${template.skills.slice(0, 3).join(", ")} and modern best practices.`,
        requiredSkills: template.skills,
        matchScore,
        type: jobType,
        salary: formatBDT(salaryMin, salaryMax),
        postedAt: pick(postedOptions, seed),
        remote: location === "Remote",
        category: catName,
        originalUrl: `${platform.baseUrl}/job/${seedStr.replace(/\s+/g, "-")}`,
        sourceLabel: new URL(platform.baseUrl).hostname + "/job",
        platformId: platform.id,
        platformName: platform.name,
        platformIcon: platform.icon,
        jobType,
        experienceLevel,
        verified,
        topCompany,
      });
    }
  });

  return jobs;
}

export function generateAllBDJobs(): JobListing[] {
  return JOB_PLATFORMS.flatMap((platform) => generateJobsForPlatform(platform));
}
