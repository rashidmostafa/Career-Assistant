/**
 * RoadmapContext — roadmap state.
 *
 * Step 1 of the rebuild: hold one roadmap per target role, generate it, and
 * persist it. Milestone status, completion and chat come later.
 *
 * Scoped per role deliberately. The account model already supports several
 * target roles (targetRoles[] + activeRoleId), and a roadmap toward "Data
 * Scientist" says nothing useful about "Backend Engineer" — so switching roles
 * switches plans rather than overwriting one.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@/services/syncedStorage";
import { useAuth } from "@/context/AuthContext";
import { useCV } from "@/context/CVContext";
import { generateRoadmap as generate, type Roadmap } from "@/services/roadmapAI";

export type { Roadmap, Milestone } from "@/services/roadmapAI";

/** Why the roadmap cannot be shown or built, if it cannot. */
export type RoadmapBlocker = "no_cv" | "no_target_role" | null;

interface RoadmapContextType {
  roadmap: Roadmap | null;
  /** True while loading the stored roadmap, before we know whether one exists. */
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
  /** Non-null when a prerequisite is missing; the screen renders this instead. */
  blocker: RoadmapBlocker;
  targetRole: string;
  build: () => Promise<void>;
  clear: () => Promise<void>;
}

const RoadmapContext = createContext<RoadmapContextType | undefined>(undefined);

export function RoadmapProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { cvProfile } = useCV();

  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetRole = user?.targetRole ?? "";

  // Prerequisites, in the order the user can act on them.
  const blocker: RoadmapBlocker =
    !cvProfile?.rawText ? "no_cv"
    : !targetRole ? "no_target_role"
    : null;

  // One key per user and role, so switching roles reveals that role's plan
  // rather than regenerating over the top of another one.
  const roleKey = user?.activeRoleId || targetRole || "default";
  const storageKey = user ? `roadmap_${user.id}_${roleKey}` : null;

  useEffect(() => {
    if (!storageKey) { setRoadmap(null); setIsLoading(false); return; }
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!cancelled) setRoadmap(raw ? (JSON.parse(raw) as Roadmap) : null);
      } catch {
        if (!cancelled) setRoadmap(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  const build = useCallback(async () => {
    if (!user || blocker) return;
    setIsGenerating(true);
    setError(null);
    try {
      const result = await generate({
        targetRole,
        cvText: cvProfile?.rawText ?? "",
        cvSkills: cvProfile?.skills ?? [],
        experienceLevel: user.experienceLevel || undefined,
      });

      if (!result.ok) {
        // Each cause needs a different action from the user, so each says
        // something different. Any existing roadmap is left alone.
        setError(
          result.reason === "no_ai"
            ? "AI isn't configured, so a roadmap can't be generated yet."
            : result.reason === "unreachable"
            ? "Couldn't reach the AI. Check your connection and try again."
            : "The AI returned something unusable. Try again."
        );
        return;
      }

      setRoadmap(result.roadmap);
      if (storageKey) await AsyncStorage.setItem(storageKey, JSON.stringify(result.roadmap));
    } finally {
      setIsGenerating(false);
    }
  }, [user, blocker, targetRole, cvProfile, storageKey]);

  const clear = useCallback(async () => {
    setRoadmap(null);
    setError(null);
    if (storageKey) await AsyncStorage.removeItem(storageKey);
  }, [storageKey]);

  return (
    <RoadmapContext.Provider
      value={{ roadmap, isLoading, isGenerating, error, blocker, targetRole, build, clear }}
    >
      {children}
    </RoadmapContext.Provider>
  );
}

export function useRoadmap() {
  const ctx = useContext(RoadmapContext);
  if (!ctx) throw new Error("useRoadmap must be used within RoadmapProvider");
  return ctx;
}
