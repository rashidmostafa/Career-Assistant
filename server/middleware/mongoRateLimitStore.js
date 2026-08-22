/**
 * MongoRateLimitStore — an express-rate-limit v7 store backed by MongoDB.
 *
 * See models/RateLimit.js for why this exists rather than the default
 * MemoryStore. Implements the v7 Store interface: init, increment, decrement,
 * resetKey, resetAll.
 */
const RateLimit = require("../models/RateLimit");

class MongoRateLimitStore {
  constructor({ prefix = "rl" } = {}) {
    this.prefix = prefix;
  }

  /** Called by express-rate-limit with the limiter's resolved options. */
  init(options) {
    this.windowMs = options.windowMs;
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  /**
   * Counts one hit and reports the running total.
   *
   * The conditional reset runs as an aggregation-pipeline update so that
   * "has this window expired?" and "increment" are a single atomic operation.
   * Reading the document first and then writing it back would let two
   * concurrent requests both observe an expired window and both reset the
   * counter to 1 — which is precisely the burst a rate limiter exists to catch.
   */
  async increment(key) {
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);

    const doc = await RateLimit.findOneAndUpdate(
      { key: this._key(key) },
      [{
        $set: {
          hits: {
            $cond: [{ $gt: ["$resetAt", now] }, { $add: [{ $ifNull: ["$hits", 0] }, 1] }, 1],
          },
          resetAt: {
            $cond: [{ $gt: ["$resetAt", now] }, "$resetAt", resetAt],
          },
        },
      }],
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return { totalHits: doc.hits, resetTime: doc.resetAt };
  }

  async decrement(key) {
    await RateLimit.updateOne({ key: this._key(key) }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await RateLimit.deleteOne({ key: this._key(key) });
  }

  async resetAll() {
    await RateLimit.deleteMany({ key: new RegExp(`^${this.prefix}:`) });
  }
}

module.exports = { MongoRateLimitStore };
