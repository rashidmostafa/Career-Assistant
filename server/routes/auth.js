/**
 * Auth routes — /api/auth/*
 * Includes: register, email/phone OTP, login, 2FA, refresh, logout,
 *           reauth, recovery, reset-password, Google/LinkedIn OAuth,
 *           and biometric register/verify/disable.
 */
const express     = require("express");
const passport    = require("passport");
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

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth2
// ─────────────────────────────────────────────────────────────────────────────

// Step 1: Redirect the browser to Google's consent screen.
router.get("/google",
  passport.authenticate("google", { session: true, scope: ["openid", "profile", "email"] })
);

// Step 2: Google redirects back here with an authorisation code.
router.get("/google/callback",
  passport.authenticate("google", { session: true, failureRedirect: "/api/auth/oauth/error" }),
  async (req, res) => {
    try {
      const { accessToken, refreshToken, expiresAt } = await AuthService.issueSocialSession(req.user, req);
      const appDeepLink = process.env.APP_DEEP_LINK ?? "career-assistant://";
      // Redirect back to the mobile app with tokens embedded in the deep link.
      res.redirect(
        `${appDeepLink}oauth/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&expiresAt=${expiresAt}`
      );
    } catch (e) {
      console.error("[OAuth/Google] Session issue error:", e);
      res.redirect(`${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/error`);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn OAuth2
// ─────────────────────────────────────────────────────────────────────────────

// Step 1: Redirect to LinkedIn.
router.get("/linkedin",
  passport.authenticate("linkedin", { session: true })
);

// Step 2: LinkedIn redirects back here.
router.get("/linkedin/callback",
  passport.authenticate("linkedin", { session: true, failureRedirect: "/api/auth/oauth/error" }),
  async (req, res) => {
    try {
      const { accessToken, refreshToken, expiresAt } = await AuthService.issueSocialSession(req.user, req);
      const appDeepLink = process.env.APP_DEEP_LINK ?? "career-assistant://";
      res.redirect(
        `${appDeepLink}oauth/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&expiresAt=${expiresAt}`
      );
    } catch (e) {
      console.error("[OAuth/LinkedIn] Session issue error:", e);
      res.redirect(`${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/error`);
    }
  }
);

// OAuth error fallback (shown if browser deep-link fails)
router.get("/oauth/error", (_req, res) => {
  res.status(400).json({ message: "Social sign-in failed. Please try again." });
});

// ─────────────────────────────────────────────────────────────────────────────
// Biometric
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/biometric/register
 * Body: { credentialIdHash: string }
 * Authenticated — links a device biometric credential to the account.
 */
router.post("/biometric/register", authenticate, async (req, res) => {
  try {
    const result = await AuthService.registerBiometric(req.userId, req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

/**
 * POST /api/auth/biometric/verify
 * Body: { userId: string, credentialIdHash: string }
 * Public — verifies a biometric credential and issues tokens.
 */
router.post("/biometric/verify", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.verifyBiometric(req.body, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

/**
 * POST /api/auth/biometric/disable
 * Authenticated — removes the stored biometric credential hash.
 */
router.post("/biometric/disable", authenticate, async (req, res) => {
  try {
    const result = await AuthService.disableBiometric(req.userId, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

module.exports = router;
