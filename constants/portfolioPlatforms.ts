/**
 * Registry for turning a pasted URL into a recognisable card.
 *
 * A raw link is unreadable at a glance — "https://github.com/rashidmostafa?tab=repositories"
 * tells you almost nothing until you have parsed it. Matching the host against
 * this list lets each link render as its platform: real brand colour, the right
 * icon, and the account name pulled out of the path.
 */
import type { Feather } from "@expo/vector-icons";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export interface PortfolioPlatform {
  id: string;
  name: string;
  /** Hostname fragments that identify this platform. */
  hosts: string[];
  /** Official brand colour — what makes a card recognisable before it is read. */
  color: string;
  icon: FeatherName;
  /** Pulls the account name out of the URL path, when the platform has one. */
  handleFrom?: (url: URL) => string | null;
}

/** First path segment, ignoring empties. Covers most profile URL shapes. */
const firstSegment = (url: URL): string | null => {
  const seg = url.pathname.split("/").filter(Boolean)[0];
  return seg ?? null;
};

/** For hosts that namespace profiles, e.g. /profile/<handle> or /in/<handle>. */
const segmentAfter = (prefix: string) => (url: URL): string | null => {
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf(prefix);
  return i >= 0 ? (parts[i + 1] ?? null) : (parts[0] ?? null);
};

export const PORTFOLIO_PLATFORMS: PortfolioPlatform[] = [
  { id: "github",        name: "GitHub",        hosts: ["github.com"],                     color: "#24292F", icon: "github",    handleFrom: firstSegment },
  { id: "gitlab",        name: "GitLab",        hosts: ["gitlab.com"],                     color: "#FC6D26", icon: "gitlab",    handleFrom: firstSegment },
  { id: "codeforces",    name: "Codeforces",    hosts: ["codeforces.com"],                 color: "#1F8ACB", icon: "code",      handleFrom: segmentAfter("profile") },
  { id: "leetcode",      name: "LeetCode",      hosts: ["leetcode.com"],                   color: "#FFA116", icon: "code",      handleFrom: segmentAfter("u") },
  { id: "hackerrank",    name: "HackerRank",    hosts: ["hackerrank.com"],                 color: "#00EA64", icon: "terminal",  handleFrom: segmentAfter("profile") },
  { id: "kaggle",        name: "Kaggle",        hosts: ["kaggle.com"],                     color: "#20BEFF", icon: "bar-chart-2", handleFrom: firstSegment },
  { id: "linkedin",      name: "LinkedIn",      hosts: ["linkedin.com"],                   color: "#0A66C2", icon: "linkedin",  handleFrom: segmentAfter("in") },
  { id: "stackoverflow", name: "Stack Overflow", hosts: ["stackoverflow.com"],             color: "#F48024", icon: "layers",    handleFrom: segmentAfter("users") },
  { id: "dribbble",      name: "Dribbble",      hosts: ["dribbble.com"],                   color: "#EA4C89", icon: "dribbble",  handleFrom: firstSegment },
  { id: "behance",       name: "Behance",       hosts: ["behance.net"],                    color: "#1769FF", icon: "feather",   handleFrom: firstSegment },
  { id: "figma",         name: "Figma",         hosts: ["figma.com"],                      color: "#F24E1E", icon: "figma",     handleFrom: segmentAfter("@") },
  { id: "medium",        name: "Medium",        hosts: ["medium.com"],                     color: "#000000", icon: "book-open", handleFrom: firstSegment },
  { id: "devto",         name: "DEV",           hosts: ["dev.to"],                         color: "#0A0A0A", icon: "book-open", handleFrom: firstSegment },
  { id: "youtube",       name: "YouTube",       hosts: ["youtube.com", "youtu.be"],        color: "#FF0000", icon: "youtube",   handleFrom: firstSegment },
  { id: "x",             name: "X",             hosts: ["x.com", "twitter.com"],           color: "#000000", icon: "twitter",   handleFrom: firstSegment },
  { id: "codepen",       name: "CodePen",       hosts: ["codepen.io"],                     color: "#47CF73", icon: "codepen",   handleFrom: firstSegment },
];

/** Fallback for personal sites and anything unrecognised. */
export const WEBSITE_PLATFORM: PortfolioPlatform = {
  id: "website",
  name: "Website",
  hosts: [],
  color: "#6366F1",
  icon: "globe",
};

export function detectPlatform(rawUrl: string): PortfolioPlatform {
  try {
    const url = new URL(normalizeUrl(rawUrl));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return (
      PORTFOLIO_PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ??
      WEBSITE_PLATFORM
    );
  } catch {
    return WEBSITE_PLATFORM;
  }
}

/**
 * People paste "github.com/name" far more often than they type the scheme.
 * Assume https rather than rejecting the input.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isValidUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeUrl(raw));
    // A bare word parses as a URL with no dot in the host; require a real domain.
    return !!url.hostname && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Card title: the account name where the platform exposes one, otherwise the
 * bare domain. Never the full URL — that is what made a list of links unreadable.
 */
export function deriveLabel(rawUrl: string, platform: PortfolioPlatform): string {
  try {
    const url = new URL(normalizeUrl(rawUrl));
    const handle = platform.handleFrom?.(url);
    if (handle) return decodeURIComponent(handle.replace(/^@/, ""));
    return url.hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}
