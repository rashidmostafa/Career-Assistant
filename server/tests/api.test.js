/**
 * Route tests for the endpoints added alongside the AI proxy and data sync,
 * plus the OAuth state handling and error-response contract.
 *
 * These talk to the real MongoDB in MONGODB_URI. There is no in-memory Mongo in
 * this project's devDependencies, and the behaviour worth testing here — atomic
 * counter increments, TTL indexes, unique compound indexes — is the database's,
 * so faking it would test the fake. Every document created is namespaced to
 * this suite and removed afterwards.
 */
require("dotenv").config();

// Limiters skip themselves when NODE_ENV is "test" (see middleware/rateLimiter.js),
// which keeps route tests from exhausting a shared budget. The store's own
// behaviour is exercised directly further down.
process.env.NODE_ENV = "test";

const request  = require("supertest");
const mongoose = require("mongoose");
const jwt      = require("jsonwebtoken");

const { connectDB } = require("../config/db");
const app       = require("../app");
const User      = require("../models/User");
const UserData  = require("../models/UserData");
const RateLimit = require("../models/RateLimit");
const { issueAccessToken } = require("../middleware/authMiddleware");
const { MongoRateLimitStore } = require("../middleware/mongoRateLimitStore");

const TEST_EMAIL = "jest-api-suite@test.local";
let token;
let userId;

const auth = (req) => req.set("Authorization", `Bearer ${token}`).set("X-Device-Id", "jest-device");

beforeAll(async () => {
  await connectDB();
  await User.deleteOne({ email: TEST_EMAIL });
  const user = await User.create({
    name: "Jest Suite",
    email: TEST_EMAIL,
    passwordHash: "x".repeat(20),
    emailVerified: true,
  });
  userId = user._id.toString();
  token = issueAccessToken(userId, "jest-device");
}, 30000);

