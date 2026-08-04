/**
 * OtpService — Client-side OTP simulation + TOTP helpers.
 * In production these would be backed by server calls.
 * Includes: Email OTP, SMS OTP, TOTP (RFC 6238) backup codes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const OTP_TTL_MS    = 10 * 60 * 1000; // 10 minutes
const TOTP_STEP_SEC = 30;              // RFC 6238 step

interface OtpRecord {
  code: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
}

const OTP_KEY_PREFIX  = "auth_otp_";
const TOTP_SECRET_KEY = "auth_totp_secret";
const BACKUP_KEY      = "auth_backup_codes";

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateNumericOtp(digits = 6): string {
  let code = "";
  for (let i = 0; i < digits; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

function generateBase32Secret(): string {
  const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  for (let i = 0; i < 32; i++) out += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  return out;
}

// ─── OtpService ────────────────────────────────────────────────────────────────
export const OtpService = {
  // ── Email / SMS OTP ─────────────────────────────────────────────────────────
  async createOtp(purpose: string): Promise<string> {
    const code = generateNumericOtp(6);
    const record: OtpRecord = {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      maxAttempts: 3,
    };
    await AsyncStorage.setItem(`${OTP_KEY_PREFIX}${purpose}`, JSON.stringify(record));
    return code;
  },

  async verifyOtp(purpose: string, inputCode: string): Promise<{ valid: boolean; error?: string }> {
    const raw = await AsyncStorage.getItem(`${OTP_KEY_PREFIX}${purpose}`);
    if (!raw) return { valid: false, error: "OTP expired or not found. Please request a new one." };
    const record: OtpRecord = JSON.parse(raw);

    if (Date.now() > record.expiresAt) {
      await AsyncStorage.removeItem(`${OTP_KEY_PREFIX}${purpose}`);
      return { valid: false, error: "OTP has expired. Please request a new one." };
    }

    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      await AsyncStorage.removeItem(`${OTP_KEY_PREFIX}${purpose}`);
      return { valid: false, error: "Too many incorrect attempts. Please request a new OTP." };
    }

    if (inputCode.trim() !== record.code) {
      await AsyncStorage.setItem(`${OTP_KEY_PREFIX}${purpose}`, JSON.stringify(record));
      return { valid: false, error: `Incorrect code. ${record.maxAttempts - record.attempts} attempt${record.maxAttempts - record.attempts !== 1 ? "s" : ""} remaining.` };
    }

    await AsyncStorage.removeItem(`${OTP_KEY_PREFIX}${purpose}`);
    return { valid: true };
  },

  getOtpTtlSecs(): number {
    return OTP_TTL_MS / 1000;
  },

  // ── TOTP (RFC 6238 simulation) ───────────────────────────────────────────────
  async setupTotp(userId: string): Promise<{ secret: string; qrUri: string; backupCodes: string[] }> {
    const secret = generateBase32Secret();
    await AsyncStorage.setItem(`${TOTP_SECRET_KEY}_${userId}`, secret);
    const issuer = encodeURIComponent("CareerAssistant");
    const email  = encodeURIComponent(userId);
    const qrUri  = `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
    const backupCodes = await this.generateBackupCodes(userId);
    return { secret, qrUri, backupCodes };
  },

  async generateBackupCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () => {
      const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
      return `${seg()}-${seg()}`;
    });
    await AsyncStorage.setItem(`${BACKUP_KEY}_${userId}`, JSON.stringify(codes));
    return codes;
  },

  async verifyBackupCode(userId: string, input: string): Promise<boolean> {
    const raw = await AsyncStorage.getItem(`${BACKUP_KEY}_${userId}`);
    if (!raw) return false;
    const codes: string[] = JSON.parse(raw);
    const normalised = input.trim().toUpperCase();
    const idx = codes.indexOf(normalised);
    if (idx < 0) return false;
    // Consume the code
    codes.splice(idx, 1);
    await AsyncStorage.setItem(`${BACKUP_KEY}_${userId}`, JSON.stringify(codes));
    return true;
  },

  async getRemainingBackupCodes(userId: string): Promise<number> {
    const raw = await AsyncStorage.getItem(`${BACKUP_KEY}_${userId}`);
    if (!raw) return 0;
    return (JSON.parse(raw) as string[]).length;
  },

  /**
   * Simulate TOTP verification — in production this is done server-side.
   * For demo: accepts any 6-digit code.
   */
  async verifyTotp(_userId: string, code: string): Promise<boolean> {
    // Client-side demo: accept any well-formed 6-digit TOTP code
    return /^\d{6}$/.test(code.trim());
  },

  getTotpStepRemainingSecs(): number {
    return TOTP_STEP_SEC - (Math.floor(Date.now() / 1000) % TOTP_STEP_SEC);
  },
};
