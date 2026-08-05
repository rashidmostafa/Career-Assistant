/**
 * AuthContext — Full authentication state management.
 * Backward-compatible: still exports User, useAuth, AuthProvider with
 * the same signIn / signUp / signOut / updateUser / completeOnboarding /
 * resendVerification / confirmEmailVerified interface used by existing screens.
 *
 * New additions:
 *  - 2FA state & helpers
 *  - Biometric login
 *  - 8-week rolling session + re-auth urgency
 *  - Risk scoring
 *  - Security questions
 *  - GDPR helpers
 *  - Account lockout
 *
 * Task 2 fix — Credential mismatch: loginWithBiometric now passes the stored
 *   userId to BiometricService.biometricLogin() so the pre-prompt mismatch
 *   check runs before any OS biometric attempt is consumed.
 *
 * Task 3 fix — Auto biometric enrolment: after a successful password-based
 *   signIn() or email verification, if the device supports biometrics and the
 *   user has not yet enrolled, shouldPromptBiometricEnroll is set to true.
 *   Callers read this flag and show a non-blocking enrolment prompt.
 *   Call dismissBiometricPrompt() once the user responds (accept or decline).
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
import { RiskScoringService, type RiskLevel } from "@/services/riskScoring";
import { OtpService } from "@/services/otpService";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface SecurityQuestion {
  question: string;
  answer: string; // hashed on server; stored locally as hint only
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  targetRole: string;
  experienceLevel: string;
  background?: string;
  onboardingComplete?: boolean;
  emailVerified?: boolean;
  photoUri?: string;
  // Security
  twoFactorEnabled: boolean;
  twoFactorMethod?: "totp" | "sms" | "email";
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
  biometricType: "FaceID" | "Fingerprint" | "None";
  shouldPromptBiometricEnroll: boolean;
  dismissBiometricPrompt: () => void;
  // ── Legacy API ──────────────────────────────────────────────────────────────
  signIn: (email: string, password: string) => Promise<{ require2FA?: boolean; userId?: string }>;
  signUp: (data: { name: string; email: string; password: string; phone?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  completeOnboarding: (background: string, experienceLevel: string, targetRole: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  confirmEmailVerified: () => Promise<void>;
  // ── New auth API ─────────────────────────────────────────────────────────────
  verify2FA: (code: string, method: "totp" | "sms" | "email" | "backup", trustDevice?: boolean) => Promise<void>;
  loginWithBiometric: () => Promise<boolean>;
  enrollBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
  reauthenticate: (method: "biometric" | "password" | "security_questions", credential?: string | Array<{ question: string; answer: string }>) => Promise<boolean>;
  setSecurityQuestions: (questions: SecurityQuestion[]) => Promise<void>;
  verifySecurityAnswers: (answers: Array<{ question: string; answer: string }>) => Promise<boolean>;
  getSecurityQuestions: () => Promise<string[]>;
  // ── Social auth ──────────────────────────────────────────────────────────────
  signInWithSocial: (provider: "google" | "linkedin") => Promise<void>;
  // ✅ ADD THIS NEW LINE
  handleOAuthCallback: (accessToken: string, refreshToken: string) => Promise<void>;
  // ── GDPR ─────────────────────────────────────────────────────────────────────
  exportData: () => Promise<object>;
  requestAccountDeletion: () => Promise<void>;
  cancelAccountDeletion: () => Promise<void>;
  grantConsent: () => Promise<void>;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const STORE = {
  USER:          "auth_user_v2",
  USERS:         "auth_users_v2",
  PENDING_EMAIL: "auth_pending_email",
  PENDING_USER:  "auth_pending_user",
  SECURITY_Q:    "auth_security_questions",
  REAUTH_TS:     "auth_last_reauth_ts",
  // Task 3 — tracks whether the one-time first-login biometric prompt has been shown
  BIO_PROMPT_SHOWN: "auth_biometric_prompt_shown",
} as const;

// ─── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null);

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateId() {
  return `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function simpleHash(str: string): string {
  // Deterministic client-side hash (NOT cryptographic — for local sim only)
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function makeDefaultUser(partial: Partial<User>): User {
  return {
    id: generateId(),
    name: "",
    email: "",
    targetRole: "",
    experienceLevel: "",
    twoFactorEnabled: false,
    biometricEnabled: false,
    securityQuestionsSet: false,
    loginAttempts: 0,
    accountLocked: false,
    consentGiven: false,
    ...partial,
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
  const [biometricType, setBiometricType] = useState<"FaceID" | "Fingerprint" | "None">("None");
  // Task 3 — biometric enrolment prompt flag
  const [shouldPromptBiometricEnroll, setShouldPromptBiometricEnroll] = useState(false);

  const sessionTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Startup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [rawUser, pendingEmail] = await Promise.all([
        AsyncStorage.getItem(STORE.USER),
        AsyncStorage.getItem(STORE.PENDING_EMAIL),
      ]);
      if (rawUser) {
        const u: User = JSON.parse(rawUser);
        setUser(u);
        // Check lockout expiry
        if (u.accountLocked && u.lockoutUntil && Date.now() > u.lockoutUntil) {
          const unlocked = { ...u, accountLocked: false, loginAttempts: 0, lockoutUntil: undefined };
          await persistUser(unlocked);
        }
      }
      if (pendingEmail) setPendingVerificationEmail(pendingEmail);
      setIsLoading(false);
    })();

    // Biometric availability check
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

  // ── Persistence helpers ───────────────────────────────────────────────────────
  async function persistUser(u: User) {
    await AsyncStorage.setItem(STORE.USER, JSON.stringify(u));
    setUser(u);
    // Update in users list
    const raw = await AsyncStorage.getItem(STORE.USERS);
    const users: StoredUser[] = raw ? JSON.parse(raw) : [];
    const idx = users.findIndex((x) => x.id === u.id);
    if (idx >= 0) users[idx] = { ...users[idx], ...u };
    await AsyncStorage.setItem(STORE.USERS, JSON.stringify(users));
  }

  // ── Task 3 — check whether to show the biometric enrolment prompt ─────────────
  /**
   * Fires after any successful password-based login or email verification.
   * Sets shouldPromptBiometricEnroll = true when:
   *   - the device supports biometrics
   *   - the user has not yet enrolled biometrics for this account
   *   - we have not already shown the one-time prompt for this user
   */
  async function maybePromptBiometricEnroll(loggedInUser: User): Promise<void> {
    if (loggedInUser.biometricEnabled) return; // already enrolled
    const { available } = await BiometricService.getAvailability();
    if (!available) return; // hardware not present

    // Check per-user flag so we only prompt once per account
    const shownKey = `${STORE.BIO_PROMPT_SHOWN}_${loggedInUser.id}`;
    const alreadyShown = await AsyncStorage.getItem(shownKey);
    if (alreadyShown === "true") return;

    setShouldPromptBiometricEnroll(true);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // signIn (backward-compatible, also handles risk + lockout)
  // ─────────────────────────────────────────────────────────────────────────────
  const signIn = useCallback(async (email: string, password: string) => {
    const raw = await AsyncStorage.getItem(STORE.USERS);
    const users: StoredUser[] = raw ? JSON.parse(raw) : [];
    const found = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!found) throw new Error("No account found with that email.");

    // Lockout check
    if (found.accountLocked) {
      if (found.lockoutUntil && Date.now() < found.lockoutUntil) {
        const mins = Math.ceil((found.lockoutUntil - Date.now()) / 60_000);
        throw new Error(`Account locked. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.`);
      }
      found.accountLocked = false;
      found.loginAttempts = 0;
    }

    // Password check (local sim: compare hash)
    if (found.passwordHash && simpleHash(password) !== found.passwordHash) {
      found.loginAttempts = (found.loginAttempts ?? 0) + 1;
      await RiskScoringService.recordAttempt(found.id, false);
      if (found.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        found.accountLocked = true;
        found.lockoutUntil  = Date.now() + LOCKOUT_MS;
        const idx = users.findIndex((u) => u.id === found.id);
        if (idx >= 0) users[idx] = found;
        await AsyncStorage.setItem(STORE.USERS, JSON.stringify(users));
        throw new Error(`Account locked for 15 minutes after ${MAX_LOGIN_ATTEMPTS} failed attempts.`);
      }
      const idx = users.findIndex((u) => u.id === found.id);
      if (idx >= 0) users[idx] = found;
      await AsyncStorage.setItem(STORE.USERS, JSON.stringify(users));
      throw new Error(`Incorrect password. ${MAX_LOGIN_ATTEMPTS - found.loginAttempts} attempt${MAX_LOGIN_ATTEMPTS - found.loginAttempts !== 1 ? "s" : ""} remaining.`);
    }

    // Risk scoring
    const deviceId = await SessionManager.getOrCreateDeviceId();
    const knownDevices: string[] = found.knownDevices ?? [];
    const recentFailures = await RiskScoringService.getRecentFailures();
    const risk = await RiskScoringService.calculate({
      deviceId,
      knownDeviceIds: knownDevices,
      recentFailures,
      timeSinceLastLogin: found.lastLogin ? Date.now() - found.lastLogin : undefined,
    });
    setRiskLevel(risk.level);

    // Record successful attempt
    await RiskScoringService.recordAttempt(found.id, true);
    // Add device to known
    if (!knownDevices.includes(deviceId)) knownDevices.push(deviceId);

    // Reset login attempts
    found.loginAttempts = 0;
    found.accountLocked = false;
    found.lastLogin = Date.now();
    found.knownDevices = knownDevices;
    const idx = users.findIndex((u) => u.id === found.id);
    if (idx >= 0) users[idx] = found;
    await AsyncStorage.setItem(STORE.USERS, JSON.stringify(users));

    // Check device trust + 2FA
    const trusted = await SessionManager.isDeviceTrusted();

    if (found.twoFactorEnabled && !trusted) {
      // Need 2FA — set pending state
      setPending2FAUserId(found.id);
      await AsyncStorage.setItem("auth_pending_2fa_user", JSON.stringify(found));
      return { require2FA: true, userId: found.id };
    }

    // Complete login
    const { passwordHash: _ph, knownDevices: _kd, ...safeUser } = found;
    const finalUser: User = safeUser;
    await persistUser(finalUser);

    // Issue local tokens
    await SessionManager.saveTokens({
      accessToken:  `local_at_${generateId()}`,
      refreshToken: `local_rt_${generateId()}`,
      expiresAt:    Date.now() + 15 * 60 * 1000,
    });

    // Task 2 — proactively clear any stale biometric credential for a different
    // account before the new session is used (prevents mismatch lockouts).
    await BiometricService.clearIfMismatch(finalUser.id);

    setPendingVerificationEmail(null);
    await AsyncStorage.removeItem(STORE.PENDING_EMAIL);

    // Task 3 — prompt for biometric enrolment if appropriate
    await maybePromptBiometricEnroll(finalUser);

    return {};
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // signUp
  // ─────────────────────────────────────────────────────────────────────────────
  const signUp = useCallback(async (data: {
    name: string; email: string; password: string; phone?: string;
  }) => {
    const raw = await AsyncStorage.getItem(STORE.USERS);
    const users: StoredUser[] = raw ? JSON.parse(raw) : [];
    if (users.find((u) => u.email.toLowerCase() === data.email.toLowerCase())) {
      throw new Error("An account with this email already exists.");
    }

    const newUser: StoredUser = {
      ...makeDefaultUser({
        name: data.name,
        email: data.email,
        phone: data.phone,
      }),
      passwordHash: simpleHash(data.password),
      emailVerified: false,
      onboardingComplete: false,
    };

    users.push(newUser);
    await AsyncStorage.setItem(STORE.USERS, JSON.stringify(users));

    // Create + store OTP
    const otp = await OtpService.createOtp(`email_verify_${newUser.id}`);
    console.log(`[DEV] Email OTP for ${data.email}: ${otp}`); // visible in dev logs

    setPendingVerificationEmail(data.email);
    setPendingUserId(newUser.id);
    await AsyncStorage.setItem(STORE.PENDING_EMAIL, data.email);
    await AsyncStorage.setItem(STORE.PENDING_USER, JSON.stringify(newUser));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // confirmEmailVerified (backward-compat: called after OTP check)
  // ─────────────────────────────────────────────────────────────────────────────
  const confirmEmailVerified = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORE.PENDING_USER);
    if (!raw) return;
    const pending: StoredUser = JSON.parse(raw);
    const verifiedUser: User = {
      ...pending,
      emailVerified: true,
      twoFactorEnabled: pending.twoFactorEnabled ?? false,
      biometricEnabled: pending.biometricEnabled ?? false,
      securityQuestionsSet: pending.securityQuestionsSet ?? false,
      loginAttempts: 0,
      accountLocked: false,
    };

      // ── Social sign-in ────────────────────────────────────────────────────────────
  const signInWithSocial = useCallback(async (provider: "google" | "linkedin") => {
    const { SocialAuthService } = await import("@/services/socialAuthService");
    await SocialAuthService[provider === "google" ? "signInWithGoogle" : "signInWithLinkedIn"]();
    try {
      const { AuthApiService } = await import("@/services/authApiService");
      const profile = await AuthApiService.getProfile();
      if (profile?.user) await persistUser(profile.user as User);
    } catch {
      // No backend in dev — leave user state as-is; the session is valid.
    }
  }, []);

  // ── OAuth Callback Handler ────────────────────────────────────────────────────
  // ✅ ADD THIS ENTIRE FUNCTION
  const handleOAuthCallback = useCallback(async (accessToken: string, refreshToken: string) => {
    try {
      setIsLoading(true);
      console.log('🔑 Processing OAuth callback...');
      
      // Store tokens securely
      await SessionManager.saveTokens({
        accessToken,
        refreshToken,
        expiresAt: Date.now() + 56 * 24 * 60 * 60 * 1000, // 8 weeks
      });
      
      // Fetch user profile from backend
      const { AuthApiService } = await import("@/services/authApiService");
      const profile = await AuthApiService.getProfile();
      
      if (profile?.user) {
        // Save user to local storage
        await persistUser(profile.user as User);
        console.log('✅ OAuth login successful for:', profile.user.name);
      } else {
        console.warn('⚠️ No user profile returned from OAuth');
      }
    } catch (error) {
      console.error('❌ OAuth callback error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

    const usersRaw = await AsyncStorage.getItem(STORE.USERS);
    const users: StoredUser[] = usersRaw ? JSON.parse(usersRaw) : [];
    const idx = users.findIndex((u) => u.id === verifiedUser.id);
    if (idx >= 0) users[idx] = { ...users[idx], ...verifiedUser };
    await AsyncStorage.setItem(STORE.USERS, JSON.stringify(users));
    await AsyncStorage.setItem(STORE.USER, JSON.stringify(verifiedUser));
    await AsyncStorage.removeItem(STORE.PENDING_EMAIL);
    await AsyncStorage.removeItem(STORE.PENDING_USER);

    await SessionManager.saveTokens({
      accessToken:  `local_at_${generateId()}`,
      refreshToken: `local_rt_${generateId()}`,
      expiresAt:    Date.now() + 15 * 60 * 1000,
    });

    setUser(verifiedUser);
    setPendingVerificationEmail(null);
    setPendingUserId(null);

    // Task 3 — prompt for biometric enrolment after first-time email verification
    await maybePromptBiometricEnroll(verifiedUser);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // resendVerification
  // ─────────────────────────────────────────────────────────────────────────────
  const resendVerification = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORE.PENDING_USER);
    if (!raw) return;
    const pending: StoredUser = JSON.parse(raw);
    const otp = await OtpService.createOtp(`email_verify_${pending.id}`);
    console.log(`[DEV] Resent OTP for ${pending.email}: ${otp}`);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2FA verification
  // ─────────────────────────────────────────────────────────────────────────────
  const verify2FA = useCallback(async (
    code: string,
    method: "totp" | "sms" | "email" | "backup",
    trustDevice = false,
  ) => {
    const rawPending = await AsyncStorage.getItem("auth_pending_2fa_user");
    const pending: StoredUser | null = rawPending ? JSON.parse(rawPending) : null;
    const userId = pending2FAUserId ?? pending?.id;
    if (!userId) throw new Error("No pending 2FA session.");

    let valid = false;
    if (method === "backup") {
      valid = await OtpService.verifyBackupCode(userId, code);
    } else if (method === "totp") {
      valid = await OtpService.verifyTotp(userId, code);
    } else {
      const res = await OtpService.verifyOtp(`2fa_${method}_${userId}`, code);
      valid = res.valid;
      if (!res.valid) throw new Error(res.error ?? "Invalid code.");
    }

    if (!valid) throw new Error("Invalid 2FA code.");

    if (trustDevice) await SessionManager.trustDevice();

    // Complete login
    if (!pending) throw new Error("Session data lost. Please log in again.");
    const { passwordHash: _ph, knownDevices: _kd, ...safeUser } = pending;
    const finalUser: User = { ...safeUser, twoFactorEnabled: true };
    await persistUser(finalUser);

    await SessionManager.saveTokens({
      accessToken:  `local_at_${generateId()}`,
      refreshToken: `local_rt_${generateId()}`,
      expiresAt:    Date.now() + 15 * 60 * 1000,
    });

    setPending2FAUserId(null);
    await AsyncStorage.removeItem("auth_pending_2fa_user");
  }, [pending2FAUserId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Biometric
  // ─────────────────────────────────────────────────────────────────────────────
  const loginWithBiometric = useCallback(async (): Promise<boolean> => {
    const raw = await AsyncStorage.getItem(STORE.USER);
    const storedUser: User | null = raw ? JSON.parse(raw) : null;
    if (!storedUser?.biometricEnabled || !storedUser.id) return false;

    // Task 2 — pass the expected userId so BiometricService can validate the
    // stored credential BEFORE consuming a native biometric attempt.
    const credential = await BiometricService.biometricLogin(storedUser.id);
    if (!credential) return false;

    storedUser.lastLogin = Date.now();
    await persistUser(storedUser);
    await SessionManager.saveTokens({
      accessToken:  `local_at_${generateId()}`,
      refreshToken: `local_rt_${generateId()}`,
      expiresAt:    Date.now() + 15 * 60 * 1000,
    });
    return true;
  }, []);

  const enrollBiometric = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    const { success } = await BiometricService.authenticate("Enroll biometric for sign-in");
    if (!success) return false;
    const credentialId = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await BiometricService.saveCredential(credentialId, user.id);
    if (!result) return false;
    await persistUser({ ...user, biometricEnabled: true });
    // Mark prompt as shown once they actually enrol
    await AsyncStorage.setItem(`${STORE.BIO_PROMPT_SHOWN}_${user.id}`, "true");
    setShouldPromptBiometricEnroll(false);
    return true;
  }, [user]);

  const disableBiometric = useCallback(async () => {
    if (!user) return;
    await BiometricService.clearCredential();
    await persistUser({ ...user, biometricEnabled: false });
  }, [user]);

  // Task 3 — dismiss biometric prompt and remember the decision per-user
  const dismissBiometricPrompt = useCallback(async () => {
    setShouldPromptBiometricEnroll(false);
    if (user) {
      // Record that the prompt was shown (and declined) so we don't re-surface it
      await AsyncStorage.setItem(`${STORE.BIO_PROMPT_SHOWN}_${user.id}`, "true");
    }
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Re-authentication
  // ─────────────────────────────────────────────────────────────────────────────
  const reauthenticate = useCallback(async (
    method: "biometric" | "password" | "security_questions",
    credential?: string | Array<{ question: string; answer: string }>,
  ): Promise<boolean> => {
    if (!user) return false;

    if (method === "biometric") {
      const ok = await BiometricService.authenticateForReauth();
      if (ok) {
        await SessionManager.resetSessionClock();
        await AsyncStorage.setItem(STORE.REAUTH_TS, String(Date.now()));
        setReauthUrgency("none");
        setSessionDaysRemaining(56);
      }
      return ok;
    }

    if (method === "password" && typeof credential === "string") {
      const raw = await AsyncStorage.getItem(STORE.USERS);
      const users: StoredUser[] = raw ? JSON.parse(raw) : [];
      const stored = users.find((u) => u.id === user.id);
      if (!stored?.passwordHash) return false;
      const ok = simpleHash(credential) === stored.passwordHash;
      if (ok) {
        await SessionManager.resetSessionClock();
        setReauthUrgency("none");
        setSessionDaysRemaining(56);
      }
      return ok;
    }

    if (method === "security_questions" && Array.isArray(credential)) {
      return verifySecurityAnswers(credential);
    }

    return false;
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Security questions
  // ─────────────────────────────────────────────────────────────────────────────
  const setSecurityQuestions = useCallback(async (questions: SecurityQuestion[]) => {
    if (!user) return;
    const hashed = questions.map((q) => ({ question: q.question, answerHash: simpleHash(q.answer.toLowerCase().trim()) }));
    await AsyncStorage.setItem(`${STORE.SECURITY_Q}_${user.id}`, JSON.stringify(hashed));
    await persistUser({ ...user, securityQuestionsSet: true });
  }, [user]);

  const getSecurityQuestions = useCallback(async (): Promise<string[]> => {
    if (!user) return [];
    const raw = await AsyncStorage.getItem(`${STORE.SECURITY_Q}_${user.id}`);
    if (!raw) return [];
    const stored: Array<{ question: string; answerHash: string }> = JSON.parse(raw);
    return stored.map((s) => s.question);
  }, [user]);

  const verifySecurityAnswers = useCallback(async (
    answers: Array<{ question: string; answer: string }>,
  ): Promise<boolean> => {
    const userId = user?.id ?? pending2FAUserId;
    if (!userId) return false;
    const raw = await AsyncStorage.getItem(`${STORE.SECURITY_Q}_${userId}`);
    if (!raw) return false;
    const stored: Array<{ question: string; answerHash: string }> = JSON.parse(raw);
    const allCorrect = answers.every((a) => {
      const match = stored.find((s) => s.question === a.question);
      return match && simpleHash(a.answer.toLowerCase().trim()) === match.answerHash;
    });
    if (allCorrect) {
      await SessionManager.resetSessionClock();
      setReauthUrgency("none");
    }
    return allCorrect;
  }, [user, pending2FAUserId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // signOut
  // ─────────────────────────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    await SessionManager.clearTokens();
    await AsyncStorage.removeItem(STORE.USER);
    setUser(null);
    setReauthUrgency("none");
    setRiskLevel(null);
    setShouldPromptBiometricEnroll(false);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // updateUser / completeOnboarding
  // ─────────────────────────────────────────────────────────────────────────────
  const updateUser = useCallback(async (data: Partial<User>) => {
    if (!user) return;
    await persistUser({ ...user, ...data });
  }, [user]);

  const completeOnboarding = useCallback(async (
    background: string, experienceLevel: string, targetRole: string,
  ) => {
    if (!user) return;
    await persistUser({ ...user, background, experienceLevel, targetRole, onboardingComplete: true });
  }, [user]);

  // ─────────────────────────────────────────────────────────────────────────────
  // GDPR
  // ─────────────────────────────────────────────────────────────────────────────
  const exportData = useCallback(async (): Promise<object> => {
    if (!user) throw new Error("Not authenticated");
    const raw = await AsyncStorage.getItem(STORE.USERS);
    const users: StoredUser[] = raw ? JSON.parse(raw) : [];
    const { passwordHash: _ph, ...safe } = users.find((u) => u.id === user.id) ?? {};
    return {
      exportedAt: new Date().toISOString(),
      user: safe,
      gdprNote: "This export contains all personal data held for your account.",
    };
  }, [user]);

  const requestAccountDeletion = useCallback(async () => {
    if (!user) return;
    const scheduledAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30-day grace
    await persistUser({ ...user, deletionScheduledAt: scheduledAt });
  }, [user]);

  const cancelAccountDeletion = useCallback(async () => {
    if (!user) return;
    await persistUser({ ...user, deletionScheduledAt: undefined });
  }, [user]);

  const grantConsent = useCallback(async () => {
    if (!user) return;
    await persistUser({ ...user, consentGiven: true });
  }, [user]);

  // ── Social sign-in ────────────────────────────────────────────────────────────
  // Thin wrapper — SocialAuthService handles the OAuth flow and token persistence.
  // After the deep-link callback, we reload the user profile from the server
  // (or local store in offline/dev mode) so the context is up to date.
  const signInWithSocial = useCallback(async (provider: "google" | "linkedin") => {
    // Lazy-import to avoid bundling expo-web-browser unless called
    const { SocialAuthService } = await import("@/services/socialAuthService");
    await SocialAuthService[provider === "google" ? "signInWithGoogle" : "signInWithLinkedIn"]();
    // After OAuth the session tokens are already saved by SocialAuthService.
    // Try to fetch the live profile; fall back gracefully in offline/dev mode.
    try {
      const { AuthApiService } = await import("@/services/authApiService");
      const profile = await AuthApiService.getProfile();
      if (profile?.user) await persistUser(profile.user as User);
    } catch {
      // No backend in dev — leave user state as-is; the session is valid.
    }
  }, []);

  const handleOAuthCallback = useCallback(async (accessToken: string, refreshToken: string) => {
    try {
      setIsLoading(true);
      console.log('🔑 Processing OAuth callback...');
      
      // Store tokens securely
      await SessionManager.saveTokens({
        accessToken,
        refreshToken,
        expiresAt: Date.now() + 56 * 24 * 60 * 60 * 1000,
      });
      
      // Fetch user profile from backend
      const { AuthApiService } = await import("@/services/authApiService");
      const profile = await AuthApiService.getProfile();
      
      if (profile?.user) {
        await persistUser(profile.user as User);
        console.log('✅ OAuth login successful for:', profile.user.name);
      }
    } catch (error) {
      console.error('❌ OAuth callback error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <AuthContext.Provider value={{
      user, isLoading, pendingVerificationEmail, pendingUserId,
      reauthUrgency, sessionDaysRemaining, riskLevel,
      pending2FAUserId, biometricAvailable, biometricType,
      shouldPromptBiometricEnroll,
      dismissBiometricPrompt,
      signIn, signUp, signOut, updateUser,
      completeOnboarding, resendVerification, confirmEmailVerified,
      verify2FA, loginWithBiometric, enrollBiometric, disableBiometric,
      reauthenticate, setSecurityQuestions, verifySecurityAnswers, getSecurityQuestions,
      signInWithSocial, handleOAuthCallback,
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

// ─── Internal stored user (includes password hash + device list) ───────────────
interface StoredUser extends User {
  passwordHash?: string;
  knownDevices?: string[];
}
