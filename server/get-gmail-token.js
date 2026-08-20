/**
 * One-time helper: obtains a Gmail API refresh token for the account that will
 * send the app's OTP emails.
 *
 * Why this exists: managed hosts (Render's free tier included) block outbound
 * SMTP on ports 25/465/587, so nodemailer cannot reach smtp.gmail.com from the
 * deployed server — it fails with "Connection timeout" regardless of how valid
 * the credentials are. The Gmail HTTP API runs over 443 and is not blocked.
 *
 * Usage:
 *   cd server && node get-gmail-token.js
 *
 * Prerequisites, both in the Google Cloud project that owns GOOGLE_CLIENT_ID:
 *   1. APIs & Services -> Library -> enable "Gmail API"
 *   2. APIs & Services -> Credentials -> your OAuth client -> Authorised
 *      redirect URIs -> add exactly:  http://localhost:53682/
 *
 * Prints a refresh token. Put it in server/.env and in Render's environment as
 * GMAIL_REFRESH_TOKEN, alongside GMAIL_FROM_EMAIL (the address you consent as).
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const http = require("http");
const crypto = require("crypto");

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/`;
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("✗ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing from server/.env");
  process.exit(1);
}

// Guards against a stray request to the loopback port being treated as the
// real callback.
const state = crypto.randomBytes(16).toString("hex");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    // offline + consent together are what actually produce a refresh token.
    // Without prompt=consent Google returns only an access token on repeat
    // authorisations, and the script would appear to succeed while giving you
    // nothing durable to deploy.
    access_type: "offline",
    prompt: "consent",
    state,
  });

async function exchange(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${body.error ?? ""} ${body.error_description ?? ""}`);
  return body;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    res.writeHead(404).end("waiting for the OAuth callback");
    return;
  }

  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(200, { "content-type": "text/html" }).end(`<h2>Authorisation failed: ${err}</h2>`);
    console.error(`\n✗ Google returned: ${err}`);
    server.close();
    process.exit(1);
  }

  if (url.searchParams.get("state") !== state) {
    res.writeHead(400).end("state mismatch");
    return;
  }

  try {
    const tokens = await exchange(url.searchParams.get("code"));
    res.writeHead(200, { "content-type": "text/html" }).end(
      "<h2>Done — you can close this tab and return to the terminal.</h2>"
    );

    if (!tokens.refresh_token) {
      console.error("\n✗ No refresh_token returned. Revoke the app's access at");
      console.error("  https://myaccount.google.com/permissions and run this again.");
      process.exit(1);
    }

    console.log("\n────────────────────────────────────────────────────────────");
    console.log("GMAIL_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("────────────────────────────────────────────────────────────");
    console.log("\nAdd that to server/.env and to Render's environment, together");
    console.log("with GMAIL_FROM_EMAIL set to the address you just consented as.");
    console.log("\nNote: while the OAuth consent screen is in 'Testing' mode this");
    console.log("token expires after 7 days. Publish the app to stop that.");
  } catch (e) {
    console.error("\n✗ Token exchange failed:", e.message);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 100);
  }
});

server.listen(PORT, () => {
  console.log("Open this URL in your browser and sign in as the sending account:\n");
  console.log(authUrl);
  console.log(`\nListening on ${REDIRECT_URI} for the callback…`);
});
