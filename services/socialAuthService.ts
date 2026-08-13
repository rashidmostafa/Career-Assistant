import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { SessionManager } from "./sessionManager";

WebBrowser.maybeCompleteAuthSession();

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export interface SocialAuthResult {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
}

export type AuthTokens = SocialAuthResult;

async function openSocialAuth(provider: "google" | "linkedin"): Promise<SocialAuthResult> {
  if (!BASE) {
    throw new Error("EXPO_PUBLIC_API_URL is not set.");
  }

  // Clear any old tokens so polling doesn't pick up stale ones
  await SessionManager.clearTokens();

  const redirectUri = Linking.createURL("oauth/callback");
  console.log("[SocialAuth] redirectUri:", redirectUri);

  const authUrl = `${BASE}/api/auth/${provider}?redirectUri=${encodeURIComponent(redirectUri)}`;
  console.log("[SocialAuth] authUrl:", authUrl);

  // Open the browser without waiting for return value.
  // OAuthDeepLinkHandler in _layout.tsx catches the deep link,
  // saves tokens via SessionManager, then we pick them up below.
  WebBrowser.openBrowserAsync(authUrl, {
    showTitle: true,
    enableBarCollapsing: true,
  });

  // Poll SecureStore for up to 2 minutes until tokens appear
  const tokens = await new Promise<SocialAuthResult>((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      try {
        const accessToken  = await SessionManager.getAccessToken();
        const refreshToken = await SessionManager.getRefreshToken();
        if (accessToken && refreshToken) {
          clearInterval(interval);
          WebBrowser.dismissBrowser();
          resolve({ accessToken, refreshToken, expiresAt: Date.now() + 15 * 60 * 1000 });
        } else if (Date.now() - start > 120_000) {
          clearInterval(interval);
          WebBrowser.dismissBrowser();
          reject(new Error("Sign-in timed out. Please try again."));
        }
      } catch {
        // keep polling
      }
    }, 500);
  });

  return tokens;
}

export const SocialAuthService = {
  async signInWithGoogle(): Promise<SocialAuthResult> {
    return openSocialAuth("google");
  },
  async signInWithLinkedIn(): Promise<SocialAuthResult> {
    return openSocialAuth("linkedin");
  },
};
