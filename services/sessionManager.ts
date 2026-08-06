/**
 * SessionManager — Access token (15 min) + Refresh token (30-day rotation)
 * 8-week rolling session (56 days) with progressive re-auth reminders.
 * Uses expo-secure-store for Keychain/Keystore on device, AsyncStorage fallback.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// ─── Constants ─────────────────────────────────────────────────────────────────
export const ACCESS_TOKEN_TTL   = 15 * 60 * 1000;          // 15 minutes
export const REFRESH_TOKEN_TTL  = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_TTL        = 56 * 24 * 60 * 60 * 1000; // 56 days (8 weeks)
export const REAUTH_WARN_DAY_50 = 50 * 24 * 60 * 60 * 1000;
export const REAUTH_WARN_DAY_54 = 54 * 24 * 60 * 60 * 1000;
export const REAUTH_WARN_DAY_56 = 56 * 24 * 60 * 60 * 1000;
export const GRACE_PERIOD       = 12 * 60 * 60 * 1000;      // 12 hours

const KEYS = {
  ACCESS:      "auth_access_token",
  REFRESH:     "auth_refresh_token",
  SESSION_START: "auth_session_start",
  DEVICE_ID:   "auth_device_id",
  TRUST_UNTIL: "auth_device_trust_until",
} as const;

export type ReauthUrgency = "none" | "weekly" | "daily" | "hourly" | "expired" | "grace";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ─── Secure helpers ────────────────────────────────────────────────────────────
async function secureSet(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(key);
  }
}

async function secureDel(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    await AsyncStorage.removeItem(key);
  }
}

// ─── Token storage ─────────────────────────────────────────────────────────────
export const SessionManager = {
  async saveTokens(tokens: TokenPair) {
    await secureSet(KEYS.ACCESS,  tokens.accessToken);
    await secureSet(KEYS.REFRESH, tokens.refreshToken);
    // Start 8-week session clock if not already started
    const existing = await secureGet(KEYS.SESSION_START);
    if (!existing) await secureSet(KEYS.SESSION_START, String(Date.now()));
  },

  async getAccessToken(): Promise<string | null> {
    return secureGet(KEYS.ACCESS);
  },

  async getRefreshToken(): Promise<string | null> {
    return secureGet(KEYS.REFRESH);
  },

  async clearTokens() {
    await Promise.all([
      secureDel(KEYS.ACCESS),
      secureDel(KEYS.REFRESH),
      secureDel(KEYS.SESSION_START),
    ]);
  },

  async getSessionStartMs(): Promise<number | null> {
    const v = await secureGet(KEYS.SESSION_START);
    return v ? Number(v) : null;
  },

  async resetSessionClock() {
    await secureSet(KEYS.SESSION_START, String(Date.now()));
  },

  // ── Re-auth urgency ──────────────────────────────────────────────────────────
  async getReauthUrgency(): Promise<ReauthUrgency> {
    const start = await this.getSessionStartMs();
    if (!start) return "none";
    const elapsed = Date.now() - start;
    if (elapsed >= SESSION_TTL + GRACE_PERIOD) return "expired";
    if (elapsed >= SESSION_TTL)               return "grace";
    if (elapsed >= REAUTH_WARN_DAY_56)        return "hourly";
    if (elapsed >= REAUTH_WARN_DAY_54)        return "daily";
    if (elapsed >= REAUTH_WARN_DAY_50)        return "weekly";
    return "none";
  },

  async getSessionDaysRemaining(): Promise<number> {
    const start = await this.getSessionStartMs();
    if (!start) return 56;
    const elapsed = Date.now() - start;
    return Math.max(0, Math.ceil((SESSION_TTL - elapsed) / (24 * 60 * 60 * 1000)));
  },

  async getGraceExpiresAt(): Promise<number | null> {
    const start = await this.getSessionStartMs();
    if (!start) return null;
    return start + SESSION_TTL + GRACE_PERIOD;
  },

  // ── Device trust (2FA: trust for 30 days) ──────────────────────────────────
  async trustDevice() {
    const until = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await secureSet(KEYS.TRUST_UNTIL, String(until));
  },

  async isDeviceTrusted(): Promise<boolean> {
    const v = await secureGet(KEYS.TRUST_UNTIL);
    if (!v) return false;
    return Number(v) > Date.now();
  },

  async revokeDeviceTrust() {
    await secureDel(KEYS.TRUST_UNTIL);
  },

  // ── Device fingerprint ───────────────────────────────────────────────────────
  async getOrCreateDeviceId(): Promise<string> {
    let id = await secureGet(KEYS.DEVICE_ID);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await secureSet(KEYS.DEVICE_ID, id);
    }
    return id;
  },
};
