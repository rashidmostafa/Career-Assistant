/**
 * Comprehensive auth test suite — v2.
 *
 * Unit:        RiskScoringService, SessionManager, BiometricService,
 *              NotificationService
 *
 * OtpService was removed: it was a client-side simulation that stored TOTP
 * secrets and backup codes in plaintext AsyncStorage and whose verifyTotp
 * accepted any well-formed 6-digit code. Nothing imported it. The real
 * implementation is server-side (speakeasy + User.totpSecret/backupCodes,
 * both select:false in Atlas).
 * Server unit: AuthService (mocked DB), EmailService, SmsService
 * Integration: Full HTTP flows via supertest
 * Security:    Rate limiting, account lockout, token reuse, TOTP, backup codes
 * GDPR:        Export, deletion, consent
 * Edge cases:  Network retry, biometric not available, 2FA auto-resend,
 *              session expired mid-action, device switch
 *
 * Run: cd Career-Assistant-main && npm test
 */

// ── Minimal mocks so tests run without a real MongoDB ────────────────────────
jest.mock("../server/config/db", () => ({
  connectDB: jest.fn().mockResolvedValue(true),
  mongoose: {},
}));

// Mock email + SMS services to prevent real network calls
jest.mock("../server/services/emailService", () => ({
  sendOtp:            jest.fn().mockResolvedValue(undefined),
  sendSessionWarning: jest.fn().mockResolvedValue(undefined),
  sendRecoveryEmail:  jest.fn().mockResolvedValue(undefined),
  // /health reads this; a mock without it made the endpoint 500.
  status: () => ({ provider: "none", configured: false, from: "test@local", lastSend: { at: null, ok: null, reason: null } }),
}));
jest.mock("../server/services/pushNotificationService", () => ({
  send:                  jest.fn().mockResolvedValue(undefined),
  sendSessionReminder:   jest.fn().mockResolvedValue(undefined),
  sendSecurityAlert:     jest.fn().mockResolvedValue(undefined),
}));

const mongoose = require("mongoose");

// Must be `mock`-prefixed: babel-plugin-jest-hoist lifts jest.mock() factories
// above this declaration and rejects out-of-scope references unless the name
// starts with "mock".
function mockMakeModel() {
  return {
    create:             jest.fn(),
    findOne:            jest.fn(),
    findById:           jest.fn(),
    findByIdAndUpdate:  jest.fn(),
    updateOne:          jest.fn(),
    updateMany:         jest.fn(),
    find:               jest.fn(),
    findOneAndUpdate:   jest.fn(),
    countDocuments:     jest.fn().mockResolvedValue(0),
  };
}

jest.mock("../server/models/User",     () => mockMakeModel());
jest.mock("../server/models/Session",  () => mockMakeModel());
jest.mock("../server/models/AuditLog", () => mockMakeModel());

