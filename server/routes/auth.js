/**
 * Auth routes — /api/auth/*
 */
const express     = require("express");
const router      = express.Router();
const AuthService = require("../services/authService");
const { authenticate } = require("../middleware/authMiddleware");
const { authLimiter, recoveryLimiter } = require("../middleware/rateLimiter");

// ── Register ──────────────────────────────────────────────────────────────────
router.post("/register", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.register(req.body, req);
    res.status(201).json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Verify email OTP ──────────────────────────────────────────────────────────
router.post("/verify-email", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.verifyEmail(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Send phone OTP ────────────────────────────────────────────────────────────
router.post("/send-phone-otp", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.sendPhoneOtp(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Verify phone OTP ──────────────────────────────────────────────────────────
router.post("/verify-phone", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.verifyPhone(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/login", authLimiter, async (req, res) => {
  try {
    const deviceId = req.headers["x-device-id"] ?? "unknown";
    const result = await AuthService.login({ ...req.body, deviceId }, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message, code: e.code });
  }
});

// ── 2FA verify ────────────────────────────────────────────────────────────────
router.post("/2fa/verify", authLimiter, async (req, res) => {
  try {
    const deviceId = req.headers["x-device-id"] ?? "unknown";
    const result = await AuthService.verify2FA({ ...req.body, deviceId }, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── 2FA resend ────────────────────────────────────────────────────────────────
router.post("/2fa/resend", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.resend2faCode(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── 2FA setup (TOTP) ──────────────────────────────────────────────────────────
router.post("/2fa/setup", authenticate, async (req, res) => {
  try {
    const result = await AuthService.setupTotp(req.userId);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── 2FA disable ───────────────────────────────────────────────────────────────
router.post("/2fa/disable", authenticate, async (req, res) => {
  try {
    const result = await AuthService.disable2FA({ userId: req.userId, code: req.body.code }, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Token refresh ─────────────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  try {
    const result = await AuthService.refreshTokens(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message, code: e.code });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", authenticate, async (req, res) => {
  try {
    await AuthService.logout({ refreshToken: req.body.refreshToken, userId: req.userId }, req);
    res.json({ message: "Logged out successfully." });
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Re-authentication ─────────────────────────────────────────────────────────
router.post("/reauth", authenticate, async (req, res) => {
  try {
    const result = await AuthService.reauthenticate({ ...req.body, userId: req.userId }, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Account recovery ──────────────────────────────────────────────────────────
router.post("/recover", recoveryLimiter, async (req, res) => {
  try {
    const result = await AuthService.recoverAccount(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Verify recovery OTP ───────────────────────────────────────────────────────
router.post("/verify-recovery-otp", recoveryLimiter, async (req, res) => {
  try {
    const result = await AuthService.verifyRecoveryOtp(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

// ── Reset password ────────────────────────────────────────────────────────────
router.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.resetPassword(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

module.exports = router;
