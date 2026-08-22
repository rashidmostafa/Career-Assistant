/**
 * Rate limiting middleware — counters and IP blocks persisted in MongoDB.
 *
 * These used to live in process memory (express-rate-limit's default
 * MemoryStore, and a plain Set for blocked IPs), which meant every deploy and
 * every free-tier spin-down handed all clients a fresh budget and emptied the
 * blocklist. See models/RateLimit.js.
 *
 * Limits (keyed by device ID when available, IP as fallback — see
 * rateLimitKey() below):
 *  - Auth endpoints: 20 requests / hour
 *  - Recovery:  3 attempts / day
 *  - General:   100 requests / hour
 *  - AI proxy:  60 requests / hour
 */
const { rateLimit } = require("express-rate-limit");
const RateLimit = require("../models/RateLimit");
const { MongoRateLimitStore } = require("./mongoRateLimitStore");

// Mobile carriers commonly rotate the client's visible public IP mid-session
// (CGNAT) — keying purely on req.ip let a single device silently get a fresh
// budget every time its IP changed. The app already sends a stable
// X-Device-Id header (generated once and persisted in SecureStore) on every
// request, so prefer that; fall back to IP only for clients that never send
// one (e.g. a raw script hitting the API directly).
function rateLimitKey(req, prefix = "") {
  const deviceId = req.headers["x-device-id"];
  const key = deviceId ? `device_${deviceId}` : (req.ip ?? "unknown");
  return prefix ? `${prefix}_${key}` : key;
}

const authLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: "auth" }),
  windowMs: 60 * 60 * 1000, // 1 hour
  // 20, not 10. This budget is pooled across register, login, verify-email,
  // resend-verification, 2fa/verify, 2fa/resend, reset-password and
  // biometric/verify — a single signup walkthrough spends four of them, so 10
  // ran out after two or three honest passes through the flow and showed a
  // legitimate user "Too many authentication attempts" for the rest of the
  // hour. Account lockout (5 failed logins, User.incrementLoginAttempts) is
  // the control that actually stops password guessing; this limiter only
  // needs to blunt automated volume.
  max: 20,
  message: { message: "Too many authentication attempts. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateLimitKey(req),
  skip: (req) => process.env.NODE_ENV === "test",
});

const recoveryLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: "recovery" }),
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3,
  message: { message: "Too many recovery attempts. Please try again tomorrow." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateLimitKey(req, "recovery"),
  skip: (req) => process.env.NODE_ENV === "test",
});

const generalLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: "general" }),
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateLimitKey(req),
  skip: (req) => process.env.NODE_ENV === "test",
});

// AI proxy calls are far more expensive than a login, and they are also the
// only endpoints a normal session hits repeatedly. Pooling them into
// generalLimiter (100/hour, shared with every other /api route) meant a user
// working through a CV analysis plus a roadmap regeneration could exhaust the
// budget that /api/auth/refresh needs to keep them signed in. Separate bucket.
const aiLimiter = rateLimit({
  store: new MongoRateLimitStore({ prefix: "ai" }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  message: { message: "Too many AI requests. Please try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateLimitKey(req, "ai"),
  skip: (req) => process.env.NODE_ENV === "test",
});

// ── IP blocking ──────────────────────────────────────────────────────────────
// Blocks are stored in MongoDB so they survive restarts, but the middleware
// reads from an in-process cache: this runs on every request, and a database
// round trip per request to answer "is this IP blocked?" would cost more than
// the protection is worth. The cache is loaded at boot and refreshed on an
// interval, so a block placed by another instance takes effect within one
// refresh rather than instantly — an acceptable trade for a control that
// exists to blunt sustained abuse, not to win a race.
const BLOCK_PREFIX       = "block";
const BLOCK_REFRESH_MS   = 30_000;
const blockedIPs = new Set();

async function refreshBlockedIPs() {
  try {
    const docs = await RateLimit.find({
      key: new RegExp(`^${BLOCK_PREFIX}:`),
      resetAt: { $gt: new Date() },
    }).select("key").lean();

    blockedIPs.clear();
    for (const d of docs) blockedIPs.add(d.key.slice(BLOCK_PREFIX.length + 1));
  } catch (e) {
    // Keep serving with the cache we have rather than failing open on a blip.
    console.warn("[RateLimit] Could not refresh IP blocklist:", e.message);
  }
}

function startBlocklistSync() {
  refreshBlockedIPs();
  const timer = setInterval(refreshBlockedIPs, BLOCK_REFRESH_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

async function blockIP(ip, durationMs = 60 * 60 * 1000) {
  blockedIPs.add(ip);   // effective immediately on this instance
  try {
    await RateLimit.findOneAndUpdate(
      { key: `${BLOCK_PREFIX}:${ip}` },
      { $set: { resetAt: new Date(Date.now() + durationMs) }, $setOnInsert: { hits: 0 } },
      { upsert: true },
    );
  } catch (e) {
    console.error("[RateLimit] Failed to persist IP block:", e.message);
  }
}

function ipBlockMiddleware(req, res, next) {
  const ip = req.ip ?? "unknown";
  if (blockedIPs.has(ip)) {
    return res.status(429).json({ message: "Your IP has been temporarily blocked due to suspicious activity." });
  }
  next();
}

module.exports = { authLimiter, recoveryLimiter, generalLimiter, aiLimiter, ipBlockMiddleware, blockIP, startBlocklistSync };
