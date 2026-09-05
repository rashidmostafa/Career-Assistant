/**
 * Biometrics are offered, never demanded.
 *
 * The login screen used to call autoPromptOnMount, raising the OS biometric
 * sheet the moment it mounted. Because AuthGate routes back to /auth on any
 * transient absence of a user — including the moment before the profile
 * finishes loading — that threw a fingerprint prompt over whatever the user was
 * doing, unbidden and seemingly at random.
 *
 * The intended shape is a banking app's: enrol once, deliberately, in
 * Profile - Security; then the prompt appears only on tapping "Sign in with
 * biometrics".
 */
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const authScreen = read("app/auth.tsx");
const hook = read("hooks/useBiometric.ts");
const security = read("app/auth-security.tsx");

describe("nothing prompts for biometrics on its own", () => {
  it("the login screen has no mount-time prompt", () => {
    expect(authScreen).not.toMatch(/autoPromptOnMount/);
  });

  it("the hook no longer exposes one to call by accident", () => {
    expect(hook).not.toMatch(/autoPromptOnMount/);
  });

  it("no biometric call sits in a mount effect anywhere in the auth screen", () => {
    // Catches a reintroduction under a different name: a useEffect with an
    // empty or mount-only dependency list that reaches for the prompt.
    const effects = authScreen.match(/React\.useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const e of effects) {
      expect(e).not.toMatch(/biometric\.login\(|BiometricService\.authenticate|biometricLogin\(/);
    }
  });
});

describe("signing in with biometrics is a deliberate tap", () => {
  it("the button calls the login handler", () => {
    expect(authScreen).toMatch(/onPress=\{handleBiometricLogin\}/);
  });

  it("is offered only when this device holds a credential, not merely a sensor", () => {
    // A phone with a fingerprint reader but no credential for this account
    // cannot sign in this way; showing the button would fail on tap.
    expect(authScreen).toMatch(/biometricAvailable && biometric\.isEnrolled/);
  });

  it("makes exactly one attempt, so a rejection cannot double-prompt", () => {
    const handler = authScreen.slice(authScreen.indexOf("const handleBiometricLogin"));
    const body = handler.slice(0, handler.indexOf("}, ["));
    expect(body.match(/biometric\.login\(/g) ?? []).toHaveLength(1);
  });
});

describe("enrolment lives in Profile - Security", () => {
  it("the security screen enrols and disables", () => {
    expect(security).toMatch(/enrollBiometric\(\)/);
    expect(security).toMatch(/disableBiometric\(\)/);
  });

  it("the toggle reflects the account's stored setting", () => {
    expect(security).toMatch(/value=\{user\.biometricEnabled\}/);
  });

  it("profile links to it", () => {
    expect(read("app/(tabs)/profile.tsx")).toMatch(/router\.push\("\/auth-security"\)/);
  });
});

describe("fingerprint only", () => {
  const service = read("services/biometricService.ts");

  it("requires a fingerprint reader, not merely any biometric", () => {
    expect(service).toMatch(/AuthenticationType\.FINGERPRINT/);
    expect(service).toMatch(/return \{ available: false, type: "None" \};/);
  });

  it("refuses the device passcode as a stand-in", () => {
    // A PIN may have been shared; accepting it would let it substitute for the
    // fingerprint the account is bound to, which is the point of the binding.
    expect(service).toMatch(/disableDeviceFallback: true/);
    expect(service).not.toMatch(/disableDeviceFallback: false/);
  });

  it("does not still offer a passcode in its copy", () => {
    expect(service).not.toMatch(/Use Passcode/);
    expect(service).not.toMatch(/Use your passcode/);
  });

  it("asks for a fingerprint by name in the prompts", () => {
    expect(service).toMatch(/Sign in with your fingerprint/);
    expect(service).toMatch(/Confirm your fingerprint/);
  });
});

describe("one account per device, locally", () => {
  const service = read("services/biometricService.ts");
  const hook = read("hooks/useBiometric.ts");

  it("refuses to enrol over another account's binding", () => {
    const fn = service.slice(service.indexOf("async saveCredential"));
    expect(fn.slice(0, 900)).toMatch(/existingUser !== userId/);
  });

  it("checks before prompting, so the user is not asked for a finger it will reject", () => {
    const fn = service.slice(service.indexOf("async saveCredential"), service.indexOf("const hash = await sha256"));
    expect(fn.indexOf("existingUser !== userId")).toBeLessThan(fn.indexOf("this.authenticate("));
  });

  it("tells the user a refusal apart from a cancellation", () => {
    // The two are indistinguishable from outside saveCredential, and calling a
    // refusal a cancellation would send the user round the same loop forever.
    expect(hook).toMatch(/Another account on this device already uses fingerprint/);
    expect(service).toMatch(/async enrolledUserId\(\)/);
  });
});
