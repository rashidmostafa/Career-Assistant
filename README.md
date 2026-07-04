# CareerAI – Mobile App

An AI-powered career assistant built with React Native + Expo.

## ✅ Quick Start

### 1. Install Node.js (if not installed)
Download from https://nodejs.org (v18 or newer)

### 2. Install Expo CLI
```bash
npm install -g expo-cli
```

### 3. Install dependencies
```bash
cd careerAI
npm install
```

### 4. Start the app
```bash
npx expo start
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

- Node.js 18+
- npm 9+
- Expo Go app on your phone (iOS or Android)

## Troubleshooting

**Metro bundler error on start:**
```bash
npx expo start --clear
```

**Package not found:**
```bash
npm install --legacy-peer-deps
```
