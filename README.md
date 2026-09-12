# CareerAI – Mobile App

An AI-powered career assistant built with React Native + Expo.

## ✅ Quick Start

### 1. Install Node.js (if not installed)
Download Node.js 22 LTS from https://nodejs.org

### 2. Install dependencies
```bash
npm install
```

### 3. Start the app
```bash
npm run start
```

### 4. Open on your phone
- Install **Expo Go** from the App Store or Google Play
- Scan the QR code shown in the terminal with your phone camera (iOS) or the Expo Go app (Android)

---

## 📱 Features

| Screen | What it does |
|--------|-------------|
| **Auth** | Sign up / Sign in with email verification simulation |
| **Onboarding** | 3-step background → level → role selection |
| **Home** | Dashboard with stats |
| **Jobs** | AI-matched job listings |
| **CV** | Upload PDF → AI ATS analysis + optimised export |
| **Roadmap** | Role-specific 12-week plan (Beginner → Intermediate → Advanced) |
| **Interview** | Mock interviews with model answers + precise scoring |
| **Portfolio** | GitHub & Codeforces metrics |
| **Profile** | Dropdown-only profile editor |

---

## 🤖 AI Features (Optional)

AI calls (CV analysis, roadmap generation, interview feedback) go through the
backend in `server/`, not straight from the phone — so there is no API key in
the app. To enable them, point the app at a running backend by creating a
`.env` file in the project root:

```
EXPO_PUBLIC_API_URL=https://career-assistant-api.onrender.com
```

The model itself is configured on the server via `AI_API_KEY`, `AI_BASE_URL`
and `AI_MODEL` — any OpenAI-compatible endpoint works; the default is Gemini
(`gemini-3.5-flash-lite`). See `server/.env.example`, and
`docs/HAWK_INTEGRATION.md` for the self-hosted Hawk model.

Without a backend URL, the app uses built-in fallbacks for all AI features.

---

## 🛠 Requirements

- Node.js 22 LTS
- npm 9+
- Expo Go app on your phone (iOS or Android)

## Troubleshooting

**Metro bundler error on start:**
```bash
npm run start:clear
```

**Expo Go says: "Unknown error: The internet connection appears to be offline":**
1. Use tunnel mode (already the default in this project):
```bash
npm run start
```
2. Ensure your laptop has internet access (tunnel needs internet on both laptop and phone).
3. Disable VPN/Proxy on laptop or phone while testing.
4. On Windows, allow Node.js through Firewall for Private networks.
5. If it still fails, stop Expo and restart clean:
```bash
npm run start:clear
```

**Package not found:**
```bash
npm install --legacy-peer-deps
```

**Could not determine Node.js install directory:**
This usually means Windows is resolving `node`/`npm` from a broken or stale install.
Run `where node` and `where npm` and make sure they point to the same Node.js install.
If a dead path is still on PATH, remove it and reinstall Node.js 22 LTS.
