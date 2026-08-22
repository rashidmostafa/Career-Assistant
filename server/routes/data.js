/**
 * Feature-data sync routes — /api/data/*
 * All routes require authentication. See models/UserData.js for why this is a
 * namespaced document store rather than five domain schemas.
 *
 *   GET    /api/data                 manifest: every namespace + revision
 *   POST   /api/data/bulk            write many namespaces in one round trip
 *   GET    /api/data/:namespace      one payload
 *   PUT    /api/data/:namespace      upsert one payload
 *   DELETE /api/data/:namespace      remove one payload
 */
const express  = require("express");
const router   = express.Router();
const UserData = require("../models/UserData");
const { authenticate } = require("../middleware/authMiddleware");

// Namespaces come from the client, are stored verbatim, and are used in a
// query — so they are constrained to a conservative character set rather
// than trusted. Colons separate the domain from its role scope
// ("roadmap:frontend-engineer"); nothing else is allowed through.
const NAMESPACE_RE = /^[a-z0-9][a-z0-9:_-]{0,127}$/i;

// Mongo's own ceiling is 16MB per document. This much lower cap is about
// keeping a single sync response small enough to survive a mobile connection;
// the largest real payload (a parsed CV with extracted text) is well under it.
const MAX_PAYLOAD_BYTES = 512 * 1024;

function invalidNamespace(ns) {
  return typeof ns !== "string" || !NAMESPACE_RE.test(ns);
}

function payloadTooLarge(payload) {
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8") > MAX_PAYLOAD_BYTES;
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
// Deliberately excludes payloads. The client calls this on sign-in to decide
// what it actually needs to download, which matters on a slow connection and
// on a cold Render instance.
router.get("/", authenticate, async (req, res, next) => {
  try {
    const docs = await UserData.find({ userId: req.userId })
      .select("namespace revision updatedAt")
      .lean();
    res.json({
      namespaces: docs.map((d) => ({
        namespace: d.namespace,
        revision:  d.revision,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ─── Bulk write ───────────────────────────────────────────────────────────────
// The app finishes onboarding with five namespaces to push at once. Sending
// them individually against a spun-down free-tier instance meant five
// sequential cold-start-length waits; this makes it one.
router.post("/bulk", authenticate, async (req, res, next) => {
  try {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "`items` must be a non-empty array." });
    }
    if (items.length > 50) {
      return res.status(400).json({ message: "At most 50 items per request." });
    }

    for (const item of items) {
      if (invalidNamespace(item?.namespace)) {
        return res.status(400).json({ message: `Invalid namespace: ${item?.namespace}` });
      }
      if (payloadTooLarge(item?.payload)) {
        return res.status(413).json({ message: `Payload for '${item.namespace}' exceeds ${MAX_PAYLOAD_BYTES} bytes.` });
      }
    }

    const ops = items.map((item) => ({
      updateOne: {
        filter: { userId: req.userId, namespace: item.namespace },
        update: { $set: { payload: item.payload ?? {} }, $inc: { revision: 1 } },
        upsert: true,
      },
    }));
    await UserData.bulkWrite(ops, { ordered: false });

    const saved = await UserData.find({
      userId: req.userId,
      namespace: { $in: items.map((i) => i.namespace) },
    }).select("namespace revision updatedAt").lean();

    res.json({ saved });
  } catch (e) {
    next(e);
  }
});

// ─── Read one ─────────────────────────────────────────────────────────────────
router.get("/:namespace", authenticate, async (req, res, next) => {
  try {
    const { namespace } = req.params;
    if (invalidNamespace(namespace)) {
      return res.status(400).json({ message: "Invalid namespace." });
    }
    const doc = await UserData.findOne({ userId: req.userId, namespace }).lean();
    // A namespace the user has never written is not an error — a fresh
    // account legitimately has none of them, and the client treats a null
    // payload the same as empty local storage.
    if (!doc) return res.json({ namespace, payload: null, revision: 0 });
    res.json({
      namespace,
      payload:   doc.payload,
      revision:  doc.revision,
      updatedAt: doc.updatedAt,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Write one ────────────────────────────────────────────────────────────────
router.put("/:namespace", authenticate, async (req, res, next) => {
  try {
    const { namespace } = req.params;
    if (invalidNamespace(namespace)) {
      return res.status(400).json({ message: "Invalid namespace." });
    }
    const { payload } = req.body ?? {};
    if (payload === undefined) {
      return res.status(400).json({ message: "`payload` is required." });
    }
    if (payloadTooLarge(payload)) {
      return res.status(413).json({ message: `Payload exceeds ${MAX_PAYLOAD_BYTES} bytes.` });
    }

    const doc = await UserData.findOneAndUpdate(
      { userId: req.userId, namespace },
      { $set: { payload }, $inc: { revision: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json({ namespace, revision: doc.revision, updatedAt: doc.updatedAt });
  } catch (e) {
    next(e);
  }
});

// ─── Delete one ───────────────────────────────────────────────────────────────
router.delete("/:namespace", authenticate, async (req, res, next) => {
  try {
    const { namespace } = req.params;
    if (invalidNamespace(namespace)) {
      return res.status(400).json({ message: "Invalid namespace." });
    }
    await UserData.deleteOne({ userId: req.userId, namespace });
    res.json({ message: "Deleted." });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
