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

describe("several accounts may share a device", () => {
  const service = read("services/biometricService.ts");
  const hook = read("hooks/useBiometric.ts");

  it("holds a map of enrolments rather than a single credential", () => {
    // A single slot meant a second enrolment overwrote the first and the button
    // opened the wrong account.
    expect(service).toMatch(/ACCOUNTS_KEY/);
    expect(service).toMatch(/async readAccounts\(\)/);
  });

  it("stores the account number beside each credential", () => {
    // So a typed number resolves an account locally, without asking the server
    // who lives on this device.
    expect(service).toMatch(/userNumber: String\(userNumber \?\? ""\)/);
  });

  it("asks which account only when there is a choice to make", () => {
    const fn = service.slice(service.indexOf("async biometricLogin("));
    expect(fn).toMatch(/if \(ids\.length === 1\)/);
    expect(fn).toMatch(/return \{ status: "choose_account"/);
  });

  it("matches the number after the fingerprint, never instead of it", () => {
    const fn = service.slice(service.indexOf("async biometricLogin("));
    const body = fn.slice(0, fn.indexOf("return {\n      status: \"ok\""));
    expect(body.indexOf("this.authenticate(")).toBeLessThan(body.indexOf("opts.userNumber"));
  });

  it("rejects a number no account on this device answers to", () => {
    expect(service).toMatch(/return \{ status: "unknown_number" \}/);
    expect(hook).toMatch(/No account with that number uses fingerprint sign-in/);
  });

  it("keeps other accounts enrolled when one is turned off", () => {
    const fn = service.slice(service.indexOf("async clearCredential("));
    expect(fn.slice(0, 700)).toMatch(/delete map\[userId\]/);
  });

  it("migrates a device enrolled before the map existed", () => {
    const fn = service.slice(service.indexOf("async readAccounts()"));
    expect(fn.slice(0, 1200)).toMatch(/legacyUser/);
  });
});

describe("the account number", () => {
  it("is shown in Profile, where someone would look for it", () => {
    const profile = read("app/(tabs)/profile.tsx");
    expect(profile).toMatch(/ACCOUNT NUMBER/);
    expect(profile).toMatch(/user\.userNumber\.slice\(0, 4\)/);
  });

  it("is asked for on the sign-in screen only when needed", () => {
    const auth = read("app/auth.tsx");
    expect(auth).toMatch(/biometric\.needsUserNumber && \(/);
    expect(auth).toMatch(/keyboardType="number-pad"/);
  });

  it("accepts digits only, and exactly eight", () => {
    const auth = read("app/auth.tsx");
    expect(auth).toMatch(/replace\(\/\\D\/g, ""\)\.slice\(0, 8\)/);
  });
});

describe("being asked which account is not a failure", () => {
  const screen = read("app/auth.tsx");
  const hook = read("hooks/useBiometric.ts");

  it("login reports its reason instead of returning a bare null", () => {
    // The screen used to read `error` from the hook, which is React state and
    // still stale in the same tick, so `null ?? "Biometric authentication
    // failed"` rendered a failure while the app was merely waiting for a number.
    expect(hook).toMatch(/export type LoginOutcome/);
    expect(hook).toMatch(/reason: "choose_account"/);
  });

  it("shows nothing in red when the account number is being asked for", () => {
    expect(screen).toMatch(/result\.reason === "choose_account"/);
    const branch = screen.slice(screen.indexOf('result.reason === "choose_account"'));
    expect(branch.slice(0, 400)).toMatch(/setError\(null\)/);
  });

  it("no longer falls back to a failure message on a null error", () => {
    expect(screen).not.toMatch(/biometric\.error \?\?/);
    expect(screen).not.toMatch(/Biometric authentication failed/);
  });

  it("stays silent when the user cancels their own prompt", () => {
    expect(screen).toMatch(/result\.reason !== "cancelled"/);
  });
});

describe("the account number checks itself", () => {
  const screen = read("app/auth.tsx");

  it("verifies on the eighth digit with no button to press", () => {
    const effect = screen.slice(screen.indexOf("if (!biometric.needsUserNumber) return;"));
    expect(effect.slice(0, 300)).toMatch(/userNumber\.length !== 8/);
    expect(effect.slice(0, 300)).toMatch(/handleBiometricLogin\(\)/);
  });

  it("cannot fire twice while a check is already running", () => {
    const effect = screen.slice(screen.indexOf("if (!biometric.needsUserNumber) return;"));
    expect(effect.slice(0, 300)).toMatch(/\|\| loading/);
  });

  it("says how many digits are left, then that it is checking", () => {
    expect(screen).toMatch(/Checking…/);
    expect(screen).toMatch(/more digit/);
  });

  it("declares the handler before the effect that calls it", () => {
    // A const reached backwards for is a ReferenceError waiting on render order.
    expect(screen.indexOf("const handleBiometricLogin"))
      .toBeLessThan(screen.indexOf("if (!biometric.needsUserNumber) return;"));
  });
});

describe("the security screen explains what it is turning on", () => {
  const security = read("app/auth-security.tsx");

  it("is titled for the fingerprint, not for biometrics in general", () => {
    expect(security).toMatch(/Fingerprint Sign-In/);
  });

  it("says whether it is on, rather than only offering a switch", () => {
    expect(security).toMatch(/On for this device/);
  });

  it("states that the fingerprint never leaves the phone", () => {
    expect(security).toMatch(/never leaves the phone/);
  });

  it("shows the account number where it becomes relevant", () => {
    expect(security).toMatch(/user\.biometricEnabled && !!user\.userNumber/);
  });

  it("reassures that the password still works", () => {
    expect(security).toMatch(/password keeps working/);
  });
});

describe("the sign-in screen explains a missing fingerprint button", () => {
  const screen = read("app/auth.tsx");

  it("shows a hint when the phone has a reader but no enrolment", () => {
    // The button is hidden until this device holds a credential, because
    // tapping it otherwise could only fail. Its absence on a phone that plainly
    // has a fingerprint reader reads as a broken app.
    expect(screen).toMatch(/biometricAvailable && !biometric\.isEnrolled/);
    expect(screen).toMatch(/isn't set up on this device yet/);
  });

  it("says where to turn it on", () => {
    expect(screen).toMatch(/Profile → Security & Privacy/);
  });

  it("shows the hint and the button as alternatives, never both", () => {
    expect(screen).toMatch(/biometricAvailable && biometric\.isEnrolled/);
    expect(screen).toMatch(/biometricAvailable && !biometric\.isEnrolled/);
  });

  it("shows neither on a phone with no reader at all", () => {
    // Both branches are gated on biometricAvailable, so a device without the
    // hardware is told nothing about a feature it could never use.
    const conditions = screen.match(/biometricAvailable &&[^\n]*/g) ?? [];
    expect(conditions.length).toBe(2);
    for (const c of conditions) expect(c.startsWith("biometricAvailable &&")).toBe(true);
  });
});
