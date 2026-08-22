/**
 * Auth routes — /api/auth/*
 * Includes: register, email OTP, login, 2FA, refresh, logout,
 *           reauth, recovery, reset-password, Google OAuth,
 *           and biometric register/verify/disable.
 *
 * OAuth deep-link handling:
 *   The client passes ?redirectUri=<url> when initiating OAuth.
 *   That URL travels in the signed OAuth `state` parameter so the callback can
 *   redirect back to whatever scheme the client supports:
 *     - Expo Go:       exp://192.168.x.x:PORT/--/oauth/callback
 *     - Standalone:    career-assistant://oauth/callback
 *     - Web fallback:  https://your-app.com/oauth/callback
 *   If no redirectUri is supplied the server falls back to APP_DEEP_LINK.
 */
const express     = require("express");
const passport    = require("passport");
const crypto      = require("crypto");
const jwt         = require("jsonwebtoken");
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

// ── Resend registration email OTP ─────────────────────────────────────────────
router.post("/resend-verification", authLimiter, async (req, res) => {
  try {
    const result = await AuthService.resendVerificationEmail(req.body, req);
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
    // userId is forwarded only for EMAIL_NOT_VERIFIED, where the client needs
    // it to resend the OTP. It is undefined for every other error and drops
    // out of the JSON, so this leaks nothing on a failed password attempt.
    res.status(e.status ?? 500).json({ message: e.message, code: e.code, userId: e.userId });
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

// ── 2FA setup (Email) ──────────────────────────────────────────────────────────
router.post("/2fa/setup-otp", authenticate, async (req, res) => {
  try {
    const result = await AuthService.setupOtp2FA(req.userId, req.body.method, req);
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
// ─────────────────────────────────────────────────────────────────────────────
// OAuth state
//
// The redirect URI used to live in req.session across the Google round trip,
// which required express-session and its in-memory store: a warning on every
// boot, in-flight sign-ins lost on restart, and no path to more than one
// instance. It now travels in the OAuth `state` parameter instead.
//
// `state` is attacker-visible and attacker-modifiable, so it is a signed JWT
// rather than a bare string — an unsigned redirect target here would hand the
// victim's tokens to whoever crafted the link. The signature proves this
// server issued it; the paired nonce cookie proves it was issued to *this*
// browser, which is the CSRF protection the session cookie used to provide.
// ─────────────────────────────────────────────────────────────────────────────
const OAUTH_STATE_TTL_SEC = 600;            // 10 minutes, as the session was
const OAUTH_NONCE_COOKIE  = "oauth_nonce";

function buildOAuthState(redirectUri) {
  const nonce = crypto.randomUUID();
  const state = jwt.sign(
    { redirectUri: redirectUri ?? null, nonce },
    process.env.JWT_SECRET || "change_me_in_production",
    { expiresIn: OAUTH_STATE_TTL_SEC, algorithm: "HS256" },
  );
  return { state, nonce };
}

function setNonceCookie(res, nonce) {
  res.cookie(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    // "lax" so the cookie is still sent on the top-level GET navigation back
    // from accounts.google.com. "strict" would drop it and break the flow.
    sameSite: "lax",
    maxAge:   OAUTH_STATE_TTL_SEC * 1000,
    path:     "/api/auth",
  });
}

/** Reads one cookie without pulling in cookie-parser for a single value. */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * Verifies the returned state and yields the redirect URI it carried.
 * Returns null whenever anything fails, so the caller falls back to the
 * default deep link rather than trusting an unverified destination.
 */
function redirectUriFromState(req) {
  const state = req.query.state;
  if (!state || typeof state !== "string") return null;

  let payload;
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET || "change_me_in_production");
  } catch (e) {
    console.warn("[OAuth] state rejected:", e.message);
    return null;
  }

  // Binds the callback to the browser that started the flow.
  const cookieNonce = readCookie(req, OAUTH_NONCE_COOKIE);
  if (!cookieNonce || cookieNonce !== payload.nonce) {
    console.warn("[OAuth] state nonce did not match the browser's cookie.");
    return null;
  }

  // Re-checked even though it was validated before signing: the allow-list can
  // change between issuing and returning, and this is the point where the
  // value is actually used to deliver tokens.
  if (!payload.redirectUri || !isAllowedRedirectUri(payload.redirectUri)) return null;
  return payload.redirectUri;
}

/** Minimal HTML escaping for values echoed back into the error page. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * A self-contained error page. OAuth failures surface inside a browser tab the
 * app opened, so an explanation there is the only thing the user can actually
 * see — the app itself has no way to render this.
 */
function oauthErrorPage(title, detail) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in failed</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;
       display:grid;place-items:center;min-height:100vh;background:#0f1115;color:#e6e8eb;padding:24px}
  .card{max-width:32rem;background:#181b21;border:1px solid #272b33;border-radius:12px;padding:28px}
  h1{font-size:1.15rem;margin:0 0 12px}
  p{margin:0;line-height:1.6;color:#a8b0ba;font-size:.94rem}
  code{background:#0f1115;padding:2px 6px;border-radius:4px;font-size:.85em;word-break:break-all;color:#d8dee6}
</style></head><body><div class="card">
<h1>${escapeHtml(title)}</h1><p>${detail}</p>
</div></body></html>`;
}

function isAllowedRedirectUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  // Expo Go: exp://192.168.x.x:8081/--/oauth/callback
  if (parsed.protocol === "exp:") return true;

  // Standalone / dev-client build: career-assistant://oauth/callback
  const appScheme = (process.env.APP_DEEP_LINK ?? "career-assistant://").split("://")[0];
  if (parsed.protocol === `${appScheme}:`) return true;

  // Web build: https://your-web-build/oauth/callback
  //
  // This list must stay strict. The callback appends the access and refresh
  // tokens to this URI as query parameters, so an unchecked value here is not
  // an open redirect but a full account takeover — an attacker who can choose
  // the destination receives the victim's session.
  //
  // WEB_ORIGINS is checked alongside ALLOWED_ORIGINS so the CORS list and the
  // OAuth-return list can differ; either one is enough.
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    const origins = [
      ...(process.env.ALLOWED_ORIGINS ?? "").split(","),
      ...(process.env.WEB_ORIGINS ?? "").split(","),
    ].map((o) => o.trim()).filter(Boolean);

    if (origins.includes(parsed.origin)) return true;

    // localhost is permitted in development only, so `expo start --web`
    // works without configuration while never being accepted in production.
    if (process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) {
      return true;
    }
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
  //
  // A rejected redirectUri used to be ignored silently: the flow continued,
  // the callback fell back to APP_DEEP_LINK, and a web browser was handed a
  // `career-assistant://` URL it could not open. The user saw a dead page
  // while the app polled for two minutes and then reported "Sign-in timed
  // out" — a configuration problem wearing the costume of a network problem.
  // Refuse up front instead, and say exactly what is wrong.
  if (req.query.redirectUri) {
    if (!isAllowedRedirectUri(req.query.redirectUri)) {
      console.warn(
        `[OAuth/Google] Rejected redirectUri "${req.query.redirectUri}". ` +
        `Allowed: exp://, ${(process.env.APP_DEEP_LINK ?? "career-assistant://").split("://")[0]}://, ` +
        `and origins in ALLOWED_ORIGINS/WEB_ORIGINS ` +
        `[${[...(process.env.ALLOWED_ORIGINS ?? "").split(","), ...(process.env.WEB_ORIGINS ?? "").split(",")].filter(Boolean).join(", ") || "none set"}].`
      );
      return res.status(400).type("html").send(oauthErrorPage(
        "This app build is not authorised to sign in with Google.",
        `The address it asked to return to (<code>${escapeHtml(req.query.redirectUri)}</code>) is not on the server's allow-list. ` +
        `If this is the web build, add its origin to <code>WEB_ORIGINS</code> on the server and try again.`
      ));
    }
  }

  const { state, nonce } = buildOAuthState(req.query.redirectUri);
  setNonceCookie(res, nonce);

  passport.authenticate("google", {
    session: false,
    scope: ["openid", "profile", "email"],
    // Passing `state` as a string makes passport-oauth2 forward it verbatim and
    // skip its own session-backed state store entirely (see NullStore) — the
    // verification above is ours.
    state,
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
  passport.authenticate("google", { session: false, failureRedirect: "/api/auth/oauth/error" }),
  async (req, res) => {
    try {
      const { accessToken, refreshToken, expiresAt } = await AuthService.issueSocialSession(req.user, req);

      // Prefer the redirect URI the client registered at step 1, recovered
      // from the signed state rather than from server-side session storage.
      const appDeepLink =
        redirectUriFromState(req) ??
        `${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/callback`;

      // One flow, one nonce.
      res.clearCookie(OAUTH_NONCE_COOKIE, { path: "/api/auth" });

      // Build the redirect URL; handle trailing slashes consistently.
      const separator = appDeepLink.includes("?") ? "&" : "?";
      const redirectUrl = `${appDeepLink}${separator}accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&expiresAt=${expiresAt}`;
      res.redirect(redirectUrl);
    } catch (e) {
      console.error("[OAuth/Google] Session issue error:", e);
      const fallback = redirectUriFromState(req) ?? `${process.env.APP_DEEP_LINK ?? "career-assistant://"}oauth/error`;
      res.clearCookie(OAUTH_NONCE_COOKIE, { path: "/api/auth" });
      res.redirect(fallback.includes("?") ? `${fallback}&error=auth_failed` : `${fallback}?error=auth_failed`);
    }
  }
);

// OAuth error fallback (shown if browser deep-link fails).
// This is rendered inside a real browser, so it returns a page a person can
// read rather than a JSON body they cannot act on.
router.get("/oauth/error", (_req, res) => {
  res.status(400).type("html").send(oauthErrorPage(
    "Sign-in failed",
    "Google sign-in could not be completed. Close this window and try again."
  ));
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
