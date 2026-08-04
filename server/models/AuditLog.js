/**
 * AuditLog — immutable security event log.
 * Events: login_success, login_failure, logout, password_change,
 *         2fa_enabled, 2fa_verified, reauth, account_locked,
 *         data_exported, deletion_requested.
 */
const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  event:     { type: String, required: true, index: true },
  ipAddress: { type: String },
  deviceId:  { type: String },
  userAgent: { type: String },
  metadata:  { type: mongoose.Schema.Types.Mixed },
  success:   { type: Boolean, default: true },
}, { timestamps: true });

// TTL: keep logs for 1 year
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
AuditLogSchema.index({ userId: 1, event: 1, createdAt: -1 });

// Prevent modifications
AuditLogSchema.set("strict", true);

module.exports = mongoose.model("AuditLog", AuditLogSchema);
