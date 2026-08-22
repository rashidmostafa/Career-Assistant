/**
 * RateLimit — persistent counters for express-rate-limit and the IP blocklist.
 *
 * Both previously lived in process memory: express-rate-limit's default
 * MemoryStore, and a plain `new Set()` for blocked IPs. On Render's free tier
 * the instance restarts on every deploy and spins down after ~15 minutes idle,
 * so every restart handed every client a fresh budget and emptied the
 * blocklist. The limits existed but did not hold, which is worse than not
 * having them: the code reads as protected while an attacker only has to
 * outlast a restart.
 *
 * MongoDB rather than Redis because the database is already here and already
 * paid for. Redis would be faster and is the right answer under real load, but
 * a counter write per request is well within what this workload does anyway.
 */
const mongoose = require("mongoose");

const RateLimitSchema = new mongoose.Schema({
  // Bucket identity: the limiter's prefix plus the device ID or IP.
  key:     { type: String, required: true, unique: true, index: true },
  hits:    { type: Number, default: 0 },
  resetAt: { type: Date,   required: true },
}, { versionKey: false });

// Expired buckets are removed by Mongo itself, so nothing has to sweep them.
// The window is re-armed on write, so a live bucket is never collected.
RateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RateLimit", RateLimitSchema);
