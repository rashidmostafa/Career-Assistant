/**
 * CV routes — /api/cv/*
 *
 * Text extraction runs here rather than on the device.
 *
 * The previous implementation parsed PDFs in the client with ~650 lines of
 * hand-rolled byte decoding. It worked on simple documents and produced
 * plausible-looking gibberish on anything using an embedded subset font with no
 * ToUnicode map — which was then sent to the model and returned as a "rewritten
 * CV" full of nonsense. Real parsers handle those cases, and running server-side
 * also means .docx works without shipping a second parser to the phone.
 */
const express  = require("express");
const router   = express.Router();
const mammoth  = require("mammoth");
const { PDFParse } = require("pdf-parse");
const { authenticate } = require("../middleware/authMiddleware");
const { aiLimiter }    = require("../middleware/rateLimiter");

// A CV is a handful of pages. This is generous for that and still far below
// anything that would strain the instance.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const SUPPORTED = {
  pdf:  "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Whether extracted text is prose someone wrote, rather than decoding debris.
 *
 * Two independent signals, because either alone has a blind spot: a page of
 * "!!!!!" is all valid characters but no words, while accented mojibake can
 * form word-shaped tokens out of characters prose never uses.
 */
function readability(text) {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 40) return { sane: 0, wordish: 0, ok: false };

  const sane = (s.match(/[A-Za-z0-9 .,;:'"()\-@/&+#%$!?]/g)?.length ?? 0) / s.length;
  const tokens = s.split(" ").filter(Boolean);
  const words = tokens.filter((w) => /^[A-Za-z][A-Za-z'’-]{1,}$/.test(w)).length;
  const wordish = tokens.length ? words / tokens.length : 0;

  // A real CV is overwhelmingly ordinary characters and mostly real words, even
  // allowing for dates, bullets, emails and version numbers.
  return { sane: +sane.toFixed(3), wordish: +wordish.toFixed(3), ok: sane >= 0.85 && wordish >= 0.45 };
}

function detectKind(fileName = "", mimeType = "") {
  const ext = String(fileName).toLowerCase().split(".").pop();
  if (mimeType === SUPPORTED.pdf || ext === "pdf") return "pdf";
  if (mimeType === SUPPORTED.docx || ext === "docx") return "docx";
  return null;
}

/**
 * POST /api/cv/extract
 * Body: { fileBase64, fileName, mimeType }
 * → { text, chars, kind, readability }
 *
 * Rate limited with the AI bucket: parsing is the step before every model call
 * here, and it is the expensive part of an upload.
 */
router.post("/extract", authenticate, aiLimiter, async (req, res, next) => {
  try {
    const { fileBase64, fileName, mimeType } = req.body ?? {};

    if (typeof fileBase64 !== "string" || !fileBase64) {
      return res.status(400).json({ message: "fileBase64 is required." });
    }

    // Length of the encoding, checked before allocating the decoded buffer.
    const approxBytes = Math.floor((fileBase64.length * 3) / 4);
    if (approxBytes > MAX_FILE_BYTES) {
      return res.status(413).json({ message: "That file is larger than 8MB." });
    }

    const kind = detectKind(fileName, mimeType);
    if (!kind) {
      return res.status(415).json({ message: "Upload a PDF or Word (.docx) file." });
    }

    const buffer = Buffer.from(fileBase64, "base64");
    if (!buffer.length) {
      return res.status(400).json({ message: "That file appears to be empty." });
    }

    let text = "";
    try {
      if (kind === "pdf") {
        const parsed = await new PDFParse({ data: buffer }).getText();
        text = parsed?.text ?? "";
      } else {
        text = (await mammoth.extractRawText({ buffer }))?.value ?? "";
      }
    } catch (e) {
      // A corrupt or password-protected file is the user's problem to fix, not
      // a server fault, so it must not read as one.
      console.warn("[CV] extraction failed:", e.message);
      return res.status(422).json({
        message: "Couldn't read that file. It may be corrupted, password-protected, or a scanned image rather than text.",
      });
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    const quality = readability(text);
    if (!quality.ok) {
      // Length alone is not enough: a scan or a broken font decode produces
      // plenty of characters and no words. Refusing here is what stops nonsense
      // reaching the model and coming back as a "rewritten CV".
      return res.status(422).json({
        message: text.length < 40
          ? "No text found in that file — it looks like a scan or an image. Upload a text-based PDF or a Word file."
          : "That file's text didn't decode into readable words. Try exporting it again from Word or Google Docs.",
        readability: quality,
      });
    }

    res.json({ text, chars: text.length, kind, readability: quality });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
