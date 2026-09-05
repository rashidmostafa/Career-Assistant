/**
 * Mailer configuration.
 *
 * An unused provider is usually left in the environment as an empty value
 * rather than removed. `??` only falls through on null or undefined, so
 * `SENDGRID_FROM_EMAIL=` stopped the sender chain dead and every message went
 * out with an empty From, which mail servers reject. Nothing surfaced, because
 * sendOtp catches its own errors: registration succeeded, the code was stored,
 * and the user waited on an email that had never been accepted.
 */
const path = require("path");

const EMAIL_VARS = [
  "GMAIL_REFRESH_TOKEN", "GMAIL_FROM_EMAIL", "GOOGLE_CLIENT_ID",
  "BREVO_API_KEY", "BREVO_FROM_EMAIL",
  "SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
];

function loadWith(env) {
  jest.resetModules();
  for (const k of EMAIL_VARS) delete process.env[k];
  Object.assign(process.env, env);
  return require("../services/emailService");
}

const saved = {};
beforeAll(() => { for (const k of EMAIL_VARS) saved[k] = process.env[k]; });
afterAll(() => {
  for (const k of EMAIL_VARS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe("sender address", () => {
  it("skips a provider left in the environment as an empty value", () => {
    // The exact shape of the bug: SendGrid unused but its FROM still declared.
    const { status } = loadWith({ SENDGRID_FROM_EMAIL: "", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@gmail.com" });
    expect(status().from).toBe("me@gmail.com");
  });

  it("skips a whitespace-only value too", () => {
    const { status } = loadWith({ SENDGRID_FROM_EMAIL: "   ", SMTP_HOST: "h", SMTP_USER: "me@gmail.com" });
    expect(status().from).toBe("me@gmail.com");
  });

  it("prefers the first provider that actually has an address", () => {
    const { status } = loadWith({ GMAIL_FROM_EMAIL: "a@x.com", SENDGRID_FROM_EMAIL: "b@x.com", SMTP_USER: "c@x.com" });
    expect(status().from).toBe("a@x.com");
  });

  it("never resolves to an empty sender", () => {
    const { status } = loadWith({ GMAIL_FROM_EMAIL: "", BREVO_FROM_EMAIL: "", SENDGRID_FROM_EMAIL: "", SMTP_USER: "" });
    expect(status().from).toBeTruthy();
  });

  it("trims a stray space, which SMTP would reject", () => {
    const { status } = loadWith({ SMTP_HOST: "h", SMTP_USER: " me@gmail.com " });
    expect(status().from).toBe("me@gmail.com");
  });
});

describe("provider reporting", () => {
  it("names none when nothing is configured, rather than pretending to work", () => {
    const { status } = loadWith({});
    expect(status()).toMatchObject({ provider: "none", configured: false });
  });

  it("prefers the Gmail HTTP API, which works where SMTP ports are blocked", () => {
    // Render blocks outbound SMTP, so an smtp provider there cannot deliver.
    const { status } = loadWith({ GMAIL_REFRESH_TOKEN: "t", GOOGLE_CLIENT_ID: "c", SMTP_HOST: "h" });
    expect(status().provider).toBe("gmail-api");
  });

  it("ignores an empty api key rather than selecting a dead provider", () => {
    const { status } = loadWith({ SENDGRID_API_KEY: "", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@x.com" });
    expect(status().provider).toBe("smtp");
  });

  it("reports no delivery attempt before one is made", () => {
    const { status } = loadWith({ SMTP_HOST: "h", SMTP_USER: "me@x.com" });
    expect(status().lastSend).toEqual({ at: null, ok: null, reason: null });
  });

  it("exposes no secret", () => {
    const { status } = loadWith({ SENDGRID_API_KEY: "SG.supersecret", SENDGRID_FROM_EMAIL: "me@x.com" });
    const dumped = JSON.stringify(status());
    expect(dumped).not.toContain("supersecret");
  });
});

describe("sendOtp reports whether it delivered", () => {
  it("returns sent:false instead of throwing, so a bad mailer cannot fail a signup", async () => {
    const { sendOtp } = loadWith({});  // dev stub logs, never throws
    const r = await sendOtp("a@b.com", "123456", "verification");
    expect(r).toHaveProperty("sent");
  });

  it("records the attempt so a failure is visible afterwards", async () => {
    const svc = loadWith({});
    await svc.sendOtp("a@b.com", "123456");
    expect(svc.status().lastSend.at).not.toBeNull();
  });
});
