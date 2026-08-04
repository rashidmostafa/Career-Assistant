/**
 * Rate limiting middleware using an in-process LRU store.
 * Production: swap windowMs/max with express-rate-limit + Redis.
 *
 * Limits:
 *  - Auth endpoints: 10 requests / hour per IP
 *  - Recovery:  3 attempts / day per IP
 *  - General:   100 requests / hour per IP
 */
const { rateLimit } = require("express-rate-limit");

function makeStore() {
  // Minimal in-memory store (express-rate-limit compatible)
  const hits = new Map();
  return {
    increment: (key) => {
      const now = Date.now();
      const record = hits.get(key) ?? { count: 0, resetTime: now };
      record.count += 1;
      hits.set(key, record);
      return { totalHits: record.count, resetTime: new Date(record.resetTime) };
    },
    decrement: (key) => {
      const record = hits.get(key);
      if (record && record.count > 0) record.count -= 1;
    },
    resetKey: (key) => hits.delete(key),
    resetAll: () => hits.clear(),
  };
}

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { message: "Too many authentication attempts. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  skip: (req) => process.env.NODE_ENV === "test",
});

const recoveryLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3,
  message: { message: "Too many recovery attempts. Please try again tomorrow." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `recovery_${req.ip ?? "unknown"}`,
  skip: (req) => process.env.NODE_ENV === "test",
});

const generalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === "test",
});

// IP blocking (in-memory; production: use Redis SET with TTL)
const blockedIPs = new Set();
const blockExpiry = new Map();

function blockIP(ip, durationMs = 60 * 60 * 1000) {
  blockedIPs.add(ip);
  blockExpiry.set(ip, Date.now() + durationMs);
}

function ipBlockMiddleware(req, res, next) {
  const ip = req.ip ?? "unknown";
  if (blockedIPs.has(ip)) {
    const expiry = blockExpiry.get(ip);
    if (expiry && Date.now() > expiry) {
      blockedIPs.delete(ip);
      blockExpiry.delete(ip);
    } else {
      return res.status(429).json({ message: "Your IP has been temporarily blocked due to suspicious activity." });
    }
  }
  next();
}

module.exports = { authLimiter, recoveryLimiter, generalLimiter, ipBlockMiddleware, blockIP };
