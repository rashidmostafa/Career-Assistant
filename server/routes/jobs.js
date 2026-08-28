/**
 * Job routes — /api/jobs/*
 *
 * A proxy in front of Careerjet, which is the only identified route to genuine
 * Bangladesh listings. It exists rather than the app calling Careerjet directly
 * because the API key must never reach the bundle, and because Careerjet
 * requires the end user's IP and user agent, which only the server can attach
 * accurately.
 */
const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const { searchCareerjet, isConfigured, LOCALE } = require("../services/careerjetService");

/** Whether local listings are available, so the app can say so honestly. */
router.get("/status", authenticate, (_req, res) => {
  res.json({ careerjet: { configured: isConfigured(), locale: LOCALE } });
});

/**
 * GET /api/jobs/search?keywords=&location=
 *
 * Returns an empty list rather than an error when Careerjet is unavailable:
 * the app merges this with its other sources, and one board being down should
 * narrow the feed, not break it.
 */
router.get("/search", authenticate, async (req, res, next) => {
  try {
    const { keywords, location } = req.query;

    const result = await searchCareerjet({
      keywords: typeof keywords === "string" ? keywords.slice(0, 200) : "",
      location: typeof location === "string" ? location.slice(0, 100) : "",
      // Forwarded per Careerjet's terms — the user whose action triggered this.
      userIp: req.ip,
      userAgent: req.headers["user-agent"],
      pageSize: 50,
    });

    res.json({
      jobs: result.jobs,
      available: result.ok,
      // Named so a misconfiguration is diagnosable from the client rather than
      // looking like "no jobs in Bangladesh".
      reason: result.ok ? undefined : result.reason,
      locations: result.locations,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
