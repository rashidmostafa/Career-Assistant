/**
 * Passport.js configuration — Google OAuth2.
 *
 * Upserts the User record: if a matching social account already exists the
 * user is returned; otherwise a new account is created with a random
 * placeholder password (they can never log in with it).
 *
 * Usage:
 *   const { initPassport } = require("./config/passport");
 *   initPassport(app);
 */
const passport     = require("passport");
const GoogleStrategy  = require("passport-google-oauth20").Strategy;
const crypto       = require("crypto");
const bcrypt       = require("bcryptjs");
const User         = require("../models/User");

// ── Helper: find-or-create social user ───────────────────────────────────────
async function upsertSocialUser({ provider, providerId, email, name, avatarUrl }) {
  // 1. Try to find by provider + providerId
  let user = await User.findOne({ provider, providerId });
  if (user) return user;

  // 2. Try to find an existing email account and link it
  user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    user.provider   = provider;
    user.providerId = providerId;
    if (avatarUrl && !user.photoUri) user.photoUri = avatarUrl;
    await user.save();
    return user;
  }

  // 3. Create a new account (no usable password)
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash: placeholderHash, // not usable for login
    emailVerified: true,           // social accounts are pre-verified
    provider,
    providerId,
    photoUri:     avatarUrl ?? undefined,
    consentGiven: true,
    consentAt:    new Date(),
  });
  return user;
}

// ── Google Strategy ───────────────────────────────────────────────────────────
function buildGoogleStrategy() {
  // Render injects RENDER_EXTERNAL_URL (e.g. https://foo.onrender.com) automatically.
  // Preferring it as a fallback means the OAuth callback stays correct even if
  // SERVER_BASE_URL is unset or stale after a redeploy. This URL must match the
  // "Authorised redirect URI" registered in the Google Cloud Console exactly.
  const baseUrl = process.env.SERVER_BASE_URL || process.env.RENDER_EXTERNAL_URL || "";
  const callbackURL = `${baseUrl}/api/auth/google/callback`;
  return new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL,
      scope: ["openid", "profile", "email"],
      // The verify callback needs only the Google profile; there is no session
      // or request state to consult.
      passReqToCallback: false,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email     = profile.emails?.[0]?.value;
        const avatarUrl = profile.photos?.[0]?.value;
        if (!email) return done(new Error("Google account has no email."));
        const user = await upsertSocialUser({
          provider:   "google",
          providerId: profile.id,
          email,
          name: profile.displayName ?? email.split("@")[0],
          avatarUrl,
        });
        done(null, user);
      } catch (e) {
        done(e);
      }
    }
  );
}

// No serializeUser/deserializeUser: nothing is stored in a session. Passport
// is used purely to run the Google verify callback, and the resulting user is
// read from req.user within that same request.

// ── Export ────────────────────────────────────────────────────────────────────
function initPassport(app) {
  // Deliberately no express-session.
  //
  // The only thing a session ever held was `oauthRedirectUri`, for the ten
  // minutes between the redirect to Google and the callback. That single
  // string is now carried in the OAuth `state` parameter — signed with
  // JWT_SECRET and bound to a short-lived nonce cookie — so there is no
  // server-side session state at all.
  //
  // Removing it fixes three things at once: the "MemoryStore is not designed
  // for a production environment" warning on every boot, the loss of in-flight
  // sign-ins whenever the instance restarts, and the fact that sessions in
  // process memory would not survive running more than one instance.
  const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (hasGoogleConfig) {
    passport.use(buildGoogleStrategy());
  } else {
    console.warn("[Passport] Google OAuth not configured; skipping Google strategy.");
  }

  app.use(passport.initialize());
}

module.exports = { initPassport, upsertSocialUser };
