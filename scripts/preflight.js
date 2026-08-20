#!/usr/bin/env node
/**
 * Preflight — verifies everything the APK depends on, against a live backend.
 *
 * Exercises the real HTTP surface with the same User-Agent React Native uses on
 * Android, so a pass here means the shipped APK will behave the same way.
 *
 * Usage:
 *   node scripts/preflight.js                        # uses EXPO_PUBLIC_API_URL from .env
 *   node scripts/preflight.js https://x.onrender.com # explicit base URL
 *
 * Env:
 *   TEST_OTP=123456   supply an email OTP to also verify the email-verify step
 *
 * Exit code 0 = every check passed. Non-zero = at least one failure.
 */
const fs = require("fs");
const path = require("path");

// ── Base URL resolution ──────────────────────────────────────────────────────
function apiUrlFromEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const line = raw
      .split("\n")
      .find((l) => l.trim().startsWith("EXPO_PUBLIC_API_URL="));
    return line ? line.split("=").slice(1).join("=").trim() : null;
  } catch {
    return null;
  }
}

const BASE = (process.argv[2] || apiUrlFromEnvFile() || "").replace(/\/$/, "");
if (!BASE) {
  console.error("No base URL. Pass one as an argument or set EXPO_PUBLIC_API_URL in .env");
  process.exit(2);
}

// React Native on Android issues requests through okhttp. This matters: tunnel
// providers such as ngrok serve an HTML interstitial to browser-like agents,
// which would turn every JSON response into unparseable HTML.
const UA = "okhttp/4.9.2";
const DEVICE = "preflight-device-" + Date.now();

const results = [];
let token = null;
let refreshToken = null;
let userId = null;

function record(name, ok, detail, skipped = false) {
  results.push({ name, ok, detail, skipped });
  const tag = skipped ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`${tag.padEnd(5)} ${name}${detail ? "  — " + detail : ""}`);
}

async function call(method, pathname, { body, auth, raw } = {}) {
  const headers = {
    "User-Agent": UA,
    "X-Device-Id": DEVICE,
  };
  if (body) headers["Content-Type"] = "application/json";
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  const text = await res.text();
  if (raw) return { res, text };

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* left null — caller decides whether that is a failure */
  }
  return { res, json, text };
}

// ── Checks ───────────────────────────────────────────────────────────────────
async function checkHealth() {
  const { res, json, text } = await call("GET", "/health");
  if (res.status !== 200) return record("Backend reachable", false, `HTTP ${res.status}`);
  if (!json) {
    return record(
      "Backend returns JSON (not a tunnel interstitial)",
      false,
      "response was not JSON: " + text.slice(0, 80),
    );
  }
  record("Backend reachable", true, `uptime ${Math.round(json.uptime)}s`);
  record("Backend returns JSON (not a tunnel interstitial)", true);
}

async function checkDatabase() {
  // Registration performs a write; the profile fetch later performs a read.
  const email = `preflight.${Date.now()}@gmail.com`;
  const { res, json } = await call("POST", "/api/auth/register", {
    body: {
      name: "Preflight Check",
      email,
      password: "StrongPass!234",
      consentGiven: true,
    },
  });
  if (res.status !== 201 || !json?.userId) {
    return record("Database write (register)", false, `HTTP ${res.status} ${json?.message ?? ""}`);
  }
  userId = json.userId;
  record("Database write (register)", true, `userId ${userId.slice(0, 8)}…`);
  return email;
}

/**
 * The server logs every OTP (authService.js logs "[DEV] Email OTP for <email>: <code>").
 * When OTP_LOG points at the backend's log file, the code is read straight from
 * it so the whole register → verify → login chain runs unattended. Against a
 * remote backend, pass TEST_OTP instead (read it from the host's log console).
 */
function otpFromLog(email) {
  const logPath = process.env.OTP_LOG;
  if (!logPath) return null;
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const re = new RegExp(
      `Email OTP for ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (\\d{4,8})`,
    );
    const matches = raw.match(re);
    return matches ? matches[1] : null;
  } catch {
    return null;
  }
}

