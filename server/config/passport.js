/**
 * Passport.js configuration — Google OAuth2 + LinkedIn OAuth2.
 *
 * Both strategies upsert the User record: if a matching social account
 * already exists the user is returned; otherwise a new account is created
 * with a random placeholder password (they can never log in with it).
 *
 * Usage:
 *   const { initPassport } = require("./config/passport");
 *   initPassport(app);
 */
const passport     = require("passport");
const GoogleStrategy  = require("passport-google-oauth20").Strategy;
const LinkedInStrategy = require("passport-linkedin-oauth2").Strategy;
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
  const callbackURL = `${process.env.SERVER_BASE_URL}/api/auth/google/callback`;
  return new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL,
      scope: ["openid", "profile", "email"],
      // Pass the request object so we can read session data in the verify callback
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

// ── LinkedIn Strategy ─────────────────────────────────────────────────────────
function buildLinkedInStrategy() {
  const callbackURL = `${process.env.SERVER_BASE_URL}/api/auth/linkedin/callback`;
  return new LinkedInStrategy(
    {
      clientID:     process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      callbackURL,
      scope: ["openid", "profile", "email"],
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email     = profile.emails?.[0]?.value;
        const avatarUrl = profile.photos?.[0]?.value;
        if (!email) return done(new Error("LinkedIn account has no email."));
        const user = await upsertSocialUser({
          provider:   "linkedin",
          providerId: profile.id,
          email,
          name: profile.displayName ?? email.split("@")[0],
          avatarUrl,
        });
        // FIX: was incorrectly passing `done` instead of `user`
        done(null, user);
      } catch (e) {
        done(e);
      }
    }
  );
}

// ── Passport session serialisation (minimal — we use JWT, not sessions) ───────
passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (e) {
    done(e);
  }
});

// ── Export ────────────────────────────────────────────────────────────────────
function initPassport(app) {
  // express-session must be wired before passport
  const session = require("express-session");
  app.use(session({
    secret:            process.env.SESSION_SECRET || "dev-session-secret-change-me",
    resave:            false,
    saveUninitialized: false,
    cookie: {
      secure:   process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge:   10 * 60 * 1000, // 10 min — only needed for the OAuth round-trip
    },
  }));

  const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hasLinkedInConfig = Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);

  if (hasGoogleConfig) {
    passport.use(buildGoogleStrategy());
  } else {
    console.warn("[Passport] Google OAuth not configured; skipping Google strategy.");
  }

  if (hasLinkedInConfig) {
    passport.use(buildLinkedInStrategy());
  } else {
    console.warn("[Passport] LinkedIn OAuth not configured; skipping LinkedIn strategy.");
  }

  app.use(passport.initialize());
  app.use(passport.session());
}

module.exports = { initPassport, upsertSocialUser };
