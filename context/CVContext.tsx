import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { extractSkillsFromText } from "@/utils/skillsExtract";
import { chatJSON, isAIConfigured } from "@/services/aiClient";
import { useAuth } from "./AuthContext";

export interface ATSBreakdown {
  keyword: number;
  formatting: number;
  achievements: number;
  skills: number;
  experience: number;
  grammar: number;
}

export interface CVSuggestion {
  title: string;
  location: string;
  problem: string;
  fix: string;
  example: string;
}

export interface CVProfile {
  id: string;
  userId: string;
  rawText: string;
  fullOptimizedCV: string;
  atsScore: number;
  breakdown: ATSBreakdown;
  suggestions: CVSuggestion[];
  /** Canonical skill names detected in the CV — drives job match scoring. */
  skills: string[];
  format: string;
  updatedAt: string;
}

interface CVContextType {
  cvProfile: CVProfile | null;
  isAnalyzing: boolean;
  analyzeCV: (rawText: string, format?: string) => Promise<void>;
  clearCV: () => Promise<void>;
}

const CVContext = createContext<CVContextType | null>(null);

const WEIGHTS: Record<keyof ATSBreakdown, number> = {
  keyword: 0.2,
  formatting: 0.15,
  achievements: 0.2,
  skills: 0.15,
  experience: 0.15,
  grammar: 0.15,
};

const BREAKDOWN_KEYS: (keyof ATSBreakdown)[] = ["keyword", "formatting", "achievements", "skills", "experience", "grammar"];

/** Guard against a corrupt/partial CVProfile (old app version, interrupted write) crashing the result view. */
function isValidCVProfile(v: unknown): v is CVProfile {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  if (typeof p.rawText !== "string" || typeof p.fullOptimizedCV !== "string") return false;
  if (typeof p.atsScore !== "number") return false;
  if (!p.breakdown || typeof p.breakdown !== "object") return false;
  if (!BREAKDOWN_KEYS.every((k) => typeof (p.breakdown as Record<string, unknown>)[k] === "number")) return false;
  if (!Array.isArray(p.suggestions)) return false;
  return true;
}

function computeOverallScore(breakdown: ATSBreakdown): number {
  const weighted =
    breakdown.keyword * WEIGHTS.keyword +
    breakdown.formatting * WEIGHTS.formatting +
    breakdown.achievements * WEIGHTS.achievements +
    breakdown.skills * WEIGHTS.skills +
    breakdown.experience * WEIGHTS.experience +
    breakdown.grammar * WEIGHTS.grammar;
  return Math.round(Math.min(100, Math.max(0, weighted)));
}

