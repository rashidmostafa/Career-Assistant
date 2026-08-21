/**
 * User MongoDB schema.
 * bcrypt 12 rounds for password storage.
 * Includes: 2FA, biometric, security questions, session tracking,
 *           risk profile, account lockout, GDPR consent,
 *           social OAuth (Google), push notifications.
 */
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const SecurityQuestionSchema = new mongoose.Schema({
  question:   { type: String, required: true },
  answerHash: { type: String, required: true },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  // ── Core ──────────────────────────────────────────────────────────────────
  name:  { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true },
  passwordHash: { type: String, required: true },

  // ── Social OAuth ──────────────────────────────────────────────────────────
  provider:   { type: String, enum: ["local", "google"], default: "local" },
  providerId: { type: String },        // provider's user ID
  avatarUrl:  { type: String },        // avatar from social profile

  // ── Profile ───────────────────────────────────────────────────────────────
  targetRole:       { type: String, default: "" },
  // Every role the user is pursuing. targetRole above stays as the active
  // one so older clients keep working unchanged; activeRoleId is what the
  // multi-role client reads.
  targetRoles: {
    type: [{
      id:        { type: String, required: true },
      title:     { type: String, required: true },
      createdAt: { type: String },
      _id:       false,
    }],
    default: [],
  },
  activeRoleId:     { type: String, default: "" },
  experienceLevel:  { type: String, default: "" },
  background:       { type: String, default: "" },
  photoUri:         { type: String },
  onboardingComplete: { type: Boolean, default: false },

  // ── Push notifications ────────────────────────────────────────────────────
  pushToken: { type: String },

  // ── Verification ──────────────────────────────────────────────────────────
  emailVerified:        { type: Boolean, default: false },
  emailVerifyToken:     { type: String },
  emailVerifyExpires:   { type: Date },

  // ── 2FA ───────────────────────────────────────────────────────────────────
  twoFactorEnabled:  { type: Boolean, default: false },
  twoFactorMethod:   { type: String, enum: ["totp", "email"], default: "totp" },
  totpSecret:        { type: String, select: false },
  backupCodes:       { type: [String], select: false },

  // ── Biometric ─────────────────────────────────────────────────────────────
  biometricEnabled:      { type: Boolean, default: false },
  biometricTokenHash:    { type: String, select: false },  // SHA-256 of device credential ID
  biometricRegisteredAt: { type: Date },

  // ── Security questions ────────────────────────────────────────────────────
  securityQuestions: { type: [SecurityQuestionSchema], select: false },
  securityQuestionsSet: { type: Boolean, default: false },

  // ── Account lockout ───────────────────────────────────────────────────────
  loginAttempts: { type: Number, default: 0 },
  accountLocked: { type: Boolean, default: false },
  lockoutUntil:  { type: Date },
  lastLogin:     { type: Date },

  // ── Risk / device ─────────────────────────────────────────────────────────
  knownDevices: { type: [String], default: [] },
  trustedDevices: [{
    deviceId:   { type: String },
    trustedAt:  { type: Date, default: Date.now },
    expiresAt:  { type: Date },
    _id: false,
  }],

  // ── GDPR ─────────────────────────────────────────────────────────────────
  consentGiven:         { type: Boolean, default: false },
  consentAt:            { type: Date },
  deletionScheduledAt:  { type: Date },
  deletionCancelledAt:  { type: Date },

}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────────────────────────

UserSchema.index({ provider: 1, providerId: 1 }, { sparse: true });
UserSchema.index({ "trustedDevices.deviceId": 1 });
UserSchema.index({ deletionScheduledAt: 1 }, { sparse: true });

// ── Password hashing ──────────────────────────────────────────────────────────
UserSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  // passwordHash field receives plaintext password on set, then gets hashed
  if (!this.passwordHash.startsWith("$2")) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  }
  next();
});

// ── Instance methods ──────────────────────────────────────────────────────────
UserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

UserSchema.methods.incrementLoginAttempts = async function () {
  const MAX = 5;
  this.loginAttempts += 1;
  if (this.loginAttempts >= MAX) {
    this.accountLocked = true;
    this.lockoutUntil  = new Date(Date.now() + 15 * 60 * 1000);
  }
  return this.save();
};

UserSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.accountLocked = false;
  this.lockoutUntil  = undefined;
  this.lastLogin     = new Date();
  return this.save();
};

UserSchema.methods.isDeviceTrusted = function (deviceId) {
  const now = new Date();
  return this.trustedDevices.some((d) => d.deviceId === deviceId && d.expiresAt > now);
};

UserSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  // Expose only the count, never the actual codes — only populated when the
  // caller's query explicitly selected +backupCodes (it's select:false by default).
  if (Array.isArray(obj.backupCodes)) obj.backupCodesRemaining = obj.backupCodes.length;
  delete obj.passwordHash;
  delete obj.totpSecret;
  delete obj.backupCodes;
  delete obj.securityQuestions;
  delete obj.biometricTokenHash;
  return obj;
};

module.exports = mongoose.model("User", UserSchema);
