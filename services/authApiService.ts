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
  require2FA?: false;
  requireReauth?: boolean;
  riskScore?: number;
  riskLevel?: string;
}

/** Returned by login() instead of AuthResponse when 2FA must be completed first — no tokens yet. */
export interface TwoFactorRequiredResponse {
  require2FA: true;
  userId: string;
  method: string;
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

  async resendVerificationEmail(payload: { userId: string }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/resend-verification", { method: "POST", body: JSON.stringify(payload) });
  },

  // ── Login ─────────────────────────────────────────────────────────────────────
  async login(payload: {
    email: string;
    password: string;
    deviceId?: string;
  }): Promise<AuthResponse | TwoFactorRequiredResponse> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
  },

  // ── 2FA ───────────────────────────────────────────────────────────────────────
  async verify2FA(payload: {
    userId: string;
    code: string;
    method: "totp" | "email" | "backup";
    trustDevice?: boolean;
  }): Promise<AuthResponse> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/verify", { method: "POST", body: JSON.stringify(payload) });
  },

  async resend2FA(payload: { userId: string; method: string }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/resend", { method: "POST", body: JSON.stringify(payload) });
  },

  async setup2FA(): Promise<{ qrUri: string; qrDataUri: string | null; secret: string; backupCodes: string[] }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/setup", { method: "POST" }, true);
  },

  async setup2FAOtp(method: "email"): Promise<{ method: string; backupCodes: string[] }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/setup-otp", { method: "POST", body: JSON.stringify({ method }) }, true);
  },

  async disable2FA(code: string): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }) }, true);
  },

  // ── Tokens ────────────────────────────────────────────────────────────────────
  async refresh(refreshToken: string): Promise<AuthTokens> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) });
  },

  async logout(refreshToken: string): Promise<void> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }, true);
  },

  // ── Reauth ────────────────────────────────────────────────────────────────────
  // Field names must match what server/services/authService.js#reauthenticate
  // destructures ({ method, password, answers, biometricToken }) — it spreads
  // req.body directly, so a mismatched key here silently sends `undefined`.
  async reauth(payload: {
    method: "password" | "security_questions" | "biometric";
    password?: string;
    answers?: Array<{ question: string; answer: string }>;
    biometricToken?: string;
  }): Promise<AuthResponse> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/reauth", { method: "POST", body: JSON.stringify(payload) }, true);
  },

  // ── Recovery ──────────────────────────────────────────────────────────────────
  // Field names must match server/services/authService.js exactly — it spreads
  // req.body directly into each function, so a mismatched key silently sends
  // `undefined` instead of a clear type error.
  async recoverAccount(payload: { method: "email"; email: string }): Promise<{ message: string; userId?: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/recover", { method: "POST", body: JSON.stringify(payload) });
  },

  async verifyRecoveryOtp(payload: { userId: string; otp: string }): Promise<{ message: string; recoveryToken: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/verify-recovery-otp", { method: "POST", body: JSON.stringify(payload) });
  },

  async resetPassword(payload: {
    recoveryToken: string;
    newPassword: string;
  }): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify(payload) });
  },

  // ── Social OAuth helpers ──────────────────────────────────────────────────────
  /** Returns the backend URL that starts the Google OAuth redirect flow. */
  getGoogleAuthUrl(): string {
    return `${BASE}/api/auth/google`;
  },

  // ── Biometric ─────────────────────────────────────────────────────────────────
  /**
   * Register a biometric credential with the server.
   * @param credentialIdHash SHA-256 hash of the device credential ID.
   */
  async registerBiometric(credentialIdHash: string): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch(
      "/api/auth/biometric/register",
      { method: "POST", body: JSON.stringify({ credentialIdHash }) },
      true
    );
  },

  /**
   * Verify a biometric credential and receive JWT tokens.
   * @param userId  The userId stored in SecureStore alongside the credential.
   * @param credentialIdHash SHA-256 hash of the device credential ID.
   */
  async verifyBiometric(userId: string, credentialIdHash: string): Promise<AuthResponse> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch(
      "/api/auth/biometric/verify",
      { method: "POST", body: JSON.stringify({ userId, credentialIdHash }) }
    );
  },

  /** Disable biometric login for the current user. */
  async disableBiometric(): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/auth/biometric/disable", { method: "POST" }, true);
  },

  // ── Security questions ────────────────────────────────────────────────────────
  async setSecurityQuestions(
    questions: Array<{ question: string; answer: string }>
  ): Promise<{ message: string }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch(
      "/api/user/security-questions",
      { method: "POST", body: JSON.stringify({ questions }) },
      true
    );
  },

  async getSecurityQuestions(): Promise<{ questions: string[] }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/security-questions", {}, true);
  },

  // ── GDPR ──────────────────────────────────────────────────────────────────────
  async exportData(): Promise<object> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch("/api/user/export", {}, true);
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
    onboardingComplete: boolean;
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

  async getAuditLog(page = 1, limit = 20): Promise<{ logs: any[]; page: number; limit: number; total: number }> {
    if (!BASE) throw new Error("NO_BACKEND");
    return apiFetch(`/api/user/audit-log?page=${page}&limit=${limit}`, {}, true);
  },
};
