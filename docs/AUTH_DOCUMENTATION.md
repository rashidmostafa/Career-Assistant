# Career Assistant — Authentication System Documentation

> **Version 2.0** | August 2026 | Covers all 15 specification requirements.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Registration Flow](#1-registration-flow)
4. [Login System](#2-login-system)
5. [8-Week Rolling Authentication](#3-8-week-rolling-authentication)
6. [Security Risk Scoring](#4-security-risk-scoring)
7. [Account Recovery](#5-account-recovery)
8. [Session Management](#6-session-management)
9. [2FA Implementation](#7-2fa-implementation)
10. [Biometric Integration](#8-biometric-integration)
11. [UI Screens](#9-ui-screens)
12. [Security Hardening](#10-security-hardening)
13. [GDPR Compliance](#11-gdpr-compliance)
14. [Technical Stack](#12-technical-stack)
15. [Performance Targets](#13-performance-targets)
16. [Testing](#14-testing)
17. [Edge Cases](#15-edge-cases)
18. [Server Setup](#server-setup)
19. [Environment Variables](#environment-variables)

---

## Overview

The Career Assistant authentication system provides enterprise-grade, multi-layered security for a React Native (Expo) mobile application backed by a Node.js / Express / MongoDB API server.

**Security philosophy:** Balance security with convenience. Use progressive verification — not all checks at once. Frame security positively: *"We're keeping your data safe."*

---

## Architecture

```
Client (Expo / React Native)
├── app/auth.tsx              — Registration, Login, OTP verify, Security questions
├── app/auth-2fa.tsx          — 2FA code entry + device trust
├── app/auth-reauth.tsx       — 8-week re-authentication screen
├── app/auth-security.tsx     — Security settings (TOTP setup, biometrics, GDPR)
├── context/AuthContext.tsx   — Global auth state + all auth actions
├── services/
│   ├── authApiService.ts     — HTTP client (with retry + auto-refresh)
│   ├── sessionManager.ts     — Secure token storage + 8-week session logic
│   ├── biometricService.ts   — expo-local-authentication wrapper
│   ├── otpService.ts         — Client-side OTP / TOTP utilities
│   ├── riskScoring.ts        — Client-side risk assessment
│   └── notificationService.ts — Push notification scheduling (Expo + FCM)
└── components/auth/
    ├── OtpInput.tsx
    ├── PasswordStrengthBar.tsx
    ├── BiometricButton.tsx
    └── SecurityQuestionsForm.tsx

Server (Node.js / Express / MongoDB)
└── server/
    ├── app.js                — Express entry point, middleware, routing
    ├── config/db.js          — MongoDB connection
    ├── models/
    │   ├── User.js           — User schema (bcrypt, 2FA, biometrics, GDPR)
    │   ├── Session.js        — Refresh-token sessions + 8-week clock
    │   └── AuditLog.js       — Immutable security event log (1-year TTL)
    ├── middleware/
    │   ├── authMiddleware.js — JWT verification, token issuance
    │   └── rateLimiter.js    — In-memory rate limits + IP blocking
    ├── services/
    │   ├── authService.js    — Core business logic
    │   ├── emailService.js   — Nodemailer / SendGrid (OTP, recovery, warnings)
    │   ├── smsService.js     — Twilio (OTP, recovery, warnings)
    │   └── pushNotificationService.js — Expo push + Firebase Admin
    └── routes/
        ├── auth.js           — /api/auth/* endpoints
        └── user.js           — /api/user/* endpoints
```

---

## 1. Registration Flow

### Screens
- `app/auth.tsx` (mode: `register` → `verify-otp` → `security-questions`)

### Steps

1. **User fills form** — name, email, password, optional phone, GDPR consent checkbox.
2. **Password strength validation** — 8 chars, uppercase, lowercase, number, special char, no spaces.
3. **Email OTP sent** — server generates 6-digit code, stores in in-memory OTP map (10-min TTL), dispatches via `EmailService`.
4. **Phone OTP sent** (optional) — if phone provided, `SmsService` sends a separate 6-digit code.
5. **OTP entry** — `OtpInput` component handles paste + auto-submit.
6. **Security questions** (optional at registration) — minimum 3 of 5, answers bcrypt-hashed server-side.
7. **Biometric enrolment prompt** — optional, uses `expo-local-authentication`.

### Password Rules
| Rule | Minimum |
|------|---------|
| Length | 8 characters |
| Uppercase | 1 letter |
| Lowercase | 1 letter |
| Number | 1 digit |
| Special char | 1 symbol |
| No spaces | required |

---

## 2. Login System

### Standard Login
- Email + password → `POST /api/auth/login`
- Failed attempts tracked per user; 5 failures → 15-minute lockout.
- Email typo detection on client (e.g. `gmail.con` → `gmail.com`).

### 2FA Integration
If `twoFactorEnabled` and device is not trusted:
- **TOTP** — TOTP code validated server-side via `speakeasy` (RFC 6238, window ±1 step).
- **SMS** — OTP generated and sent via Twilio.
- **Email** — OTP generated and sent via Nodemailer / SendGrid.
- **Backup code** — any of 10 single-use codes; consumed immediately on use.

### Biometric Login
- `BiometricService.retrieveToken()` — prompts native biometric, returns stored access token.
- Falls back to password if biometrics unavailable or user cancels.
- `expo-local-authentication` handles Face ID, Touch ID, Fingerprint, Face Unlock.

### Social Login
- Google and LinkedIn buttons present in UI.
- Implementation uses `expo-web-browser` OAuth flow (requires server-side OAuth app credentials configured in `.env`).

---

## 3. 8-Week Rolling Authentication

| Day | Urgency | Reminder Type |
|-----|---------|---------------|
| Day 50 | `weekly` | Weekly push notification + in-app banner |
| Day 54 | `daily` | Daily push notification + persistent banner |
| Day 56 | `hourly` | Hourly push + immediate re-auth screen |
| Day 56 + 12 h | `expired` | Force re-auth, grace period ends |

### How it works
- `SessionManager.saveTokens()` records `sessionStartedAt` in `expo-secure-store`.
- `AuthGate` in `_layout.tsx` checks `reauthUrgency` on every app foreground event.
- When `expired` or `grace` → redirect to `app/auth-reauth.tsx`.
- `NotificationService.scheduleSessionReminders(sessionStartMs)` pre-schedules local notifications.
- On re-authentication success → `Session.sessionStartedAt` reset to `new Date()` on the server.

---

## 4. Security Risk Scoring

### Factors
| Factor | Points |
|--------|--------|
| Unrecognised device | +30 |
| Login time 00:00–05:00 | +10 |
| Recent failed attempts (×10, max 30) | up to +30 |
| Account inactive > 30 days | +15 |

### Risk Levels
| Level | Score | Action |
|-------|-------|--------|
| LOW | 0–24 | Normal login |
| MEDIUM | 25–49 | Log + monitor |
| HIGH | 50–74 | Require 2FA |
| CRITICAL | 75–100 | Require 2FA + security alert push |

---

## 5. Account Recovery

### Methods
| Method | Flow |
|--------|------|
| Email OTP | `POST /api/auth/recover` → email code → verify → reset password |
| SMS OTP | Same flow via SMS |
| Security questions | 3 of N questions must be answered correctly |

### Rate Limiting
- `recoveryLimiter`: 3 attempts per day per IP.
- After 3 failed security-question attempts the IP is blocked.

### Flow
1. `POST /api/auth/recover` → sends OTP or verifies security answers.
2. On success → returns `recoveryToken` (32-byte random hex, 1-hour TTL, in-memory).
3. `POST /api/auth/reset-password { recoveryToken, newPassword }` → hashes new password, invalidates all sessions.

---

## 6. Session Management

### Tokens
| Token | TTL | Storage |
|-------|-----|---------|
| Access token (JWT) | 15 minutes | `expo-secure-store` → Keychain/Keystore |
| Refresh token (JWT) | 30 days (rotation) | `expo-secure-store` + MongoDB `Session` document |

### Token Rotation
Every refresh issues a **new** access + refresh token pair and revokes the old refresh token. Replay of a used refresh token → 401.

### Auto-Refresh
`authApiService.ts` catches `401 TOKEN_EXPIRED`, calls `POST /api/auth/refresh`, saves new tokens, retries original request — transparent to the caller.

### Secure Storage
- `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` flag.
- Falls back to `AsyncStorage` only in environments where SecureStore is unavailable (e.g. web preview).

---

## 7. 2FA Implementation

### TOTP Setup
1. `POST /api/auth/2fa/setup` — server generates `speakeasy` secret, creates `otpauth://` URI.
2. Server generates QR code data URI (`qrcode` npm package) — displayed in `auth-security.tsx`.
3. 10 single-use backup codes returned **once** at setup (format: `XXXX-XXXX`).
4. User scans QR code in Google Authenticator, Microsoft Authenticator, or Authy.

### TOTP Verification (RFC 6238)
- 30-second TOTP steps.
- Server-side `speakeasy.totp.verify` with `window: 1` (±30 s tolerance).
- Client shows countdown timer via `OtpService.getTotpStepRemainingSecs()`.

### Device Trust
- On successful 2FA, user can tick "Trust this device for 30 days".
- `User.trustedDevices[]` stores `{ deviceId, expiresAt }`.
- Trusted devices skip 2FA on next login.

### Backup Codes
- 10 codes, shown once at setup.
- Each code is single-use; consumed atomically on server.
- `OtpService.getRemainingBackupCodes()` tracks locally how many remain.

### Fallback
- TOTP → SMS → Email → Backup codes.

---

## 8. Biometric Integration

### Stack
- **expo-local-authentication** — cross-platform Face ID, Touch ID, Fingerprint, Face Unlock.
- **expo-secure-store** — Keychain (iOS) / Keystore (Android) for the biometric-guarded token.

### Enrolment (`BiometricService.enroll`)
1. Biometric challenge prompt shown.
2. On success, access token stored in SecureStore under `auth_biometric_token`.
3. `auth_biometric_enabled = "true"` set in AsyncStorage as a flag.

### Sign-in (`BiometricService.retrieveToken`)
1. Check `auth_biometric_enabled` flag.
2. Show native biometric prompt.
3. Return stored token on success → passed to `AuthContext.loginWithBiometric`.

### Fallback
- If biometrics fail or hardware unavailable → password login.
- `BiometricService.getAvailability()` returns `{ available: false, type: "None" }` → `BiometricButton` hidden.

---

## 9. UI Screens

| Screen | File | Description |
|--------|------|-------------|
| Login / Register | `app/auth.tsx` | Email/OTP, password, biometric, social, consent |
| 2FA Verification | `app/auth-2fa.tsx` | TOTP / SMS / email / backup code entry |
| Re-auth Reminder | `app/auth-reauth.tsx` | Countdown banner + biometric/password re-auth |
| Security Settings | `app/auth-security.tsx` | TOTP setup, backup codes, biometrics, GDPR |

---

## 10. Security Hardening

| Feature | Implementation |
|---------|----------------|
| Rate limiting | `express-rate-limit`: 10 req/h (auth), 3/day (recovery), 100/h (general) |
| Account lockout | 5 wrong passwords → 15-minute lock (`User.incrementLoginAttempts`) |
| Password hashing | `bcryptjs` 12 rounds (`User.pre('save')`) |
| HTTPS | Enforced at reverse-proxy/CDN layer; `helmet` sets HSTS headers |
| CSRF | Stateless JWT auth (no cookies); device-ID header |
| Audit log | Immutable `AuditLog` collection, 1-year TTL TTL index |
| SQL/NoSQL injection | Mongoose strict schema, no raw query interpolation |
| Token signature | HS256 JWT, 64-byte hex secret |
| Security alerts | New-device login triggers push notification (`PushNotificationService.sendSecurityAlert`) |
| IP blocking | `blockIP()` called after repeated recovery failures |

---

## 11. GDPR Compliance

| Right | Endpoint | Notes |
|-------|----------|-------|
| Right to access / portability | `GET /api/user/export?format=json\|csv` | JSON or CSV, includes profile, audit log, sessions |
| Right to erasure | `POST /api/user/delete` | 30-day grace period; sessions revoked immediately |
| Cancel erasure | `POST /api/user/delete/cancel` | Available within 30 days |
| Explicit consent | `POST /api/user/consent` | Checkbox at registration + standalone endpoint |
| Right to rectify | `PATCH /api/user/profile` | Name, phone, profile fields |
| Right to restrict | Session revocation via `DELETE /api/user/sessions/:id` | |

---

## 12. Technical Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native 0.81 + Expo SDK 54 |
| Routing | Expo Router (file-based) |
| State | React Context + `@tanstack/react-query` |
| Biometrics | `expo-local-authentication` |
| Secure storage | `expo-secure-store` |
| Push notifications | `expo-notifications` + Firebase Admin / Expo Push API |
| API | Node.js 18+ / Express 4 |
| Database | MongoDB + Mongoose 8 |
| Auth tokens | `jsonwebtoken` (HS256) |
| Password hashing | `bcryptjs` (12 rounds) |
| TOTP | `speakeasy` (RFC 6238) + `qrcode` |
| Email | Nodemailer (SMTP / SendGrid) |
| SMS | Twilio |

---

## 13. Performance Targets

| Operation | Target | Achieved by |
|-----------|--------|-------------|
| Login | < 500 ms | Single DB lookup, bcrypt async |
| 2FA verify | < 300 ms | In-memory OTP store, speakeasy |
| Biometric prompt | < 200 ms | Native OS API, no network call |
| Concurrent sessions | 10,000+ | MongoDB horizontal scaling, stateless JWT |
| Uptime | 99.9% | MongoDB replica set + process manager |

---

## 14. Testing

### Run tests

```bash
# From the project root (runs client-side Jest tests)
npm test

# Server-only tests
cd server && npm test
```

### Coverage areas

| Suite | Tests |
|-------|-------|
| OtpService | TOTP step time, TTL, verification, backup codes |
| RiskScoringService | All 4 risk levels, multi-factor scoring, colour helpers |
| SessionManager | Constants, urgency levels (none → expired), device ID |
| BiometricService | Hardware available / unavailable, enrolment, fallback |
| EmailService | Mock call validation |
| SmsService | Mock call validation |
| AuthService (unit) | Register, login (2FA, lockout, wrong PW, unverified email), 2FA backup, recovery token, security questions |
| HTTP Integration | Health, 404, register (dup/new), login (wrong PW), refresh (bad token), recover, reset-password |
| Security | Rate-limit headers, 5-attempt lockout, token replay, invalid JWT |
| GDPR | Export/delete/consent require auth |
| Edge cases | OTP expiry, empty backup codes, session urgency timeline, biometric unavailable |

---

## 15. Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Network failure | `authApiService.ts` retries up to 3× with exponential back-off (500 ms → 1 s → 2 s) |
| Biometric unavailable | `BiometricButton` hidden; password fallback shown automatically |
| 2FA code expiry | "Resend code" button + `POST /api/auth/2fa/resend` (OTP TTL restarted) |
| Session expired mid-action | `AuthGate` detects `reauthUrgency === "expired"` → redirects to `auth-reauth.tsx`, state preserved in context |
| Device switch | New device triggers 2FA challenge + push security alert on old device; old sessions not immediately revoked but new session starts separate 8-week clock |
| Account locked mid-recovery | `lockoutUntil` checked on login; auto-clears after 15 minutes |
| Deletion within grace period | `deletionScheduledAt` set; `POST /api/user/delete/cancel` removes it before expiry |

---

## Server Setup

```bash
cd server
cp .env.example .env    # Fill in required values
npm install
npm run dev             # Nodemon dev server on port 3001
npm test                # Jest test suite
```

---

## Environment Variables

See `server/.env.example` for the full list.

**Required:**
| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | 64-byte hex secret for JWT signing |

**Optional (enable real email/SMS/push):**
| Variable | Purpose |
|----------|---------|
| `SENDGRID_API_KEY` | SendGrid email delivery |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Nodemailer SMTP |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | SMS via Twilio |
| `EXPO_ACCESS_TOKEN` | Expo Push Notifications API auth |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin SDK for FCM |

> Without email/SMS/push env vars, all messages are logged to the console (`[DEV]` prefix). This is intentional for local development.

---

*Generated by Career Assistant Auth System — all 15 specification requirements fulfilled.*
