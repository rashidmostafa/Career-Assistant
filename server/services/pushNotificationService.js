/**
 * PushNotificationService — Firebase Cloud Messaging (FCM) via Expo's
 * push notification API or Firebase Admin SDK.
 *
 * For Expo-managed apps this uses the Expo Push API (no Firebase credentials
 * needed in development). For bare React Native with a custom server key, the
 * Firebase Admin SDK path is taken.
 *
 * Required env vars (choose one):
 *   EXPO_ACCESS_TOKEN             — for Expo Push Notifications API
 *   FIREBASE_SERVICE_ACCOUNT_JSON — for Firebase Admin SDK
 */
const https = require("https");

// ── Expo Push API ─────────────────────────────────────────────────────────────
async function sendViaExpoPushApi(pushToken, title, body, data = {}) {
  const payload = JSON.stringify({
    to: pushToken,
    sound: "default",
    title,
    body,
    data,
  });

  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };

  if (process.env.EXPO_ACCESS_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "exp.host",
        path: "/--/api/v2/push/send",
        method: "POST",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Firebase Admin SDK ────────────────────────────────────────────────────────
let firebaseApp = null;
function getFirebase() {
  if (firebaseApp) return firebaseApp;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) return null;
  try {
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(serviceAccountJson);
    if (!admin.apps.length) {
      firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      firebaseApp = admin.app();
    }
    return firebaseApp;
  } catch (e) {
    console.warn("[PushService] firebase-admin not available:", e.message);
    return null;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────
const PushNotificationService = {
  /**
   * Send a push notification to a specific push token.
   * @param {string}  pushToken - Expo push token (ExponentPushToken[...]) or FCM token
   * @param {string}  title
   * @param {string}  body
   * @param {object}  data      - Extra key/value pairs passed to the app
   */
  async send(pushToken, title, body, data = {}) {
    if (!pushToken) return;

    // Dev: just log
    if (process.env.NODE_ENV === "development" && !process.env.EXPO_ACCESS_TOKEN && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      console.log(`[PushService DEV] Push to ${pushToken}: ${title} — ${body}`);
      return;
    }

    // Expo token path
    if (pushToken.startsWith("ExponentPushToken[")) {
      try {
        await sendViaExpoPushApi(pushToken, title, body, data);
      } catch (err) {
        console.error("[PushService] Expo push error:", err.message ?? err);
      }
      return;
    }

    // Firebase path
    const firebase = getFirebase();
    if (firebase) {
      try {
        const admin = require("firebase-admin");
        await admin.messaging().send({
          token: pushToken,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ),
          android: { priority: "high" },
          apns: { payload: { aps: { sound: "default" } } },
        });
      } catch (err) {
        console.error("[PushService] Firebase push error:", err.message ?? err);
      }
    }
  },

  /**
   * Send a session-expiry reminder.
   */
  async sendSessionReminder(pushToken, daysRemaining) {
    const title =
      daysRemaining <= 0 ? "🔴 Session expired" :
      daysRemaining <= 2 ? "⚠️ Session expiring soon" :
                           "🔒 Session reminder";
    const body =
      daysRemaining <= 0
        ? "Your session has expired. Please re-authenticate."
        : `Your session expires in ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}. Open the app to stay signed in.`;

    return this.send(pushToken, title, body, { type: "session_reminder", daysRemaining });
  },

  /**
   * Send a security alert (new device, suspicious login, etc.)
   */
  async sendSecurityAlert(pushToken, message) {
    return this.send(pushToken, "🚨 Security Alert", message, { type: "security_alert" });
  },
};

module.exports = PushNotificationService;
