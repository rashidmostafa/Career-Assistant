/**
 * Deterministic skill extraction from raw CV text.
 *
 * Matching is dictionary-based rather than AI-based so that job-match
 * percentages are stable, instant, and work with no API key — the same CV
 * always yields the same skills. Each canonical skill lists the aliases and
 * spellings people actually write on résumés ("JS", "Node", "ReactJS"), and
 * all of them normalise to one canonical label so scoring can compare CV
 * skills against a job's `requiredSkills` reliably.
 */

/** canonical skill name -> alternate spellings found in real CVs */
const SKILL_DICTIONARY: Record<string, string[]> = {
  // ---- Languages ----
  JavaScript: ["javascript", "java script", "js", "es6", "ecmascript"],
  TypeScript: ["typescript", "ts"],
  Python: ["python", "py"],
  Java: ["java"],
  "C++": ["c++", "cpp", "c plus plus"],
  "C#": ["c#", "c sharp", "csharp"],
  C: ["c language", "c programming"],
  PHP: ["php"],
  Ruby: ["ruby", "ruby on rails", "rails"],
  Go: ["golang", "go lang"],
  Rust: ["rust"],
  Kotlin: ["kotlin"],
  Swift: ["swift", "swiftui"],
  Dart: ["dart"],
  SQL: ["sql"],
  R: ["r programming", "r language"],
  MATLAB: ["matlab"],
  Bash: ["bash", "shell scripting", "shell script"],

  // ---- Frontend ----
  React: ["react", "reactjs", "react.js"],
  "React Native": ["react native", "reactnative"],
  "Next.js": ["next.js", "nextjs"],
  Vue: ["vue", "vuejs", "vue.js"],
  Angular: ["angular", "angularjs"],
  HTML: ["html", "html5"],
  CSS: ["css", "css3"],
  Sass: ["sass", "scss"],
  "Tailwind CSS": ["tailwind", "tailwind css", "tailwindcss"],
  Bootstrap: ["bootstrap"],
  Redux: ["redux"],
  jQuery: ["jquery"],

  // ---- Backend / API ----
  "Node.js": ["node.js", "nodejs", "node js", "node"],
  Express: ["express", "express.js", "expressjs"],
  Django: ["django"],
  Flask: ["flask"],
  Laravel: ["laravel"],
  Spring: ["spring", "spring boot", "springboot"],
  "REST API": ["rest api", "restful", "rest apis", "rest"],
  GraphQL: ["graphql"],
  "ASP.NET": ["asp.net", "aspnet", ".net", "dotnet"],

  // ---- Databases ----
  MongoDB: ["mongodb", "mongo"],
  MySQL: ["mysql"],
  PostgreSQL: ["postgresql", "postgres"],
  Redis: ["redis"],
  SQLite: ["sqlite"],
  Firebase: ["firebase"],
  Oracle: ["oracle db", "oracle database"],

  // ---- Cloud / DevOps ----
  AWS: ["aws", "amazon web services"],
  Azure: ["azure", "microsoft azure"],
  "Google Cloud": ["google cloud", "gcp"],
  Docker: ["docker", "containerization"],
  Kubernetes: ["kubernetes", "k8s"],
  "CI/CD": ["ci/cd", "ci cd", "continuous integration", "continuous deployment"],
  Jenkins: ["jenkins"],
  Terraform: ["terraform"],
  Ansible: ["ansible"],
  Nginx: ["nginx"],
  Linux: ["linux", "ubuntu", "unix"],

  // ---- Tools ----
  Git: ["git", "github", "gitlab", "bitbucket", "version control"],
  Jira: ["jira"],
  Figma: ["figma"],
  Postman: ["postman"],
  Webpack: ["webpack"],

  // ---- Data / ML ----
  "Machine Learning": ["machine learning", "ml", "deep learning"],
  Pandas: ["pandas"],
  NumPy: ["numpy"],
  TensorFlow: ["tensorflow"],
  PyTorch: ["pytorch"],
  "Data Analysis": ["data analysis", "data analytics", "data visualization"],
  Statistics: ["statistics", "statistical analysis"],
  "Power BI": ["power bi", "powerbi"],
  Tableau: ["tableau"],
  Excel: ["excel", "microsoft excel", "ms excel", "spreadsheet"],

  // ---- Networking / Security ----
  Networking: ["networking", "computer networks", "network troubleshooting", "network administration"],
  "IP Addressing": ["ip addressing", "subnetting", "subnet"],
  Routing: ["routing", "routing and switching", "switching"],
  VLAN: ["vlan", "vlans"],
  Cybersecurity: ["cybersecurity", "cyber security", "information security", "infosec", "network security"],
  "Penetration Testing": ["penetration testing", "pentesting", "ethical hacking", "ctf"],
  Firewall: ["firewall", "firewalls"],
  "Cisco Packet Tracer": ["cisco packet tracer", "packet tracer", "gns3"],
  "Embedded Systems": ["embedded systems", "embedded"],
  PLC: ["plc"],

  // ---- Engineering (non-software) ----
  AutoCAD: ["autocad", "auto cad", "autocad electrical"],
  SolidWorks: ["solidworks", "solid works"],
  CAD: ["cad"],
  "Circuit Design": ["circuit design", "circuit analysis"],
  "Power Systems": ["power systems", "power system"],
  "Structural Design": ["structural design", "structural analysis"],
  "Quality Control": ["quality control", "quality assurance", "qa"],
  Manufacturing: ["manufacturing", "production"],
  Estimation: ["estimation", "cost estimation"],
  "Site Supervision": ["site supervision", "site engineer"],

  // ---- Marketing / Business ----
  SEO: ["seo", "search engine optimization"],
  "Google Ads": ["google ads", "google adwords", "adwords", "ppc"],
  "Content Strategy": ["content strategy", "content marketing", "content writing"],
  Analytics: ["google analytics", "web analytics"],
  "Social Media": ["social media", "social media marketing"],
  CRM: ["crm", "salesforce", "hubspot"],
  "Market Research": ["market research", "marketing research"],
  "Project Management": ["project management", "agile", "scrum", "kanban"],
  "Stakeholder Management": ["stakeholder management", "stakeholder"],
  Presentation: ["presentation", "public speaking"],

  // ---- Finance ----
  Accounting: ["accounting", "bookkeeping"],
  "Financial Modeling": ["financial modeling", "financial modelling", "financial analysis"],
  Taxation: ["taxation", "tax", "vat"],
  Reporting: ["financial reporting", "reporting"],
  QuickBooks: ["quickbooks"],

  // ---- Soft skills ----
  Communication: ["communication", "communication skills"],
  Teamwork: ["teamwork", "team work", "collaboration"],
  Leadership: ["leadership", "team lead", "mentoring"],
  "Problem Solving": ["problem solving", "problem-solving", "analytical thinking"],
  "Time Management": ["time management"],
  "Customer Service": ["customer service", "customer support", "client relations"],
  "Attention to Detail": ["attention to detail", "detail oriented"],
};

