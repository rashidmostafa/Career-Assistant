/**
 * User routes — /api/user/*
 * All routes require authentication unless noted.
 */
const express  = require("express");
const router   = express.Router();
const User     = require("../models/User");
const Session  = require("../models/Session");
const AuditLog = require("../models/AuditLog");
const UserData = require("../models/UserData");
const AuthService = require("../services/authService");
const { authenticate } = require("../middleware/authMiddleware");

// ─── Profile ──────────────────────────────────────────────────────────────────
router.get("/profile", authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("+backupCodes");
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ user: user.toSafeObject() });
  } catch (e) {
    next(e);
  }
});

router.patch("/profile", authenticate, async (req, res, next) => {
  try {
    const allowed = ["name", "phone", "targetRole", "targetRoles", "activeRoleId", "experienceLevel", "background", "photoUri", "onboardingComplete"];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.userId, update, { new: true });
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ user: user.toSafeObject() });
  } catch (e) {
    next(e);
  }
});

// ─── Security questions ───────────────────────────────────────────────────────
router.post("/security-questions", authenticate, async (req, res, next) => {
  try {
    const result = await AuthService.setSecurityQuestions(req.userId, req.body.questions, req);
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 500).json({ message: e.message });
  }
});

router.get("/security-questions", authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("+securityQuestions");
    if (!user) return res.status(404).json({ message: "User not found." });
    const questions = (user.securityQuestions ?? []).map((q) => q.question);
    res.json({ questions });
  } catch (e) {
    next(e);
  }
});

// ─── Push token registration ──────────────────────────────────────────────────
router.post("/push-token", authenticate, async (req, res, next) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) return res.status(400).json({ message: "pushToken required." });
    await User.findByIdAndUpdate(req.userId, { pushToken });
    res.json({ message: "Push token registered." });
  } catch (e) {
    next(e);
  }
});

// ─── GDPR: data export ────────────────────────────────────────────────────────
router.get("/export", authenticate, async (req, res, next) => {
  try {
    const format = req.query.format === "csv" ? "csv" : "json";
    const user = await User.findById(req.userId).select("+securityQuestions");
    if (!user) return res.status(404).json({ message: "User not found." });

    const logs = await AuditLog.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const sessions = await Session.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Article 20 covers everything held for the account, not just the auth
    // record — CV, roadmap, interview history, job matches and portfolio all
    // live in UserData now that they sync, so they belong in the export too.
    const featureData = await UserData.find({ userId: req.userId })
      .select("namespace payload updatedAt")
      .lean();

    const safeUser = user.toSafeObject();
    const exportData = {
      exportedAt: new Date().toISOString(),
      gdprNote:   "This export contains all personal data held for your account under GDPR Article 20.",
      profile: safeUser,
      auditLog: logs.map((l) => ({
        event:     l.event,
        success:   l.success,
        ipAddress: l.ipAddress,
        deviceId:  l.deviceId,
        createdAt: l.createdAt,
      })),
      sessions: sessions.map((s) => ({
        deviceId:        s.deviceId,
        deviceInfo:      s.deviceInfo,
        ipAddress:       s.ipAddress,
        isRevoked:       s.isRevoked,
        createdAt:       s.createdAt,
        sessionStartedAt: s.sessionStartedAt,
      })),
      appData: featureData.reduce((acc, d) => {
        acc[d.namespace] = { payload: d.payload, updatedAt: d.updatedAt };
        return acc;
      }, {}),
    };

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="career-assistant-data-${Date.now()}.json"`);
      return res.json(exportData);
    }

    // CSV: flatten profile + audit log rows
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const profileRow = [
      "# PROFILE",
      Object.keys(safeUser).join(","),
      Object.values(safeUser).map(escape).join(","),
      "",
      "# AUDIT LOG",
      "event,success,ipAddress,deviceId,createdAt",
      ...exportData.auditLog.map((l) =>
        [l.event, l.success, l.ipAddress, l.deviceId, l.createdAt].map(escape).join(",")
      ),
      "",
      "# APP DATA (namespaces — full contents are in the JSON export)",
      "namespace,updatedAt",
      ...featureData.map((d) => [d.namespace, d.updatedAt].map(escape).join(",")),
      "",
      "# SESSIONS",
      "deviceId,deviceInfo,ipAddress,isRevoked,createdAt",
      ...exportData.sessions.map((s) =>
        [s.deviceId, s.deviceInfo, s.ipAddress, s.isRevoked, s.createdAt].map(escape).join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="career-assistant-data-${Date.now()}.csv"`);
    return res.send(profileRow);
  } catch (e) {
    next(e);
  }
});

// ─── GDPR: consent ───────────────────────────────────────────────────────────
router.post("/consent", authenticate, async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.userId, { consentGiven: true, consentAt: new Date() });
    res.json({ message: "Consent recorded." });
  } catch (e) {
    next(e);
  }
});

// ─── GDPR: account deletion ───────────────────────────────────────────────────
router.post("/delete", authenticate, async (req, res, next) => {
  try {
    const scheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30-day grace
    await User.findByIdAndUpdate(req.userId, { deletionScheduledAt: scheduledAt });
    // Invalidate all sessions immediately on deletion request
    await Session.updateMany({ userId: req.userId, isRevoked: false }, { isRevoked: true });
    const AuditLog = require("../models/AuditLog");
    try { await AuditLog.create({ userId: req.userId, event: "deletion_requested", success: true, ipAddress: req.ip }); } catch (_) {}
    res.json({ message: "Account scheduled for deletion in 30 days.", scheduledAt: scheduledAt.getTime() });
  } catch (e) {
    next(e);
  }
});

router.post("/delete/cancel", authenticate, async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.userId, {
      $unset: { deletionScheduledAt: 1 },
      deletionCancelledAt: new Date(),
    });
    res.json({ message: "Account deletion cancelled." });
  } catch (e) {
    next(e);
  }
});

// ─── Sessions ─────────────────────────────────────────────────────────────────
router.get("/sessions", authenticate, async (req, res, next) => {
  try {
    const sessions = await Session.find({
      userId: req.userId,
      isRevoked: false,
      expiresAt: { $gt: new Date() },
    })
      .select("deviceId deviceInfo ipAddress createdAt lastRefreshedAt sessionStartedAt")
      .sort({ lastRefreshedAt: -1 });
    res.json({ sessions });
  } catch (e) {
    next(e);
  }
});

router.delete("/sessions/:sessionId", authenticate, async (req, res, next) => {
  try {
    const result = await Session.findOneAndUpdate(
      { _id: req.params.sessionId, userId: req.userId },
      { isRevoked: true }
    );
    if (!result) return res.status(404).json({ message: "Session not found." });
    res.json({ message: "Session revoked." });
  } catch (e) {
    next(e);
  }
});

// ─── Audit log ────────────────────────────────────────────────────────────────
router.get("/audit-log", authenticate, async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page ?? "1"), 1);
    const limit = Math.min(parseInt(req.query.limit ?? "20"), 100);
    const logs  = await AuditLog.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await AuditLog.countDocuments({ userId: req.userId });
    res.json({ logs, page, limit, total });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
