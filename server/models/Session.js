/**
 * Session schema — refresh token rotation.
 * Access token: 15 min (stateless JWT, not stored).
 * Refresh token: 30-day rotation, stored here (invalidated on use).
 */
const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  refreshToken: { type: String, required: true, unique: true, index: true },
  deviceId:     { type: String, required: true },
  deviceInfo:   { type: String },         // user-agent or platform label
  ipAddress:    { type: String },
  isRevoked:    { type: Boolean, default: false },
  expiresAt:    { type: Date, required: true },
  // 8-week rolling window
  sessionStartedAt: { type: Date, default: Date.now },
  lastRefreshedAt:  { type: Date, default: Date.now },
}, { timestamps: true });

SessionSchema.index({ userId: 1, isRevoked: 1 });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

SessionSchema.methods.isExpired = function () {
  return this.expiresAt < new Date();
};

SessionSchema.methods.is8WeekExpired = function () {
  const EIGHT_WEEKS = 56 * 24 * 60 * 60 * 1000;
  return Date.now() - this.sessionStartedAt.getTime() > EIGHT_WEEKS;
};

module.exports = mongoose.model("Session", SessionSchema);
