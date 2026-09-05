/**
 * One account per device for fingerprint sign-in.
 *
 * Biometric sign-in starts from the device, not from a username: the phone says
 * "someone authorised" and the server must decide whose account that opens. The
 * OS never reveals which finger was used — authenticateAsync returns only
 * success — so the device is the finest identity available, and it holds one
 * account. Without this, a second enrolment silently replaced the first and the
 * button opened the wrong account.
 */
const src = require("fs").readFileSync(require.resolve("../services/authService.js"), "utf8");

describe("registerBiometric", () => {
  const fn = src.slice(src.indexOf("async registerBiometric"), src.indexOf("async verifyBiometric"));

  it("identifies the device from the header the client already sends", () => {
    expect(fn).toMatch(/x-device-id/);
  });

  it("rejects a request with no device identity rather than binding to nothing", () => {
    expect(fn).toMatch(/if \(!deviceId\)/);
  });

  it("records the device against the account", () => {
    expect(fn).toMatch(/biometricDeviceId:\s*deviceId/);
  });

  it("no longer refuses a second account on the same device", () => {
    // Refusing stopped a shared phone working at all. Several accounts may
    // enrol; the user's number resolves which one is signing in.
    expect(fn).not.toMatch(/BIOMETRIC_DEVICE_TAKEN/);
    expect(fn).not.toMatch(/status: 409/);
  });
});

describe("verifyBiometric", () => {
  const fn = src.slice(src.indexOf("async verifyBiometric"), src.indexOf("async disableBiometric"));

  it("accepts an account number as well as an id", () => {
    expect(fn).toMatch(/userNumber/);
    expect(fn).toMatch(/findOne\(\{ userNumber/);
  });

  it("requires one of them, and always the credential", () => {
    expect(fn).toMatch(/!credentialIdHash \|\| \(!userId && !userNumber\)/);
  });

  it("strips formatting from a typed number", () => {
    // The client shows "1234 5678"; a user may type it with the space.
    expect(fn).toMatch(/replace\(\/\\D\/g, ""\)/);
  });

  it("still checks the stored credential, whichever way the account was named", () => {
    expect(fn).toMatch(/timingSafeEqual/);
  });
});

describe("disableBiometric", () => {
  const fn = src.slice(src.indexOf("async disableBiometric"));

  it("releases the device so another account can enrol", () => {
    // Without this the refusal would be permanent for everyone else on the phone.
    expect(fn.slice(0, 500)).toMatch(/biometricDeviceId:\s*undefined/);
  });
});

describe("the User model", () => {
  const model = require("fs").readFileSync(require.resolve("../models/User.js"), "utf8");

  it("records which device an account enrolled on", () => {
    expect(model).toMatch(/biometricDeviceId:\s*\{ type: String, index: true \}/);
  });

  it("gives every account a unique 8-digit number", () => {
    expect(model).toMatch(/userNumber:/);
    expect(model).toMatch(/unique: true/);
    expect(model).toMatch(/\^\\d\{8\}\$/);
  });

  it("allocates one on every creation path, not at each call site", () => {
    // Local registration and Google sign-in both create users; a hook covers
    // both and anything added later.
    expect(model).toMatch(/UserSchema\.pre\("save"[\s\S]*?generateUserNumber/);
  });

  it("checks a candidate is free before using it", () => {
    expect(model).toMatch(/await this\.exists\(\{ userNumber: n \}\)/);
  });

  it("is sparse, so accounts predating the field stay valid", () => {
    expect(model).toMatch(/sparse: true/);
  });
});
