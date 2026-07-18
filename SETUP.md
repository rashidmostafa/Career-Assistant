# Running this project in VS Code with Expo Go

## Prerequisites

- [Node.js](https://nodejs.org) 22 LTS installed on your computer
- [Expo Go](https://expo.dev/go) app installed on your phone (App Store / Play Store)
- Stable internet connection on both laptop and phone (tunnel mode is used by default)

## Steps

1. Open this project folder in VS Code.
2. Open a terminal (`Terminal > New Terminal`) in the project root.
3. Install dependencies:
   ```
   npm install
   ```
   If this fails with dependency resolution errors, retry with:
   ```
   npm install --legacy-peer-deps
   ```
   If you see `Could not determine Node.js install directory`, fix your Windows PATH so `where node` and `where npm` resolve to the same Node.js installation, then reinstall Node.js 22 LTS.
4. Start the Expo development server:
   ```
   npm run start
   ```
5. A QR code will appear in the terminal.
   - **Android:** open the Expo Go app and use its built-in QR scanner.
   - **iOS:** scan the QR code with the regular Camera app, then tap the
     notification to open it in Expo Go.

## Optional: AI features

This app can use OpenAI to power CV analysis, roadmap generation, and
interview feedback. To enable it:

1. Copy `.env.example` to a new file named `.env`.
2. Fill in `EXPO_PUBLIC_OPENAI_API_KEY` with your own OpenAI API key.
3. Restart `npm run start`.

## If Expo Go shows "Unknown error: The internet connection appears to be offline"

1. Stop the current Expo process.
2. Start fresh with cleared cache in tunnel mode:
   ```
   npm run start:clear
   ```
3. Turn off VPN/Proxy on laptop and phone while testing.
4. Allow Node.js through Windows Firewall (Private network).
5. Re-scan the new QR code from the terminal.

If your local network is healthy and you want faster LAN mode, run:

```
npm run start:lan
```

Without this key, the app automatically falls back to built-in heuristic
scoring/generation, so all features still work out of the box.

## Building an APK

This project is preconfigured for EAS Build. To produce an installable APK:

```
npx eas-cli build --platform android --profile production
```

This requires an [Expo account](https://expo.dev) (free) and will build in
the cloud, giving you a download link for the `.apk` file when it finishes.
