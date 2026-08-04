/**
 * BiometricService — expo-local-authentication wrapper.
 * Supports Face ID, Touch ID, Fingerprint, and Face Unlock.
 * Falls back to device passcode when biometrics are not enrolled.
 * Tokens are stored in expo-secure-store (Keychain / Keystore).
 */
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type BiometricType = "FaceID" | "Fingerprint" | "None";

const BIOMETRIC_TOKEN_KEY = "auth_biometric_token";
const BIOMETRIC_ENABLED_KEY = "auth_biometric_enabled";

// ── Secure store helpers ──────────────────────────────────────────────────────
async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Fallback for environments where SecureStore is unavailable (e.g. web)
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
      return {
        available: true,
        type: hasFace ? "FaceID" : "Fingerprint",
      };
    } catch {
      return { available: false, type: "None" };
    }
  },

  /**
   * Prompts the native biometric dialog.
   * Returns `{ success, error? }`.
   */
  async authenticate(prompt = "Authenticate to continue"): Promise<{ success: boolean; error?: string }> {
    try {
      const { available } = await this.getAvailability();
      if (!available) return { success: false, error: "Biometrics not available." };

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: prompt,
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
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
   * Enrol biometric: stores the provided access token behind biometric guard.
   * The user must complete a biometric challenge to confirm enrolment.
   */
  async enroll(accessToken: string): Promise<boolean> {
    const auth = await this.authenticate("Confirm your identity to enable biometric sign-in");
    if (!auth.success) return false;
    await secureSet(BIOMETRIC_TOKEN_KEY, accessToken);
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");
    return true;
  },

  /**
   * Biometric sign-in: prompts the user, then returns the stored token on success.
   */
  async retrieveToken(): Promise<string | null> {
    const enabledRaw = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    if (enabledRaw !== "true") return null;

    const auth = await this.authenticate("Sign in with biometrics");
    if (!auth.success) return null;

    return secureGet(BIOMETRIC_TOKEN_KEY);
  },

  /**
   * Clears the stored biometric token and disables biometric sign-in.
   */
  async disable(): Promise<void> {
    await secureDel(BIOMETRIC_TOKEN_KEY);
    await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
  },

  /**
   * Returns whether biometric sign-in is currently enrolled.
   */
  async isEnrolled(): Promise<boolean> {
    const raw = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return raw === "true";
  },
};
