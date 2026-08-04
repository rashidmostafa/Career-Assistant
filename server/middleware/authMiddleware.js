/**
 * JWT authentication middleware.
 * Verifies access tokens; rejects expired or tampered tokens.
 * Attaches req.user (safe) and req.userId.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (process.env.NODE_ENV === "production") {
    throw new Error("[Auth] JWT_SECRET must be set in production environment variables.");
  }

  console.warn("[Auth] JWT_SECRET not set; using a development-only ephemeral secret.");
  globalThis.__careerAssistantDevJwtSecret ??= crypto.randomBytes(32).toString("hex");
  return globalThis.__careerAssistantDevJwtSecret;
})();

/**
 * authenticate — required auth; 401 if missing/invalid.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No access token provided." });
    }
    const token = authHeader.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      if (e.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Access token expired.", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ message: "Invalid access token." });
    }

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ message: "User not found." });
    if (user.accountLocked) return res.status(403).json({ message: "Account is locked." });

    req.userId = user._id.toString();
    req.user   = user.toSafeObject();
    req.deviceId = req.headers["x-device-id"] || payload.deviceId || "unknown";
    next();
  } catch (err) {
    console.error("[Auth] middleware error:", err);
    res.status(500).json({ message: "Authentication error." });
  }
}

/**
 * optionalAuth — attaches user if token present, proceeds regardless.
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return next();
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (user) { req.userId = user._id.toString(); req.user = user.toSafeObject(); }
  } catch (_) {}
  next();
}

/**
 * issueAccessToken — creates a 15-min JWT.
 */
function issueAccessToken(userId, deviceId) {
  return jwt.sign(
    { sub: userId, deviceId, type: "access" },
    JWT_SECRET,
    { expiresIn: "15m", algorithm: "HS256" },
  );
}

/**
 * issueRefreshToken — creates a signed 30-day token string (stored in DB).
 */
function issueRefreshToken(userId, deviceId) {
  return jwt.sign(
    { sub: userId, deviceId, type: "refresh" },
    JWT_SECRET,
    { expiresIn: "30d", algorithm: "HS256" },
  );
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { authenticate, optionalAuth, issueAccessToken, issueRefreshToken, verifyRefreshToken };
