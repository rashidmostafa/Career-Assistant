/**
 * Auth routes — /api/auth/*
 * Includes: register, email/phone OTP, login, 2FA, refresh, logout,
 *           reauth, recovery, reset-password, Google/LinkedIn OAuth,
 *           and biometric register/verify/disable.
 *
 * OAuth deep-link fix for Expo Go:
 *   The client passes ?redirectUri=<url> when initiating OAuth.
 *   That URL is stored in the server session so the callback can
 *   redirect back to whatever scheme the client supports:
 *     - Expo Go:       exp://192.168.x.x:PORT/--/oauth/callback
 *     - Standalone:    career-assistant://oauth/callback
 *     - Web fallback:  https://your-app.com/oauth/callback
 *   If no redirectUri is supplied the server falls back to APP_DEEP_LINK.
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

/**
 * Whitelist for the client-supplied ?redirectUri= param, to prevent this
 * endpoint from being used as an open redirect. Only allow:
 *   - exp://...                    (Expo Go, any LAN IP/port)
 *   - <APP_DEEP_LINK scheme>://... (standalone build, e.g. career-assistant://)
 *   - https://<origin in ALLOWED_ORIGINS>/... (web fallback)
 */
function isAllowedRedirectUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.protocol === "exp:") return true;

  const appScheme = (process.env.APP_DEEP_LINK ?? "career-assistant://").split("://")[0];
  if (parsed.protocol === `${appScheme}:`) return true;

  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
    if (allowedOrigins.includes(parsed.origin)) return true;
  }

  return false;
}

/**
 * Step 1 — Redirect the browser to Google's consent screen.
 *
 * The client may pass ?redirectUri=<encoded-url> so the callback knows
 * where to send the tokens once the OAuth dance completes.  This is required
 * for Expo Go, which uses a dynamic exp:// scheme instead of a static custom
 * scheme.  The redirectUri is stored in the server-side session and consumed
 * inside the callback handler below.
 */
router.get("/google", (req, res, next) => {
  // Store the client's desired redirect URI in the session so the callback
  // can use it regardless of whether the OAuth provider preserves query params.
  // Rejects anything not matching the whitelist to prevent open-redirect abuse.
  if (req.query.redirectUri && isAllowedRedirectUri(req.query.redirectUri)) {
    req.session.oauthRedirectUri = req.query.redirectUri;
  }
  passport.authenticate("google", {
    session: true,
    scope: ["openid", "profile", "email"],
  })(req, res, next);
});

/**
 * Step 2 — Google redirects back here with an authorisation code.
 *
 * After verifying the user, we redirect to:
 *   1. The redirectUri stored in session  (Expo Go or custom dev scheme)
 *   2. APP_DEEP_LINK env variable         (production standalone build)
 *   3. Hardcoded fallback                 (career-assistant://)
 *
 * Tokens are passed as query parameters so the mobile app can extract them
 * from the incoming URL inside the deep-link handler.
 */
router.get("/google/callback",
  // keepSessionInfo: true — Passport regenerates the session on login (session-fixation
  // protection), which by default wipes req.session.oauthRedirectUri set in step 1.
  // This option carries the pre-login session data across the regenerate.
  passport.authenticate("google", { session: true, keepSessionInfo: true, failureRedirect: "/api/auth/oauth/error" }),
  async (req, res) => {
    try {
      const { accessToken, refreshToken, expiresAt } = await AuthService.issueSocialSession(req.user, req);

      // Prefer the per-request redirect URI the client registered at step 1.
      const appDeepLink =
        req.session.oauthRedirectUri ??
        `${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/callback`;

      // Clear it so it cannot be reused by a later OAuth flow.
      delete req.session.oauthRedirectUri;

      // Build the redirect URL; handle trailing slashes consistently.
      const separator = appDeepLink.includes("?") ? "&" : "?";
      const redirectUrl = `${appDeepLink}${separator}accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&expiresAt=${expiresAt}`;
      res.redirect(redirectUrl);
    } catch (e) {
      console.error("[OAuth/Google] Session issue error:", e);
      const fallback = req.session.oauthRedirectUri ?? `${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/error`;
      delete req.session.oauthRedirectUri;
      res.redirect(fallback.includes("?") ? `${fallback}&error=auth_failed` : `${fallback}?error=auth_failed`);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn OAuth2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step 1 — Redirect to LinkedIn.
 * Same redirectUri session-storage pattern as Google above.
 */
router.get("/linkedin", (req, res, next) => {
  if (req.query.redirectUri && isAllowedRedirectUri(req.query.redirectUri)) {
    req.session.oauthRedirectUri = req.query.redirectUri;
  }
  passport.authenticate("linkedin", { session: true })(req, res, next);
});

/**
 * Step 2 — LinkedIn redirects back here.
 */
router.get("/linkedin/callback",
  // See the keepSessionInfo comment on the Google callback above — same fix applies here.
  passport.authenticate("linkedin", { session: true, keepSessionInfo: true, failureRedirect: "/api/auth/oauth/error" }),
  async (req, res) => {
    try {
      const { accessToken, refreshToken, expiresAt } = await AuthService.issueSocialSession(req.user, req);

      const appDeepLink =
        req.session.oauthRedirectUri ??
        `${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/callback`;

      delete req.session.oauthRedirectUri;

      const separator = appDeepLink.includes("?") ? "&" : "?";
      const redirectUrl = `${appDeepLink}${separator}accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&expiresAt=${expiresAt}`;
      res.redirect(redirectUrl);
    } catch (e) {
      console.error("[OAuth/LinkedIn] Session issue error:", e);
      const fallback = req.session.oauthRedirectUri ?? `${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/error`;
      delete req.session.oauthRedirectUri;
      res.redirect(fallback.includes("?") ? `${fallback}&error=auth_failed` : `${fallback}?error=auth_failed`);
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
