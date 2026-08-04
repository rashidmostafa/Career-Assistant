/**
 * AuthApiService — HTTP client for the Node.js/Express backend.
 * Falls back to local simulation when EXPO_PUBLIC_API_URL is not set.
 *
 * Features:
 *  - Automatic retry with exponential back-off for network failures
 *  - Access-token auto-refresh on 401
 *  - Device-ID header on every request
 *  - Graceful NO_BACKEND error for offline development
 */
import { SessionManager } from "./sessionManager";

const BASE        = process.env.EXPO_PUBLIC_API_URL ?? "";
const MAX_RETRIES = 3;
const BASE_DELAY  = 500; // ms

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  withAuth = false,
  _retryCount = 0,
): Promise<T> {
  const url = `${BASE}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> ?? {}),
  };

  if (withAuth) {
    const token = await SessionManager.getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const deviceId = await SessionManager.getOrCreateDeviceId();
  headers["X-Device-Id"] = deviceId;

  try {
    const res = await fetch(url, { ...init, headers });

    // Token expired — try to refresh once, then retry
    if (res.status === 401 && withAuth && _retryCount === 0) {
      const refreshToken = await SessionManager.getRefreshToken();
      if (refreshToken) {
        try {
          const refreshed = await apiFetch<AuthTokens>(
            "/api/auth/refresh",
            { method: "POST", body: JSON.stringify({ refreshToken }) },
            false,
            1,
          );
          await SessionManager.saveTokens(refreshed);
          headers["Authorization"] = `Bearer ${refreshed.accessToken}`;
          const retryRes = await fetch(url, { ...init, headers });
          if (retryRes.ok) return retryRes.json() as T;
        } catch {
          // Refresh failed — fall through to error
        }
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error((body as any).message ?? `Request failed: ${res.status}`) as any;
      err.status = res.status;
      err.code   = (body as any).code;
      throw err;
    }

    return res.json() as T;
  } catch (e: any) {
    // Network error (not an HTTP error) — retry with exponential back-off
    if (!e.status && _retryCount < MAX_RETRIES) {
      const delay = BASE_DELAY * Math.pow(2, _retryCount);
      await sleep(delay);
      return apiFetch<T>(path, init, withAuth, _retryCount + 1);
    }
    throw e;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthResponse extends AuthTokens {
  user: any;
  require2FA?: boolean;
  requireReauth?: boolean;
  riskScore?: number;
  riskLevel?: string;
}

// ─── AuthApiService ────────────────────────────────────────────────────────────
export const AuthApiService = {
  // ── Registration ─────────────────────────────────────────────────────────────
  async register(payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    securityQuestions?: Array<{ question: string; answer: string }>;
    consentGiven?: boolean;
    pushToken?: string;
  }): Promise<{ message: string; userId: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
  },

  async verifyEmailOtp(payload: { userId: string; otp: string }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/verify-email", { method: "POST", body: JSON.stringify(payload) });
  },

  async verifyPhoneOtp(payload: { userId: string; otp: string }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/verify-phone", { method: "POST", body: JSON.stringify(payload) });
  },

  async sendPhoneOtp(payload: { userId: string; phone: string }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/send-phone-otp", { method: "POST", body: JSON.stringify(payload) });
  },

  // ── Login ─────────────────────────────────────────────────────────────────────
  async login(payload: {
    email: string;
    password: string;
    deviceId?: string;
  }): Promise<AuthResponse> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
  },

  // ── 2FA ───────────────────────────────────────────────────────────────────────
  async verify2fa(payload: {
    userId: string;
    code: string;
    method: "totp" | "sms" | "email" | "backup";
    trustDevice?: boolean;
  }): Promise<AuthTokens & { user: any }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/verify", { method: "POST", body: JSON.stringify(payload) });
  },

  async resend2faCode(payload: {
    userId: string;
    method: "sms" | "email";
  }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/resend", { method: "POST", body: JSON.stringify(payload) });
  },

  async setup2fa(method: "totp" | "sms" | "email"): Promise<{
    qrUri?: string;
    secret?: string;
    backupCodes?: string[];
  }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/setup", { method: "POST", body: JSON.stringify({ method }) }, true);
  },

  async disable2fa(code: string): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }) }, true);
  },

  // ── Token management ──────────────────────────────────────────────────────────
  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) });
  },

  async logout(refreshToken: string): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }, true);
  },

  // ── Re-authentication ──────────────────────────────────────────────────────────
  async reauthenticate(payload: {
    method: "biometric" | "password" | "security_questions";
    password?: string;
    answers?: Array<{ question: string; answer: string }>;
    biometricToken?: string;
  }): Promise<AuthTokens> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/reauth", { method: "POST", body: JSON.stringify(payload) }, true);
  },

  // ── Account recovery ──────────────────────────────────────────────────────────
  async recoverAccount(payload: {
    method: "email" | "sms" | "security_questions";
    email?: string;
    phone?: string;
    answers?: Array<{ question: string; answer: string }>;
  }): Promise<{ message: string; recoveryToken?: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/recover", { method: "POST", body: JSON.stringify(payload) });
  },

  async resetPassword(payload: {
    recoveryToken: string;
    newPassword: string;
  }): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify(payload) });
  },

  // ── Security questions ─────────────────────────────────────────────────────────
  async setSecurityQuestions(
    questions: Array<{ question: string; answer: string }>
  ): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/security-questions", { method: "POST", body: JSON.stringify({ questions }) }, true);
  },

  async getSecurityQuestions(): Promise<string[]> {
    if (!BASE) throw new Error("NO_BACKEND");
    const data = await apiFetch<{ questions: string[] }>("/api/user/security-questions", {}, true);
    return data.questions;
  },

  // ── Push token registration ────────────────────────────────────────────────────
  async registerPushToken(pushToken: string): Promise<void> {
    if (!BASE) return; // silently ignore when offline
    return apiFetch("/api/user/push-token", { method: "POST", body: JSON.stringify({ pushToken }) }, true);
  },

  // ── GDPR ──────────────────────────────────────────────────────────────────────
  async exportData(format: "json" | "csv" = "json"): Promise<Blob> {
    if (!BASE) throw new Error("NO_BACKEND");
    const token = await SessionManager.getAccessToken();
    const deviceId = await SessionManager.getOrCreateDeviceId();
    let retries = 0;
    while (true) {
      try {
        const res = await fetch(`${BASE}/api/user/export?format=${format}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Device-Id": deviceId,
          },
        });
        if (!res.ok) throw new Error("Export failed");
        return res.blob();
      } catch (e: any) {
        if (retries >= MAX_RETRIES) throw e;
        await sleep(BASE_DELAY * Math.pow(2, retries));
        retries++;
      }
    }
  },

  async grantConsent(): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/consent", { method: "POST" }, true);
  },

  async requestDeletion(): Promise<{ message: string; scheduledAt: number }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/delete", { method: "POST" }, true);
  },

  async cancelDeletion(): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/delete/cancel", { method: "POST" }, true);
  },

  // ── User profile ──────────────────────────────────────────────────────────────
  async getProfile(): Promise<any> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/profile", {}, true);
  },

  async updateProfile(data: Partial<{
    name: string;
    phone: string;
    targetRole: string;
    experienceLevel: string;
    background: string;
    photoUri: string;
  }>): Promise<any> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/profile", { method: "PATCH", body: JSON.stringify(data) }, true);
  },

  // ── Session management ─────────────────────────────────────────────────────────
  async getSessions(): Promise<{ sessions: any[] }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/sessions", {}, true);
  },

  async revokeSession(sessionId: string): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch(`/api/user/sessions/${sessionId}`, { method: "DELETE" }, true);
  },

  async getAuditLog(page = 1, limit = 20): Promise<{ logs: any[]; page: number; limit: number }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch(`/api/user/audit-log?page=${page}&limit=${limit}`, {}, true);
  },
};
