/**
 * RiskScoring — Dynamic risk score (0-100) for adaptive authentication.
 * Factors: new device, login time, attempt frequency, behaviour anomaly.
 * 4 Risk Levels → determine session length and verification requirements.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskScore {
  score: number;        // 0–100
  level: RiskLevel;
  factors: string[];    // human-readable factors
  sessionDays: number;  // 56 / 30 / 14 / 7
  require2FA: boolean;
  requireSecurityQ: boolean;
}

interface LoginRecord {
  ts: number;
  deviceId: string;
  success: boolean;
}

const RISK_KEY = "auth_risk_log";
const MAX_LOG  = 50;

function getLevel(score: number): RiskLevel {
  if (score < 25)  return "LOW";
  if (score < 50)  return "MEDIUM";
  if (score < 75)  return "HIGH";
  return "CRITICAL";
}

function sessionDaysForLevel(level: RiskLevel): number {
  const MAP: Record<RiskLevel, number> = { LOW: 56, MEDIUM: 30, HIGH: 14, CRITICAL: 7 };
  return MAP[level];
}

export const RiskScoringService = {
  async calculate(params: {
    deviceId: string;
    knownDeviceIds: string[];
    hour?: number;       // 0-23; if omitted uses current
    recentFailures?: number;
    timeSinceLastLogin?: number; // ms
  }): Promise<RiskScore> {
    const {
      deviceId,
      knownDeviceIds,
      hour = new Date().getHours(),
      recentFailures = 0,
      timeSinceLastLogin,
    } = params;

    let score = 0;
    const factors: string[] = [];

    // Factor 1: Unknown device (+30)
    if (!knownDeviceIds.includes(deviceId)) {
      score += 30;
      factors.push("Unrecognised device");
    }

    // Factor 2: Off-hours login (midnight–5am) (+10)
    if (hour >= 0 && hour < 5) {
      score += 10;
      factors.push("Late-night login");
    }

    // Factor 3: Recent failures (+10 per failure, max 50)
    // The cap is 50 so that 5+ consecutive failures reach the HIGH threshold on
    // their own and force step-up 2FA. A cap of 30 left brute-force attempts at
    // MEDIUM unless Factor 5 (rapid attempts, +20) also fired, which an attacker
    // spacing attempts more than 5 minutes apart evades entirely.
    if (recentFailures > 0) {
      const penalty = Math.min(recentFailures * 10, 50);
      score += penalty;
      factors.push(`${recentFailures} recent failed attempt${recentFailures > 1 ? "s" : ""}`);
    }

    // Factor 4: Very long inactivity > 30 days (+15)
    if (timeSinceLastLogin && timeSinceLastLogin > 30 * 24 * 60 * 60 * 1000) {
      score += 15;
      factors.push("Account inactive > 30 days");
    }

    // Factor 5: Rapid login attempts (+20)
    const recentLog = await this.getRecentLog(5 * 60 * 1000); // last 5 min
    if (recentLog.length >= 5) {
      score += 20;
      factors.push("Rapid login attempts detected");
    }

    score = Math.min(score, 100);
    const level = getLevel(score);

    return {
      score,
      level,
      factors,
      sessionDays: sessionDaysForLevel(level),
      require2FA:       level === "HIGH" || level === "CRITICAL",
      requireSecurityQ: level === "CRITICAL",
    };
  },

  async recordAttempt(deviceId: string, success: boolean) {
    const raw = await AsyncStorage.getItem(RISK_KEY);
    const log: LoginRecord[] = raw ? JSON.parse(raw) : [];
    log.push({ ts: Date.now(), deviceId, success });
    // Trim
    const trimmed = log.slice(-MAX_LOG);
    await AsyncStorage.setItem(RISK_KEY, JSON.stringify(trimmed));
  },

  async getRecentLog(windowMs: number): Promise<LoginRecord[]> {
    const raw = await AsyncStorage.getItem(RISK_KEY);
    const log: LoginRecord[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - windowMs;
    return log.filter((r) => r.ts >= cutoff);
  },

  async getRecentFailures(windowMs = 60 * 60 * 1000): Promise<number> {
    const log = await this.getRecentLog(windowMs);
    return log.filter((r) => !r.success).length;
  },

  getLevelColor(level: RiskLevel): string {
    const MAP: Record<RiskLevel, string> = {
      LOW:      "#10b981",
      MEDIUM:   "#f59e0b",
      HIGH:     "#ef4444",
      CRITICAL: "#7c3aed",
    };
    return MAP[level];
  },

  getLevelEmoji(level: RiskLevel): string {
    const MAP: Record<RiskLevel, string> = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴", CRITICAL: "🟣" };
    return MAP[level];
  },
};
