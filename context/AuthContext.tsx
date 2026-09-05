/**
 * AuthContext — Full authentication state management.
 * Backward-compatible: still exports User, useAuth, AuthProvider with
 * the same signIn / signUp / signOut / updateUser / completeOnboarding /
 * resendVerification / confirmEmailVerified interface used by existing screens
 * (confirmEmailVerified now takes the OTP code — see below).
 *
 * All auth actions are backed by the real server (server/services/authService.js):
 *  - Registration/login/2FA/recovery/security-questions/GDPR all go through
 *    AuthApiService, which enforces real email-domain validation (disposable-
 *    domain blocklist + DNS MX lookup) and sends real OTP emails. There is no
 *    local/offline simulation fallback for these — if the server is unreachable,
 *    the action fails with a clear error rather than silently succeeding.
 *  - The 8-week rolling session clock, biometric hardware checks, and OTP
 *    countdown timers remain client-side (they don't need a server round-trip).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { SessionManager, type ReauthUrgency } from "@/services/sessionManager";
import { BiometricService } from "@/services/biometricService";
import { AuthApiService } from "@/services/authApiService";
import syncedStorage from "@/services/syncedStorage";
import { syncPushTokenToServer } from "@/services/notificationService";
import type { RiskLevel } from "@/services/riskScoring";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface SecurityQuestion {
  question: string;
  answer: string; // hashed on server; never stored in plaintext client-side
}

/** One career path the user is pursuing. */
export interface TargetRole {
  id: string;
  title: string;
  createdAt: string;
}

export interface User {
  id: string;
  /** The account's public number, shown in Profile and typed at sign-in when
   *  several accounts share a device. Eight digits. */
  userNumber: string;
  name: string;
  email: string;
  phone?: string;
  /**
   * The active role's title. Retained as the single source every existing
   * screen already reads, and kept in sync with activeRoleId — so switching
   * roles updates it and nothing downstream has to know about the array.
   */
  targetRole: string;
  /** Every role the user is pursuing. Each has its own roadmap, CV analysis,
   *  job matches and interview history — nothing is shared between them. */
  targetRoles: TargetRole[];
  /** Which role the app is currently showing. */
  activeRoleId: string;
  experienceLevel: string;
  background?: string;
  onboardingComplete?: boolean;
  emailVerified?: boolean;
  photoUri?: string;
  // Security
  twoFactorEnabled: boolean;
  twoFactorMethod?: "totp" | "email";
  backupCodesRemaining?: number;
  biometricEnabled: boolean;
  securityQuestionsSet: boolean;
  // Lockout
  loginAttempts: number;
  accountLocked: boolean;
  lockoutUntil?: number;
  lastLogin?: number;
  // GDPR
  consentGiven?: boolean;
  deletionScheduledAt?: number;
}

