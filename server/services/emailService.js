/**
 * EmailService — sends OTP codes and notifications via Nodemailer (SMTP) or
 * SendGrid. Falls back to console logging in development when credentials are
 * not configured.
 */
const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SENDGRID_API_KEY) {
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

const FROM = process.env.SENDGRID_FROM_EMAIL ?? process.env.SMTP_USER ?? "noreply@careerassistant.app";
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
    } catch (err) {
      console.error("[EmailService] sendOtp error:", err.message);
      // Do not propagate — log and continue; the console fallback ensures dev flow works
    }
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
