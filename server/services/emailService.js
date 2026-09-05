/**
 * EmailService — sends OTP codes and notifications via Nodemailer (SMTP) or
 * SendGrid. Falls back to console logging in development when credentials are
 * not configured.
 */
const nodemailer = require("nodemailer");

// ── Gmail API access-token cache ──────────────────────────────────────────────
// A refresh token is long-lived; the access token it buys lasts ~1 hour. Cache
// it rather than paying an extra round-trip to Google on every single email.
let _gmailToken = { value: null, expiresAt: 0 };

async function gmailAccessToken() {
  if (_gmailToken.value && Date.now() < _gmailToken.expiresAt) return _gmailToken.value;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: process.env.GMAIL_REFRESH_TOKEN ?? "",
      grant_type:    "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant here almost always means the refresh token was revoked or
    // expired — Google expires refresh tokens after 7 days while the OAuth
    // consent screen is still in "Testing" mode. Re-run get-gmail-token.js.
    throw new Error(`Gmail token refresh failed (${res.status}): ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  _gmailToken = {
    value: body.access_token,
    // Renew a minute early so a token cannot expire mid-flight.
    expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  };
  return _gmailToken.value;
}

// RFC 2822 message, base64url encoded as the Gmail API requires. Non-ASCII
// subjects are encoded-word wrapped; the bodies declare UTF-8 directly.
function buildMimeMessage({ from, to, subject, text, html }) {
  const encodedSubject = /^[\x00-\x7F]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;

  const boundary = `bnd_${Date.now().toString(36)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
  ];

  let body;
  if (html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text ?? "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    body = ["", text ?? "", ""].join("\r\n");
  }

  return Buffer.from(headers.join("\r\n") + body, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Which delivery path is configured, decided the same way getTransporter picks.
 *
 * Reported by /health because a misconfigured mailer is otherwise invisible:
 * sendOtp swallows its errors, so registration succeeds, the code is stored,
 * no mail is sent, and the app tells the user to check an inbox that will stay
 * empty. Names only — never a key.
 */
function emailProvider() {
  if (process.env.GMAIL_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID) return "gmail-api";
  if (process.env.BREVO_API_KEY)    return "brevo";
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  if (process.env.SMTP_HOST)        return "smtp";
  return "none";
}

/** The last delivery attempt, so a failure is visible after the fact. */
let lastSend = { at: null, ok: null, reason: null };

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  // Gmail's HTTP API. Chosen because it needs no domain of your own: Gmail and
  // Yahoo now enforce DMARC, so third-party senders (Brevo, SendGrid, Resend)
  // refuse to send *from* an @gmail.com address, and authenticating gmail.com
  // is impossible since you do not control its DNS. Sending through Gmail
  // itself sidesteps that entirely — and it runs over HTTPS on 443, so the
  // blocked SMTP ports do not apply.
  if (process.env.GMAIL_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID) {
    transporter = {
      sendMail: async ({ from, to, subject, text, html }) => {
        const token = await gmailAccessToken();
        const raw = buildMimeMessage({ from: from ?? FROM, to, subject, text, html });
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Gmail API ${res.status}: ${body.slice(0, 300)}`);
        }
        return { messageId: (await res.json().catch(() => ({}))).id ?? `gmail-${Date.now()}` };
      },
    };
  // Brevo, kept as a second HTTP option. Usable only with a domain you can
  // authenticate — it will reject an @gmail.com sender under DMARC.
  } else if (process.env.BREVO_API_KEY) {
    transporter = {
      sendMail: async ({ to, subject, text, html }) => {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": process.env.BREVO_API_KEY,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            sender: { email: FROM, name: APP_NAME },
            to: [{ email: to }],
            subject,
            textContent: text,
            ...(html ? { htmlContent: html } : {}),
          }),
          // Without this a hung request would stall the whole auth response,
          // which is what made registration appear to freeze for a minute.
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
        }
        return { messageId: `brevo-${Date.now()}` };
      },
    };
  } else if (process.env.SENDGRID_API_KEY) {
    // SendGrid SMTP relay
    transporter = nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  } else if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Development stub
    transporter = {
      sendMail: async (opts) => {
        console.log(`[EmailService DEV] To: ${opts.to} | Subject: ${opts.subject}`);
        console.log(`[EmailService DEV] Body:\n${opts.text ?? opts.html}`);
        return { messageId: "dev-" + Date.now() };
      },
    };
  }

  return transporter;
}

// Must be an address verified in the provider's dashboard, or the send is
// rejected. Brevo calls this a "verified sender"; a plain Gmail address works
// and needs no domain of your own.
/**
 * The sender address, first non-empty wins.
 *
 * `||`, not `??`. An unused provider is usually left in the environment as an
 * empty value rather than removed, and `??` only falls through on null or
 * undefined — so `SENDGRID_FROM_EMAIL=` stopped the chain dead and every
 * message went out with an empty From, which mail servers reject. The failure
 * was invisible because sendOtp catches its own errors: registration succeeded,
 * the code was stored, and the user waited on an email that was never accepted.
 */
const FROM = firstNonEmpty(
  process.env.GMAIL_FROM_EMAIL,
  process.env.BREVO_FROM_EMAIL,
  process.env.SENDGRID_FROM_EMAIL,
  process.env.SMTP_USER,
  "noreply@careerassistant.app",
);

function firstNonEmpty(...values) {
  for (const v of values) if (typeof v === "string" && v.trim() !== "") return v.trim();
  return "";
}
const APP_NAME = "Career Assistant";

const EmailService = {
  /**
   * Send an OTP code for email verification or 2FA.
   */
  async sendOtp(to, code, purpose = "verification") {
    const purposeLabel =
      purpose === "2fa"      ? "two-factor authentication" :
      purpose === "recovery" ? "account recovery"           :
                               "email verification";

    const subject = `[${APP_NAME}] Your ${purposeLabel} code: ${code}`;
    const text = [
      `Hello,`,
      ``,
      `Your ${APP_NAME} ${purposeLabel} code is:`,
      ``,
      `  ${code}`,
      ``,
      `This code expires in 10 minutes.`,
      ``,
      `If you did not request this, please ignore this email or contact support immediately.`,
      ``,
      `— The ${APP_NAME} Team`,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#6366f1">${APP_NAME}</h2>
        <p>Your <strong>${purposeLabel}</strong> code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1e293b;
                    background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;
                    margin:24px 0">${code}</div>
        <p style="color:#64748b;font-size:14px">
          This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
        </p>
        <p style="color:#64748b;font-size:13px;margin-top:24px">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `;

    try {
      await getTransporter().sendMail({ from: `"${APP_NAME}" <${FROM}>`, to, subject, text, html });
      lastSend = { at: new Date().toISOString(), ok: true, reason: null };
      return { sent: true };
    } catch (err) {
      // Still not thrown: a failed email must not fail a registration that
      // otherwise succeeded, and the code is stored either way. But the outcome
      // is returned now, so the caller can tell the user their code is not
      // coming instead of leaving them watching an empty inbox.
      console.error("[EmailService] sendOtp error:", err.message);
      lastSend = { at: new Date().toISOString(), ok: false, reason: err.message?.slice(0, 200) ?? "unknown" };
      return { sent: false, reason: err.message?.slice(0, 200) ?? "unknown" };
    }
  },

  /** Configuration and last-attempt status. Contains no secrets. */
  status() {
    const provider = emailProvider();
    return {
      provider,
      // "smtp" on a host that blocks outbound SMTP ports cannot deliver at all,
      // which is the trap this field exists to make obvious.
      configured: provider !== "none",
      from: FROM,
      lastSend,
    };
  },

  /**
   * Send a session-expiry warning email.
   */
  async sendSessionWarning(to, daysRemaining) {
    const subject = `[${APP_NAME}] Your session expires in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}`;
    const text = [
      `Hello,`,
      ``,
      `Your ${APP_NAME} session will expire in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}.`,
      ``,
      `To stay signed in, open the app and re-authenticate before your session expires.`,
      ``,
      `— The ${APP_NAME} Team`,
    ].join("\n");

    try {
      await getTransporter().sendMail({ from: `"${APP_NAME}" <${FROM}>`, to, subject, text });
    } catch (err) {
      console.error("[EmailService] sendSessionWarning error:", err.message);
    }
  },

  /**
   * Send account-recovery instructions.
   */
  async sendRecoveryEmail(to, recoveryToken) {
    const appUrl = process.env.APP_DEEP_LINK ?? "career-assistant://";
    const link   = `${appUrl}reset-password?token=${recoveryToken}`;

    const subject = `[${APP_NAME}] Reset your password`;
    const text = [
      `Hello,`,
      ``,
      `We received a request to reset your ${APP_NAME} password.`,
      ``,
      `Use the following token in the app: ${recoveryToken}`,
      ``,
      `This link expires in 1 hour.`,
      ``,
      `If you did not request this, please ignore this email.`,
      ``,
      `— The ${APP_NAME} Team`,
    ].join("\n");

    try {
      await getTransporter().sendMail({ from: `"${APP_NAME}" <${FROM}>`, to, subject, text });
    } catch (err) {
      console.error("[EmailService] sendRecoveryEmail error:", err.message);
    }
  },
};

module.exports = EmailService;
