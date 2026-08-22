/**
 * Startup configuration check.
 *
 * Every value here has a plausible local default that works perfectly on a
 * laptop and silently does the wrong thing on Render — a MONGODB_URI pointing
 * at a database that only exists on one machine, a HAWK_URL of localhost that
 * resolves to the Render container itself rather than the GPU box, a
 * JWT_SECRET left at its placeholder. None of these fail loudly at boot; they
 * fail later, as an empty account or a feature that quietly returns null.
 *
 * So they are checked once, at startup, where the log is read.
 */
const LOCAL_HOST = /(^|\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

function validateEnv({ strict = process.env.NODE_ENV === "production" } = {}) {
  const errors = [];
  const warnings = [];

  // ── Database ──
  const uri = process.env.MONGODB_URI ?? "";
  if (!uri) {
    errors.push("MONGODB_URI is not set — the API cannot store anything.");
  } else if (LOCAL_HOST.test(uri)) {
    errors.push(
      "MONGODB_URI points at a local database. On Render this resolves to the " +
      "container itself, so every account and all synced data would vanish on " +
      "the next deploy. Use the MongoDB Atlas connection string."
    );
  }

  // ── Secrets ──
  if (!process.env.JWT_SECRET) {
    errors.push("JWT_SECRET is not set — tokens would be signed with a public default.");
  }

  // ── Public URL ──
  const baseUrl = process.env.SERVER_BASE_URL || process.env.RENDER_EXTERNAL_URL || "";
  if (!baseUrl) {
    warnings.push("Neither SERVER_BASE_URL nor RENDER_EXTERNAL_URL is set — the Google OAuth callback URL cannot be built.");
  } else if (LOCAL_HOST.test(baseUrl)) {
    errors.push("SERVER_BASE_URL points at localhost; Google cannot redirect a user's browser there.");
  }

  // ── Hawk ──
  // Blank is a legitimate choice: /api/ai/hawk/* returns data:null and every
  // caller falls back. A localhost value is not — it looks configured and
  // silently is not.
  const hawkUrl = process.env.HAWK_URL ?? "";
  if (hawkUrl && LOCAL_HOST.test(hawkUrl)) {
    warnings.push(
      "HAWK_URL points at localhost. That is correct only when Hawk runs on this " +
      "same machine; on Render it means the container itself, so every Hawk call " +
      "fails and the app silently uses its fallbacks. Use the public tunnel URL, " +
      "or leave HAWK_URL blank to turn Hawk off deliberately."
    );
  }
  if (hawkUrl && !process.env.HAWK_SECRET) {
    warnings.push("HAWK_URL is set but HAWK_SECRET is not — the model host is reachable without authentication.");
  }

  // ── AI ──
  if (!process.env.AI_API_KEY) {
    warnings.push("AI_API_KEY is not set — /api/ai/chat returns data:null and CV/roadmap generation falls back to heuristics.");
  }

  for (const w of warnings) console.warn(`[Config] ${w}`);
  for (const e of errors)   console.error(`[Config] ${e}`);

  if (errors.length && strict) {
    throw new Error(
      `Refusing to start with ${errors.length} configuration error(s). See [Config] lines above.`
    );
  }
  return { errors, warnings };
}

module.exports = { validateEnv };
