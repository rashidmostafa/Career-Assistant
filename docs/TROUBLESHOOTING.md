# Career Assistant — Troubleshooting Guide

A reference for the most common issues you'll hit during development and production
deployment of the authentication system.

---

## Table of Contents

1. [Environment / Configuration](#1-environment--configuration)
2. [Social OAuth (Google / LinkedIn)](#2-social-oauth-google--linkedin)
3. [Biometric Login](#3-biometric-login)
4. [OTP (Email / SMS)](#4-otp-email--sms)
5. [JWT & Token Refresh](#5-jwt--token-refresh)
6. [2FA (TOTP / Backup Codes)](#6-2fa-totp--backup-codes)
7. [Account Lockout](#7-account-lockout)
8. [CORS](#8-cors)
9. [Android-Specific](#9-android-specific)
10. [iOS-Specific](#10-ios-specific)
11. [MongoDB Connection](#11-mongodb-connection)

---

## 1. Environment / Configuration

### App can't reach the backend
**Symptom:** All API calls fail immediately with a network error.

**Causes & fixes:**
| Scenario | Fix |
|---|---|
| `EXPO_PUBLIC_API_URL` not set | Add `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3001` to `.env` |
| Using `localhost` on a device | Use your machine's LAN IP (e.g. `192.168.1.10`) — the device can't resolve `localhost` to your computer |
| Android emulator | Use `http://10.0.2.2:3001` instead of `localhost` |
| iOS simulator | `localhost` works; physical device needs LAN IP |
| Backend not running | Run `cd server && npm run dev` |

### Missing environment variables on the server
Check that `server/.env` exists and contains:
- `MONGODB_URI`
- `JWT_SECRET` (64-byte hex)
- `SESSION_SECRET` (32-byte hex)
- `SERVER_BASE_URL` (used to build OAuth callback URLs)
- `APP_DEEP_LINK=career-assistant://`

Generate secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # SESSION_SECRET
```

---

## 2. Social OAuth (Google / LinkedIn)

### "OAuth authentication failed" / browser closes immediately
OAuth requires a **custom dev build** — it does **not** work in Expo Go because the
`career-assistant://` deep-link scheme is not registered in Expo Go.

```bash
# Build and run a development client
npx expo run:ios   # or
npx expo run:android
```

### Google consent screen errors

| Error | Fix |
|---|---|
| `redirect_uri_mismatch` | In Google Cloud Console → Credentials → Authorised redirect URIs, add `{SERVER_BASE_URL}/api/auth/google/callback` exactly |
| `invalid_client` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are wrong or from the wrong project |
| `access_blocked` | App is in Testing mode; add your Google account to the test users list |
| Blank screen after consent | Backend `SERVER_BASE_URL` doesn't match the public URL the browser sees (check reverse proxy config) |

### LinkedIn errors

| Error | Fix |
|---|---|
| `invalid_redirect_uri` | Add `{SERVER_BASE_URL}/api/auth/linkedin/callback` to Authorised Redirect URLs in your LinkedIn app |
| `unauthorized_scope_error` | Your app must request **Sign In with LinkedIn using OpenID Connect** product — apply for it in the LinkedIn developer portal |
| Profile email missing | User must grant email permission on the consent screen |

### Deep link doesn't open the app after OAuth
1. Confirm `career-assistant` scheme is in `app.json`:
   ```json
   { "expo": { "scheme": "career-assistant" } }
   ```
2. Rebuild the native app after any `app.json` scheme change.
3. On iOS, run `xcrun simctl openurl booted "career-assistant://oauth/callback?accessToken=test"` to test.
4. On Android, run `adb shell am start -W -a android.intent.action.VIEW -d "career-assistant://oauth/callback?accessToken=test" com.anonymous.careerassistant`.

### Tokens not persisted after OAuth
`SocialAuthService` calls `SessionManager.saveTokens()` immediately after parsing the
deep-link URL. If it's not persisting:
- Confirm `expo-secure-store` is installed (`npx expo install expo-secure-store`).
- Check for errors in the Expo Metro / native log.

---

## 3. Biometric Login

### "Biometrics not available on this device"
- **Simulator/Emulator:** Biometrics don't work in iOS Simulator or Android Emulator by
  default. On iOS Simulator use **Features → Face ID → Enrolled**. On Android Emulator use
  **Extended controls → Fingerprint**.
- **No biometrics enrolled:** The user must set up Face ID / Fingerprint in device Settings first.

### Biometric enrolment succeeds locally but login fails with 401
The device credential hash sent at login doesn't match what was registered.

**Common causes:**
- App was uninstalled and reinstalled — `expo-secure-store` data is wiped.
- The user signed in on a different device.
- The backend `biometricTokenHash` field was cleared (e.g. manual DB edit).

**Fix:** Call `disable()` then `enroll()` again to re-register.

### "Biometric login not enrolled for this account" from server
The server has no `biometricTokenHash` for this user even though the device thinks it's
enrolled. This can happen after a DB reset or if `registerBiometric` failed silently.

**Fix:** Toggle biometric off and back on in the app's security settings to re-register.

### expo-secure-store not available (web/test environment)
`BiometricService` falls back to `AsyncStorage` automatically. Biometric prompts are
skipped in web environments; `authenticate()` returns `{ success: true }` in test mocks.

---

## 4. OTP (Email / SMS)

### OTP email never arrives
1. Check `SENDGRID_API_KEY` / SMTP settings in `server/.env`.
2. Check spam folder — OTP emails from unverified domains often land there.
3. In dev mode, OTP codes are printed to the server console if no email provider is configured.
4. OTP expires after **10 minutes**; request a new one if the timer runs out.

### "Too many incorrect attempts. Please request a new code."
After 3 failed OTP attempts the code is invalidated for security. Use the resend button.

### SMS OTP not received
1. Confirm Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`).
2. Twilio trial accounts can only send to verified numbers — add the test phone number in
   the Twilio console.
3. Check the server logs for Twilio error codes.

---

## 5. JWT & Token Refresh

### "Token expired" / 401 on every authenticated request
- Access tokens expire in **15 minutes** by default; the client retries automatically with
  the refresh token.
- If both tokens are expired the user is redirected to the login screen.
- Confirm `JWT_SECRET` hasn't changed between server restarts (changing it invalidates all
  tokens).

### Refresh returns 403 "Token reuse detected"
The refresh token has already been consumed (rotation). This protects against token theft.
The user must sign in again.

### Tokens not found in SecureStore after reinstall
`expo-secure-store` data is erased on iOS when the app is deleted (unless iCloud Keychain
backup is used). Tokens stored in `AsyncStorage` survive reinstalls on Android but are
cleared on iOS. This is by design — users must sign in again after reinstall.

---

## 6. 2FA (TOTP / Backup Codes)

### TOTP code always rejected
- Clocks must be synchronised. TOTP windows allow ±1 step (30 s). Ensure the device clock
  is correct.
- If the user set up TOTP on one server instance and the `JWT_SECRET` / `totpSecret` was
  reset, they must re-enrol.

### "Invalid backup code" even with an unused code
Backup codes are hashed on the server. If you restored a DB backup, the codes may not
match the current hash salt. Re-generate backup codes via the 2FA setup flow.

### 2FA setup QR code doesn't scan
- The `qrcode` npm package must be installed: `cd server && npm install qrcode`.
- If `qrCode` is null in the setup response, use the `secret` field to manually enter the
  key in your authenticator app.

---

## 7. Account Lockout

### "Account is locked" after failed logins
After **5** consecutive failed login attempts the account locks for **15 minutes**.
The `lockoutUntil` field in the User document shows when the lockout expires.

**Manual unlock (admin):**
```js
// In a Mongo shell
db.users.updateOne({ email: "user@example.com" }, {
  $set: { accountLocked: false, loginAttempts: 0 },
  $unset: { lockoutUntil: "" }
});
```

### Lockout persists past the unlock time
The lockout is time-based but is only cleared on the next login attempt. If the user tries
again after `lockoutUntil` passes, the server will clear the lock and proceed.

---

## 8. CORS

### CORS error in the browser (web target) or during OAuth redirect
- Add the origin (e.g. `http://localhost:8081`) to `ALLOWED_ORIGINS` in `server/.env`.
- The OAuth redirect uses the browser as the client, so the origin is the server's own URL
  — you may need to allow `SERVER_BASE_URL` itself.
- `credentials: true` is set in the CORS config; ensure the client sends `credentials: "include"` on fetch calls that need cookies (the Passport session cookie).

---

## 9. Android-Specific

### Biometric prompt shows but never resolves
This can happen on some Android versions when `disableDeviceFallback: false` is set and no
passcode is configured. Ensure the device has a PIN/pattern as a fallback.

### Deep link doesn't open the app on Android
1. Confirm the intent filter is in `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <intent-filter>
     <action android:name="android.intent.action.VIEW"/>
     <category android:name="android.intent.category.DEFAULT"/>
     <category android:name="android.intent.category.BROWSABLE"/>
     <data android:scheme="career-assistant"/>
   </intent-filter>
   ```
2. Rebuild the native project: `npx expo run:android`.

### `expo-web-browser` closes instantly on Android after OAuth
Some Android OEMs (Xiaomi, Huawei) kill the Custom Tab before it completes. Use
`showInRecents: true` in `openAuthSessionAsync` (already set in `SocialAuthService`).

---

## 10. iOS-Specific

### Face ID permission denied
Add the `NSFaceIDUsageDescription` key to `app.json`:
```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSFaceIDUsageDescription": "Career Assistant uses Face ID to sign you in quickly and securely."
      }
    }
  }
}
```
Rebuild the native project after adding this.

### `expo-local-authentication` always returns `false` on iOS Simulator
In Simulator: **Features → Face ID → Enrolled**, then **Features → Face ID → Matching Face**.

---

## 11. MongoDB Connection

### `MongoServerError: Authentication failed`
The `MONGODB_URI` credentials are wrong. Double-check the username, password, and database
name in the connection string.

### `MongoNetworkTimeoutError` on first request
MongoDB Atlas free-tier clusters pause after 60 minutes of inactivity. The first request
after a pause takes a few seconds to wake up. This is normal and resolves on retry.

### `E11000 duplicate key error` on register
A user with that email already exists. The frontend should show "An account with this email
already exists" — if it doesn't, check that the server error propagates correctly through
the `apiFetch` helper.