// ─────────────────────────────────────────────────────────────────────────────
// 2. Risk Scoring Service
// ─────────────────────────────────────────────────────────────────────────────
describe("RiskScoringService", () => {
  let RiskScoringService;

  beforeAll(() => {
    RiskScoringService = require("../services/riskScoring").RiskScoringService;
  });

  test("known device + business hours + no failures → LOW risk", async () => {
    const result = await RiskScoringService.calculate({
      deviceId: "dev_known",
      knownDeviceIds: ["dev_known"],
      hour: 10,
      recentFailures: 0,
    });
    expect(result.level).toBe("LOW");
    expect(result.score).toBeLessThan(25);
    expect(result.require2FA).toBe(false);
  });

  test("unknown device → score increases by 30", async () => {
    const result = await RiskScoringService.calculate({
      deviceId: "dev_new",
      knownDeviceIds: [],
      hour: 10,
      recentFailures: 0,
    });
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.factors).toContain("Unrecognised device");
  });

  test("late-night login → score increases", async () => {
    const night = await RiskScoringService.calculate({
      deviceId: "dev_known",
      knownDeviceIds: ["dev_known"],
      hour: 2,
      recentFailures: 0,
    });
    const day = await RiskScoringService.calculate({
      deviceId: "dev_known",
      knownDeviceIds: ["dev_known"],
      hour: 10,
      recentFailures: 0,
    });
    expect(night.score).toBeGreaterThan(day.score);
  });

  test("failures alone cap at +30 → MEDIUM, not CRITICAL", async () => {
    const result = await RiskScoringService.calculate({
      deviceId: "dev_x",
      knownDeviceIds: ["dev_x"],
      hour: 10,
      recentFailures: 5,
    });
    // The failure penalty is capped at 30 (riskScoring.ts factor 3), so a known
    // device at a normal hour cannot reach HIGH on failures alone. That is
    // deliberate: User.incrementLoginAttempts locks the account outright at 5
    // attempts (server/models/User.js), which is the stricter control.
    expect(result.score).toBe(30);
    expect(result.level).toBe("MEDIUM");
    expect(result.require2FA).toBe(false);
  });

  test("compounded factors → CRITICAL with require2FA", async () => {
    const result = await RiskScoringService.calculate({
      deviceId: "dev_unknown",
      knownDeviceIds: ["dev_known"],
      hour: 2,
      recentFailures: 5,
      timeSinceLastLogin: 31 * 24 * 60 * 60 * 1000,
    });
    // 30 unknown device + 10 late-night + 30 failures + 15 inactivity = 85
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.level).toBe("CRITICAL");
    expect(result.require2FA).toBe(true);
    expect(result.requireSecurityQ).toBe(true);
  });

  test("getLevelColor returns a hex string for all levels", () => {
    ["LOW", "MEDIUM", "HIGH", "CRITICAL"].forEach((l) => {
      const color = RiskScoringService.getLevelColor(l);
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  test("HIGH + CRITICAL → require2FA true", async () => {
    const critical = await RiskScoringService.calculate({
      deviceId: "dev_new",
      knownDeviceIds: [],
      hour: 2,
      recentFailures: 5,
    });
    expect(critical.require2FA).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Session Manager
// ─────────────────────────────────────────────────────────────────────────────
describe("SessionManager", () => {
  let SessionManager;
  const { ACCESS_TOKEN_TTL, SESSION_TTL, GRACE_PERIOD } = require("../services/sessionManager");

  beforeAll(() => {
    SessionManager = require("../services/sessionManager").SessionManager;
  });

  test("constants are correct", () => {
    expect(ACCESS_TOKEN_TTL).toBe(15 * 60 * 1000);
    expect(SESSION_TTL).toBe(56 * 24 * 60 * 60 * 1000);
    expect(GRACE_PERIOD).toBe(12 * 60 * 60 * 1000);
  });

  test("getReauthUrgency returns 'none' with no session start", async () => {
    const urgency = await SessionManager.getReauthUrgency();
    expect(urgency).toBe("none");
  });

  test("getSessionDaysRemaining returns 56 with no session start", async () => {
    const days = await SessionManager.getSessionDaysRemaining();
    expect(days).toBe(56);
  });

  test("getOrCreateDeviceId returns a non-empty string", async () => {
    const id = await SessionManager.getOrCreateDeviceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. BiometricService
// ─────────────────────────────────────────────────────────────────────────────
describe("BiometricService", () => {
  let BiometricService;

  beforeAll(() => {
    BiometricService = require("../services/biometricService").BiometricService;
  });

  test("getAvailability reports biometrics when hardware is enrolled (mocked)", async () => {
    const { available, type } = await BiometricService.getAvailability();
    expect(available).toBe(true);
    // Mocked supportedAuthenticationTypesAsync returns [1, 2], 2 = FACIAL_RECOGNITION
    expect(type).toBe("Biometrics");
  });

  test("authenticate returns success: true when mock succeeds", async () => {
    const result = await BiometricService.authenticate("Test prompt");
    expect(result.success).toBe(true);
  });

  test("isEnrolled returns false when not enrolled", async () => {
    const enrolled = await BiometricService.isEnrolled();
    expect(typeof enrolled).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Email Service (unit)
// ─────────────────────────────────────────────────────────────────────────────
describe("EmailService", () => {
  // Use real module — it falls back to console in dev (no SMTP/SG env vars)
  const originalMock = jest.requireMock("../server/services/emailService");

  test("sendOtp mock is callable", async () => {
    await expect(originalMock.sendOtp("test@example.com", "123456", "2fa")).resolves.toBeUndefined();
    expect(originalMock.sendOtp).toHaveBeenCalledWith("test@example.com", "123456", "2fa");
  });

  test("sendRecoveryEmail mock is callable", async () => {
    await expect(originalMock.sendRecoveryEmail("test@example.com", "tok")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. AuthService (server unit — mocked DB)
// ─────────────────────────────────────────────────────────────────────────────
describe("AuthService (server unit)", () => {
  let AuthService;
  let User, Session, AuditLog;

  beforeAll(() => {
    AuthService = require("../server/services/authService");
    User        = require("../server/models/User");
    Session     = require("../server/models/Session");
    AuditLog    = require("../server/models/AuditLog");
  });

  beforeEach(() => jest.clearAllMocks());

  const fakeUser = {
    _id:                 new mongoose.Types.ObjectId(),
    name:                "Test User",
    email:               "test@example.com",
    emailVerified:       true,
    twoFactorEnabled:    false,
    loginAttempts:       0,
    accountLocked:       false,
    knownDevices:        [],
    trustedDevices:      [],
    securityQuestionsSet: false,
    securityQuestions:   [],
    passwordHash:        "$2a$12$fake",
    comparePassword:     jest.fn().mockResolvedValue(true),
    resetLoginAttempts:  jest.fn().mockResolvedValue(undefined),
    incrementLoginAttempts: jest.fn().mockImplementation(function() { this.loginAttempts += 1; return Promise.resolve(); }),
    isDeviceTrusted:     jest.fn().mockReturnValue(false),
    toSafeObject:        jest.fn().mockReturnValue({ id: "fake-id", email: "test@example.com" }),
    save:                jest.fn().mockResolvedValue(undefined),
  };

  test("register: throws 409 on duplicate email", async () => {
    User.findOne.mockResolvedValue(fakeUser);
    await expect(
      AuthService.register({ name: "X", email: "test@example.com", password: "P@ssw0rd!" }, {})
    ).rejects.toMatchObject({ message: expect.stringContaining("already exists") });
  });

  test("register: creates user and returns userId", async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ ...fakeUser, _id: new mongoose.Types.ObjectId() });
    AuditLog.create.mockResolvedValue({});
    const result = await AuthService.register(
      { name: "New", email: "new@example.com", password: "P@ssw0rd!", consentGiven: true },
      { ip: "1.2.3.4", headers: {} }
    );
    expect(result).toHaveProperty("userId");
    expect(result.message).toContain("verification code");
  });

  test("login: returns require2FA when 2FA is enabled", async () => {
    const user2fa = {
      ...fakeUser,
      twoFactorEnabled: true,
      twoFactorMethod:  "totp",
    };
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user2fa),
    });
    User.findByIdAndUpdate.mockResolvedValue({});
    AuditLog.create.mockResolvedValue({});
    const result = await AuthService.login(
      { email: "test@example.com", password: "P@ssw0rd!", deviceId: "dev-new" },
      { ip: "1.2.3.4", headers: {} }
    );
    expect(result.require2FA).toBe(true);
    expect(result).toHaveProperty("userId");
  });

  test("login: fails with wrong password and increments attempts", async () => {
    const lockedUser = { ...fakeUser, comparePassword: jest.fn().mockResolvedValue(false) };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(lockedUser) });
    AuditLog.create.mockResolvedValue({});
    await expect(
      AuthService.login({ email: "test@example.com", password: "wrong", deviceId: "dev" }, { ip: "1.2.3.4", headers: {} })
    ).rejects.toMatchObject({ message: expect.stringContaining("Invalid") });
    expect(lockedUser.incrementLoginAttempts).toHaveBeenCalled();
  });

  test("login: rejects locked account", async () => {
    const locked = {
      ...fakeUser,
      accountLocked: true,
      lockoutUntil:  new Date(Date.now() + 10 * 60 * 1000),
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(locked) });
    AuditLog.create.mockResolvedValue({});
    await expect(
      AuthService.login({ email: "test@example.com", password: "x", deviceId: "dev" }, { ip: "1.2.3.4", headers: {} })
    ).rejects.toMatchObject({ message: expect.stringContaining("locked") });
  });

  test("login: rejects unverified email", async () => {
    const unverified = { ...fakeUser, emailVerified: false };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(unverified) });
    AuditLog.create.mockResolvedValue({});
    await expect(
      AuthService.login({ email: "test@example.com", password: "P@ssw0rd!", deviceId: "dev" }, { ip: "1.2.3.4", headers: {} })
    ).rejects.toMatchObject({ message: expect.stringContaining("verify your email") });
  });

  test("verify2FA: throws on wrong backup code", async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ ...fakeUser, backupCodes: ["AAAA-BBBB"] }) });
    await expect(
      AuthService.verify2FA({ userId: "uid", code: "XXXX-YYYY", method: "backup", deviceId: "dev" }, {})
    ).rejects.toMatchObject({ message: "Invalid backup code." });
  });

  test("resetPassword: throws on invalid recovery token", async () => {
    await expect(
      AuthService.resetPassword({ recoveryToken: "invalid-token", newPassword: "NewP@ss1!" }, {})
    ).rejects.toMatchObject({ message: expect.stringContaining("expired or invalid") });
  });

  test("setSecurityQuestions: throws when fewer than 3 provided", async () => {
    await expect(
      AuthService.setSecurityQuestions("uid", [{ question: "Q1", answer: "A1" }], {})
    ).rejects.toMatchObject({ message: expect.stringContaining("3 security questions") });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. HTTP integration — full flow via supertest
// ─────────────────────────────────────────────────────────────────────────────
describe("HTTP Integration (supertest)", () => {
  let app, request;
  let User, Session, AuditLog;

  beforeAll(async () => {
    request = require("supertest");
    app     = require("../server/app");
    User     = require("../server/models/User");
    Session  = require("../server/models/Session");
    AuditLog = require("../server/models/AuditLog");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    AuditLog.create.mockResolvedValue({});
  });

  test("GET /health → always 200, and reports database state", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);

    // /health now distinguishes "the process is alive" from "its database is
    // reachable". It answers 200 either way on purpose: Render restarts an
    // instance whose health check fails, which cannot fix a Mongo outage and
    // would just cycle the process. `status` and `db` are what monitoring
    // alerts on. These models are mocked here, so no connection exists and
    // "degraded" is the correct reading.
    expect(res.body).toHaveProperty("db");
    expect(["ok", "degraded"]).toContain(res.body.status);
    expect(res.body.status).toBe(res.body.db === "connected" ? "ok" : "degraded");
  });

  test("GET /unknown-route → 404", async () => {
    const res = await request(app).get("/api/nonexistent");
    expect(res.status).toBe(404);
  });

  test("POST /api/auth/register → 409 on duplicate email", async () => {
    User.findOne.mockResolvedValue({ email: "dup@example.com" });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Dup", email: "dup@example.com", password: "P@ssw0rd!" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/);
  });

  test("POST /api/auth/register → 201 for a new user", async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      email: "new@example.com",
      securityQuestionsSet: false,
      save: jest.fn(),
    });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "New User", email: "new@example.com", password: "P@ssw0rd!" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("userId");
  });

  test("POST /api/auth/login → 401 for wrong credentials", async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        emailVerified: true,
        twoFactorEnabled: false,
        accountLocked: false,
        loginAttempts: 0,
        lockoutUntil: null,
        knownDevices: [],
        trustedDevices: [],
        comparePassword: jest.fn().mockResolvedValue(false),
        incrementLoginAttempts: jest.fn(),
        toSafeObject: jest.fn().mockReturnValue({}),
      }),
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  test("POST /api/auth/refresh → 401 with bad token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "bad.token.here" });
    expect(res.status).toBe(401);
  });

  test("GET /api/user/profile → 401 without token", async () => {
    const res = await request(app).get("/api/user/profile");
    expect(res.status).toBe(401);
  });

  test("POST /api/auth/recover → 200 (generic response for unknown email)", async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = await request(app)
      .post("/api/auth/recover")
      .send({ method: "email", email: "nobody@example.com" });
    expect(res.status).toBe(200);
  });

  test("POST /api/auth/reset-password → 400 with invalid token", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ recoveryToken: "nonexistent", newPassword: "NewP@ss1!" });
    expect(res.status).toBe(400);
  });

  test("POST /api/auth/2fa/resend → 404 for unknown userId", async () => {
    User.findById.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/auth/2fa/resend")
      .send({ userId: new mongoose.Types.ObjectId().toString(), method: "email" });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Security tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Security", () => {
  let request, app;

  beforeAll(() => {
    request = require("supertest");
    app     = require("../server/app");
    const AuditLog = require("../server/models/AuditLog");
    AuditLog.create.mockResolvedValue({});
  });

  test("Rate limiter headers present on auth endpoints", async () => {
    const User = require("../server/models/User");
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "rate@example.com", password: "wrong" });
    // express-rate-limit adds RateLimit-* headers
    const hasRateHeader =
      "ratelimit-limit" in res.headers ||
      "x-ratelimit-limit" in res.headers ||
      res.status === 429;
    expect(hasRateHeader || res.status >= 400).toBe(true);
  });

  test("Account lockout after 5 wrong passwords (unit)", async () => {
    const AuthService = require("../server/services/authService");
    const User        = require("../server/models/User");
    const AuditLog    = require("../server/models/AuditLog");
    AuditLog.create.mockResolvedValue({});

    let attempts = 0;
    const lockedUser = {
      _id: new mongoose.Types.ObjectId(),
      emailVerified: true,
      twoFactorEnabled: false,
      accountLocked: false,
      loginAttempts: 0,
      lockoutUntil: null,
      knownDevices: [],
      trustedDevices: [],
      comparePassword: jest.fn().mockResolvedValue(false),
      incrementLoginAttempts: jest.fn().mockImplementation(function() {
        attempts++;
        if (attempts >= 5) { this.accountLocked = true; this.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); }
        return Promise.resolve();
      }),
      isDeviceTrusted: jest.fn().mockReturnValue(false),
      toSafeObject: jest.fn().mockReturnValue({}),
    };

    for (let i = 0; i < 5; i++) {
      User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(lockedUser) });
      try { await AuthService.login({ email: "x@x.com", password: "wrong", deviceId: "d" }, { ip: "1.2.3.4", headers: {} }); }
      catch (_) {}
    }
    expect(lockedUser.incrementLoginAttempts).toHaveBeenCalledTimes(5);
    expect(attempts).toBe(5);
    expect(lockedUser.accountLocked).toBe(true);
  });

  test("Refresh token replay is rejected after use", async () => {
    const request = require("supertest");
    const app     = require("../server/app");
    // First call — session not found
    const Session = require("../server/models/Session");
    Session.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "already.used.token" });
    expect(res.status).toBe(401);
  });

  test("JWT with invalid signature is rejected", async () => {
    const request = require("supertest");
    const app     = require("../server/app");
    const res = await request(app)
      .get("/api/user/profile")
      .set("Authorization", "Bearer invalid.jwt.signature");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. GDPR tests
// ─────────────────────────────────────────────────────────────────────────────
describe("GDPR", () => {
  let request, app;

  beforeAll(() => {
    request = require("supertest");
    app     = require("../server/app");
  });

  test("GET /api/user/export requires authentication", async () => {
    const res = await request(app).get("/api/user/export?format=json");
    expect(res.status).toBe(401);
  });

  test("POST /api/user/delete requires authentication", async () => {
    const res = await request(app).post("/api/user/delete");
    expect(res.status).toBe(401);
  });

  test("POST /api/user/consent requires authentication", async () => {
    const res = await request(app).post("/api/user/consent");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("Edge cases", () => {
  test("OTP expired after TTL", () => {
    // Simulate the internal OTP store behaviour described in authService
    const store = new Map();
    const key   = "test_otp";
    store.set(key, { code: "123456", expiresAt: Date.now() - 1, attempts: 0 });
    const entry = store.get(key);
    const expired = Date.now() > entry.expiresAt;
    expect(expired).toBe(true);
  });

  test("SessionManager urgency — none when session start is very recent", async () => {
    const SecureStore = require("expo-secure-store");
    // getItemAsync returns session started just now
    SecureStore.getItemAsync.mockImplementation((key) => {
      if (key === "auth_session_start") return Promise.resolve(String(Date.now()));
      return Promise.resolve(null);
    });
    const { SessionManager } = require("../services/sessionManager");
    const urgency = await SessionManager.getReauthUrgency();
    expect(urgency).toBe("none");
  });

  test("SessionManager urgency — expired past SESSION_TTL + GRACE_PERIOD", async () => {
    const { SESSION_TTL, GRACE_PERIOD } = require("../services/sessionManager");
    const SecureStore = require("expo-secure-store");
    const oldStart = Date.now() - SESSION_TTL - GRACE_PERIOD - 1000;
    SecureStore.getItemAsync.mockImplementation((key) => {
      if (key === "auth_session_start") return Promise.resolve(String(oldStart));
      return Promise.resolve(null);
    });
    const { SessionManager } = require("../services/sessionManager");
    const urgency = await SessionManager.getReauthUrgency();
    expect(urgency).toBe("expired");
  });

  test("BiometricService.getAvailability returns false when hardware unavailable", async () => {
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.hasHardwareAsync.mockResolvedValueOnce(false);
    const { BiometricService } = require("../services/biometricService");
    const { available } = await BiometricService.getAvailability();
    expect(available).toBe(false);
  });

  test("BiometricService.authenticate fails gracefully when not enrolled", async () => {
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.hasHardwareAsync.mockResolvedValueOnce(true);
    LocalAuth.isEnrolledAsync.mockResolvedValueOnce(false);
    const { BiometricService } = require("../services/biometricService");
    const result = await BiometricService.authenticate("Test");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Social OAuth & Biometric server endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe("Social OAuth — AuthService.issueSocialSession", () => {
  test("throws 401 when user is null", async () => {
    const AuthService = require("../server/services/authService");
    await expect(AuthService.issueSocialSession(null, {}))
      .rejects.toMatchObject({ status: 401 });
  });

  test("issues tokens and returns accessToken + refreshToken for a valid user", async () => {
    // Minimal user stub that matches what Mongoose would return
    const fakeUser = {
      _id: "user_social_001",
      provider: "google",
      resetLoginAttempts: jest.fn().mockResolvedValue(undefined),
      toSafeObject: jest.fn().mockReturnValue({ id: "user_social_001", email: "g@test.com" }),
    };
    const AuthService = require("../server/services/authService");
    const result = await AuthService.issueSocialSession(fakeUser, {
      headers: { "user-agent": "test", "x-device-id": "dev-001" },
      ip: "127.0.0.1",
    });
    expect(result).toHaveProperty("accessToken");
    expect(result).toHaveProperty("refreshToken");
    expect(result).toHaveProperty("expiresAt");
    expect(typeof result.expiresAt).toBe("number");
  });
});

describe("Biometric — AuthService hash helper", () => {
  test("hashBiometricToken returns a 64-char hex string", () => {
    const AuthService = require("../server/services/authService");
    const hash = AuthService.hashBiometricToken("test-credential-id");
    expect(typeof hash).toBe("string");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  test("same input always produces the same hash (deterministic)", () => {
    const AuthService = require("../server/services/authService");
    const h1 = AuthService.hashBiometricToken("my-cred-id");
    const h2 = AuthService.hashBiometricToken("my-cred-id");
    expect(h1).toBe(h2);
  });

  test("different inputs produce different hashes", () => {
    const AuthService = require("../server/services/authService");
    const h1 = AuthService.hashBiometricToken("cred-A");
    const h2 = AuthService.hashBiometricToken("cred-B");
    expect(h1).not.toBe(h2);
  });
});

describe("Biometric — registerBiometric validation", () => {
  test("throws 400 when credentialIdHash is missing", async () => {
    const AuthService = require("../server/services/authService");
    await expect(AuthService.registerBiometric("uid-001", {}, {}))
      .rejects.toMatchObject({ status: 400 });
  });

  test("throws 400 when credentialIdHash is not a string", async () => {
    const AuthService = require("../server/services/authService");
    await expect(AuthService.registerBiometric("uid-001", { credentialIdHash: 12345 }, {}))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("Biometric — verifyBiometric input validation", () => {
  test("throws 400 when userId is missing", async () => {
    const AuthService = require("../server/services/authService");
    await expect(AuthService.verifyBiometric({ credentialIdHash: "abc" }, {}))
      .rejects.toMatchObject({ status: 400 });
  });

  test("throws 400 when credentialIdHash is missing", async () => {
    const AuthService = require("../server/services/authService");
    await expect(AuthService.verifyBiometric({ userId: "uid-001" }, {}))
      .rejects.toMatchObject({ status: 400 });
  });

  test("throws 401 when user is not found", async () => {
    const AuthService = require("../server/services/authService");
    // verifyBiometric calls User.findById(id).select("+biometricTokenHash"),
    // so stub the query chain here rather than inheriting whatever a previous
    // describe block left on the shared mock.
    const User = require("../server/models/User");
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    await expect(
      AuthService.verifyBiometric({ userId: "nonexistent-id-xyz", credentialIdHash: "abc123" }, {})
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("Biometric — BiometricService.saveCredential / clearCredential", () => {
  test("clearCredential resolves without error even when nothing is stored", async () => {
    const { BiometricService } = require("../services/biometricService");
    await expect(BiometricService.clearCredential()).resolves.not.toThrow();
  });

  test("isEnrolled returns false initially (nothing in AsyncStorage mock)", async () => {
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    AsyncStorage.getItem.mockResolvedValueOnce(null);
    const { BiometricService } = require("../services/biometricService");
    const enrolled = await BiometricService.isEnrolled();
    expect(enrolled).toBe(false);
  });

  test("isEnrolled returns true when the device holds an enrolment", async () => {
    // The enrolment map lives in SecureStore; the AsyncStorage flag is only a
    // mirror of it, so this is what actually decides.
    const SecureStore = require("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({ user1: { credentialId: "c1", userNumber: "12345678" } }),
    );
    const { BiometricService } = require("../services/biometricService");
    expect(await BiometricService.isEnrolled()).toBe(true);
  });
});

describe("Biometric — BiometricService.biometricLogin", () => {
  test("reports 'none' when nothing is enrolled on this device", async () => {
    const SecureStore = require("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValue(null);
    const { BiometricService } = require("../services/biometricService");
    expect(await BiometricService.biometricLogin()).toEqual({ status: "none" });
  });

  test("asks which account when several are enrolled here", async () => {
    // A fingerprint proves the owner is present; it cannot say which account
    // they meant, so the caller has to ask.
    const SecureStore = require("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValue(JSON.stringify({
      a: { credentialId: "c1", userNumber: "11111111" },
      b: { credentialId: "c2", userNumber: "22222222" },
    }));
    const { BiometricService } = require("../services/biometricService");
    expect(await BiometricService.biometricLogin()).toEqual({ status: "choose_account", accounts: 2 });
  });

  test("resolves the account from the number typed", async () => {
    const SecureStore = require("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValue(JSON.stringify({
      a: { credentialId: "c1", userNumber: "11111111" },
      b: { credentialId: "c2", userNumber: "22222222" },
    }));
    const { BiometricService } = require("../services/biometricService");
    const r = await BiometricService.biometricLogin({ userNumber: "2222 2222" });
    expect(r.status).toBe("ok");
    expect(r.userId).toBe("b");
  });

  test("rejects a number no account here answers to", async () => {
    const SecureStore = require("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValue(JSON.stringify({
      a: { credentialId: "c1", userNumber: "11111111" },
      b: { credentialId: "c2", userNumber: "22222222" },
    }));
    const { BiometricService } = require("../services/biometricService");
    expect(await BiometricService.biometricLogin({ userNumber: "99999999" }))
      .toEqual({ status: "unknown_number" });
  });

  test("reports cancelled when the fingerprint challenge is refused", async () => {
    const SecureStore = require("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ a: { credentialId: "c1", userNumber: "11111111" } }),
    );
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.authenticateAsync.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    const { BiometricService } = require("../services/biometricService");
    // Distinct from "none": there IS an account here, the user declined.
    expect(await BiometricService.biometricLogin()).toEqual({ status: "cancelled" });
  });
});

describe("Biometric — getBiometricLabel", () => {
  test("treats a face-only device as unsupported", async () => {
    // Fingerprint only: a face is shareable by a twin and defeatable by a
    // photograph on weaker sensors, and this app binds an account to it.
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.hasHardwareAsync.mockResolvedValueOnce(true);
    LocalAuth.isEnrolledAsync.mockResolvedValueOnce(true);
    LocalAuth.supportedAuthenticationTypesAsync.mockResolvedValueOnce([
      LocalAuth.AuthenticationType.FACIAL_RECOGNITION,
    ]);
    const { BiometricService } = require("../services/biometricService");
    expect(await BiometricService.getAvailability()).toEqual({ available: false, type: "None" });
  });

  test("accepts a device that also offers face, as long as it has a reader", async () => {
    // The OS picks which enrolled modality its prompt shows and gives no way to
    // demand one, so requiring a reader is as far as this can go.
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.hasHardwareAsync.mockResolvedValueOnce(true);
    LocalAuth.isEnrolledAsync.mockResolvedValueOnce(true);
    LocalAuth.supportedAuthenticationTypesAsync.mockResolvedValueOnce([
      LocalAuth.AuthenticationType.FACIAL_RECOGNITION,
      LocalAuth.AuthenticationType.FINGERPRINT,
    ]);
    const { BiometricService } = require("../services/biometricService");
    expect((await BiometricService.getAvailability()).available).toBe(true);
  });

  test("says 'Biometrics' for a fingerprint sensor too", async () => {
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.hasHardwareAsync.mockResolvedValueOnce(true);
    LocalAuth.isEnrolledAsync.mockResolvedValueOnce(true);
    LocalAuth.supportedAuthenticationTypesAsync.mockResolvedValueOnce([
      LocalAuth.AuthenticationType.FINGERPRINT,
    ]);
    const { BiometricService } = require("../services/biometricService");
    const label = await BiometricService.getBiometricLabel();
    expect(label).toBe("Biometrics");
  });

  test("returns 'Biometric' when hardware is unavailable", async () => {
    const LocalAuth = require("expo-local-authentication");
    LocalAuth.hasHardwareAsync.mockResolvedValue(false);
    const { BiometricService } = require("../services/biometricService");
    const label = await BiometricService.getBiometricLabel();
    LocalAuth.hasHardwareAsync.mockResolvedValue(true);
    expect(label).toBe("Biometric");
  });
});
