/**
 * cvBuilder — composing a CV from answers rather than reading one from a file.
 *
 * The app is gated on having a CV: the roadmap refuses to open without one and
 * job matching has nothing to score against. That locks out precisely the
 * people it should help most — a final-year student who has never written one.
 * This turns a set of answered questions into the same plain text an uploaded
 * CV produces, so everything downstream works identically afterwards.
 *
 * Section order follows the format the user picks, because the conventions
 * genuinely differ and cvAI scores against them: Harvard leads with Education,
 * MIT wants Technical Skills immediately after it and treats Projects as
 * first-class, and a corporate CV opens with a summary and a competencies
 * block. Composing all three the same way would produce a document the scorer
 * then marks down for the ordering this file chose.
 */
import { scoreAnswer } from "./interviewScoring";

// ─── Model ────────────────────────────────────────────────────────────────────
export interface CVContact {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  /** LinkedIn, GitHub, a portfolio — whatever the user has. */
  links: string[];
}

export interface EducationEntry {
  id: string;
  qualification: string;   // "BSc in Computer Science"
  institution: string;
  year: string;            // free text: "2026", "2022 - 2026", "expected 2027"
  detail: string;          // CGPA, honours, relevant coursework
}

export interface ExperienceEntry {
  id: string;
  title: string;
  organisation: string;
  period: string;
  bullets: string[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  /** "Java, MySQL" — kept as written; skills are parsed from the whole document. */
  tech: string;
  bullets: string[];
}

export interface CVDraft {
  contact: CVContact;
  summary: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string[];
  certifications: string[];
  languages: string[];
  /** One of CV_FORMATS, or the user's own answer. */
  format: string;
  updatedAt: string;
}

export const EMPTY_DRAFT: CVDraft = {
  contact: { fullName: "", email: "", phone: "", location: "", links: [] },
  summary: "",
  education: [],
  experience: [],
  projects: [],
  skills: [],
  certifications: [],
  languages: [],
  format: "Harvard",
  updatedAt: "",
};

export const newId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const emptyEducation = (): EducationEntry =>
  ({ id: newId(), qualification: "", institution: "", year: "", detail: "" });
export const emptyExperience = (): ExperienceEntry =>
  ({ id: newId(), title: "", organisation: "", period: "", bullets: [""] });
export const emptyProject = (): ProjectEntry =>
  ({ id: newId(), name: "", tech: "", bullets: [""] });

// ─── Completeness ─────────────────────────────────────────────────────────────
/**
 * The least that still makes a usable CV.
 *
 * Work experience is deliberately not required. The people this exists for have
 * none, and refusing to save without it would lock out the exact users the
 * feature was added for — a student's projects are their evidence.
 */
export function draftIssues(draft: CVDraft): string[] {
  const out: string[] = [];
  const c = draft.contact;
  if (!c.fullName.trim()) out.push("Your name is missing.");
  if (!c.email.trim()) out.push("An email address is missing — employers need a way to reply.");
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) out.push("That email address doesn't look right.");
  if (draft.education.length === 0 && draft.experience.length === 0 && draft.projects.length === 0) {
    out.push("Add at least one education entry, one job, or one project.");
  }
  if (draft.skills.length === 0) out.push("List at least one skill.");
  return out;
}

export const canSave = (draft: CVDraft): boolean => draftIssues(draft).length === 0;

/** 0-100, for the progress bar. Weighted by what a reader actually looks for. */
export function draftCompleteness(draft: CVDraft): number {
  const checks: [boolean, number][] = [
    [!!draft.contact.fullName.trim(), 15],
    [!!draft.contact.email.trim(), 15],
    [!!draft.contact.phone.trim() || !!draft.contact.location.trim(), 5],
    [draft.contact.links.length > 0, 5],
    [draft.summary.trim().length > 20, 10],
    [draft.education.length > 0, 15],
    [draft.experience.length > 0 || draft.projects.length > 0, 20],
    [draft.skills.length > 0, 10],
    [draft.certifications.length > 0 || draft.languages.length > 0, 5],
  ];
  const got = checks.reduce((n, [ok, w]) => n + (ok ? w : 0), 0);
  return Math.min(100, got);
}

// ─── Composition ──────────────────────────────────────────────────────────────
const clean = (s: string) => String(s ?? "").trim();
const nonEmpty = (xs: string[]) => xs.map(clean).filter(Boolean);

function contactBlock(c: CVContact): string[] {
  const line2 = nonEmpty([c.email, c.phone, c.location]).join(" | ");
  const line3 = nonEmpty(c.links).join(" | ");
  return [clean(c.fullName).toUpperCase(), line2, line3].filter(Boolean);
}