async function checkEmailVerify(email) {
  const otp = process.env.TEST_OTP || otpFromLog(email);
  if (!otp) {
    return record(
      "Email OTP verification",
      true,
      "no TEST_OTP or OTP_LOG supplied — later checks will be skipped",
      true,
    );
  }
  const { res, json } = await call("POST", "/api/auth/verify-email", {
    body: { userId, otp },
  });
  record("Email OTP verification", res.status === 200, json?.message ?? `HTTP ${res.status}`);
}

async function checkLogin(email) {
  const { res, json } = await call("POST", "/api/auth/login", {
    body: { email, password: "StrongPass!234" },
  });
  if (res.status !== 200 || !json?.accessToken) {
    return record("Login issues JWT", false, `HTTP ${res.status} ${json?.message ?? ""}`);
  }
  token = json.accessToken;
  refreshToken = json.refreshToken;
  record("Login issues JWT", true, `access + refresh received`);
}

async function checkWrongPassword(email) {
  const { res } = await call("POST", "/api/auth/login", {
    body: { email, password: "definitely-wrong-password" },
  });
  record("Wrong password rejected (401)", res.status === 401, `HTTP ${res.status}`);
}

async function checkProfile() {
  const { res, json } = await call("GET", "/api/user/profile", { auth: true });
  const ok = res.status === 200 && !!json?.user?.email;
  record("Database read (authenticated profile)", ok, ok ? json.user.email : `HTTP ${res.status}`);
}

async function checkUnauthorised() {
  const saved = token;
  token = "invalid.jwt.token";
  const { res } = await call("GET", "/api/user/profile", { auth: true });
  token = saved;
  record("Invalid token rejected (401)", res.status === 401, `HTTP ${res.status}`);
}

async function checkRefresh() {
  const { res, json } = await call("POST", "/api/auth/refresh", {
    body: { refreshToken },
  });
  const ok = res.status === 200 && !!json?.accessToken;
  if (ok) token = json.accessToken;
  record("Token refresh", ok, ok ? "new access token issued" : `HTTP ${res.status}`);
}

async function checkAuthenticatedRoutes() {
  const routes = [
    ["GET", "/api/user/sessions", "Active sessions"],
    ["GET", "/api/user/audit-log", "Security audit log"],
    ["GET", "/api/user/export", "GDPR data export"],
    ["GET", "/api/user/security-questions", "Security questions"],
  ];
  for (const [method, pathname, label] of routes) {
    const { res } = await call(method, pathname, { auth: true });
    record(label, res.status === 200, `HTTP ${res.status}`);
  }
}

async function check2FASetup() {
  const { res, json } = await call("POST", "/api/auth/2fa/setup", {
    auth: true,
    body: { method: "totp" },
  });
  const ok = res.status === 200 && (json?.secret || json?.qr || json?.otpauthUrl);
  record("2FA setup (TOTP secret issued)", ok, ok ? "secret + QR returned" : `HTTP ${res.status}`);
}

async function checkBiometric() {
  const hash = "preflight-credential-hash-" + Date.now();
  const reg = await call("POST", "/api/auth/biometric/register", {
    auth: true,
    body: { credentialIdHash: hash },
  });
  if (reg.res.status !== 200) {
    return record("Biometric enrol + verify", false, `enrol HTTP ${reg.res.status}`);
  }
  const ver = await call("POST", "/api/auth/biometric/verify", {
    body: { userId, credentialIdHash: hash },
  });
  record(
    "Biometric enrol + verify",
    ver.res.status === 200 && !!ver.json?.accessToken,
    ver.res.status === 200 ? "biometric login issued JWT" : `verify HTTP ${ver.res.status}`,
  );
}

