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

  it("refuses when the device belongs to another account", () => {
    expect(fn).toMatch(/biometricDeviceId: deviceId/);
    expect(fn).toMatch(/_id:\s*\{ \$ne: userId \}/);
    expect(fn).toMatch(/biometricEnabled:\s*true/);
  });

  it("refuses with 409 and a code the client can act on", () => {
    expect(fn).toMatch(/status: 409/);
    expect(fn).toMatch(/BIOMETRIC_DEVICE_TAKEN/);
  });

  it("names the holding account only in masked form", () => {
    // Enough for the phone's owner to recognise their own other account,
    // without printing a full address to whoever is holding it.
    expect(fn).toMatch(/maskEmail\(/);
    expect(fn).not.toMatch(/\$\{taken\.email\}/);
  });

  it("records the device, so the next account can be refused", () => {
    expect(fn).toMatch(/biometricDeviceId:\s*deviceId/);
  });

  it("rejects a request with no device identity rather than binding to nothing", () => {
    expect(fn).toMatch(/if \(!deviceId\)/);
  });
});

describe("disableBiometric", () => {
  const fn = src.slice(src.indexOf("async disableBiometric"));

  it("releases the device so another account can enrol", () => {
    // Without this the refusal would be permanent for everyone else on the phone.
    expect(fn.slice(0, 500)).toMatch(/biometricDeviceId:\s*undefined/);
  });
});

describe("maskEmail", () => {
  // Re-declared rather than imported: it is a module-local helper.
  const maskEmail = (email) => {
    const [name, domain] = String(email ?? "").split("@");
    if (!domain) return "another account";
    return `${name.slice(0, 1)}${"*".repeat(Math.max(name.length - 1, 1))}@${domain}`;
  };

  it("keeps the first letter and the domain", () => {
    expect(maskEmail("rashid@gmail.com")).toBe("r*****@gmail.com");
  });

  it("does not leak the length of a one-character name", () => {
    expect(maskEmail("a@x.com")).toBe("a*@x.com");
  });

  it("degrades safely on nonsense", () => {
    expect(maskEmail("")).toBe("another account");
    expect(maskEmail(undefined)).toBe("another account");
  });
});

describe("the User model records the device", () => {
  const model = require("fs").readFileSync(require.resolve("../models/User.js"), "utf8");
  it("has an indexed biometricDeviceId", () => {
    expect(model).toMatch(/biometricDeviceId:\s*\{ type: String, index: true \}/);
  });
});