function educationBlock(entries: EducationEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const head = nonEmpty([e.qualification, e.institution]).join(", ");
    out.push(nonEmpty([head, e.year]).join(" — "));
    if (clean(e.detail)) out.push(`  ${clean(e.detail)}`);
  }
  return out;
}

function experienceBlock(entries: ExperienceEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const head = nonEmpty([e.title, e.organisation]).join(", ");
    out.push(nonEmpty([head, e.period]).join(" — "));
    for (const b of nonEmpty(e.bullets)) out.push(`  • ${b}`);
    out.push("");
  }
  return out;
}

function projectBlock(entries: ProjectEntry[]): string[] {
  const out: string[] = [];
  for (const p of entries) {
    out.push(nonEmpty([p.name, clean(p.tech) ? `(${clean(p.tech)})` : ""]).join(" "));
    for (const b of nonEmpty(p.bullets)) out.push(`  • ${b}`);
    out.push("");
  }
  return out;
}

interface Section { heading: string; lines: string[] }

/**
 * Turns the draft into the plain text an uploaded CV would have produced.
 *
 * Empty sections are dropped rather than printed as a bare heading — an
 * "EXPERIENCE" heading with nothing under it advertises the gap it is trying
 * to cover.
 */
export function composeCV(draft: CVDraft): string {
  const summary: Section  = { heading: "PROFESSIONAL SUMMARY", lines: clean(draft.summary) ? [clean(draft.summary)] : [] };
  const education: Section = { heading: "EDUCATION", lines: educationBlock(draft.education) };
  const experience: Section = { heading: "EXPERIENCE", lines: experienceBlock(draft.experience) };
  const projects: Section = { heading: "PROJECTS", lines: projectBlock(draft.projects) };
  const skills: Section = {
    heading: draft.format === "MIT" ? "TECHNICAL SKILLS" : draft.format === "Corporate" ? "CORE COMPETENCIES" : "SKILLS",
    lines: draft.skills.length ? [nonEmpty(draft.skills).join(", ")] : [],
  };
  const certs: Section = { heading: "CERTIFICATIONS", lines: nonEmpty(draft.certifications).map((c) => `  • ${c}`) };
  const langs: Section = { heading: "LANGUAGES", lines: nonEmpty(draft.languages).length ? [nonEmpty(draft.languages).join(", ")] : [] };

  // Order is the format's, not ours — cvAI scores against these conventions.
  let ordered: Section[];
  switch (draft.format) {
    case "MIT":
      ordered = [education, skills, projects, experience, summary, certs, langs];
      break;
    case "Corporate":
      ordered = [summary, skills, experience, projects, education, certs, langs];
      break;
    case "Harvard":
      ordered = [education, experience, projects, skills, summary, certs, langs];
      break;
    default:
      // An unfamiliar format gets the ordering that reads most conventionally
      // rather than a guess at rules we do not know.
      ordered = [summary, education, experience, projects, skills, certs, langs];
  }

  const parts: string[] = [...contactBlock(draft.contact), ""];
  for (const s of ordered) {
    const lines = s.lines.filter((l, i, a) => !(l === "" && a[i - 1] === ""));
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) continue;
    parts.push(s.heading, ...lines, "");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ─── Coverage against a target ────────────────────────────────────────────────
export interface Coverage {
  covered: string[];
  missing: string[];
  /** 0-100. Zero when there is nothing to compare against. */
  percent: number;
}

/**
 * Which of a target's expected skills the draft already evidences.
 *
 * Matched against the whole composed document, not the skills list alone: a
 * project described as "built a REST API in Spring" evidences those skills
 * whether or not the user thought to type them into the skills box.
 */
export function coverageAgainst(draft: CVDraft, targetSkills: string[]): Coverage {
  const wanted = [...new Set(targetSkills.map((s) => String(s ?? "").toLowerCase().trim()).filter(Boolean))];
  if (wanted.length === 0) return { covered: [], missing: [], percent: 0 };

  // Reuses the interview scorer's matcher rather than a second implementation.
  // It already handles the shapes a job's required skills actually arrive in —
  // multi-word ("rest api"), punctuated ("c++", "node.js"), and pluralised —
  // and a skill vocabulary would only credit terms it happened to know.
  const document = `${composeCV(draft)}\n${draft.skills.join(", ")}`;
  const { matched, missed, score } = scoreAnswer(document, wanted);
  return { covered: matched, missing: missed, percent: score };
}