async function checkGoogleOAuth() {
  // Google Sign-In opens the *system browser*, not the app's HTTP client, so
  // this check must send a browser User-Agent. Using okhttp here would give a
  // false pass: tunnels serve their interstitial only to browser-like agents.
  const BROWSER_UA =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
  const res = await fetch(
    BASE + "/api/auth/google?redirectUri=career-assistant%3A%2F%2Foauth%2Fcallback",
    { headers: { "User-Agent": BROWSER_UA }, redirect: "manual" },
  );
  const location = res.headers.get("location") || "";
  if (res.status === 200) {
    return record(
      "Google Sign-In redirects to Google",
      false,
      "got HTML instead of a redirect — tunnel interstitial is blocking OAuth",
    );
  }
  const ok = res.status >= 300 && res.status < 400 && location.includes("accounts.google.com");
  record(
    "Google Sign-In redirects to Google",
    ok,
    ok ? "302 → accounts.google.com" : `HTTP ${res.status} → ${location.slice(0, 60)}`,
  );

  // The redirect_uri Google receives must be registered in the Cloud Console.
  const m = location.match(/redirect_uri=([^&]+)/);
  if (m) {
    const redirectUri = decodeURIComponent(m[1]);
    const expected = `${BASE}/api/auth/google/callback`;
    record(
      "OAuth callback URL matches this backend",
      redirectUri === expected,
      redirectUri === expected ? redirectUri : `got ${redirectUri}, expected ${expected}`,
    );
  }
}

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const line = raw.split("\n").find((l) => l.trim().startsWith(name + "="));
    return line ? line.split("=").slice(1).join("=").trim() : "";
  } catch {
    return "";
  }
}

/**
 * Issues a real (tiny) completion against whichever OpenAI-compatible provider
 * is configured — OpenAI, Google Gemini, or Groq. A live call is the only way to
 * prove the key, the model name, and the endpoint all work together; listing
 * models would pass even when the account has no quota.
 */
async function checkAIProvider() {
  const key = envValue("EXPO_PUBLIC_OPENAI_API_KEY");
  const baseUrl = (envValue("EXPO_PUBLIC_AI_BASE_URL") || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = envValue("EXPO_PUBLIC_AI_MODEL") || "gpt-4o-mini";
  const label = `AI provider (${model})`;

  if (!key) {
    return record(
      label,
      false,
      "EXPO_PUBLIC_OPENAI_API_KEY is empty — CV analysis will fall back to heuristics",
    );
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: 'Reply with JSON: {"ok":true}' }],
        response_format: { type: "json_object" },
      }),
    });
    const text = await res.text();

    if (res.status === 200) {
      let content = null;
      try {
        content = JSON.parse(text)?.choices?.[0]?.message?.content;
      } catch {
        /* fall through */
      }
      return record(
        label,
        !!content,
        content ? `live completion succeeded via ${new URL(baseUrl).host}` : "200 but no content",
      );
    }
    if (res.status === 401 || res.status === 403)
      return record(label, false, `${res.status} — key rejected by ${new URL(baseUrl).host}`);
    if (res.status === 429)
      return record(label, false, "429 — rate limited or out of quota/credit");
    if (res.status === 404)
      return record(label, false, `404 — model "${model}" not found at this base URL`);
    record(label, false, `HTTP ${res.status}: ${text.slice(0, 100)}`);
  } catch (e) {
    record(label, false, "network error: " + e.message);
  }
}

async function checkLogout() {
  const { res } = await call("POST", "/api/auth/logout", { auth: true, body: {} });
  record("Logout", res.status === 200, `HTTP ${res.status}`);
}

// ── Runner ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nPreflight against ${BASE}`);
  console.log(`User-Agent: ${UA}  (matches React Native on Android)\n`);

  try {
    await checkHealth();
    const email = await checkDatabase();
    if (email) {
      await checkEmailVerify(email);
      await checkLogin(email);
      await checkWrongPassword(email);
      if (token) {
        await checkProfile();
        await checkUnauthorised();
        await checkRefresh();
        await checkAuthenticatedRoutes();
        await check2FASetup();
        await checkBiometric();
        await checkLogout();
      }
    }
    await checkGoogleOAuth();
    await checkAIProvider();
  } catch (e) {
    record("Preflight completed without crashing", false, e.message);
  }

  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log(
    `\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
  );
  if (failed.length) {
    console.log("\nFailures:");
    failed.forEach((f) => console.log(`  • ${f.name} — ${f.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
})();
