# Hawk AI integration

Hawk AI is the self-hosted model in `../Hawk` — Qwen2.5-0.5B-Instruct with a
LoRA adapter fine-tuned on six career tasks. This document covers how the app
talks to it and, importantly, **which of those tasks are safe to rely on**.

Full measurements: `../Hawk/EVALUATION.md`.

---

## Running the server

On the machine with the GPU:

```bash
cd ~/Documents/Hawk
./serve_hawk.sh 8000
curl localhost:8000/health
```

Then point the app at it and **rebuild** — `EXPO_PUBLIC_*` is inlined at build
time, not read at runtime:

```
EXPO_PUBLIC_HAWK_URL=http://192.168.0.8:8000    # this machine's LAN IP
```

The phone must be on the same Wi-Fi. Leave the variable blank to disable Hawk
entirely; every call then returns `null` and the app falls back to its
deterministic logic, exactly as before.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | status, device, per-task token budgets |
| `POST /v1/hawk/{task}` | typed task call, `{"input": "..."}` |
| `POST /v1/chat/completions` | OpenAI-compatible shim, `model: "hawk-<task>"` |

Tasks: `nlp_analyzer`, `skill_extractor`, `job_matcher`, `ats_scorer`,
`roadmap_generator`, `interview_bank`.

The **server** owns the system prompts. The adapter only behaves correctly on
the exact strings it was trained on, so a system message sent by a client is
deliberately ignored.

---

## What is actually wired up

Only `InterviewContext` calls Hawk, and only to add up to 2 of 5 questions.

Everything else was evaluated and **deliberately left on the existing code
path.** This is not an oversight — each one was measured and rejected:

| Considered | Why it is not wired |
|---|---|
| CV skills via `nlp_analyzer` | Fabricates skills on real résumés — a DevOps CV returned `C++, Java, Python, React, MongoDB, Azure`, none of them present, and missed all six that were. These skills feed job-match scoring, so wiring it would corrupt match percentages. |
| Job match via `job_matcher` | A perfect 4/4 skill match scores 40% and reports "Matches 1/5". Collapses onto two outputs regardless of input. `utils/jobMatch.ts` is strictly better. |
| ATS score via `ats_scorer` | Trained on 4 dimensions (`format_structure`, `keyword_optimization`, `content_quality`, `parsing_ability`); the app's UI needs 6 (`keyword`, `formatting`, `achievements`, `skills`, `experience`, `grammar`). Not a mapping, a different rubric. |
| Cover letters, CV rewrites, answer scoring | Hawk is measurably **worse than its own base model** at these — the fine-tune cost it its long-form ability. These stay on `aiClient`. |

So the app still needs `EXPO_PUBLIC_OPENAI_API_KEY`. Hawk does not replace it.

### Interview questions

`buildQuestionSet()` in `context/InterviewContext.tsx` asks Hawk for 2 questions
and fills the rest from the curated `QUESTION_BANK`. Failures are dropped
silently — the bank has already filled every slot before Hawk is consulted.

**Known limitation:** Hawk's questions are role-blind. A *Data Scientist* prompt
returns JavaScript trivia; a *Product Manager* prompt returns React questions.
For non-web roles you may want to leave `EXPO_PUBLIC_HAWK_URL` unset until the
model is retrained. Generated questions also carry no vetted `correctAnswer` —
that field is filled at scoring time by `aiClient`.

---

## Client API

`services/hawkClient.ts`. Every function resolves to `null` rather than throwing,
so a caller's fallback path is always available:

```ts
import { analyzeCVText, matchJob, generateInterviewQuestion, isHawkConfigured } from "@/services/hawkClient";

const q = await generateInterviewQuestion("Interview prep for a backend engineer");
if (!q) { /* Hawk unconfigured, unreachable, or returned unusable output */ }
```

`null` covers: no URL configured, network failure, timeout
(`EXPO_PUBLIC_HAWK_TIMEOUT_MS`, default 20s), non-2xx, unparseable output, or
output missing required keys. A partial object is never returned — the caller's
deterministic fallback produces a complete one.

The functions for the unwired tasks (`analyzeCVText`, `matchJob`, `scoreATS`,
`extractJobSkills`, `generateRoadmap`) are implemented and tested against the
server; they are simply not called from any context yet. Read the table above
before calling one.

---

## Going beyond the LAN

The current setup requires the phone on the same Wi-Fi as the GPU box.

- **Tunnel (ngrok/cloudflared)** — works off-network, but the endpoint becomes
  public. Add a shared-secret header before doing this; the server has no auth.
- **Proxy through `server/`** — reuses the JWT auth and rate limiting already
  there, but Render still has to reach the GPU box through a tunnel.
- **Cloud GPU host** — the only option that does not depend on your machine
  being switched on. The server is a plain FastAPI app; the Dockerfile is
  ROCm-based and would need a CUDA base image for most cloud GPUs.
