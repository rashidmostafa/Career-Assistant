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
 *   POST   /api/ai/chat               (authenticated)  general LLM proxy
 *   POST   /api/ai/hawk/:task         (authenticated)  Hawk model proxy
 *   GET    /api/ai/status             (authenticated)
 *   GET    /api/data                  (authenticated)  sync manifest
 *   POST   /api/data/bulk             (authenticated)
 *   GET    /api/data/:namespace       (authenticated)
 *   PUT    /api/data/:namespace       (authenticated)
 *   DELETE /api/data/:namespace       (authenticated)
 *   POST   /api/cv/extract            (authenticated)  PDF/DOCX -> text
 *   GET    /api/jobs/search           (authenticated)  Careerjet proxy
 *   GET    /api/jobs/status           (authenticated)
 *   GET    /health
 */
const express    = require("express");
const mongoose   = require("mongoose");
const crypto     = require("crypto");
const helmet     = require("helmet");
const cors       = require("cors");
const { connectDB } = require("./config/db");
const { validateEnv } = require("./config/validateEnv");
const { initPassport } = require("./config/passport");
const { generalLimiter, ipBlockMiddleware, startBlocklistSync } = require("./middleware/rateLimiter");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const aiRoutes   = require("./routes/ai");
const dataRoutes = require("./routes/data");
const cvRoutes   = require("./routes/cv");
const jobRoutes  = require("./routes/jobs");
const interviewRoutes = require("./routes/interview");
const { startDeletionWorker } = require("./services/deletionWorker");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // managed at CDN/proxy layer
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
// ALLOWED_ORIGINS and WEB_ORIGINS are merged: the same browser origin that is
// permitted to receive the OAuth callback should be able to call the API, and
// keeping one list in two variables invites them to drift apart.
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS ?? "").split(","),
  ...(process.env.WEB_ORIGINS ?? "").split(","),
].map((o) => o.trim()).filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "[CORS] No ALLOWED_ORIGINS or WEB_ORIGINS set — any website can call this API " +
    "from a browser. Harmless while the only clients are native builds (which send " +
    "no Origin header), but set them before shipping a web build."
  );
}

app.use(cors({
  origin: (origin, cb) => {
    // No Origin header at all: a native app, curl, or a server-to-server call.
    // Browsers always send one on a cross-origin request, so this is not a
    // bypass — it is the ordinary mobile case, which CORS does not govern.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Unconfigured stays permissive so a deploy that forgets the variable does
    // not silently break the web build; the boot warning above is the nudge.
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
}));

// ── Request ID ────────────────────────────────────────────────────────────────
// Correlates a user's report ("it failed and showed me this code") with the
// exact log line. Render already tags responses with rndr-id, so that is reused
// when present rather than minting a competing identifier.
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] ?? res.getHeader("rndr-id") ?? crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
});

// ── Body parsing ──────────────────────────────────────────────────────────────
// 12mb, not 1mb: CV uploads arrive base64-encoded, which inflates a file by
// about a third, and routes/cv.js caps the decoded file at 8MB itself.
app.use(express.json({ limit: "12mb" }));
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
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

app.get("/health", (_req, res) => {
  const dbState = mongoose.connection?.readyState ?? 0;
  const dbUp = dbState === 1;

  // Reports the database but deliberately still answers 200 when it is down.
  //
  // Render treats a non-2xx here as a failed instance and restarts it. Mongoose
  // reconnects on its own, so a restart cannot fix a database outage — it would
  // just cycle the process until Mongo returns, which is the same restart loop
  // the rate-limiter exemption below was written to stop, arrived at from a
  // different direction. A liveness probe should say whether the process is
  // alive; `db` and `status: degraded` are here for monitoring to alert on.
  res.json({
    status:    dbUp ? "ok" : "degraded",
    db:        DB_STATES[dbState] ?? "unknown",
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
    version:   require("./package.json").version ?? "1.0.0",
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
app.use("/api/ai",   aiRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/cv",   cvRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/interview", interviewRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: "Not found." }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  // CORS rejections arrive here as plain Errors with no status, which used to
  // make a policy decision look like a server fault in both the logs and the
  // response.
  const status = err.status ?? (err.message === "Not allowed by CORS" ? 403 : 500);

  // One line, structured, so Render's log stream can be searched and a future
  // log drain can parse it without changing this code.
  console.error(JSON.stringify({
    level:     "error",
    requestId: req.id,
    method:    req.method,
    path:      req.originalUrl,
    status,
    userId:    req.userId ?? null,
    message:   err.message,
    stack:     status >= 500 ? err.stack : undefined,
    at:        new Date().toISOString(),
  }));

  // Client errors describe themselves; 5xx messages can carry database detail,
  // file paths and query fragments, so they are logged and not forwarded. The
  // request ID is returned instead, which is what makes a user's screenshot
  // enough to find the failure.
  res.status(status).json(
    status >= 500
      ? { message: "Internal server error.", requestId: req.id }
      : { message: err.message ?? "Request failed.", requestId: req.id },
  );
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  // Checked before connecting: a misconfigured URI should be reported as such
  // rather than as a connection timeout.
  validateEnv();

  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`[Server] Career Assistant API running on port ${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV ?? "development"}`);
    });
    // Acts on the 30-day grace period set by POST /api/user/delete.
    startDeletionWorker();
    // Loads persisted IP blocks into the in-process cache and keeps it fresh.
    startBlocklistSync();
  });
}

module.exports = app; // exported for tests