export interface AuthContextType {
  // ── Core state ──────────────────────────────────────────────────────────────
  user: User | null;
  isLoading: boolean;
  pendingVerificationEmail: string | null;
  pendingUserId: string | null;
  // ── Session ─────────────────────────────────────────────────────────────────
  reauthUrgency: ReauthUrgency;
  sessionDaysRemaining: number;
  riskLevel: RiskLevel | null;
  // ── 2FA ─────────────────────────────────────────────────────────────────────
  pending2FAUserId: string | null;
  // ── Biometric ───────────────────────────────────────────────────────────────
  biometricAvailable: boolean;
  biometricType: "Biometrics" | "None";
  // ── Legacy API (backward compat) ────────────────────────────────────────────
  signIn: (email: string, password: string) => Promise<{ require2FA?: boolean; userId?: string; method?: string }>;
  signUp: (data: { name: string; email: string; password: string; phone?: string; consentGiven?: boolean }) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  completeOnboarding: (background: string, experienceLevel: string, targetRole: string) => Promise<void>;
  /** The role currently in view; all role-scoped screens follow it. */
  activeRole: TargetRole | null;
  setActiveRole: (roleId: string) => Promise<void>;
  addTargetRole: (title: string) => Promise<void>;
  removeTargetRole: (roleId: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Re-enter email verification for an account that was registered but never
   *  verified — e.g. the user reloaded away from the OTP screen. */
  beginEmailVerification: (userId: string, email: string, password?: string) => Promise<void>;
  /** Verifies the OTP the user typed in against the server and, on success, signs them in. */
  confirmEmailVerified: (otp: string) => Promise<void>;
  // ── New auth API ─────────────────────────────────────────────────────────────
  verify2FA: (code: string, method: "totp" | "email" | "backup", trustDevice?: boolean) => Promise<void>;
  loginWithBiometric: (userNumber?: string) => Promise<boolean>;
  enrollBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
  reauthenticate: (method: "biometric" | "password" | "security_questions", credential?: string | Array<{ question: string; answer: string }>) => Promise<boolean>;
  setSecurityQuestions: (questions: SecurityQuestion[]) => Promise<void>;
  verifySecurityAnswers: (answers: Array<{ question: string; answer: string }>) => Promise<boolean>;
  getSecurityQuestions: () => Promise<string[]>;
  // ── Social auth ───────────────────────────────────────────────────────────────
  signInWithSocial: (provider: "google") => Promise<void>;
  loadUserFromServer: () => Promise<void>;
  // ── GDPR ─────────────────────────────────────────────────────────────────────
  exportData: () => Promise<object>;
  requestAccountDeletion: () => Promise<void>;
  cancelAccountDeletion: () => Promise<void>;
  grantConsent: () => Promise<void>;
}

const STORE = {
  USER:          "auth_user_v2",
  PENDING_EMAIL: "auth_pending_email",
  PENDING_USER_ID: "auth_pending_user_id",
} as const;

// ─── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null);

// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Normalises a raw server user document (Mongo `_id`, date strings, …) into our client `User` shape. */
/**
 * Accounts created before multi-role support carry only a `targetRole` string.
 * Promote it to a one-entry array so every consumer can assume the array
 * exists; without this an existing user would open the app with no active role
 * and see empty roadmaps and job lists.
 */
function normalizeRoles(raw: any): { targetRole: string; targetRoles: TargetRole[]; activeRoleId: string } {
  const list: TargetRole[] = Array.isArray(raw?.targetRoles) && raw.targetRoles.length
    ? raw.targetRoles.filter((r: any) => r && typeof r.title === "string")
    : raw?.targetRole
      ? [{ id: makeRoleId(raw.targetRole), title: raw.targetRole, createdAt: new Date().toISOString() }]
      : [];

  const activeRoleId = list.some((r) => r.id === raw?.activeRoleId)
    ? raw.activeRoleId
    : (list[0]?.id ?? "");

  return {
    targetRole: list.find((r) => r.id === activeRoleId)?.title ?? "",
    targetRoles: list,
    activeRoleId,
  };
}

/**
 * Derived from the title rather than random, so the same role added on two
 * devices keys to the same stored roadmap instead of silently forking.
 */
export function makeRoleId(title: string): string {
  return `role_${title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

/**
 * Applies the role migration to a user object read from local cache.
 * The cached copy predates multi-role support and has no targetRoles array, so
 * loading it raw left every consumer calling .find on undefined.
 */
function hydrateUser(raw: any): User {
  return { ...raw, ...normalizeRoles(raw) };
}

function mapServerUser(raw: any): User {
  const toMs = (v: any): number | undefined => {
    if (!v) return undefined;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? undefined : t;
  };
  return {
    id:    raw._id?.toString?.() ?? raw.id ?? "",
    userNumber: raw.userNumber ?? "",
    name:  raw.name ?? "",
    email: raw.email ?? "",
    phone: raw.phone,
    ...normalizeRoles(raw),
    experienceLevel:  raw.experienceLevel ?? "",
    background:       raw.background,
    onboardingComplete: raw.onboardingComplete ?? false,
    emailVerified:      raw.emailVerified ?? false,
    photoUri:           raw.photoUri ?? raw.avatarUrl,
    twoFactorEnabled:   raw.twoFactorEnabled ?? false,
    twoFactorMethod:    raw.twoFactorMethod,
    backupCodesRemaining: typeof raw.backupCodesRemaining === "number" ? raw.backupCodesRemaining : undefined,
    biometricEnabled:      raw.biometricEnabled ?? false,
    securityQuestionsSet:  raw.securityQuestionsSet ?? false,
    loginAttempts: raw.loginAttempts ?? 0,
    accountLocked: raw.accountLocked ?? false,
    lockoutUntil:  toMs(raw.lockoutUntil),
    lastLogin:     toMs(raw.lastLogin),
    consentGiven:  raw.consentGiven ?? false,
    deletionScheduledAt: toMs(raw.deletionScheduledAt),
  };
}

// ─── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]  = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pending2FAUserId, setPending2FAUserId] = useState<string | null>(null);
  const [reauthUrgency, setReauthUrgency] = useState<ReauthUrgency>("none");
  const [sessionDaysRemaining, setSessionDaysRemaining] = useState(56);
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<"Biometrics" | "None">("None");

  const sessionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Kept in memory only (never persisted) so we can auto-login right after the
  // user verifies their email OTP — the server's verify-email endpoint only
  // marks the account verified, it doesn't issue a session by itself.
  const pendingPasswordRef = useRef<string | null>(null);

  // ── Startup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const accessToken = await SessionManager.getAccessToken();
        if (accessToken) {
          try {
            const profile = await AuthApiService.getProfile();
            if (profile?.user) await persistUser(mapServerUser(profile.user));
            // Atlas is the source of truth: refresh the device cache from the
            // account before any feature context reads it, so a phone that has
            // been offline picks up edits made elsewhere.
            await syncedStorage.hydrate();
            void syncPushTokenToServer();
          } catch {
            // Server unreachable — fall back to the last cached profile so the
            // app stays usable offline. A stale cache beats a blank screen.
            const rawUser = await AsyncStorage.getItem(STORE.USER);
            if (rawUser) setUser(hydrateUser(JSON.parse(rawUser)));
          }
        }
        const [pendingEmail, pendingId] = await Promise.all([
          AsyncStorage.getItem(STORE.PENDING_EMAIL),
          AsyncStorage.getItem(STORE.PENDING_USER_ID),
        ]);
        if (pendingEmail) setPendingVerificationEmail(pendingEmail);
        if (pendingId) setPendingUserId(pendingId);
      } finally {
        setIsLoading(false);
      }
    })();

    // Biometric hardware check
    BiometricService.getAvailability().then(({ available, type }) => {
      setBiometricAvailable(available);
      setBiometricType(type);
    });
  }, []);

  // ── Session ticker ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) { clearSession(); return; }
    refreshSessionState();
    sessionTimer.current = setInterval(refreshSessionState, 60_000);
    return () => clearSession();
  }, [user?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") refreshSessionState();
    });
    return () => sub.remove();
  }, []);

  function clearSession() {
    if (sessionTimer.current) clearInterval(sessionTimer.current);
  }

  async function refreshSessionState() {
    const [urgency, days] = await Promise.all([
      SessionManager.getReauthUrgency(),
      SessionManager.getSessionDaysRemaining(),
    ]);
    setReauthUrgency(urgency);
    setSessionDaysRemaining(days);
  }

  // ── Persistence helper ─────────────────────────────────────────────────────────
  // The server is the source of truth; AsyncStorage just caches the last known
  // profile so the app has something to show while offline.
  async function persistUser(u: User) {
    await AsyncStorage.setItem(STORE.USER, JSON.stringify(u));
    setUser(u);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // signIn
  // ─────────────────────────────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string) => {
    const result = await AuthApiService.login({ email, password });

    if (result.require2FA) {
      setPending2FAUserId(result.userId);
      return { require2FA: true, userId: result.userId, method: result.method };
    }

    await SessionManager.saveTokens({
      accessToken:  result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt:    result.expiresAt,
    });
    if (result.riskLevel) setRiskLevel(result.riskLevel as RiskLevel);
    await persistUser(mapServerUser(result.user));
    // New session on this device — the cache may belong to nobody, or to a
    // different account entirely.
    await syncedStorage.hydrate();
    void syncPushTokenToServer();

    setPendingVerificationEmail(null);
    setPendingUserId(null);
    await AsyncStorage.removeItem(STORE.PENDING_EMAIL);
    await AsyncStorage.removeItem(STORE.PENDING_USER_ID);
    return {};
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // signUp — real server registration. The server validates the email domain
  // (rejects disposable addresses and domains with no MX records) and emails a
  // real OTP; there is no local fallback that would let a fake address through.
  // ─────────────────────────────────────────────────────────────────────────────
  const signUp = useCallback(async (data: {
    name: string; email: string; password: string; phone?: string; consentGiven?: boolean;
  }) => {
    const result = await AuthApiService.register({
      name: data.name,
      email: data.email,
      password: data.password,
      phone: data.phone,
      consentGiven: data.consentGiven,
    });

    pendingPasswordRef.current = data.password;
    setPendingVerificationEmail(data.email);
    setPendingUserId(result.userId);
    await AsyncStorage.setItem(STORE.PENDING_EMAIL, data.email);
    await AsyncStorage.setItem(STORE.PENDING_USER_ID, result.userId);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // confirmEmailVerified — verifies the OTP against the server, then auto-signs
  // the user in using the password remembered from signUp (never persisted).
  // ─────────────────────────────────────────────────────────────────────────────
  const confirmEmailVerified = useCallback(async (otp: string) => {
    const userId = pendingUserId;
    if (!userId) throw new Error("Session expired. Please register again.");

    await AuthApiService.verifyEmailOtp({ userId, otp });

    const email    = pendingVerificationEmail;
    const password = pendingPasswordRef.current;
    if (email && password) {
      const loginResult = await AuthApiService.login({ email, password });
      if (!loginResult.require2FA) {
        await SessionManager.saveTokens({
          accessToken:  loginResult.accessToken,
          refreshToken: loginResult.refreshToken,
          expiresAt:    loginResult.expiresAt,
        });
        await persistUser(mapServerUser(loginResult.user));
      }
    }

    pendingPasswordRef.current = null;
    setPendingVerificationEmail(null);
    setPendingUserId(null);
    await AsyncStorage.removeItem(STORE.PENDING_EMAIL);
    await AsyncStorage.removeItem(STORE.PENDING_USER_ID);
  }, [pendingUserId, pendingVerificationEmail]);

  // ─────────────────────────────────────────────────────────────────────────────
  // resendVerification
  // ─────────────────────────────────────────────────────────────────────────────
  const resendVerification = useCallback(async () => {
    // Previously a silent `return` when pendingUserId was null, which made the
    // Resend button look like it worked while sending nothing — the user waits
    // for a code that was never requested.
    if (!pendingUserId) throw new Error("Session expired. Please sign in again to resend the code.");
    await AuthApiService.resendVerificationEmail({ userId: pendingUserId });
  }, [pendingUserId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // beginEmailVerification — restores the pending-verification state so the OTP
  // screen becomes reachable again after it was navigated away from. Registration
  // is not the only way into verification: an account can sit unverified
  // indefinitely, and login is the natural place the user comes back through.
  // Passing the password lets confirmEmailVerified auto-sign-in as it does after
  // registration; it is held in a ref and never persisted.
  // ─────────────────────────────────────────────────────────────────────────────
  const beginEmailVerification = useCallback(async (userId: string, email: string, password?: string) => {
    setPendingUserId(userId);
    setPendingVerificationEmail(email);
    if (password) pendingPasswordRef.current = password;
    await AsyncStorage.setItem(STORE.PENDING_USER_ID, userId);
    await AsyncStorage.setItem(STORE.PENDING_EMAIL, email);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2FA verification
  // ─────────────────────────────────────────────────────────────────────────────
  const verify2FA = useCallback(async (
    code: string,
    method: "totp" | "email" | "backup",
    trustDevice = false,
  ) => {
    const userId = pending2FAUserId;
    if (!userId) throw new Error("No pending 2FA session.");

    const result = await AuthApiService.verify2FA({ userId, code, method, trustDevice });

    await SessionManager.saveTokens({
      accessToken:  result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt:    result.expiresAt,
    });
    if (trustDevice) await SessionManager.trustDevice();
    await persistUser(mapServerUser(result.user));

    setPending2FAUserId(null);
  }, [pending2FAUserId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Biometric — credential lives on-device (SecureStore); the hash + userId are
  // exchanged with the server for a real session, same as password login.
  // ─────────────────────────────────────────────────────────────────────────────
  const loginWithBiometric = useCallback(async (userNumber?: string): Promise<boolean> => {
    try {
      // Anything but "ok" means the caller has something to ask or say — most
      // often that this device holds several accounts and needs the number.
      const outcome = await BiometricService.biometricLogin({ userNumber });
      if (outcome.status !== "ok") return false;
      const result = await AuthApiService.verifyBiometric(outcome.userId, outcome.credentialIdHash);
      await SessionManager.saveTokens({
        accessToken:  result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt:    result.expiresAt,
      });
      await persistUser(mapServerUser(result.user));
      return true;
    } catch {
      return false;
    }
  }, []);

  const enrollBiometric = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    const credentialId = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // The number travels with the credential so a later sign-in can resolve
    // which account it belongs to without asking the server.
    const result = await BiometricService.saveCredential(credentialId, user.id, user.userNumber);
    if (!result) return false;
    await AuthApiService.registerBiometric(result.hash);
    await persistUser({ ...user, biometricEnabled: true });
    return true;
  }, [user]);

  const disableBiometric = useCallback(async () => {
    if (!user) return;
    await BiometricService.clearCredential(user.id);
    await AuthApiService.disableBiometric();
    await persistUser({ ...user, biometricEnabled: false });
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Re-authentication — always round-trips to the server so its 8-week session
  // clock (used to validate refresh tokens) stays in sync with the local one.
  // ─────────────────────────────────────────────────────────────────────────────
  const reauthenticate = useCallback(async (
    method: "biometric" | "password" | "security_questions",
    credential?: string | Array<{ question: string; answer: string }>,
  ): Promise<boolean> => {
    if (!user) return false;

    try {
      let result;
      if (method === "biometric") {
        const ok = await BiometricService.authenticateForReauth();
        if (!ok) return false;
        result = await AuthApiService.reauth({ method: "biometric", biometricToken: "device-confirmed" });
      } else if (method === "password" && typeof credential === "string") {
        result = await AuthApiService.reauth({ method: "password", password: credential });
      } else if (method === "security_questions" && Array.isArray(credential)) {
        result = await AuthApiService.reauth({ method: "security_questions", answers: credential });
      } else {
        return false;
      }

      await SessionManager.saveTokens({
        accessToken:  result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt:    result.expiresAt,
      });
      await SessionManager.resetSessionClock();
      setReauthUrgency("none");
      setSessionDaysRemaining(56);
      return true;
    } catch {
      return false;
    }
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Security questions
  // ─────────────────────────────────────────────────────────────────────────────
  const setSecurityQuestions = useCallback(async (questions: SecurityQuestion[]) => {
    if (!user) return;
    await AuthApiService.setSecurityQuestions(questions);
    await persistUser({ ...user, securityQuestionsSet: true });
  }, [user]);

  const getSecurityQuestions = useCallback(async (): Promise<string[]> => {
    try {
      const { questions } = await AuthApiService.getSecurityQuestions();
      return questions;
    } catch {
      return [];
    }
  }, []);

  const verifySecurityAnswers = useCallback(async (
    answers: Array<{ question: string; answer: string }>,
  ): Promise<boolean> => {
    return reauthenticate("security_questions", answers);
  }, [reauthenticate]);

  // ─────────────────────────────────────────────────────────────────────────────
  // signOut
  // ─────────────────────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    try {
      const refreshToken = await SessionManager.getRefreshToken();
      if (refreshToken) await AuthApiService.logout(refreshToken);
    } catch {
      // Best-effort — still clear local state even if the server is unreachable.
    }
    pendingPasswordRef.current = null;
    // Flush first: a debounced write still in flight would otherwise be lost,
    // and it is the user's most recent edit. Then drop the cache — the data
    // lives in Atlas, and leaving it would expose it to the next account
    // signed in on this device.
    try {
      await syncedStorage.flush();
      await syncedStorage.clearLocal();
    } catch {
      // Never block sign-out on sync.
    }
    await SessionManager.clearTokens();
    await AsyncStorage.removeItem(STORE.USER);
    setUser(null);
    setReauthUrgency("none");
    setRiskLevel(null);
  }, []);

  // ─── Target roles ────────────────────────────────────────────────────────────
  // Each role owns its roadmap, CV analysis, job matches and interviews, so
  // switching is a change of context rather than a filter over shared data.

  const setActiveRole = useCallback(async (roleId: string) => {
    if (!user) return;
    const role = (user.targetRoles ?? []).find((r) => r.id === roleId);
    if (!role) return;
    // targetRole is kept in step so every existing screen, and the server's
    // single-role field, follow the switch without knowing about the array.
    await persistUser({ ...user, activeRoleId: role.id, targetRole: role.title });
    try {
      await AuthApiService.updateProfile({ targetRole: role.title, activeRoleId: role.id });
    } catch (e) {
      console.warn("[AuthContext] Failed to sync active role:", e);
    }
  }, [user]);

  const addTargetRole = useCallback(async (title: string) => {
    if (!user) return;
    const clean = title.trim();
    if (!clean) return;
    const id = makeRoleId(clean);
    // Adding a role the user already has should switch to it, not duplicate it.
    const existing = user.targetRoles ?? [];
    if (existing.some((r) => r.id === id)) {
      await setActiveRole(id);
      return;
    }
    const role: TargetRole = { id, title: clean, createdAt: new Date().toISOString() };
    await persistUser({
      ...user,
      targetRoles: [...existing, role],
      activeRoleId: id,
      targetRole: clean,
    });
    try {
      await AuthApiService.updateProfile({
        targetRole: clean,
        targetRoles: [...existing, role],
        activeRoleId: id,
      });
    } catch (e) {
      console.warn("[AuthContext] Failed to sync new role:", e);
    }
  }, [user, setActiveRole]);

  const removeTargetRole = useCallback(async (roleId: string) => {
    if (!user) return;
    // Refuse to remove the last role: with none, the app has no context to
    // show and every role-scoped screen would render empty.
    if ((user.targetRoles ?? []).length <= 1) return;
    const remaining = (user.targetRoles ?? []).filter((r) => r.id !== roleId);
    // Sync happens below via persistUser's server call path; push the pruned
    // list explicitly so a removed role does not reappear on the next login.
    const nextActive = user.activeRoleId === roleId
      ? remaining[0]
      : (user.targetRoles ?? []).find((r) => r.id === user.activeRoleId) ?? remaining[0];
    await persistUser({
      ...user,
      targetRoles: remaining,
      activeRoleId: nextActive.id,
      targetRole: nextActive.title,
    });
    try {
      await AuthApiService.updateProfile({
        targetRole: nextActive.title,
        targetRoles: remaining,
        activeRoleId: nextActive.id,
      });
    } catch (e) {
      console.warn("[AuthContext] Failed to sync role removal:", e);
    }
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // updateUser / completeOnboarding
  // ─────────────────────────────────────────────────────────────────────────────
  const updateUser = useCallback(async (data: Partial<User>) => {
    if (!user) return;
    await persistUser({ ...user, ...data });

    // Sync only the fields the server's profile endpoint actually accepts.
    const { name, phone, targetRole, experienceLevel, background, photoUri, onboardingComplete } = data;
    const profileFields = { name, phone, targetRole, experienceLevel, background, photoUri, onboardingComplete };
    if (Object.values(profileFields).some((v) => v !== undefined)) {
      try {
        await AuthApiService.updateProfile(profileFields);
      } catch (e) {
        console.warn("[AuthContext] Failed to sync profile update to server:", e);
      }
    }
  }, [user]);

  const completeOnboarding = useCallback(async (
    background: string, experienceLevel: string, targetRole: string,
  ) => {
    if (!user) return;
    const first: TargetRole = { id: makeRoleId(targetRole), title: targetRole, createdAt: new Date().toISOString() };
    await persistUser({
      ...user,
      background,
      experienceLevel,
      targetRole,
      targetRoles: [first],
      activeRoleId: first.id,
      onboardingComplete: true,
    });
    try {
      await AuthApiService.updateProfile({
        background, experienceLevel, targetRole, onboardingComplete: true,
        targetRoles: [first], activeRoleId: first.id,
      });
    } catch (e) {
      console.warn("[AuthContext] Failed to sync onboarding to server:", e);
    }
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // GDPR
  // ─────────────────────────────────────────────────────────────────────────────
  const exportData = useCallback(async (): Promise<object> => {
    if (!user) throw new Error("Not authenticated");
    return AuthApiService.exportData();
  }, [user]);

  const requestAccountDeletion = useCallback(async () => {
    if (!user) return;
    const result = await AuthApiService.requestDeletion();
    await persistUser({ ...user, deletionScheduledAt: result.scheduledAt });
  }, [user]);

  const cancelAccountDeletion = useCallback(async () => {
    if (!user) return;
    await AuthApiService.cancelDeletion();
    await persistUser({ ...user, deletionScheduledAt: undefined });
  }, [user]);

  const grantConsent = useCallback(async () => {
    if (!user) return;
    await AuthApiService.grantConsent();
    await persistUser({ ...user, consentGiven: true });
  }, [user]);

  // ── Social sign-in ────────────────────────────────────────────────────────────
  // SocialAuthService handles the OAuth flow and token persistence; once tokens
  // land we just need to load the live profile.
  const signInWithSocial = useCallback(async (provider: "google") => {
    // Lazy-import to avoid bundling expo-web-browser unless social login is used.
    const { SocialAuthService } = await import("@/services/socialAuthService");
    await SocialAuthService.signInWithGoogle();
    const profile = await AuthApiService.getProfile();
    if (profile?.user) await persistUser(mapServerUser(profile.user));
  }, []);

  // ── Load user from server (called after OAuth deep-link callback) ────────────
  const loadUserFromServer = useCallback(async () => {
    try {
      const profile = await AuthApiService.getProfile();
      if (profile?.user) await persistUser(mapServerUser(profile.user));
      await syncedStorage.hydrate();
      void syncPushTokenToServer();
    } catch (e) {
      console.warn("[AuthContext] loadUserFromServer failed:", e);
      const raw = await AsyncStorage.getItem(STORE.USER);
      if (raw) setUser(hydrateUser(JSON.parse(raw)));
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider value={{
      user, isLoading, pendingVerificationEmail, pendingUserId,
      reauthUrgency, sessionDaysRemaining, riskLevel,
      pending2FAUserId, biometricAvailable, biometricType,
      signIn, signUp, signOut, updateUser,
      completeOnboarding, resendVerification, confirmEmailVerified, beginEmailVerification,
      activeRole: user?.targetRoles?.find((r) => r.id === user.activeRoleId) ?? null,
      setActiveRole, addTargetRole, removeTargetRole,
      verify2FA, loginWithBiometric, enrollBiometric, disableBiometric,
      reauthenticate, setSecurityQuestions, verifySecurityAnswers, getSecurityQuestions,
      signInWithSocial, loadUserFromServer,
      exportData, requestAccountDeletion, cancelAccountDeletion, grantConsent,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
