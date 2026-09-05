/**
 * useBiometric — React hook for biometric enrollment, login, and re-auth.
 *
 * Features:
 *  - enroll: prompts the user, registers the credential with the server, and
 *    persists the hash locally.
 *  - login: full biometric login flow (prompt → hash → POST verify → save tokens).
 *  - reauthenticate: local biometric challenge only (no server round-trip).
 *  - disable: clears local credential and calls the server to remove the hash.
 */
import { useCallback, useEffect, useState } from "react";
import { BiometricService, type BiometricType } from "@/services/biometricService";
import { AuthApiService, type AuthResponse } from "@/services/authApiService";
import { SessionManager } from "@/services/sessionManager";

/** Why a fingerprint sign-in ended, carried with the result so it cannot lag. */
export type LoginOutcome =
  | { ok: true; response: AuthResponse }
  | { ok: false; reason: "choose_account" | "unknown_number" | "none" | "cancelled" | "error"; message?: string };

export interface UseBiometricReturn {
  /** Whether biometric hardware + enrollments are available. */
  available: boolean;
  /** "Biometrics" | "None" */
  biometricType: BiometricType;
  /** Human-readable label shown to the user, e.g. "Biometrics". */
  biometricLabel: string;
  /** Whether this device has a registered biometric credential for this account. */
  isEnrolled: boolean;
  /** True while any async biometric operation is in progress. */
  loading: boolean;
  /** Last error message, if any. */
  error: string | null;
  /** The device has several enrolments; ask for the account number. */
  needsUserNumber: boolean;

  /**
   * Enrol biometric for the current user.
   * Generates a device credential ID, prompts biometric confirmation,
   * hashes the ID, and registers it with the server.
   *
   * @param userId  The authenticated user's ID.
   * @returns true on success.
   */
  enroll: (userId: string, userNumber?: string) => Promise<boolean>;

  /**
   * Full biometric login: prompts the user, retrieves the stored credential,
   * and exchanges it for JWT tokens via the server.
   *
   * @returns AuthResponse on success, or null on failure/cancel.
   */
  login: (userNumber?: string) => Promise<LoginOutcome>;

  /**
   * Local-only re-authentication (no server call).
   * Use for sensitive in-app actions that need identity confirmation.
   *
   * @returns true if the user successfully authenticated.
   */
  reauthenticate: (reason?: string) => Promise<boolean>;

  /**
   * Disable biometric login: clears local credential and notifies the server.
   */
  disable: () => Promise<void>;

  /**
   * Call this from a login screen to silently attempt biometric login on mount.
   * Does nothing if biometrics are not enrolled or hardware is unavailable.
   *
   * @param onSuccess Called with the AuthResponse when login succeeds.
   */
}

export function useBiometric(): UseBiometricReturn {
  const [available,      setAvailable]      = useState(false);
  const [biometricType,  setBiometricType]  = useState<BiometricType>("None");
  const [biometricLabel, setBiometricLabel] = useState("Biometric");
  const [isEnrolled,     setIsEnrolled]     = useState(false);
  // True when the device holds several enrolments and the account number is
  // needed to say which one is signing in.
  const [needsUserNumber, setNeedsUserNumber] = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  // Auto-prompt ref — avoids prompting twice if the component re-mounts quickly.

  // ── Initialise state on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { available: avail, type } = await BiometricService.getAvailability();
      const label    = await BiometricService.getBiometricLabel();
      const enrolled = await BiometricService.isEnrolled();
      if (!cancelled) {
        setAvailable(avail);
        setBiometricType(type);
        setBiometricLabel(label);
        setIsEnrolled(enrolled);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── enroll ────────────────────────────────────────────────────────────────
  const enroll = useCallback(async (userId: string, userNumber = ""): Promise<boolean> => {
    setError(null);
    setLoading(true);
    try {
      // Generate a unique credential ID for this device + user combination
      const credentialId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await BiometricService.saveCredential(credentialId, userId, userNumber);
      if (!result) {
        setError("Fingerprint confirmation was cancelled.");
        return false;
      }

      // Register the hash with the server (best-effort — local enrolment stands
      // even if the server call fails in offline/dev scenarios).
      try {
        await AuthApiService.registerBiometric(result.hash);
      } catch (serverErr: any) {
        if (serverErr?.message !== "NO_BACKEND") throw serverErr;
        // Offline / dev mode — skip server registration
      }

      setIsEnrolled(true);
      return true;
    } catch (e: any) {
      setError(e?.message ?? "Biometric enrolment failed.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── login ─────────────────────────────────────────────────────────────────
  /**
   * Returns why it stopped, rather than a bare null.
   *
   * The caller used to infer the reason from `error`, which is React state and
   * therefore still stale in the same tick — so "several accounts use this
   * device", a question, was rendered as "Biometric authentication failed", a
   * failure. The reason travels with the result now, so it cannot lag.
   */
  const login = useCallback(async (userNumber?: string): Promise<LoginOutcome> => {
    setError(null);
    setLoading(true);
    try {
      const outcome = await BiometricService.biometricLogin({ userNumber });

      if (outcome.status === "choose_account") {
        // A question, not a failure: nothing is shown in red for this.
        setNeedsUserNumber(true);
        return { ok: false, reason: "choose_account" };
      }
      if (outcome.status !== "ok") {
        const message =
          outcome.status === "unknown_number" ? "No account with that number uses fingerprint sign-in on this device."
          : outcome.status === "none"         ? "Fingerprint sign-in isn't set up on this device."
          : "Fingerprint sign-in cancelled.";
        setError(message);
        return { ok: false, reason: outcome.status, message };
      }

      setNeedsUserNumber(false);
      const response = await AuthApiService.verifyBiometric(
        outcome.userId,
        outcome.credentialIdHash
      );

      // Persist the new tokens so the rest of the app is immediately authenticated.
      await SessionManager.saveTokens({
        accessToken:  response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt:    response.expiresAt,
      });

      return { ok: true, response };
    } catch (e: any) {
      const message = e?.message ?? "Fingerprint sign-in failed.";
      setError(message);
      return { ok: false, reason: "error", message };
    } finally {
      setLoading(false);
    }
  }, []);

  // ── reauthenticate ────────────────────────────────────────────────────────
  const reauthenticate = useCallback(async (reason?: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    try {
      const ok = await BiometricService.authenticateForReauth(
        reason ?? "Confirm your identity to continue"
      );
      if (!ok) setError("Re-authentication failed or was cancelled.");
      return ok;
    } catch (e: any) {
      setError(e?.message ?? "Re-authentication error.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── disable ───────────────────────────────────────────────────────────────
  const disable = useCallback(async (): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      await BiometricService.clearCredential();
      try {
        await AuthApiService.disableBiometric();
      } catch (serverErr: any) {
        if (serverErr?.message !== "NO_BACKEND") throw serverErr;
      }
      setIsEnrolled(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to disable biometric login.");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    available,
    biometricType,
    biometricLabel,
    isEnrolled,
    needsUserNumber,
    loading,
    error,
    enroll,
    login,
    reauthenticate,
    disable,
  };
}
