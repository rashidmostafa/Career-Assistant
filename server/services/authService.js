/**
 * AuthService — business logic for authentication.
 *
 * Handles: register (email + phone OTP), login, 2FA verify, refresh, logout,
 *          re-auth, account recovery, risk scoring, audit logging, TOTP setup
 *          with QR code, email + SMS OTP dispatch, and session management.
 */
const crypto    = require("crypto");
const speakeasy = require("speakeasy");
const User      = require("../models/User");
const Session   = require("../models/Session");
const AuditLog  = require("../models/AuditLog");
const { issueAccessToken, issueRefreshToken, verifyRefreshToken } = require("../middleware/authMiddleware");
const { blockIP } = require("../middleware/rateLimiter");
const EmailService = require("./emailService");
const SmsService   = require("./smsService");

// ─── OTP store (use Redis in production) ─────────────────────────────────────
const otpStore = new Map();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeOtp(key, code, ttlMs = 10 * 60 * 1000) {
  otpStore.set(key, { code, expiresAt: Date.now() + ttlMs, attempts: 0 });
}

function verifyStoredOtp(key, input) {
  const entry = otpStore.get(key);
  if (!entry) return { valid: false, error: "OTP expired or not found." };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(key);
    return { valid: false, error: "OTP expired. Please request a new code." };
  }
  entry.attempts += 1;
  if (entry.attempts > 3) {
    otpStore.delete(key);
    return { valid: false, error: "Too many incorrect attempts. Please request a new code." };
  }
  if (input.trim() !== entry.code) {
    return { valid: false, error: `Incorrect code. ${3 - entry.attempts} attempt(s) remaining.` };
  }
  otpStore.delete(key);
  return { valid: true };
}

// ─── Recovery token store ─────────────────────────────────────────────────────
const recoveryStore = new Map();

function generateRecoveryToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ─── Audit helper ─────────────────────────────────────────────────────────────
async function audit(event, userId, req, metadata = {}, success = true) {
  try {
    await AuditLog.create({
      userId, event, success,
      ipAddress: req?.ip,
      deviceId:  req?.headers?.["x-device-id"],
      userAgent: req?.headers?.["user-agent"],
      metadata,
    });
  } catch (_) {}
}

// ─── Risk scoring ─────────────────────────────────────────────────────────────
function calcRiskScore({ isNewDevice, hourOfDay, recentFailures, inactiveDays }) {
  let score = 0;
  if (isNewDevice)         score += 30;
  if (hourOfDay < 5)       score += 10;
  score += Math.min(recentFailures * 10, 30);
  if (inactiveDays > 30)   score += 15;
  return Math.min(score, 100);
}

