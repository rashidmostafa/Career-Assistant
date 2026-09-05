/**
 * BiometricService — expo-local-authentication wrapper.
 * Supports every sensor expo-local-authentication exposes — face and
 * fingerprint alike — and presents them all to the user as "biometrics".
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

/**
 * Whether biometric sign-in is usable, not which sensor does it.
 *
 * This used to distinguish "FaceID" from "Fingerprint", but every label the
 * user sees now reads "biometrics", so the distinction had no consumer left —
 * and "Face ID" is Apple's name for hardware Android phones do not have.
 */
export type BiometricType = "Biometrics" | "None";

const CREDENTIAL_ID_KEY   = "auth_biometric_credential_id";   // raw device ID (local only)
const BIOMETRIC_ENABLED_KEY = "auth_biometric_enabled";        // "true" | absent
const USER_ID_KEY         = "auth_biometric_user_id";          // legacy single-account key
/**
 * Every account enrolled on this device: { userId: { credentialId, userNumber } }.
 *
 * A device used to hold one enrolment, so a second account overwrote the first
 * and the sign-in button quietly opened the wrong one. Several are held now,
 * and the user's number picks between them — the fingerprint proves the owner
 * is present, it cannot say which account they meant.
 *
 * userNumber is stored beside the credential so the number typed at sign-in can
 * be resolved without a round trip, and without the app ever having to ask the
 * server "who lives on this device", which would enumerate accounts.
 */
