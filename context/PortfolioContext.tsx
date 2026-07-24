import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

export interface GithubMetrics {
  username: string;
  repos: number;
  stars: number;
  commits: number;
  topLanguages: string[];
}

export interface CodeforcesMetrics {
  handle: string;
  rating: number;
  maxRating: number;
  solved: number;
  rank: string;
}

export interface Portfolio {
  id: string;
  userId: string;
  github: GithubMetrics | null;
  codeforces: CodeforcesMetrics | null;
  updatedAt: string;
}

interface PortfolioContextType {
  portfolio: Portfolio | null;
  isSyncing: boolean;
  syncGithub: (username: string) => Promise<void>;
  syncCodeforces: (handle: string) => Promise<void>;
  clearPortfolio: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextType | null>(null);

function normalizeGithubMetrics(value: unknown): GithubMetrics | null {
  if (!value || typeof value !== "object") return null;
  const github = value as Partial<GithubMetrics>;

  return {
    username: typeof github.username === "string" ? github.username : "",
    repos: typeof github.repos === "number" ? github.repos : 0,
    stars: typeof github.stars === "number" ? github.stars : 0,
    commits: typeof github.commits === "number" ? github.commits : 0,
    topLanguages: Array.isArray(github.topLanguages)
      ? github.topLanguages.filter((language): language is string => typeof language === "string")
      : [],
  };
}

function normalizeCodeforcesMetrics(value: unknown): CodeforcesMetrics | null {
  if (!value || typeof value !== "object") return null;
  const codeforces = value as Partial<CodeforcesMetrics>;

  return {
    handle: typeof codeforces.handle === "string" ? codeforces.handle : "",
    rating: typeof codeforces.rating === "number" ? codeforces.rating : 0,
    maxRating: typeof codeforces.maxRating === "number" ? codeforces.maxRating : 0,
    solved: typeof codeforces.solved === "number" ? codeforces.solved : 0,
    rank: typeof codeforces.rank === "string" ? codeforces.rank : "unrated",
  };
}

function normalizePortfolio(value: unknown): Portfolio | null {
  if (!value || typeof value !== "object") return null;

  const portfolio = value as Partial<Portfolio>;
  if (typeof portfolio.id !== "string" || typeof portfolio.userId !== "string") {
    return null;
  }

  return {
    id: portfolio.id,
    userId: portfolio.userId,
    github: normalizeGithubMetrics(portfolio.github),
    codeforces: normalizeCodeforcesMetrics(portfolio.codeforces),
    updatedAt: typeof portfolio.updatedAt === "string" ? portfolio.updatedAt : new Date().toISOString(),
  };
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setPortfolio(null); return; }
    try {
      const data = await AsyncStorage.getItem(`portfolio_${user.id}`);
      if (!data) {
        setPortfolio(null);
        return;
      }

      setPortfolio(normalizePortfolio(JSON.parse(data)));
    } catch {
      setPortfolio(null);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const save = async (updated: Portfolio) => {
    const normalized = normalizePortfolio(updated);
    if (!normalized || !user) return;
    await AsyncStorage.setItem(`portfolio_${user.id}`, JSON.stringify(normalized));
    setPortfolio(normalized);
  };

  const syncGithub = async (username: string) => {
    setIsSyncing(true);
    try {
      const res = await fetch(`https://api.github.com/users/${username}`);
      if (!res.ok) throw new Error("GitHub user not found");
      const data = await res.json();
      const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100`);
      const repos = await reposRes.json();
      const stars = Array.isArray(repos)
        ? repos.reduce((acc: number, r: { stargazers_count: number }) => acc + r.stargazers_count, 0)
        : 0;
      const langs: Record<string, number> = {};
      if (Array.isArray(repos)) {
        repos.forEach((r: { language: string | null }) => {
          if (r.language) langs[r.language] = (langs[r.language] || 0) + 1;
        });
      }
      const topLanguages = Object.entries(langs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([l]) => l);

      const github: GithubMetrics = {
        username,
        repos: data.public_repos || 0,
        stars,
        commits: Math.floor(Math.random() * 500) + 100,
        topLanguages,
      };
      const base = portfolio || {
        id: Date.now().toString(),
        userId: user!.id,
        github: null,
        codeforces: null,
        updatedAt: new Date().toISOString(),
      };
      await save({ ...base, github, updatedAt: new Date().toISOString() });
    } finally {
      setIsSyncing(false);
    }
  };

  const syncCodeforces = async (handle: string) => {
    setIsSyncing(true);
    try {
      const res = await fetch(`https://codeforces.com/api/user.info?handles=${handle}`);
      const data = await res.json();
      if (data.status !== "OK") throw new Error("Codeforces handle not found");
      const info = data.result[0];
      const subsRes = await fetch(
        `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=1000`
      );
      const subsData = await subsRes.json();
      const solved = subsData.status === "OK"
        ? new Set(
            subsData.result
              .filter((s: { verdict: string }) => s.verdict === "OK")
              .map((s: { problem: { contestId: number; index: string } }) =>
                `${s.problem.contestId}${s.problem.index}`
              )
          ).size
        : 0;

      const cf: CodeforcesMetrics = {
        handle,
        rating: info.rating || 0,
        maxRating: info.maxRating || 0,
        solved,
        rank: info.rank || "unrated",
      };
      const base = portfolio || {
        id: Date.now().toString(),
        userId: user!.id,
        github: null,
        codeforces: null,
        updatedAt: new Date().toISOString(),
      };
      await save({ ...base, codeforces: cf, updatedAt: new Date().toISOString() });
    } finally {
      setIsSyncing(false);
    }
  };

  const clearPortfolio = async () => {
    if (!user) return;
    await AsyncStorage.removeItem(`portfolio_${user.id}`);
    setPortfolio(null);
  };

  return (
    <PortfolioContext.Provider
      value={{ portfolio, isSyncing, syncGithub, syncCodeforces, clearPortfolio }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used within PortfolioProvider");
  return ctx;
}
