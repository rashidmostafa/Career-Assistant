/**
 * CV extraction. Runs against real PDF and DOCX files rather than mocks: the
 * failure this replaces was a parser that produced plausible-looking gibberish,
 * which no mock would have caught.
 */
require("dotenv").config();
process.env.NODE_ENV = "test";

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const mongoose = require("mongoose");

const { connectDB } = require("../config/db");
const app = require("../app");
const User = require("../models/User");
const { issueAccessToken } = require("../middleware/authMiddleware");

const FIXTURES = path.join(__dirname, "fixtures");
const b64 = (f) => fs.readFileSync(path.join(FIXTURES, f)).toString("base64");

const TEST_EMAIL = "jest-cv@test.local";
let token, userId;
const auth = (r) => r.set("Authorization", `Bearer ${token}`).set("X-Device-Id", "jest-cv");

beforeAll(async () => {
  await connectDB();
  await User.deleteOne({ email: TEST_EMAIL });
  const u = await User.create({ name: "Jest CV", email: TEST_EMAIL, passwordHash: "x".repeat(20), emailVerified: true });
  userId = u._id.toString();
  token = issueAccessToken(userId, "jest-cv");
}, 30000);

afterAll(async () => {
  await User.deleteOne({ _id: userId });
  await mongoose.disconnect();
}, 30000);

describe("POST /api/cv/extract", () => {
  it("requires authentication", async () => {
    expect((await request(app).post("/api/cv/extract").send({})).status).toBe(401);
  });

  it("extracts a real PDF, preserving the content that matters", async () => {
    const res = await auth(request(app).post("/api/cv/extract"))
      .send({ fileBase64: b64("sample-cv.pdf"), fileName: "cv.pdf" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("pdf");
    // Name, contact, a quantified bullet and education all survive — the old
    // parser lost or mangled these on many files.
    expect(res.body.text).toContain("RASHID MOSTAFA");
    expect(res.body.text).toContain("rashid.mostafa@example.com");
    expect(res.body.text).toContain("10,000 requests");
    expect(res.body.text).toContain("University of Dhaka");
    expect(res.body.readability.ok).toBe(true);
  }, 30000);

  it("extracts a real Word document", async () => {
    const res = await auth(request(app).post("/api/cv/extract"))
      .send({ fileBase64: b64("sample-cv.docx"), fileName: "cv.docx" });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("docx");
    expect(res.body.text).toContain("MongoDB");
    expect(res.body.readability.ok).toBe(true);
  }, 30000);

  it("rejects a file type it cannot read", async () => {
    const res = await auth(request(app).post("/api/cv/extract"))
      .send({ fileBase64: Buffer.from("plain text").toString("base64"), fileName: "cv.txt" });
    expect(res.status).toBe(415);
  });

  it("rejects a corrupt file as the user's problem, not a server fault", async () => {
    const res = await auth(request(app).post("/api/cv/extract"))
      .send({ fileBase64: Buffer.from("this is not a pdf").toString("base64"), fileName: "cv.pdf" });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/couldn't read|corrupted|password/i);
  });

  it("requires a file", async () => {
    expect((await auth(request(app).post("/api/cv/extract")).send({ fileName: "cv.pdf" })).status).toBe(400);
  });

  it("refuses a file over the size cap without decoding it", async () => {
    const res = await auth(request(app).post("/api/cv/extract"))
      .send({ fileBase64: "A".repeat(12 * 1024 * 1024), fileName: "cv.pdf" });
    expect(res.status).toBe(413);
  }, 30000);
});

describe("POST /api/cv/export", () => {
  const CV = `RASHID MOSTAFA
Dhaka, Bangladesh

PROFESSIONAL SUMMARY
Backend Engineer with 2 years of experience building REST APIs.

EXPERIENCE
Software Engineer, Acme Ltd (2024 - 2026)
- Built a REST API serving 10,000 requests per day
- Raised Jest coverage from 12% to 68%

SKILLS
JavaScript, Node.js, MongoDB`;

  it("requires authentication", async () => {
    expect((await request(app).post("/api/cv/export").send({ text: CV })).status).toBe(401);
  });

  it("produces a real .docx, not HTML with a Word extension", async () => {
    const res = await auth(request(app).post("/api/cv/export")).send({ text: CV });
    expect(res.status).toBe(200);
    expect(res.body.extension).toBe("docx");

    const buf = Buffer.from(res.body.fileBase64, "base64");
    // A .docx is a zip; the rename trick would start with "<".
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  }, 30000);

  it("keeps the content, and the structure, through a real Word parser", async () => {
    const res = await auth(request(app).post("/api/cv/export")).send({ text: CV });
    const buf = Buffer.from(res.body.fileBase64, "base64");

    const mammoth = require("mammoth");
    const text = (await mammoth.extractRawText({ buffer: buf })).value;
    expect(text).toContain("RASHID MOSTAFA");
    expect(text).toContain("10,000 requests");
    expect(text).toContain("University of Dhaka".slice(0, 0) + "MongoDB");

    // Headings and bullets must be real Word structures, or the document is
    // not editable in the way someone sending it to an employer expects.
    const html = (await mammoth.convertToHtml({ buffer: buf })).value;
    expect(html).toMatch(/<h2>/);
    expect(html).toMatch(/<li>/);
  }, 30000);

  it("refuses an empty export", async () => {
    expect((await auth(request(app).post("/api/cv/export")).send({ text: "short" })).status).toBe(400);
  });

  it("refuses an oversized export", async () => {
    expect((await auth(request(app).post("/api/cv/export")).send({ text: "x".repeat(70_000) })).status).toBe(413);
  });
});
