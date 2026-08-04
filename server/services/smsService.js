/**
 * SmsService — sends OTP codes via Twilio or logs to console in development.
 *
 * Required env vars (Twilio):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER   (e.g. +15550000000)
 */

let twilioClient = null;

function getTwilio() {
  if (twilioClient) return twilioClient;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (sid && token) {
    try {
      const twilio = require("twilio");
      twilioClient = twilio(sid, token);
    } catch {
      console.warn("[SmsService] twilio package not installed — using dev stub.");
    }
  }

  if (!twilioClient) {
    twilioClient = {
      messages: {
        create: async ({ to, body }) => {
          console.log(`[SmsService DEV] SMS to ${to}:\n${body}`);
          return { sid: "dev-" + Date.now() };
        },
      },
    };
  }

  return twilioClient;
}

const APP_NAME = "Career Assistant";
const FROM     = process.env.TWILIO_PHONE_NUMBER ?? "+15550000000";

const SmsService = {
  /**
   * Send an OTP via SMS.
   * @param {string} to     - E.164 formatted phone number, e.g. "+8801700000000"
   * @param {string} code   - 6-digit OTP
   * @param {string} purpose - "verification" | "2fa" | "recovery"
   */
  async sendOtp(to, code, purpose = "verification") {
    const purposeLabel =
      purpose === "2fa"      ? "2FA"      :
      purpose === "recovery" ? "recovery" :
                               "verification";

    const body = `[${APP_NAME}] Your ${purposeLabel} code: ${code}. Valid for 10 min. Do not share it.`;

    try {
      await getTwilio().messages.create({ to, from: FROM, body });
    } catch (err) {
      console.error("[SmsService] sendOtp error:", err.message ?? err);
    }
  },

  /**
   * Send a session-expiry warning via SMS.
   */
  async sendSessionWarning(to, daysRemaining) {
    const body = `[${APP_NAME}] Your session expires in ${daysRemaining} day(s). Open the app to re-authenticate.`;
    try {
      await getTwilio().messages.create({ to, from: FROM, body });
    } catch (err) {
      console.error("[SmsService] sendSessionWarning error:", err.message ?? err);
    }
  },
};

module.exports = SmsService;
