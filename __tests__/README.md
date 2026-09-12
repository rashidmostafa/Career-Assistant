# App test suite

```bash
npm test            # from the repo root
```

Jest with the `jest-expo` preset. [setup.js](setup.js) mocks the native
modules that do not exist in Node (AsyncStorage, SecureStore, expo-crypto,
local authentication, notifications, constants and React Native itself), so
the suite runs without a device, emulator or database. The server has its
own suite under `server/tests/` — run `npm test` inside `server/` for that.

Most files open with a comment explaining the bug or rule they guard; that
is the best place to look before changing what they cover. The table below
is the index.

| File | Guards | Exercises |
|---|---|---|
| [auth.test.js](auth.test.js) | Risk scoring, session management, biometric service and the full HTTP auth flow (register → verify → login → 2FA → refresh → logout) via supertest, with the Mongoose models mocked | `services/riskScoring`, `sessionManager`, `biometricService`, `server/app` |
| [biometric-flow.test.js](biometric-flow.test.js) | Biometrics are offered, never demanded: nothing auto-prompts on mount, sign-in is a deliberate tap, enrolment lives under Profile → Security, fingerprint only. Reads the screen source directly | `app/auth.tsx`, `app/auth-security.tsx`, `app/(tabs)/profile.tsx`, `hooks/useBiometric.ts` |
| [cv-builder.test.js](cv-builder.test.js) | A CV composed from answers produces the same plain text an upload does, so the roadmap gate, job matching and ATS scorer read it identically; bullet rewriting refuses invented facts | `services/cvBuilder`, `cvBuilderAI` |
| [cv-export.test.js](cv-export.test.js) | The printed PDF and the .docx infer the same structure from the model's plain-text output | `services/cvExport` |
| [cv-honesty.test.js](cv-honesty.test.js) | The optimised CV must not claim skills the candidate cannot defend — fabricated skills are detected, not trusted | `services/cvAI` |
| [cv-roadmap-link.test.js](cv-roadmap-link.test.js) | The CV engine really feeds the roadmap and job matching (both once silently degraded to an empty skill set) | `context/CVContext`, `RoadmapContext` |
| [cv-scoring.test.js](cv-scoring.test.js) | The ATS rubric, format awareness and what the report guarantees on failure | `services/cvAI` |
| [cv-stored-shape.test.js](cv-stored-shape.test.js) | A CV stored by an older app version never reaches the screen in the wrong shape (this once crashed the CV tab on launch) | `context/CVContext` |
| [interview-progress.test.js](interview-progress.test.js) | Streak, XP, competency mastery and confidence-calibration arithmetic — a quiet fault here misreports progress rather than crashing | `context/InterviewContext` |
| [interview-scoring.test.js](interview-scoring.test.js) | Answer score and Keyword Detective colouring share one keyword match, so they can never disagree; flashcard fill-in-the-blank | `services/interviewScoring` |
| [job-engine.test.js](job-engine.test.js) | Job engine rules: only jobs for the target role (including spelling variants), match % comes from the CV, feed sources are distinct from browse-only link-outs | `services/jobFeedService`, `utils/jobMatch`, `constants/jobPlatforms`, `context/JobsContext` |
| [job-feed-live.test.js](job-feed-live.test.js) | Hits the real Careerjet feed through the backend. Needs a signed-in user, so outside the app it returns nothing and the assertions skip; when it does run it checks shape and de-duplication | `services/jobFeedService` |
| [portfolio-link.test.js](portfolio-link.test.js) | Syncing GitHub metrics must not overwrite the link that triggered it (a stale closure once saved `links: []` over the top) | `context/PortfolioContext` |
| [rn-runtime.test.js](rn-runtime.test.js) | No web-only APIs that React Native's runtime lacks — these fail only on device, as a feature silently doing nothing | `services/authApiService`, `jobFeedService` |
| [roadmap-step1.test.js](roadmap-step1.test.js) | Roadmap rules: generated from CV gaps against the target role, time is per skill rather than a fixed schedule, resources carry openable URLs, failure is reported not hidden | `services/roadmapAI` |
| [token-refresh.test.js](token-refresh.test.js) | Concurrent 401s share one refresh, since the server rotates refresh tokens and a second use of the same one would log the user out | `services/authApiService` |

## Conventions

- One file per behaviour or seam, named after the thing it protects rather
  than the module it imports.
- Regression tests keep the story of the original bug in the header comment
  so the test still makes sense once the code has moved on.
- Anything that needs a network or a real account must skip cleanly when it
  cannot run (`job-feed-live.test.js` is the model), so `npm test` stays
  green offline.