function riskLevel(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

// ─── Helper: generate TOTP QR code as data URI ───────────────────────────────
async function generateQrDataUri(otpauthUrl) {
  try {
    const QRCode = require("qrcode");
    return await QRCode.toDataURL(otpauthUrl, { width: 256, margin: 2 });
  } catch {
    return null; // qrcode module unavailable — caller can use secret instead
  }
}

// ─── AuthService ──────────────────────────────────────────────────────────────
const AuthService = {

  // ── Register ─────────────────────────────────────────────────────────────────
  async register({ name, email, password, phone, securityQuestions, consentGiven, pushToken }, req) {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      throw Object.assign(new Error("An account with this email already exists."), { status: 409 });
    }

    const user = await User.create({
      name:         name.trim(),
      email:        email.toLowerCase(),
      passwordHash: password, // hashed in pre-save hook
      phone,
      consentGiven: !!consentGiven,
      consentAt:    consentGiven ? new Date() : undefined,
    });

    // Email OTP
    const emailOtp = generateOtp();
    storeOtp(`email_verify_${user._id}`, emailOtp);
    await EmailService.sendOtp(user.email, emailOtp, "verification");
    console.log(`[DEV] Email OTP for ${email}: ${emailOtp}`);

    // Phone OTP (optional)
    if (phone) {
      const phoneOtp = generateOtp();
      storeOtp(`phone_verify_${user._id}`, phoneOtp);
      await SmsService.sendOtp(phone, phoneOtp, "verification");
      console.log(`[DEV] Phone OTP for ${phone}: ${phoneOtp}`);
    }

    // Security questions (optional at registration)
    if (securityQuestions?.length >= 3) {
      const bcrypt = require("bcryptjs");
      user.securityQuestions = await Promise.all(
        securityQuestions.slice(0, 5).map(async (q) => ({
          question:   q.question,
          answerHash: await bcrypt.hash(q.answer.toLowerCase().trim(), 10),
        }))
      );
      user.securityQuestionsSet = true;
      await user.save();
    }

    // Store push token
    if (pushToken) {
      await User.findByIdAndUpdate(user._id, { pushToken });
    }

    await audit("register", user._id, req);
    return {
      message: "Account created. Check your email for the verification code.",
      userId: user._id.toString(),
    };
  },

  // ── Verify email OTP ──────────────────────────────────────────────────────────
  async verifyEmail({ userId, otp }, req) {
    const result = verifyStoredOtp(`email_verify_${userId}`, otp);
    if (!result.valid) {
      throw Object.assign(new Error(result.error), { status: 400 });
    }
    const user = await User.findByIdAndUpdate(userId, { emailVerified: true }, { new: true });
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    await audit("email_verified", userId, req);
    return { message: "Email verified successfully." };
  },

  // ── Send phone OTP ────────────────────────────────────────────────────────────
  async sendPhoneOtp({ userId, phone }, req) {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    const otp = generateOtp();
    storeOtp(`phone_verify_${userId}`, otp);
    await SmsService.sendOtp(phone, otp, "verification");
    console.log(`[DEV] Phone OTP for ${phone}: ${otp}`);
    await audit("phone_otp_sent", userId, req);
    return { message: "Verification code sent to your phone." };
  },

  // ── Verify phone OTP ──────────────────────────────────────────────────────────
  async verifyPhone({ userId, otp }, req) {
    const result = verifyStoredOtp(`phone_verify_${userId}`, otp);
    if (!result.valid) throw Object.assign(new Error(result.error), { status: 400 });
    const user = await User.findByIdAndUpdate(userId, { phoneVerified: true }, { new: true });
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    await audit("phone_verified", userId, req);
    return { message: "Phone number verified successfully." };
  },

  // ── Login ─────────────────────────────────────────────────────────────────────
  async login({ email, password, deviceId }, req) {
    const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash +totpSecret +backupCodes");
    if (!user) {
      throw Object.assign(new Error("Invalid email or password."), { status: 401 });
    }

    // Account lockout
    if (user.accountLocked) {
      const lockoutRemaining = user.lockoutUntil ? Math.ceil((user.lockoutUntil - Date.now()) / 60000) : 15;
      if (user.lockoutUntil && Date.now() > user.lockoutUntil) {
        await user.resetLoginAttempts();
      } else {
        await audit("login_failure", user._id, req, { reason: "account_locked" }, false);
        throw Object.assign(
          new Error(`Account is locked for ${lockoutRemaining} more minute(s). Too many failed login attempts.`),
          { status: 403 }
        );
      }
    }

    // Verify password
    const valid = await user.comparePassword(password);
    if (!valid) {
      await user.incrementLoginAttempts();
      const remaining = 5 - user.loginAttempts;
      await audit("login_failure", user._id, req, { reason: "wrong_password" }, false);

      if (user.accountLocked) {
        throw Object.assign(new Error("Account locked for 15 minutes after 5 failed attempts."), { status: 403 });
      }
      throw Object.assign(
        new Error(`Invalid email or password. ${remaining} attempt(s) remaining before lockout.`),
        { status: 401 }
      );
    }

    // Email verification check
    if (!user.emailVerified) {
      throw Object.assign(new Error("Please verify your email before signing in."), { status: 403, code: "EMAIL_NOT_VERIFIED" });
    }

    // Risk assessment
    const isNewDevice    = !user.knownDevices.includes(deviceId ?? "");
    const hourOfDay      = new Date().getHours();
    const inactiveDays   = user.lastLogin ? Math.floor((Date.now() - user.lastLogin) / 86400000) : 0;
    const recentFailures = user.loginAttempts;
    const riskScore      = calcRiskScore({ isNewDevice, hourOfDay, recentFailures, inactiveDays });
    const level          = riskLevel(riskScore);

    // Check device trust
    const isDeviceTrusted = user.isDeviceTrusted(deviceId);

    // 2FA required?
    if (user.twoFactorEnabled && !isDeviceTrusted) {
      // Send OTP code for SMS/email 2FA
      if (user.twoFactorMethod === "email") {
        const code = generateOtp();
        storeOtp(`2fa_${user._id}`, code);
        await EmailService.sendOtp(user.email, code, "2fa");
        console.log(`[DEV] 2FA email code for ${user.email}: ${code}`);
      } else if (user.twoFactorMethod === "sms" && user.phone) {
        const code = generateOtp();
        storeOtp(`2fa_${user._id}`, code);
        await SmsService.sendOtp(user.phone, code, "2fa");
        console.log(`[DEV] 2FA SMS code for ${user.phone}: ${code}`);
      }

      await audit("2fa_required", user._id, req, { riskScore, level });
      return {
        require2FA: true,
        userId:     user._id.toString(),
        method:     user.twoFactorMethod,
        riskScore,
        riskLevel:  level,
      };
    }

    // 2FA not required — check high-risk scenarios
    if (level === "CRITICAL" || level === "HIGH") {
      // For high-risk logins without 2FA enabled, require re-auth
      await audit("high_risk_login", user._id, req, { riskScore, level, isNewDevice });
    }

    // Issue session
    await user.resetLoginAttempts();
    if (isNewDevice && deviceId) {
      await User.findByIdAndUpdate(user._id, { $addToSet: { knownDevices: deviceId } });

      // Security alert for new device
      const PushService = require("./pushNotificationService");
      if (user.pushToken) {
        await PushService.sendSecurityAlert(
          user.pushToken,
          `New sign-in from an unrecognised device. If this wasn't you, change your password immediately.`
        );
      }
    }

    const tokens = await this._issueSession(user._id, deviceId ?? "unknown", req);
    await audit("login_success", user._id, req, { riskScore, level, isNewDevice });

    return {
      ...tokens,
      user: user.toSafeObject(),
      riskScore,
      riskLevel: level,
    };
  },

  // ── 2FA verify ───────────────────────────────────────────────────────────────
  async verify2FA({ userId, code, method, trustDevice, deviceId }, req) {
    const user = await User.findById(userId).select("+totpSecret +backupCodes");
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

    let verified = false;

    if (method === "totp") {
      verified = speakeasy.totp.verify({
        secret:   user.totpSecret,
        encoding: "base32",
        token:    code.replace(/\s/g, ""),
        window:   1,
      });
    } else if (method === "sms" || method === "email") {
      const result = verifyStoredOtp(`2fa_${userId}`, code);
      verified = result.valid;
      if (!result.valid) throw Object.assign(new Error(result.error), { status: 400 });
    } else if (method === "backup") {
      const norm = code.trim().toUpperCase();
      const idx  = (user.backupCodes ?? []).indexOf(norm);
      if (idx < 0) throw Object.assign(new Error("Invalid backup code."), { status: 400 });
      user.backupCodes.splice(idx, 1);
      await user.save();
      verified = true;
    }

    if (!verified) throw Object.assign(new Error("Invalid or expired 2FA code."), { status: 400 });

    // Device trust
    if (trustDevice && deviceId) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await User.findByIdAndUpdate(userId, {
        $push: { trustedDevices: { deviceId, expiresAt } },
        $addToSet: { knownDevices: deviceId },
      });
    }

    const tokens = await this._issueSession(userId, deviceId ?? "unknown", req);
    await audit("2fa_verified", userId, req, { method });

    return { ...tokens, user: user.toSafeObject() };
  },

  // ── Resend 2FA code ───────────────────────────────────────────────────────────
  async resend2faCode({ userId, method }, req) {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    const code = generateOtp();
    storeOtp(`2fa_${userId}`, code);
    if (method === "email") {
      await EmailService.sendOtp(user.email, code, "2fa");
      console.log(`[DEV] Resent 2FA email code for ${user.email}: ${code}`);
    } else if (method === "sms" && user.phone) {
      await SmsService.sendOtp(user.phone, code, "2fa");
      console.log(`[DEV] Resent 2FA SMS code for ${user.phone}: ${code}`);
    }
    await audit("2fa_code_resent", userId, req, { method });
    return { message: "Verification code sent." };
  },

  // ── TOTP setup ────────────────────────────────────────────────────────────────
  async setupTotp(userId) {
    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

    const secret = speakeasy.generateSecret({
      name:   `CareerAssistant:${user.email}`,
      issuer: "CareerAssistant",
    });

    const backupCodes = Array.from({ length: 10 }, () => {
      const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
      return `${seg()}-${seg()}`;
    });

    // Generate QR code data URI
    const qrDataUri = await generateQrDataUri(secret.otpauth_url);

    await User.findByIdAndUpdate(userId, {
      twoFactorEnabled: true,
      twoFactorMethod:  "totp",
      totpSecret:       secret.base32,
      backupCodes,
    });

    return {
      qrUri:       secret.otpauth_url,   // otpauth:// URL for manual entry
      qrDataUri,                          // base64 PNG (null if qrcode module missing)
      secret:      secret.base32,         // manual key
      backupCodes,
    };
  },

  // ── Disable 2FA ───────────────────────────────────────────────────────────────
  async disable2FA({ userId, code }, req) {
    const user = await User.findById(userId).select("+totpSecret");
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    if (user.twoFactorEnabled && user.twoFactorMethod === "totp") {
      const ok = speakeasy.totp.verify({ secret: user.totpSecret, encoding: "base32", token: code, window: 1 });
      if (!ok) throw Object.assign(new Error("Invalid code."), { status: 400 });
    }
    await User.findByIdAndUpdate(userId, {
      twoFactorEnabled: false,
      twoFactorMethod:  "totp",
      totpSecret:       null,
      backupCodes:      [],
    });
    await audit("2fa_disabled", userId, req);
    return { message: "Two-factor authentication disabled." };
  },

  // ── Token refresh ─────────────────────────────────────────────────────────────
  async refreshTokens({ refreshToken }, req) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw Object.assign(new Error("Invalid or expired refresh token."), { status: 401, code: "REFRESH_EXPIRED" });
    }

    const session = await Session.findOne({ refreshToken, isRevoked: false });
    if (!session) throw Object.assign(new Error("Session not found or revoked."), { status: 401, code: "SESSION_REVOKED" });
    if (session.isExpired()) throw Object.assign(new Error("Session expired."), { status: 401, code: "SESSION_EXPIRED" });
    if (session.is8WeekExpired()) {
      await Session.updateOne({ _id: session._id }, { isRevoked: true });
      throw Object.assign(new Error("8-week session expired. Please sign in again."), { status: 401, code: "ROLLING_SESSION_EXPIRED" });
    }

    // Revoke old token and issue new pair (rotation)
    await Session.updateOne({ _id: session._id }, { isRevoked: true });

    const newAccess  = issueAccessToken(payload.sub, session.deviceId);
    const newRefresh = issueRefreshToken(payload.sub, session.deviceId);
    const expiresAt  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await Session.create({
      userId:           payload.sub,
      refreshToken:     newRefresh,
      deviceId:         session.deviceId,
      deviceInfo:       session.deviceInfo,
      ipAddress:        req?.ip,
      expiresAt,
      sessionStartedAt: session.sessionStartedAt, // preserve 8-week clock
      lastRefreshedAt:  new Date(),
    });

    return {
      accessToken:  newAccess,
      refreshToken: newRefresh,
      expiresAt:    expiresAt.getTime(),
    };
  },

  // ── Logout ────────────────────────────────────────────────────────────────────
  async logout({ refreshToken, userId }, req) {
    if (refreshToken) {
      await Session.updateOne({ refreshToken }, { isRevoked: true });
    } else {
      // Revoke all sessions for user
      await Session.updateMany({ userId, isRevoked: false }, { isRevoked: true });
    }
    await audit("logout", userId, req);
    return { message: "Logged out successfully." };
  },

  // ── Re-authentication ─────────────────────────────────────────────────────────
  async reauthenticate({ userId, method, password, answers, biometricToken }, req) {
    const user = await User.findById(userId).select("+passwordHash +securityQuestions");
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

    if (method === "password") {
      if (!password) throw Object.assign(new Error("Password required."), { status: 400 });
      const ok = await user.comparePassword(password);
      if (!ok) throw Object.assign(new Error("Incorrect password."), { status: 401 });
    } else if (method === "security_questions") {
      if (!answers?.length) throw Object.assign(new Error("Answers required."), { status: 400 });
      const bcrypt = require("bcryptjs");
      let correct = 0;
      for (const a of answers) {
        const stored = user.securityQuestions.find((q) => q.question === a.question);
        if (stored && await bcrypt.compare(a.answer.toLowerCase().trim(), stored.answerHash)) correct++;
      }
      if (correct < 3) throw Object.assign(new Error("Incorrect answers to security questions."), { status: 401 });
    } else if (method === "biometric") {
      if (!biometricToken) throw Object.assign(new Error("Biometric token required."), { status: 400 });
      // In production, verify against stored biometric token or FIDO assertion
      // For MVP we trust the client-side biometric result backed by SecureStore
    } else {
      throw Object.assign(new Error("Invalid re-auth method."), { status: 400 });
    }

    // Reset the rolling 8-week session clock
    await Session.updateMany(
      { userId, isRevoked: false },
      { sessionStartedAt: new Date(), lastRefreshedAt: new Date() }
    );

    const deviceId = req?.headers?.["x-device-id"] ?? "unknown";
    const tokens   = await this._issueSession(userId, deviceId, req, new Date());
    await audit("reauth", userId, req, { method });
    return tokens;
  },

  // ── Account recovery ──────────────────────────────────────────────────────────
  async recoverAccount({ method, email, phone, answers }, req) {
    let user;

    if (method === "email" || method === "security_questions") {
      user = await User.findOne({ email: email?.toLowerCase() }).select("+securityQuestions");
    } else if (method === "sms") {
      user = await User.findOne({ phone }).select("+securityQuestions");
    }

    if (!user) {
      // Return generic message to prevent enumeration
      return { message: "If an account exists, a recovery code has been sent." };
    }

    if (method === "email") {
      const otp = generateOtp();
      storeOtp(`recovery_${user._id}`, otp, 60 * 60 * 1000); // 1 hour
      await EmailService.sendOtp(user.email, otp, "recovery");
      console.log(`[DEV] Recovery OTP for ${user.email}: ${otp}`);
      return { message: "Recovery code sent to your email.", userId: user._id.toString() };
    }

    if (method === "sms") {
      const otp = generateOtp();
      storeOtp(`recovery_${user._id}`, otp, 60 * 60 * 1000);
      await SmsService.sendOtp(user.phone, otp, "recovery");
      console.log(`[DEV] Recovery SMS OTP for ${user.phone}: ${otp}`);
      return { message: "Recovery code sent to your phone.", userId: user._id.toString() };
    }

    if (method === "security_questions") {
      if (!answers?.length || !user.securityQuestionsSet) {
        throw Object.assign(new Error("Security questions not set up for this account."), { status: 400 });
      }
      const bcrypt = require("bcryptjs");
      let correct = 0;
      for (const a of answers) {
        const stored = user.securityQuestions.find((q) => q.question === a.question);
        if (stored && await bcrypt.compare(a.answer.toLowerCase().trim(), stored.answerHash)) correct++;
      }
      if (correct < 3) {
        await audit("recovery_failure", user._id, req, { method, correct }, false);
        const err = Object.assign(new Error("Incorrect answers."), { status: 401 });
        // IP block after repeated failures
        const failCount = (req._recoveryFailures = (req._recoveryFailures ?? 0) + 1);
        if (failCount >= 3 && req.ip) blockIP(req.ip);
        throw err;
      }
    }

    const recoveryToken = generateRecoveryToken();
    recoveryStore.set(recoveryToken, { userId: user._id.toString(), expiresAt: Date.now() + 60 * 60 * 1000 });
    await audit("recovery_initiated", user._id, req, { method });
    return { message: "Identity verified. Proceed to reset your password.", recoveryToken };
  },

  // ── Verify recovery OTP ───────────────────────────────────────────────────────
  async verifyRecoveryOtp({ userId, otp }, req) {
    const result = verifyStoredOtp(`recovery_${userId}`, otp);
    if (!result.valid) throw Object.assign(new Error(result.error), { status: 400 });
    const recoveryToken = generateRecoveryToken();
    recoveryStore.set(recoveryToken, { userId, expiresAt: Date.now() + 60 * 60 * 1000 });
    return { message: "OTP verified. Proceed to reset your password.", recoveryToken };
  },

  // ── Reset password ────────────────────────────────────────────────────────────
  async resetPassword({ recoveryToken, newPassword }, req) {
    const entry = recoveryStore.get(recoveryToken);
    if (!entry || Date.now() > entry.expiresAt) {
      throw Object.assign(new Error("Recovery token expired or invalid."), { status: 400 });
    }
    recoveryStore.delete(recoveryToken);

    const user = await User.findById(entry.userId).select("+passwordHash");
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

    user.passwordHash  = newPassword; // hashed in pre-save hook
    user.loginAttempts = 0;
    user.accountLocked = false;

    // Invalidate all sessions on password change
    await Session.updateMany({ userId: user._id, isRevoked: false }, { isRevoked: true });
    await user.save();
    await audit("password_reset", user._id, req);
    return { message: "Password updated successfully." };
  },

  // ── Security questions ────────────────────────────────────────────────────────
  async setSecurityQuestions(userId, questions, req) {
    if (!questions?.length || questions.length < 3) {
      throw Object.assign(new Error("At least 3 security questions are required."), { status: 400 });
    }
    const bcrypt = require("bcryptjs");
    const hashed = await Promise.all(
      questions.slice(0, 5).map(async (q) => ({
        question:   q.question,
        answerHash: await bcrypt.hash(q.answer.toLowerCase().trim(), 10),
      }))
    );
    await User.findByIdAndUpdate(userId, {
      securityQuestions: hashed,
      securityQuestionsSet: true,
    });
    await audit("security_questions_set", userId, req);
    return { message: "Security questions saved." };
  },

  // ── Social auth: issue session after OAuth callback ──────────────────────────
  async issueSocialSession(user, req) {
    if (!user) throw Object.assign(new Error("OAuth authentication failed."), { status: 401 });
    const deviceId = req?.headers?.["x-device-id"] ?? "social-oauth";
    await user.resetLoginAttempts?.();
    await audit("social_login", user._id, req, { provider: user.provider });
    return this._issueSession(user._id, deviceId, req);
  },

  // ── Biometric: register a credential hash ─────────────────────────────────
  async registerBiometric(userId, { credentialIdHash }, req) {
    if (!credentialIdHash || typeof credentialIdHash !== "string") {
      throw Object.assign(new Error("credentialIdHash is required."), { status: 400 });
    }
    const hash = this.hashBiometricToken(credentialIdHash);
    await User.findByIdAndUpdate(userId, {
      biometricTokenHash:    hash,
      biometricEnabled:      true,
      biometricRegisteredAt: new Date(),
    });
    await audit("biometric_register", userId, req);
    return { message: "Biometric credential registered." };
  },

  // ── Biometric: verify a credential and issue tokens ──────────────────────
  async verifyBiometric({ userId, credentialIdHash }, req) {
    if (!userId || !credentialIdHash) {
      throw Object.assign(new Error("userId and credentialIdHash are required."), { status: 400 });
    }
    const user = await User.findById(userId).select("+biometricTokenHash");
    if (!user || !user.biometricEnabled || !user.biometricTokenHash) {
      throw Object.assign(new Error("Biometric login not enrolled for this account."), { status: 401 });
    }
    if (user.accountLocked) {
      throw Object.assign(new Error("Account is locked. Please use password login."), { status: 403 });
    }

    const incomingHash  = Buffer.from(this.hashBiometricToken(credentialIdHash), "hex");
    const storedHash    = Buffer.from(user.biometricTokenHash, "hex");
    const match =
      incomingHash.length === storedHash.length &&
      crypto.timingSafeEqual(incomingHash, storedHash);

    if (!match) {
      await user.incrementLoginAttempts();
      await audit("biometric_fail", userId, req, {}, false);
      throw Object.assign(new Error("Biometric verification failed."), { status: 401 });
    }

    await user.resetLoginAttempts();
    await audit("biometric_login", userId, req);
    const deviceId = req?.headers?.["x-device-id"] ?? "biometric";
    const tokens   = await this._issueSession(user._id, deviceId, req);
    return { ...tokens, user: user.toSafeObject() };
  },

  // ── Biometric: disable ────────────────────────────────────────────────────
  async disableBiometric(userId, req) {
    await User.findByIdAndUpdate(userId, {
      biometricTokenHash:    undefined,
      biometricEnabled:      false,
      biometricRegisteredAt: undefined,
    });
    await audit("biometric_disable", userId, req);
    return { message: "Biometric login disabled." };
  },

  // ── Helper: SHA-256 hash of a biometric credential ID ────────────────────
  hashBiometricToken(raw) {
    return crypto.createHash("sha256").update(raw).digest("hex");
  },

  // ── Internal helpers ──────────────────────────────────────────────────────────
  async _issueSession(userId, deviceId, req, sessionStartedAt) {
    const accessToken  = issueAccessToken(userId, deviceId);
    const refreshToken = issueRefreshToken(userId, deviceId);
    const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await Session.create({
      userId,
      refreshToken,
      deviceId,
      deviceInfo:       req?.headers?.["user-agent"],
      ipAddress:        req?.ip,
      expiresAt,
      sessionStartedAt: sessionStartedAt ?? new Date(),
      lastRefreshedAt:  new Date(),
    });

    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt.getTime(),
    };
  },
};

module.exports = AuthService;