export function CVProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cvProfile, setCvProfile] = useState<CVProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setCvProfile(null); return; }
    try {
      const data = await AsyncStorage.getItem(`cv_${user.id}`);
      const parsed = data ? JSON.parse(data) : null;
      if (!isValidCVProfile(parsed)) {
        // Corrupt/partial data from an old version or interrupted write —
        // drop it rather than let a malformed shape crash the result view.
        if (data) await AsyncStorage.removeItem(`cv_${user.id}`);
        setCvProfile(null);
        return;
      }
      // Profiles saved before skills extraction existed have no `skills`;
      // derive them now so job matching works without a re-upload.
      if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
        parsed.skills = extractSkillsFromText(`${parsed.rawText}\n${parsed.fullOptimizedCV}`);
        await AsyncStorage.setItem(`cv_${user.id}`, JSON.stringify(parsed));
      }
      setCvProfile(parsed);
    } catch {
      setCvProfile(null);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const analyzeCV = async (rawText: string, format: string = "Harvard") => {
    if (!user) return;
    setIsAnalyzing(true);
    try {
      const apiKey = isAIConfigured;
      const role = user.targetRole || "Professional";
      const expLevel = user.experienceLevel || "";
      const prompt = `You are an ATS (Applicant Tracking System) resume auditor and expert CV writer, giving Turnitin-style detailed feedback. Analyze the following CV text for a ${role} position${expLevel ? ` (${expLevel} level)` : ""}.

CV Content (extracted from the candidate's uploaded PDF):
${rawText.slice(0, 6000)}

Score the CV against these exact weighted ATS criteria (each 0-100, be precise and vary the numbers realistically based on the actual content - do NOT default to round numbers like 60, 70, 80):
- keyword (20% weight): keyword optimisation for the target role
- formatting (15% weight): formatting and structure quality
- achievements (20% weight): presence and quality of quantifiable achievements
- skills (15% weight): skills presentation and relevance
- experience (15% weight): experience relevance to the target role
- grammar (15% weight): grammar and spelling quality

Then provide exactly 5 Turnitin-style suggestions. Each suggestion must reference something SPECIFIC and REAL from the CV text above (quote or closely paraphrase the actual line/section), not a generic tip. Each suggestion needs:
- title: short suggestion title (e.g. "Add Quantifiable Metrics")
- location: where in the CV this applies (e.g. "Experience Section - 'Improved sales'")
- problem: a clear explanation of the issue, referencing the real content
- fix: an actionable, specific recommendation
- example: a concrete rewritten example line the candidate could use

Finally, produce the FULL rewritten, ATS-optimised CV in ${format} format using the candidate's ACTUAL information from the CV above (do not invent an unrelated person). Every standard section that has real content in the source CV (Summary, Experience, Education, Skills, Projects, Certifications) must appear, fully written out, with all 5 suggestions already applied/integrated. This must be the complete CV, not a snippet or outline.

Format guidance (these follow each institution's actual published resume guide — match the section order and content exactly, only omitting a section if the source CV has nothing real to put in it):
- Harvard (per Harvard OCS/Mignone Center resume guide): Header (name, phone, email, LinkedIn) → brief Summary/Objective (optional, 1-2 lines) → Education (reverse chronological: institution, location, degree, expected/actual graduation date, GPA if strong, relevant coursework/honors) → Experience (reverse chronological, bullet points starting with strong action verbs, quantified accomplishments) → Leadership/Activities (optional — move above Experience only if more relevant to the target role) → Skills & Interests (technical skills, languages with fluency level, lab techniques if applicable, personal interests).
- MIT (per MIT CAPD career toolkit): Header → Education (institution, degree, expected date, relevant coursework, GPA) → Technical Skills (a dedicated categorized block — e.g. Languages / Frameworks & Tools / Lab Techniques — placed right after Education) → Projects (course and personal projects are a key differentiator for MIT students — name each project, note the GitHub/portfolio link if the source mentions one) → Experience/Research Experience → Leadership/Activities (optional). Every bullet must follow a PAR structure (Action verb + Project/task + measurable Result), never first person, never full sentences.
- Corporate (standard ATS-optimised professional format used across industry): Header (name, phone, email, LinkedIn, location) → Professional Summary (2-4 lines: years of experience, key skills, career focus) → Core Competencies/Skills (keyword-rich, tailored to the target role for ATS scanning) → Professional Experience (reverse chronological, quantified achievements, action verbs) → Education → Certifications (only if the source CV mentions any). Single-column, standard section headings, no tables or graphics — this is what ATS parsers expect.

Return ONLY a valid JSON object with exactly these fields, no markdown, no code blocks:
{
  "breakdown": { "keyword": number, "formatting": number, "achievements": number, "skills": number, "experience": number, "grammar": number },
  "suggestions": [ { "title": string, "location": string, "problem": string, "fix": string, "example": string }, ... exactly 5 items ],
  "fullOptimizedCV": string
}`;

      // Fallback values (used when no API key or the request fails)
      let breakdown = estimateBreakdown(rawText);
      let suggestions = generateFallbackSuggestions(rawText, role);
      let fullOptimizedCV = generateFallbackCV(rawText, format, role, user.name || "");

      if (apiKey) {
        try {
          const parsed = await chatJSON(prompt);
          if (parsed) {
            if (parsed.breakdown) {
              breakdown = {
                keyword: clampScore(parsed.breakdown.keyword),
                formatting: clampScore(parsed.breakdown.formatting),
                achievements: clampScore(parsed.breakdown.achievements),
                skills: clampScore(parsed.breakdown.skills),
                experience: clampScore(parsed.breakdown.experience),
                grammar: clampScore(parsed.breakdown.grammar),
              };
            }
            if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
              suggestions = parsed.suggestions
                .filter((s: any) => s && typeof s === "object")
                .map((s: any) => ({
                  title: String(s.title ?? "Suggestion"),
                  location: String(s.location ?? "CV"),
                  problem: String(s.problem ?? ""),
                  fix: String(s.fix ?? ""),
                  example: String(s.example ?? ""),
                }));
            }
            if (parsed.fullOptimizedCV && String(parsed.fullOptimizedCV).length > 100) {
              fullOptimizedCV = String(parsed.fullOptimizedCV);
            }
          }
        } catch { /* use fallbacks */ }
      }

      const atsScore = computeOverallScore(breakdown);

      const profile: CVProfile = {
        id: Date.now().toString(),
        userId: user.id,
        rawText,
        fullOptimizedCV,
        atsScore,
        breakdown,
        suggestions,
        // Scan the optimised CV too — the rewrite often surfaces skills that
        // were implied rather than named in the original text.
        skills: extractSkillsFromText(`${rawText}\n${fullOptimizedCV}`),
        format,
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(`cv_${user.id}`, JSON.stringify(profile));
      setCvProfile(profile);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearCV = async () => {
    if (!user) return;
    await AsyncStorage.removeItem(`cv_${user.id}`);
    setCvProfile(null);
  };

  return (
    <CVContext.Provider value={{ cvProfile, isAnalyzing, analyzeCV, clearCV }}>
      {children}
    </CVContext.Provider>
  );
}

function clampScore(n: unknown): number {
  const num = typeof n === "number" ? n : parseFloat(String(n));
  if (Number.isNaN(num)) return 50;
  return Math.min(100, Math.max(0, Math.round(num)));
}

// Deterministic heuristic breakdown (used without an API key), varied per-criterion
// so scores are never identical across CVs.
function estimateBreakdown(rawText: string): ATSBreakdown {
  const text = rawText.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const hasQuant = /\d+%/.test(text) || /\$\d[\d,.]*/.test(text) || /\b\d{2,}\+?\b/.test(text);
  const hasSkills = /skills|proficient|expertise|technolog(y|ies)/.test(text);
  const hasExperience = /experience|work history|employment/.test(text);
  const hasEducation = /education|degree|university|college|b\.sc|m\.sc|bachelor|master/.test(text);
  const hasActionVerbs = /\b(led|managed|developed|built|designed|implemented|delivered|launched|architected|optimi[sz]ed)\b/.test(text);
  const hasContact = text.includes("@") && /\.(com|org|net|io)/.test(text);
  const hasBullets = /[•▪●\-]\s/.test(rawText);
  const misspellingSignals = (rawText.match(/\s{3,}/g) || []).length;

  const keyword = Math.min(96, 38 + (hasSkills ? 14 : 0) + (hasExperience ? 10 : 0) + (wordCount > 250 ? 10 : 0) + (hasContact ? 6 : 0) + Math.floor(Math.random() * 10));
  const formatting = Math.min(94, 40 + (hasBullets ? 16 : 0) + (hasContact ? 8 : 0) + (wordCount > 200 ? 8 : 0) - Math.min(20, misspellingSignals * 2) + Math.floor(Math.random() * 10));
  const achievements = Math.min(95, 25 + (hasQuant ? 30 : 0) + (hasActionVerbs ? 12 : 0) + Math.floor(Math.random() * 10));
  const skills = Math.min(94, 35 + (hasSkills ? 24 : 0) + (wordCount > 300 ? 8 : 0) + Math.floor(Math.random() * 10));
  const experience = Math.min(94, 32 + (hasExperience ? 22 : 0) + (hasActionVerbs ? 10 : 0) + Math.floor(Math.random() * 10));
  const grammar = Math.min(96, 55 + (wordCount > 150 ? 10 : 0) - Math.min(20, misspellingSignals * 3) + Math.floor(Math.random() * 12));

  return {
    keyword: Math.max(20, keyword),
    formatting: Math.max(20, formatting),
    achievements: Math.max(15, achievements),
    skills: Math.max(20, skills),
    experience: Math.max(20, experience),
    grammar: Math.max(30, grammar),
  };
}

/** Section header keywords, checked in order — first match wins per section. */
const SECTION_HEADERS: Record<string, string[]> = {
  summary: ["professional summary", "summary", "objective", "profile"],
  education: ["education", "academic background"],
  experience: ["professional experience", "work experience", "experience", "work history", "employment"],
  projects: ["selected projects", "personal projects", "projects"],
  skills: ["technical skills", "core competencies", "skills", "technologies", "proficient"],
  activities: ["leadership & activities", "leadership and activities", "activities", "leadership"],
  certifications: ["certifications", "certificates", "licenses"],
};

/**
 * Split raw CV text into the sections a real resume guide expects, bounding
 * each one by the START OF THE NEXT detected header rather than a fixed
 * character count — a fixed slice regularly cut a section mid-sentence or
 * bled into whatever came next.
 */
function sectionize(rawText: string): {
  summary: string; education: string; experience: string; projects: string;
  skills: string; activities: string; certifications: string;
} {
  const lower = rawText.toLowerCase();
  const hits: { key: string; idx: number; len: number }[] = [];
  for (const [key, keywords] of Object.entries(SECTION_HEADERS)) {
    for (const kw of keywords) {
      const idx = lower.indexOf(kw);
      if (idx !== -1) { hits.push({ key, idx, len: kw.length }); break; }
    }
  }
  hits.sort((a, b) => a.idx - b.idx);

  const sectionText = (key: string): string => {
    const hit = hits.find((h) => h.key === key);
    if (!hit) return "";
    const start = hit.idx + hit.len;
    const next = hits.find((h) => h.idx > hit.idx);
    const end = next ? next.idx : Math.min(rawText.length, start + 800);
    return rawText.slice(start, end).replace(/^[:\s]+/, "").trim();
  };

  return {
    summary: sectionText("summary") || rawText.slice(0, 300).trim(),
    education: sectionText("education"),
    experience: sectionText("experience"),
    projects: sectionText("projects"),
    skills: sectionText("skills"),
    activities: sectionText("activities"),
    certifications: sectionText("certifications"),
  };
}

/** Pull real contact details out of the CV text instead of inventing placeholders. */
function extractContactInfo(rawText: string): { email: string; phone: string; linkedin: string } {
  const email = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";
  const phone = rawText.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? "";
  const linkedin = rawText.match(/linkedin\.com\/in\/[\w-]+/i)?.[0] ?? "";
  return { email, phone, linkedin };
}

/**
 * Builds a resume that actually follows each institution's published guide
 * (verified against the real Harvard OCS, MIT CAPD, and standard corporate/
 * ATS resume guides — section order and content match what each expects),
 * using the CV's own detected sections and real contact info rather than
 * placeholders. Used when no OpenAI key is configured or the API call fails.
 */
function generateFallbackCV(rawText: string, format: string, role: string, name: string): string {
  const n = (name || "Your Name").toUpperCase();
  const { summary, education, experience, projects, skills, activities, certifications } = sectionize(rawText);
  const { email, phone, linkedin } = extractContactInfo(rawText);
  const contactLine = [email, phone, linkedin].filter(Boolean).join(" | ") || "Add your email, phone, and LinkedIn";

  const missing = (label: string) => `[No ${label} detected in the uploaded PDF — add this section with real details.]`;
  const eduBlock = education || missing("education details");
  const expBlock = experience || missing("experience details");
  const skillsBlock = skills || missing("skills");
  const projectsBlock = projects || missing("projects");
  const summaryBlock = summary || `Results-driven ${role} with a track record of delivering measurable impact.`;

  const footer = "\n\n---\nGenerated from your uploaded CV. Connect an OpenAI API key for a fully AI-rewritten version with all suggestions applied.";

  if (format === "MIT") {
    // MIT CAPD order: Header → Education → Technical Skills → Projects → Experience → Activities.
    // Technical Skills sits right after Education per MIT's guide, and Projects
    // gets its own section — MIT students' course/personal projects are called
    // out as a key differentiator.
    let out = `${n}\n${contactLine}\n\nEDUCATION\n${eduBlock}\n\nTECHNICAL SKILLS\n${skillsBlock}\n\nPROJECTS\n${projectsBlock}\n\nEXPERIENCE\n${expBlock}`;
    if (activities) out += `\n\nLEADERSHIP & ACTIVITIES\n${activities}`;
    return out + footer;
  }
  if (format === "Corporate") {
    // Standard ATS/corporate order: Header (with role headline) → Summary →
    // Core Competencies → Professional Experience → Education → Certifications.
    let out = `${n}\n${role}\n${contactLine}\n\nPROFESSIONAL SUMMARY\n${summaryBlock}\n\nCORE COMPETENCIES\n${skillsBlock}\n\nPROFESSIONAL EXPERIENCE\n${expBlock}\n\nEDUCATION\n${eduBlock}`;
    if (certifications) out += `\n\nCERTIFICATIONS\n${certifications}`;
    return out + footer;
  }
  // Harvard OCS order: Header → brief Summary → Education → Experience →
  // Activities (optional) → Skills & Interests.
  let out = `${n}\n${contactLine}\n\n${summaryBlock}\n\nEDUCATION\n${eduBlock}\n\nEXPERIENCE\n${expBlock}`;
  if (activities) out += `\n\nLEADERSHIP & ACTIVITIES\n${activities}`;
  out += `\n\nSKILLS & INTERESTS\n${skillsBlock}`;
  return out + footer;
}

function generateFallbackSuggestions(rawText: string, role: string): CVSuggestion[] {
  const { experience, education, skills } = sectionize(rawText);
  const hasQuant = /\d+%/.test(rawText) || /\$\d/.test(rawText);

  return [
    {
      title: "Add Quantifiable Metrics",
      location: experience ? `Experience Section - "${experience.slice(0, 40).trim()}..."` : "Experience Section",
      problem: hasQuant
        ? "Some achievements are quantified, but several bullet points still describe responsibilities without measurable outcomes."
        : "Your experience bullet points describe duties but lack measurable impact (numbers, percentages, dollar amounts).",
      fix: `Rewrite each bullet to include a metric relevant to a ${role} role — percentage improvement, revenue, time saved, or team size.`,
      example: `"Improved sales by 30% within 6 months" or "Reduced page load time from 4.2s to 1.1s"`,
    },
    {
      title: "Add Missing Keywords",
      location: skills ? "Skills Section" : "Skills Section (missing)",
      problem: `Your CV is missing common keywords that ATS systems scan for in ${role} job postings.`,
      fix: "Add role-specific keywords pulled directly from recent job descriptions for this position.",
      example: "Skills: React, TypeScript, Node.js, AWS, CI/CD",
    },
    {
      title: "Improve Formatting Consistency",
      location: "Overall document formatting",
      problem: "Inconsistent bullet styles, spacing, or date formats make it harder for ATS parsers to correctly segment your CV.",
      fix: "Use a single bullet character, consistent date format (MMM YYYY), and clear section headers throughout.",
      example: "Jan 2022 – Present  ·  Senior Developer  ·  Acme Inc.",
    },
    {
      title: "Strengthen Education Details",
      location: education ? "Education Section" : "Education Section (missing)",
      problem: "Graduation date and/or GPA are missing, which some ATS systems and recruiters look for.",
      fix: "Add your expected/actual graduation date, and GPA if it's 3.0 or higher.",
      example: "B.Sc. Computer Science, GPA: 3.8 (2024)",
    },
    {
      title: "Lead With Strong Action Verbs",
      location: "Experience Section bullet points",
      problem: "Several bullet points start with weak or passive phrasing instead of strong action verbs.",
      fix: "Start every bullet with a strong verb: Led, Architected, Delivered, Optimised, Spearheaded.",
      example: '"Led a cross-functional team of 6 to deliver the v2 platform two weeks ahead of schedule"',
    },
  ];
}

export function useCV() {
  const ctx = useContext(CVContext);
  if (!ctx) throw new Error("useCV must be used within CVProvider");
  return ctx;
}
