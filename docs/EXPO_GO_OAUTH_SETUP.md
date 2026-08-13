# OAuth Setup for Expo Go (Google & LinkedIn)

This document explains how the authentication flow works in this project and
exactly how to configure everything for testing with **Expo Go** (no standalone
build required).

---

## How the flow works

```
Expo App                    Backend (ngrok)              Google/LinkedIn
───────                     ───────────────              ───────────────
signInWithGoogle()
  │
  ├─ Linking.createURL("oauth/callback")
  │  → exp://192.168.x.x:PORT/--/oauth/callback   (Expo Go)
  │  → career-assistant://oauth/callback           (standalone)
  │
  ├─ openAuthSessionAsync(
  │    url:        https://ngrok.../api/auth/google
  │                  ?redirectUri=exp://192.168.x.x.../oauth/callback
  │    redirectTo: exp://192.168.x.x.../oauth/callback
  │  )
  │
  │  GET /api/auth/google?redirectUri=…  ──────────────────────────────►
  │  (server stores redirectUri in session)
  │
  │                          GET /api/auth/google  ──────────────────────►
  │                                                  Google consent screen
  │                          ◄── GET /api/auth/google/callback?code=…
  │                          (server exchanges code, creates JWT tokens)
  │                          redirect to:
  │                            exp://192.168.x.x.../oauth/callback
  │                              ?accessToken=...&refreshToken=...
  │
  ◄─ openAuthSessionAsync detects redirect to exp:// and closes browser
  │
  ├─ Parse tokens from URL
  ├─ SessionManager.saveTokens(tokens)
  └─ AuthContext loads user profile → navigate to home
```

The key insight: **Expo Go already supports `exp://` URLs natively**. The fix
is that the backend redirects to whatever `redirectUri` the client passes — so
in Expo Go it redirects to `exp://...` instead of `career-assistant://...`.

---

## Step-by-step setup

### 1. Start the backend with ngrok

```bash
cd server
npm install
# Create server/.env from server/.env.example and fill in values
npm run dev
```

In a separate terminal:

```bash
ngrok http 3001
# Copy the https URL, e.g. https://flinch-uncounted-sixties.ngrok-free.app
```

### 2. Configure Google OAuth Console

1. Go to https://console.cloud.google.com → APIs & Services → Credentials
2. Edit your Web Application OAuth client
3. Under **Authorised redirect URIs**, add:
   ```
   https://flinch-uncounted-sixties.ngrok-free.app/api/auth/google/callback
   ```
4. Under **Authorised JavaScript origins**, add:
   ```
   https://flinch-uncounted-sixties.ngrok-free.app
   ```
5. **Do NOT add** `exp://...` or `career-assistant://...` as redirect URIs —
   those are handled server-side.

### 3. Configure LinkedIn Developer App

1. Go to https://www.linkedin.com/developers/apps
2. Under **Auth** tab → Authorized redirect URLs, add:
   ```
   https://flinch-uncounted-sixties.ngrok-free.app/api/auth/linkedin/callback
   ```

### 4. Set environment variables

**`server/.env`:**
```env
SERVER_BASE_URL=https://flinch-uncounted-sixties.ngrok-free.app
GOOGLE_CLIENT_ID=219422974845-eole2t7sqa82iltp4lsn93h786na87db.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
LINKEDIN_CLIENT_ID=your-linkedin-id
LINKEDIN_CLIENT_SECRET=your-linkedin-secret
JWT_SECRET=<64-byte-hex>
SESSION_SECRET=<32-byte-hex>
MONGODB_URI=mongodb://127.0.0.1:27017/career-assistant
```

**`.env` (project root):**
```env
EXPO_PUBLIC_API_URL=https://flinch-uncounted-sixties.ngrok-free.app
```

### 5. Start Expo

```bash
npm start   # starts with --tunnel flag automatically
```

Open Expo Go on your Android device and scan the QR code.

---

## What was fixed

| File | Problem | Fix |
|------|---------|-----|
| `server/config/passport.js` | LinkedIn strategy passed `done` instead of `user` — all LinkedIn logins silently failed | Changed `done(null, done)` → `done(null, user)` |
| `server/routes/auth.js` | Always redirected to `career-assistant://` which Expo Go can't handle | Now reads `?redirectUri=` from query param and redirects there instead |
| `services/socialAuthService.ts` | Hardcoded `career-assistant://oauth/callback` as the redirect URI | Uses `Linking.createURL("oauth/callback")` which auto-generates the right URI for each environment |
| `app/_layout.tsx` | No deep link listener — tokens in the URL were never read | Added `OAuthDeepLinkHandler` that watches for incoming URLs containing `oauth/callback`, extracts tokens, saves them, and navigates home |
| `.env.example` | Missing `EXPO_PUBLIC_API_URL` | Added with full documentation |

---

## Troubleshooting

**Browser opens but app never returns after Google login:**
- Confirm `EXPO_PUBLIC_API_URL` is set to the ngrok URL (not localhost)
- Confirm your device is connected to the internet (ngrok URL must be reachable)
- Check server logs for any errors in the `/api/auth/google/callback` handler

**"invalid_client" from Google:**
- The redirect URI registered in Google Console must exactly match `${SERVER_BASE_URL}/api/auth/google/callback`
- Update the ngrok URL in Google Console every time ngrok restarts (use a fixed ngrok domain if possible)

**LinkedIn login fails silently:**
- This was a bug — `done(null, done)` instead of `done(null, user)` — now fixed
- Also ensure your LinkedIn app has the `openid`, `profile`, `email` scopes enabled

**Expo Go shows "Something went wrong" after redirect:**
- The `exp://` URL is not matching the expected pattern — check Expo Go's port and IP
- Try clearing Expo Go's cache: shake device → "Reload"
