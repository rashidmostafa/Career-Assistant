/**
 * SocialAuthService — Google and LinkedIn OAuth via expo-web-browser.
 *
 * Flow:
 *  1. Open the backend OAuth redirect URL in an in-app browser.
 *  2. The backend handles the OAuth dance with the provider.
 *  3. On success, the backend deep-links back to career-assistant://oauth/callback
 *     with accessToken, refreshToken, and expiresAt as query params.
 *  4. This service extracts the tokens from the callback URL and returns them.
 *
 * Requirements:
 *  - Custom dev build (not Expo Go) — deep links require a native scheme.
 *  - EXPO_PUBLIC_API_URL must point to your backend.
 *  - The app scheme "career-assistant" must be registered in app.json.
 */
import * as WebBrowser from "expo-web-browser";
import { AuthApiService, type AuthTokens } from "./authApiService";
import { SessionManager } from "./sessionManager";

WebBrowser.maybeCompleteAuthSession();

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export interface SocialAuthResult {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
}

async function openSocialAuth(provider: "google" | "linkedin"): Promise<SocialAuthResult> {
  if (!BASE) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not set. Add it to your .env file and rebuild the app."
    );
  }

  const authUrl = `${BASE}/api/auth/${provider}`;

  const result = await WebBrowser.openAuthSessionAsync(
    authUrl,
    "career-assistant://oauth/callback",
    { showInRecents: true }
  );

  if (result.type !== "success" || !result.url) {
    if (result.type === "cancel" || result.type === "dismiss") {
      throw new Error("Sign-in was cancelled.");
    }
    throw new Error(`Social sign-in failed (${result.type}). Please try again.`);
  }

  // Parse tokens from deep-link URL
  const url = new URL(result.url);
  const accessToken  = url.searchParams.get("accessToken");
  const refreshToken = url.searchParams.get("refreshToken");
  const expiresAtStr = url.searchParams.get("expiresAt");

  if (!accessToken || !refreshToken || !expiresAtStr) {
    throw new Error("Incomplete authentication response from server.");
  }

  const tokens: AuthTokens = {
    accessToken,
    refreshToken,
    expiresAt: parseInt(expiresAtStr, 10),
  };

  // Persist tokens so the rest of the app can use them immediately
  await SessionManager.saveTokens(tokens);

  return tokens;
}

export const SocialAuthService = {
  /**
   * Sign in with Google.
   * Opens the Google consent screen via the backend OAuth redirect.
   */
  async signInWithGoogle(): Promise<SocialAuthResult> {
    return openSocialAuth("google");
  },

  /**
   * Sign in with LinkedIn.
   * Opens the LinkedIn consent screen via the backend OAuth redirect.
   */
  async signInWithLinkedIn(): Promise<SocialAuthResult> {
    return openSocialAuth("linkedin");
  },
};
