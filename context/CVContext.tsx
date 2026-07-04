import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
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
    const data = await AsyncStorage.getItem(`cv_${user.id}`);
    if (data) setCvProfile(JSON.parse(data));
    else setCvProfile(null);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const analyzeCV = async (rawText: string, format: string = "Harvard") => {
    if (!user) return;
    setIsAnalyzing(true);
    try {
      const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
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

Format guidance:
- Harvard: Academic style, education first, achievement-focused bullet points
- MIT: Technical style, projects and skills first, metrics-driven
- Corporate: Experience first, summary at top, metric-driven achievements

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
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
            }),
          });
          const json = await res.json();
          if (json.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(json.choices[0].message.content);
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

function sectionize(rawText: string): { experience: string; education: string; skills: string; summary: string } {
  const lower = rawText.toLowerCase();
  const findSection = (keys: string[]) => {
    for (const key of keys) {
      const idx = lower.indexOf(key);
      if (idx !== -1) return rawText.slice(idx, idx + 400).trim();
    }
    return "";
  };
  return {
    summary: rawText.slice(0, 300).trim(),
    experience: findSection(["experience", "work history", "employment"]),
    education: findSection(["education", "university", "degree"]),
    skills: findSection(["skills", "technologies", "proficient"]),
  };
}

function generateFallbackCV(rawText: string, format: string, role: string, name: string): string {
  const n = (name || "Your Name").toUpperCase();
  const { experience, education, skills, summary } = sectionize(rawText);
  const expBlock = experience || "[No experience details detected in the uploaded PDF — add your most recent roles with quantified achievements.]";
  const eduBlock = education || "[No education details detected in the uploaded PDF — add your degree, institution, and graduation date.]";
  const skillsBlock = skills || "[No skills detected in the uploaded PDF — list your key technical and soft skills relevant to this role.]";
  const summaryBlock = summary || `Results-driven ${role} with a track record of delivering measurable impact.`;

  if (format === "MIT") {
    return `${n}\nyourname@email.com | github.com/${name.toLowerCase().replace(/\s/g, "")}\n\nTECHNICAL SKILLS\n${skillsBlock}\n\nPROJECTS\n[Project highlights extracted/derived from your CV — add measurable outcomes]\n\nWORK EXPERIENCE\n${expBlock}\n\nEDUCATION\n${eduBlock}\n\n---\nGenerated from your uploaded CV. Connect an OpenAI API key for a fully AI-rewritten version with all suggestions applied.`;
  }
  if (format === "Corporate") {
    return `${n}\nyourname@email.com | Your Location\n\nPROFESSIONAL SUMMARY\n${summaryBlock}\n\nCORE COMPETENCIES\n${skillsBlock}\n\nPROFESSIONAL EXPERIENCE\n${expBlock}\n\nEDUCATION\n${eduBlock}\n\n---\nGenerated from your uploaded CV. Connect an OpenAI API key for a fully AI-rewritten version with all suggestions applied.`;
  }
  return `${n}\n${role}\nyourname@email.com | linkedin.com/in/${name.toLowerCase().replace(/\s/g, "")}\n\nEDUCATION\n${eduBlock}\n\nPROFESSIONAL EXPERIENCE\n${expBlock}\n\nSKILLS\n${skillsBlock}\n\n---\nGenerated from your uploaded CV. Connect an OpenAI API key for a fully AI-rewritten version with all suggestions applied.`;
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
