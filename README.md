# CareerAI – Mobile App

An AI-powered career assistant built with React Native + Expo.

## ✅ Quick Start

### 1. Install Node.js (if not installed)
Download Node.js 22 LTS from https://nodejs.org

### 2. Install Expo CLI
```bash
npm install -g expo-cli
```

### 3. Install dependencies
```bash
npm install
```

### 4. Start the app
```bash
npm run start
```

### 5. Open on your phone
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

To enable real AI analysis, create a `.env` file in the project root:

```
EXPO_PUBLIC_OPENAI_API_KEY=sk-your-key-here
```

Without a key, the app uses smart built-in fallbacks for all AI features.

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