const ACCOUNTS_KEY        = "auth_biometric_accounts";

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

      // Fingerprint only.
      //
      // A face can be shared by a twin and defeated by a photograph on weaker
      // sensors, and this app binds an account to a biometric, so the weaker
      // modality is not offered. A device without a fingerprint reader is
      // reported unavailable and falls back to password sign-in.
      //
      // Honest about the limit: the OS chooses which enrolled modality its own
      // prompt presents, and exposes no way to demand one. So this guarantees
      // the device HAS a fingerprint reader, not that a face was never used on
      // a phone offering both. That boundary belongs to the platform.
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      if (!types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        return { available: false, type: "None" };
      }
      return { available: true, type: "Biometrics" };
    } catch {
      return { available: false, type: "None" };
    }
  },

  /**
   * Returns a human-readable label for the available biometric type.
   */
  async getBiometricLabel(): Promise<string> {
    const { type } = await this.getAvailability();
    return type === "None" ? "Biometric" : "Biometrics";
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
        cancelLabel:         "Cancel",
        // No passcode fallback. The device PIN is something the account owner
        // may have shared, and accepting it here would let it stand in for the
        // fingerprint this account is bound to — which is the whole point of
        // the binding. Someone without the finger uses their password instead.
        disableDeviceFallback: true,
      });

      if (result.success) return { success: true };
      return {
        success: false,
        error:
          result.error === "user_cancel"
            ? "Authentication cancelled."
            : result.error === "lockout"
            ? "Too many failed attempts. Sign in with your password instead."
            : "Authentication failed.",
      };
    } catch (e: any) {
      return { success: false, error: e?.message ?? "Authentication error." };
    }
  },

  /**
   * Reads the enrolment map, absorbing a legacy single-account record.
   *
   * Devices enrolled before the map existed keep working: their one credential
   * is migrated in place the first time this runs.
   */
  async readAccounts(): Promise<Record<string, { credentialId: string; userNumber: string }>> {
    let map: Record<string, { credentialId: string; userNumber: string }> = {};
    try {
      const raw = await secureGet(ACCOUNTS_KEY);
      if (raw) map = JSON.parse(raw);
      if (typeof map !== "object" || map === null) map = {};
    } catch { map = {}; }

    if (Object.keys(map).length === 0) {
      const legacyId   = await secureGet(CREDENTIAL_ID_KEY);
      const legacyUser = await secureGet(USER_ID_KEY);
      const enabled    = (await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY)) === "true";
      if (enabled && legacyId && legacyUser) {
        // The number is unknown for a legacy record; with one account enrolled
        // it is never needed, and the next enrolment fills it in.
        map[legacyUser] = { credentialId: legacyId, userNumber: "" };
        await secureSet(ACCOUNTS_KEY, JSON.stringify(map));
      }
    }
    return map;
  },

  async writeAccounts(map: Record<string, { credentialId: string; userNumber: string }>): Promise<void> {
    await secureSet(ACCOUNTS_KEY, JSON.stringify(map));
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, Object.keys(map).length > 0 ? "true" : "false");
  },

  /** The single enrolled account, or null when there are none or several. */
  async enrolledUserId(): Promise<string | null> {
    const ids = Object.keys(await this.readAccounts());
    return ids.length === 1 ? ids[0] : null;
  },

  async saveCredential(
    credentialId: string,
    userId: string,
    userNumber = "",
  ): Promise<{ hash: string } | null> {
    const auth = await this.authenticate("Confirm your fingerprint to enable sign-in");
    if (!auth.success) return null;

    // Added alongside whatever is already here. Several accounts may share a
    // device; the user's number tells them apart at sign-in.
    const map = await this.readAccounts();
    map[userId] = { credentialId, userNumber: String(userNumber ?? "") };
    await this.writeAccounts(map);

    // Legacy keys kept in step so an older build on the same device still works.
    await secureSet(CREDENTIAL_ID_KEY, credentialId);
    await secureSet(USER_ID_KEY,       userId);

    const hash = await sha256(credentialId);
    return { hash };
  },

  async clearCredential(userId?: string): Promise<void> {
    const map = await this.readAccounts();

    if (userId) {
      delete map[userId];
    } else {
      // No id given means "forget this device entirely".
      for (const k of Object.keys(map)) delete map[k];
    }
    await this.writeAccounts(map);

    const remaining = Object.keys(map);
    if (remaining.length === 0) {
      await secureDel(CREDENTIAL_ID_KEY);
      await secureDel(USER_ID_KEY);
      await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
    } else {
      // Keep the legacy pointers valid rather than dangling at a deleted account.
      await secureSet(CREDENTIAL_ID_KEY, map[remaining[0]].credentialId);
      await secureSet(USER_ID_KEY,       remaining[0]);
    }
  },

  /**
   * Fingerprint sign-in.
   *
   * The prompt proves the device's owner is present. It cannot say which
   * account they meant, so when this device holds more than one enrolment the
   * caller is told to ask for the account number, exactly as a bank asks for a
   * customer number on a shared phone.
   *
   * `userNumber` resolves that second step. It is matched locally, so choosing
   * an account never asks the server who lives on this device.
   */
  async biometricLogin(opts: { userNumber?: string } = {}): Promise<
    | { status: "ok"; credentialIdHash: string; userId: string; userNumber: string }
    | { status: "choose_account"; accounts: number }
    | { status: "unknown_number" }
    | { status: "none" }
    | { status: "cancelled" }
  > {
    const map = await this.readAccounts();
    const ids = Object.keys(map);
    if (ids.length === 0) return { status: "none" };

    const auth = await this.authenticate("Sign in with your fingerprint");
    if (!auth.success) return { status: "cancelled" };

    let chosen: string | undefined;
    if (ids.length === 1) {
      chosen = ids[0];
    } else if (opts.userNumber) {
      const wanted = String(opts.userNumber).replace(/\D/g, "");
      chosen = ids.find((id) => map[id].userNumber === wanted);
      if (!chosen) return { status: "unknown_number" };
    } else {
      return { status: "choose_account", accounts: ids.length };
    }

    const entry = map[chosen];
    return {
      status: "ok",
      credentialIdHash: await sha256(entry.credentialId),
      userId: chosen,
      userNumber: entry.userNumber,
    };
  },

  /** A local fingerprint challenge with no server round-trip, for re-auth. */
  async authenticateForReauth(reason = "Confirm your fingerprint"): Promise<boolean> {
    const { success } = await this.authenticate(reason);
    return success;
  },

  async isEnrolled(): Promise<boolean> {
    return Object.keys(await this.readAccounts()).length > 0;
  },

  /** How many accounts have enrolled on this device. */
  async enrolledCount(): Promise<number> {
    return Object.keys(await this.readAccounts()).length;
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
    const auth = await this.authenticate("Sign in with your fingerprint");
    if (!auth.success) return null;
    return secureGet(CREDENTIAL_ID_KEY);
  },

  /** @deprecated Use clearCredential instead */
  async disable(): Promise<void> {
    return this.clearCredential();
  },
};