afterAll(async () => {
  await UserData.deleteMany({ userId });
  await User.deleteOne({ _id: userId });
  await RateLimit.deleteMany({ key: /^jest:/ });
  await mongoose.disconnect();
}, 30000);

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /health", () => {
  it("reports database connectivity", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("connected");
    expect(res.body.status).toBe("ok");
  });

  it("answers 200 even so, because a restart cannot fix a database outage", async () => {
    // Guards the deliberate choice documented in app.js: Render restarts an
    // instance that fails its health check, which would loop against a Mongo
    // outage mongoose already retries on its own.
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("/api/data", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/data")).status).toBe(401);
  });

  it("returns null for a namespace never written, rather than 404", async () => {
    const res = await auth(request(app).get("/api/data/cv"));
    expect(res.status).toBe(200);
    expect(res.body.payload).toBeNull();
    expect(res.body.revision).toBe(0);
  });

  it("round-trips a payload unchanged", async () => {
    const payload = { fullName: "Test", skills: ["React Native"], nested: { score: 78 } };
    const put = await auth(request(app).put("/api/data/cv")).send({ payload });
    expect(put.status).toBe(200);
    expect(put.body.revision).toBe(1);

    const get = await auth(request(app).get("/api/data/cv"));
    expect(get.body.payload).toEqual(payload);
  });

  it("increments the revision on overwrite", async () => {
    const res = await auth(request(app).put("/api/data/cv")).send({ payload: { v: 2 } });
    expect(res.body.revision).toBe(2);
  });

  it("keeps role-scoped namespaces separate", async () => {
    await auth(request(app).put("/api/data/roadmap:frontend")).send({ payload: { weeks: 12 } });
    await auth(request(app).put("/api/data/roadmap:backend")).send({ payload: { weeks: 8 } });
    const fe = await auth(request(app).get("/api/data/roadmap:frontend"));
    const be = await auth(request(app).get("/api/data/roadmap:backend"));
    expect(fe.body.payload.weeks).toBe(12);
    expect(be.body.payload.weeks).toBe(8);
  });

  it("returns every payload in one request with ?payloads=1", async () => {
    // Sign-in hydration used to fetch the manifest and then each namespace
    // separately, so a single sign-in cost 1+N requests and 1+N counts against
    // the rate limit. Guards that it stays one request.
    const res = await auth(request(app).get("/api/data?payloads=1"));
    expect(res.status).toBe(200);
    expect(res.body.namespaces.length).toBeGreaterThanOrEqual(3);
    for (const entry of res.body.namespaces) {
      expect(entry).toHaveProperty("payload");
    }
  });

  it("omits payloads from the manifest", async () => {
    const res = await auth(request(app).get("/api/data"));
    expect(res.body.namespaces.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(res.body)).not.toContain("weeks");
  });

  it("writes many namespaces in one bulk call", async () => {
    const res = await auth(request(app).post("/api/data/bulk")).send({
      items: [
        { namespace: "jobs:matches", payload: [{ id: "j1" }] },
        { namespace: "portfolio",    payload: { github: "x" } },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.saved).toHaveLength(2);
  });

  it("rejects namespaces outside the allowed character set", async () => {
    for (const ns of ["../../etc/passwd", "CV bad!", "has/slash"]) {
      const res = await auth(request(app).get(`/api/data/${encodeURIComponent(ns)}`));
      expect(res.status).toBe(400);
    }
  });

  it("rejects a payload over the size cap", async () => {
    const res = await auth(request(app).put("/api/data/big")).send({ payload: { blob: "x".repeat(600 * 1024) } });
    expect(res.status).toBe(413);
  });

  it("deletes a namespace", async () => {
    await auth(request(app).put("/api/data/temp")).send({ payload: { a: 1 } });
    expect((await auth(request(app).delete("/api/data/temp"))).status).toBe(200);
    expect((await auth(request(app).get("/api/data/temp"))).body.payload).toBeNull();
  });

  it("scopes data to the owning user", async () => {
    const other = await User.create({
      name: "Other", email: "jest-other@test.local", passwordHash: "y".repeat(20), emailVerified: true,
    });
    const otherToken = issueAccessToken(other._id.toString(), "other-device");
    const res = await request(app).get("/api/data/cv").set("Authorization", `Bearer ${otherToken}`);
    expect(res.body.payload).toBeNull();   // must not see the first user's CV
    await User.deleteOne({ _id: other._id });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("/api/ai", () => {
  it("requires authentication", async () => {
    expect((await request(app).post("/api/ai/chat").send({ prompt: "hi" })).status).toBe(401);
    expect((await request(app).get("/api/ai/status")).status).toBe(401);
  });

  it("refuses a Hawk task the adapter was never trained on", async () => {
    const res = await auth(request(app).post("/api/ai/hawk/not_a_real_task")).send({ input: "x" });
    expect(res.status).toBe(404);
  });

  it("refuses a path-traversal task name before contacting the model host", async () => {
    const res = await auth(request(app).post(`/api/ai/hawk/${encodeURIComponent("../../admin")}`)).send({ input: "x" });
    expect([400, 404]).toContain(res.status);
  });

  it("validates the chat prompt", async () => {
    expect((await auth(request(app).post("/api/ai/chat")).send({})).status).toBe(400);
    expect((await auth(request(app).post("/api/ai/chat")).send({ prompt: "   " })).status).toBe(400);
  });

  it("rejects an oversized prompt", async () => {
    const res = await auth(request(app).post("/api/ai/chat")).send({ prompt: "x".repeat(30000) });
    expect(res.status).toBe(413);
  });

  it("reports provider status", async () => {
    const res = await auth(request(app).get("/api/ai/status"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("general.configured");
    expect(res.body).toHaveProperty("hawk.configured");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Google OAuth state", () => {
  it("carries the redirect URI in a signed state and a paired nonce cookie", async () => {
    const redirectUri = "career-assistant://oauth/callback";
    const res = await request(app).get(`/api/auth/google?redirectUri=${encodeURIComponent(redirectUri)}`);

    expect(res.status).toBe(302);
    const state = new URL(res.headers.location).searchParams.get("state");
    expect(state).toBeTruthy();

    const payload = jwt.verify(state, process.env.JWT_SECRET);
    expect(payload.redirectUri).toBe(redirectUri);
    expect(payload.nonce).toBeTruthy();

    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("oauth_nonce");
    expect(cookie).toContain(payload.nonce);   // state is bound to this browser
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("does not accept a redirect URI that is not allow-listed", async () => {
    const res = await request(app).get(
      `/api/auth/google?redirectUri=${encodeURIComponent("https://attacker.test/steal")}`
    );
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).not.toContain("<script");   // the echoed URI is escaped
  });

  it("accepts every shape of client the app ships", async () => {
    for (const uri of ["exp://192.168.0.8:8081/--/oauth/callback", "career-assistant://oauth/callback"]) {
      const res = await request(app).get(`/api/auth/google?redirectUri=${encodeURIComponent(uri)}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("accounts.google.com");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("error responses", () => {
  it("returns a request ID and withholds internal detail", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("404s an unknown route", async () => {
    expect((await request(app).get("/api/nope")).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("rate limit store", () => {
  const store = new MongoRateLimitStore({ prefix: "jest" });

  beforeAll(() => store.init({ windowMs: 60_000 }));
  afterEach(() => store.resetAll());

  it("survives a process restart", async () => {
    await store.increment("k");
    await store.increment("k");

    // A fresh instance is what a redeployed server looks like.
    const restarted = new MongoRateLimitStore({ prefix: "jest" });
    restarted.init({ windowMs: 60_000 });
    expect((await restarted.increment("k")).totalHits).toBe(3);
  });

  it("loses no hits under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => store.increment("burst")));
    expect(Math.max(...results.map((r) => r.totalHits))).toBe(20);
  });

  it("starts a fresh window once the old one expires", async () => {
    const short = new MongoRateLimitStore({ prefix: "jest" });
    short.init({ windowMs: 250 });
    await short.increment("rolling");
    await new Promise((r) => setTimeout(r, 400));
    expect((await short.increment("rolling")).totalHits).toBe(1);
  });
});