/**
 * Word-ish boundaries that tolerate the punctuation real skill names carry
 * (`C++`, `C#`, `Node.js`, `CI/CD`). Written as capture groups rather than
 * lookbehind, since lookbehind support is inconsistent across the JS engines
 * React Native runs on.
 */
const BOUNDARY_LEFT = "(^|[^A-Za-z0-9+#])";
const BOUNDARY_RIGHT = "($|[^A-Za-z0-9+#])";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Precompiled once at module load — extraction runs on every CV upload. */
const COMPILED: { canonical: string; pattern: RegExp }[] = Object.entries(SKILL_DICTIONARY).flatMap(
  ([canonical, aliases]) =>
    [canonical.toLowerCase(), ...aliases].map((alias) => ({
      canonical,
      pattern: new RegExp(BOUNDARY_LEFT + escapeRegExp(alias) + BOUNDARY_RIGHT, "i"),
    }))
);

/**
 * Scan raw CV text and return the canonical names of every skill mentioned.
 * Order follows the dictionary so results are stable across runs.
 */
export function extractSkillsFromText(rawText: string): string[] {
  if (!rawText || rawText.trim().length === 0) return [];
  // Collapse whitespace so line-wrapped phrases ("machine\nlearning") still match.
  const text = rawText.replace(/\s+/g, " ");
  const found = new Set<string>();
  for (const { canonical, pattern } of COMPILED) {
    if (found.has(canonical)) continue;
    if (pattern.test(text)) found.add(canonical);
  }
  return Array.from(found);
}

/**
 * Normalise an arbitrary skill string (e.g. a job's `requiredSkills` entry)
 * onto a dictionary canonical name so it can be compared with CV skills.
 * Falls back to the trimmed original when the skill isn't in the dictionary,
 * so unknown-but-matching strings still compare correctly.
 */
export function canonicalizeSkill(skill: string): string {
  const needle = skill.trim().toLowerCase();
  if (!needle) return "";
  for (const [canonical, aliases] of Object.entries(SKILL_DICTIONARY)) {
    if (canonical.toLowerCase() === needle) return canonical;
    if (aliases.includes(needle)) return canonical;
  }
  return skill.trim();
}
