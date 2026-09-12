# Career Assistant — API server

Express + MongoDB backend for the mobile app. It owns everything that must not
live on the phone: accounts and tokens, the AI provider keys, the Careerjet
key, PDF/DOCX parsing, the shared interview question bank, and per-account
data sync.

The app talks to it through `EXPO_PUBLIC_API_URL`; with that variable blank
the app runs entirely on its built-in offline logic and never calls this
server.

## Run it locally

```bash
cd server
npm install
cp .env.example .env      # then fill in at least MONGODB_URI and JWT_SECRET
npm run dev               # nodemon on http://localhost:3001
```

`GET /health` answers once it is up. `node check-atlas.js` verifies the
`MONGODB_URI` in `.env` is reachable and that the models can build their
indexes.

On startup `config/validateEnv.js` checks the environment: `MONGODB_URI` and
`JWT_SECRET` missing are errors, and in production a `MONGODB_URI` pointing
at localhost is refused because on Render that database disappears on every
deploy.

## Environment

Every variable is described in [.env.example](.env.example). In summary:

| Group | Variables | Needed for |
|---|---|---|
| Core | `MONGODB_URI`, `JWT_SECRET`, `PORT`, `SERVER_BASE_URL` | Everything |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_DEEP_LINK` | OAuth flow — see [docs/EXPO_GO_OAUTH_SETUP.md](../docs/EXPO_GO_OAUTH_SETUP.md) |
| Email | One of Gmail API / Brevo / SendGrid / SMTP | OTP and verification mail |
| AI | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | `/api/ai/chat` — any OpenAI-compatible endpoint, defaults to Gemini |
| Hawk | `HAWK_URL`, `HAWK_SECRET` | `/api/ai/hawk/*` — see [docs/HAWK_INTEGRATION.md](../docs/HAWK_INTEGRATION.md) |
| Jobs | `CAREERJET_API_KEY`, `CAREERJET_REFERER` | `/api/jobs/search` |
| Push | `EXPO_ACCESS_TOKEN` or `FIREBASE_SERVICE_ACCOUNT_JSON` | Notifications |

Anything AI- or jobs-related left unset degrades to `data: null`, which the
app treats as "use the local fallback" rather than an error.

## Routes

| Mount | File | What it does |
|---|---|---|
| `/api/auth` | [routes/auth.js](routes/auth.js) | Register, email OTP, login, 2FA, refresh, logout, password recovery, Google OAuth, biometric device binding |
| `/api/user` | [routes/user.js](routes/user.js) | Profile, security questions, push token, data export, consent, deletion (with cancel window), sessions, audit log |
| `/api/data` | [routes/data.js](routes/data.js) | Per-account sync of feature data (CV, roadmap, interview progress…) |
| `/api/cv` | [routes/cv.js](routes/cv.js) | Server-side PDF/DOCX text extraction |
| `/api/jobs` | [routes/jobs.js](routes/jobs.js) | Careerjet proxy — attaches the key and the end user's IP/UA |
| `/api/ai` | [routes/ai.js](routes/ai.js) | LLM proxy (`/chat`), Hawk proxy (`/hawk/:task`), `/status` |
| `/api/interview` | [routes/interview.js](routes/interview.js) | Shared question bank, generated once per role |

Every route except auth and `/health` requires a bearer access token
(`middleware/authMiddleware.js`). Auth endpoints and everything that reaches a
model (`/api/ai`, `/api/cv`, `/api/interview`) are rate limited per account,
with the counters persisted in MongoDB so they survive restarts
(`middleware/rateLimiter.js`, `middleware/mongoRateLimitStore.js`).

The full auth design — token lifetimes, refresh rotation, OTP, 2FA, biometric
binding — is in [docs/AUTH_DOCUMENTATION.md](../docs/AUTH_DOCUMENTATION.md).

## Layout

```
app.js            Express app, middleware, route mounts, startup
config/           db connection, passport (Google), env validation
middleware/       JWT auth, rate limiting
models/           Mongoose schemas (User, Session, UserData, AuditLog, …)
routes/           one file per /api/* mount, see table above
services/         auth helpers, email, push, Careerjet client, deletion worker
templates/        landing page HTML served by serve.js
tests/            Jest suite (see below)
serve.js          separate static server for Expo web builds (not the API)
check-atlas.js    connectivity check for MONGODB_URI
get-gmail-token.js one-time helper to mint a Gmail API refresh token
```

## Tests

```bash
npm test
```

Runs Jest serially with `--experimental-vm-modules`. The suite covers the
API surface (`api.test.js`), config validation, AI timeouts and rate limits,
CV extraction, Careerjet, interview generation, biometric device binding,
passport and email configuration. Fixtures live in `tests/fixtures/`.

## Deploying

The service is described in [render.yaml](../render.yaml) at the repo root
and deploys to Render; the step-by-step (Atlas network access, Render
setup, Google callback URL, pointing the app at it) is in
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
