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
 * GET /api/jobs/outbound-ip
 *
 * Reports the address this server actually leaves from.
 *
 * Careerjet authorises API access per IP and rejects everything else with
 * "Unauthorized access from IP x.x.x.x". Render lists several static outbound
 * addresses for a service and does not say which one a given request will use,
 * so this asks an echo service and reports the answer — turning a guess into a
 * fact before anything is whitelisted. Useful for any future provider with the
 * same requirement.
 */
router.get("/outbound-ip", authenticate, async (_req, res) => {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(10000) });
    const { ip } = await r.json();
    res.json({ outboundIp: ip, note: "Whitelist this address in the Careerjet publisher API settings." });
  } catch (e) {
    res.status(502).json({ message: "Couldn't determine the outbound IP.", detail: e.message });
  }
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

    // Careerjet wants the end user's address. Behind Render's proxy req.ip
    // comes from X-Forwarded-For, but if that is missing or private the value
    // is useless to them and the call is rejected — so it is checked rather
    // than sent blindly.
    const isPublicIp = (ip) =>
      typeof ip === "string" &&
      /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
      !/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

    const rawIp = (req.ip || "").replace(/^::ffff:/, "");
    const userIp = isPublicIp(rawIp) ? rawIp : null;

    const result = await searchCareerjet({
      keywords: typeof keywords === "string" ? keywords.slice(0, 200) : "",
      location: typeof location === "string" ? location.slice(0, 100) : "",
      // Forwarded per Careerjet's terms — the user whose action triggered this.
      userIp,
      userAgent: req.headers["user-agent"],
      pageSize: 50,
    });

    res.json({
      jobs: result.jobs,
      available: result.ok,
      // Named so a misconfiguration is diagnosable from the client rather than
      // looking like "no jobs in Bangladesh".
      reason: result.ok ? undefined : result.reason,
      // Careerjet's own words, so a misconfiguration is diagnosable without a
      // redeploy to add logging.
      detail: result.ok ? undefined : result.detail,
      // Echoed while diagnosing: a rejected call is usually about which address
      // reached Careerjet, and guessing at that is what cost us a cycle.
      sentUserIp: result.ok ? undefined : (userIp ?? `rejected:${rawIp || "none"}`),
      locations: result.locations,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
