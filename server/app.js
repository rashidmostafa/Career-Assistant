require("dotenv").config();
/**
 * Career Assistant — Auth API Server
 * Node.js + Express + MongoDB + JWT + bcrypt + TOTP (speakeasy)
 * + Passport.js (Google OAuth2) + Biometric token endpoints
 *
 * Endpoints:
 *   POST   /api/auth/register
 *   POST   /api/auth/verify-email
 *   POST   /api/auth/login
 *   POST   /api/auth/2fa/verify
 *   POST   /api/auth/2fa/setup        (authenticated)
 *   POST   /api/auth/refresh
 *   POST   /api/auth/logout           (authenticated)
 *   POST   /api/auth/reauth           (authenticated)
 *   POST   /api/auth/recover
 *   POST   /api/auth/reset-password
 *   GET    /api/auth/google            -> Google OAuth redirect
 *   GET    /api/auth/google/callback   -> Google OAuth callback
 *   POST   /api/auth/biometric/register (authenticated)
 *   POST   /api/auth/biometric/verify
 *   POST   /api/auth/biometric/disable (authenticated)
 *   GET    /api/user/profile          (authenticated)
 *   PATCH  /api/user/profile          (authenticated)
 *   POST   /api/user/security-questions (authenticated)
 *   GET    /api/user/export           (authenticated)
 *   POST   /api/user/consent          (authenticated)
 *   POST   /api/user/delete           (authenticated)
 *   POST   /api/user/delete/cancel    (authenticated)
 *   GET    /api/user/sessions         (authenticated)
 *   DELETE /api/user/sessions/:id     (authenticated)
 *   GET    /api/user/audit-log        (authenticated)
 *   GET    /health
 */
const express    = require("express");
const helmet     = require("helmet");
const cors       = require("cors");
const { connectDB } = require("./config/db");
const { initPassport } = require("./config/passport");
const { generalLimiter, ipBlockMiddleware } = require("./middleware/rateLimiter");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // managed at CDN/proxy layer
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// ── Trust proxy (Heroku/Render/Railway) ───────────────────────────────────────
app.set("trust proxy", 1);

// ── Health check ──────────────────────────────────────────────────────────────
// Deliberately mounted BEFORE ipBlockMiddleware and generalLimiter. Render
// probes this endpoint every few seconds and sends no X-Device-Id, so every
// probe shared one IP-keyed bucket in generalLimiter (100/hour) and started
// returning 429 within minutes. Render reads a 429 as a failed health check,
// pulls the instance out of rotation, and the edge serves 404 until the rate
// limit window rolls over — a self-inflicted restart loop. A liveness probe
// must never be rate limited or IP blocked.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: require("./package.json").version ?? "1.0.0",
  });
});

// ── Global rate limiting + IP block ──────────────────────────────────────────
app.use(ipBlockMiddleware);
app.use(generalLimiter);

// ── Passport (session + strategies) ──────────────────────────────────────────
// Must be called after body-parsing and before routes.
initPassport(app);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: "Not found." }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[App] Unhandled error:", err);
  res.status(err.status ?? 500).json({ message: err.message ?? "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`[Server] Career Assistant Auth API running on port ${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV ?? "development"}`);
    });
  });
}

module.exports = app; // exported for tests
