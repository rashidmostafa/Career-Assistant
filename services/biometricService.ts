/**
 * BiometricService — expo-local-authentication wrapper.
 * Supports Face ID, Touch ID, Fingerprint, and Face Unlock.
 *
 * Design:
 *  - Raw biometric tokens never leave the device.
 *  - Only the SHA-256 hash of the device credential ID is sent to the server.
 *  - expo-secure-store with WHEN_UNLOCKED_THIS_DEVICE_ONLY is used on iOS/Android.
 *  - AsyncStorage is used as a fallback for environments without SecureStore (e.g. web).
 */
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

export type BiometricType = "FaceID" | "Fingerprint" | "None";

const CREDENTIAL_ID_KEY   = "auth_biometric_credential_id";   // raw device ID (local only)
const BIOMETRIC_ENABLED_KEY = "auth_biometric_enabled";        // "true" | absent
const USER_ID_KEY         = "auth_biometric_user_id";          // userId linked to credential

// ── SecureStore helpers ───────────────────────────────────────────────────────
async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
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

async function secureDel(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    await AsyncStorage.removeItem(key);
  }
}

// ── SHA-256 hash helper ───────────────────────────────────────────────────────
async function sha256(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
}

// ── Service ───────────────────────────────────────────────────────────────────
export const BiometricService = {
  /**
   * Returns whether biometric hardware is available and which type is enrolled.
   */
  async getAvailability(): Promise<{ available: boolean; type: BiometricType }> {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) return { available: false, type: "None" };
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) return { available: false, type: "None" };
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      return { available: true, type: hasFace ? "FaceID" : "Fingerprint" };
    } catch {
      return { available: false, type: "None" };
    }
  },

  /**
   * Returns a human-readable label for the available biometric type.
   */
  async getBiometricLabel(): Promise<string> {
    const { type } = await this.getAvailability();
    if (type === "FaceID") return "Face ID";
    if (type === "Fingerprint") return "Fingerprint";
    return "Biometric";
  },

  /**
   * Prompts the native biometric dialog.
   */
  async authenticate(prompt = "Authenticate to continue"): Promise<{ success: boolean; error?: string }> {
    try {
      const { available } = await this.getAvailability();
      if (!available) return { success: false, error: "Biometrics not available on this device." };

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage:       prompt,
        fallbackLabel:       "Use Passcode",
        disableDeviceFallback: false,
        cancelLabel:         "Cancel",
      });

      if (result.success) return { success: true };
      return {
        success: false,
        error:
          result.error === "user_cancel"
            ? "Authentication cancelled."
            : result.error === "lockout" || result.error === "lockout_permanent"
            ? "Too many failed attempts. Use your passcode."
            : "Authentication failed.",
      };
    } catch (e: any) {
      return { success: false, error: e?.message ?? "Authentication error." };
    }
  },

  /**
   * Save a credential ID + userId pair to SecureStore after a biometric check.
   * Returns the SHA-256 hash of the credential ID (to send to the server).
   */
  async saveCredential(credentialId: string, userId: string): Promise<{ hash: string } | null> {
    const auth = await this.authenticate("Confirm your identity to enable biometric sign-in");
    if (!auth.success) return null;

    await secureSet(CREDENTIAL_ID_KEY,    credentialId);
    await secureSet(USER_ID_KEY,          userId);
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");

    const hash = await sha256(credentialId);
    return { hash };
  },

  /**
   * Clears the stored biometric credential from SecureStore.
   */
  async clearCredential(): Promise<void> {
    await secureDel(CREDENTIAL_ID_KEY);
    await secureDel(USER_ID_KEY);
    await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
  },

  /**
   * Biometric login flow:
   *  1. Prompts the user.
   *  2. Reads credential ID + userId from SecureStore.
   *  3. Returns them so the caller can POST to /api/auth/biometric/verify.
   */
  async biometricLogin(): Promise<{ credentialIdHash: string; userId: string } | null> {
    const enabledRaw = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    if (enabledRaw !== "true") return null;

    const auth = await this.authenticate("Sign in with biometrics");
    if (!auth.success) return null;

    const credentialId = await secureGet(CREDENTIAL_ID_KEY);
    const userId       = await secureGet(USER_ID_KEY);
    if (!credentialId || !userId) return null;

    const credentialIdHash = await sha256(credentialId);
    return { credentialIdHash, userId };
  },

  /**
   * Biometric re-authentication (for sensitive actions already inside the app).
   * Does not exchange a credential — just confirms the user's identity locally.
   */
  async authenticateForReauth(reason = "Confirm your identity"): Promise<boolean> {
    const { success } = await this.authenticate(reason);
    return success;
  },

  /**
   * Returns whether biometric sign-in is currently enrolled on this device.
   */
  async isEnrolled(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return raw === "true";
  },

  // ── Legacy API (kept for backward compatibility) ──────────────────────────

  /** @deprecated Use saveCredential instead */
  async enroll(accessToken: string): Promise<boolean> {
    const auth = await this.authenticate("Confirm your identity to enable biometric sign-in");
    if (!auth.success) return false;
    await secureSet(CREDENTIAL_ID_KEY, accessToken);
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");
    return true;
  },

  /** @deprecated Use biometricLogin instead */
  async retrieveToken(): Promise<string | null> {
    const enabledRaw = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    if (enabledRaw !== "true") return null;
    const auth = await this.authenticate("Sign in with biometrics");
    if (!auth.success) return null;
    return secureGet(CREDENTIAL_ID_KEY);
  },

  /** @deprecated Use clearCredential instead */
  async disable(): Promise<void> {
    return this.clearCredential();
  },
};
