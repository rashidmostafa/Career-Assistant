/**
 * useBiometric — React hook for biometric enrollment, login, and re-auth.
 *
 * Features:
 *  - autoPromptOnMount: silently tries biometric login when the login screen mounts.
 *  - enroll: prompts the user, registers the credential with the server, and
 *    persists the hash locally.
 *  - login: full biometric login flow (prompt → hash → POST verify → save tokens).
 *  - reauthenticate: local biometric challenge only (no server round-trip).
 *  - disable: clears local credential and calls the server to remove the hash.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BiometricService, type BiometricType } from "@/services/biometricService";
import { AuthApiService, type AuthResponse } from "@/services/authApiService";
import { SessionManager } from "@/services/sessionManager";

export interface UseBiometricReturn {
  /** Whether biometric hardware + enrollments are available. */
  available: boolean;
  /** "FaceID" | "Fingerprint" | "None" */
  biometricType: BiometricType;
  /** Human-readable label, e.g. "Face ID" or "Fingerprint". */
  biometricLabel: string;
  /** Whether this device has a registered biometric credential for this account. */
  isEnrolled: boolean;
  /** True while any async biometric operation is in progress. */
  loading: boolean;
  /** Last error message, if any. */
  error: string | null;

  /**
   * Enrol biometric for the current user.
   * Generates a device credential ID, prompts biometric confirmation,
   * hashes the ID, and registers it with the server.
   *
   * @param userId  The authenticated user's ID.
   * @returns true on success.
   */
  enroll: (userId: string) => Promise<boolean>;

  /**
   * Full biometric login: prompts the user, retrieves the stored credential,
   * and exchanges it for JWT tokens via the server.
   *
   * @returns AuthResponse on success, or null on failure/cancel.
   */
  login: () => Promise<AuthResponse | null>;

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
  autoPromptOnMount: (onSuccess: (result: AuthResponse) => void) => void;
}

export function useBiometric(): UseBiometricReturn {
  const [available,      setAvailable]      = useState(false);
  const [biometricType,  setBiometricType]  = useState<BiometricType>("None");
  const [biometricLabel, setBiometricLabel] = useState("Biometric");
  const [isEnrolled,     setIsEnrolled]     = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  // Auto-prompt ref — avoids prompting twice if the component re-mounts quickly.
  const autoPrompted = useRef(false);

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
  const enroll = useCallback(async (userId: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    try {
      // Generate a unique credential ID for this device + user combination
      const credentialId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await BiometricService.saveCredential(credentialId, userId);
      if (!result) {
        setError("Biometric confirmation was cancelled.");
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
  const login = useCallback(async (): Promise<AuthResponse | null> => {
    setError(null);
    setLoading(true);
    try {
      const credential = await BiometricService.biometricLogin();
      if (!credential) {
        setError("Biometric sign-in cancelled or unavailable.");
        return null;
      }

      const response = await AuthApiService.verifyBiometric(
        credential.userId,
        credential.credentialIdHash
      );

      // Persist the new tokens so the rest of the app is immediately authenticated.
      await SessionManager.saveTokens({
        accessToken:  response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt:    response.expiresAt,
      });

      return response;
    } catch (e: any) {
      setError(e?.message ?? "Biometric sign-in failed.");
      return null;
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

  // ── autoPromptOnMount ─────────────────────────────────────────────────────
  const autoPromptOnMount = useCallback(
    (onSuccess: (result: AuthResponse) => void) => {
      if (autoPrompted.current) return;
      autoPrompted.current = true;

      (async () => {
        const enrolled = await BiometricService.isEnrolled();
        if (!enrolled) return;
        const { available: avail } = await BiometricService.getAvailability();
        if (!avail) return;

        const result = await login();
        if (result) onSuccess(result);
      })();
    },
    [login]
  );

  return {
    available,
    biometricType,
    biometricLabel,
    isEnrolled,
    loading,
    error,
    enroll,
    login,
    reauthenticate,
    disable,
    autoPromptOnMount,
  };
}
