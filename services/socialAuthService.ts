import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { SessionManager } from "./sessionManager";

WebBrowser.maybeCompleteAuthSession();

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

/**
 * How long to keep checking storage after the auth session ends.
 *
 * On some platforms the deep link is delivered to the app's global handler
 * (OAuthDeepLinkHandler in app/_layout.tsx) rather than being returned by
 * openAuthSessionAsync, so the session can resolve as "dismiss" a moment
 * before the tokens land. This is a short grace period for that race — not the
 * primary mechanism. It used to be the primary mechanism, at 120 seconds,
 * which is why a misconfigured redirect URI presented as "Sign-in timed out"
 * two minutes later instead of as the configuration error it was.
 */
const GRACE_MS = 8000;

export interface SocialAuthResult {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
}

export type AuthTokens = SocialAuthResult;

/** Pulls tokens out of the callback URL, or throws if it carries an error. */
function tokensFromUrl(url: string): SocialAuthResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const error = parsed.searchParams.get("error");
  if (error) throw new Error(`Sign-in failed: ${error.replace(/_/g, " ")}.`);

  const accessToken  = parsed.searchParams.get("accessToken");
  const refreshToken = parsed.searchParams.get("refreshToken");
  const expiresAtStr = parsed.searchParams.get("expiresAt");
  if (!accessToken || !refreshToken || !expiresAtStr) return null;

  return { accessToken, refreshToken, expiresAt: parseInt(expiresAtStr, 10) };
}

/** Polls storage briefly, for the case where the global handler won the race. */
async function awaitStoredTokens(timeoutMs: number): Promise<SocialAuthResult | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const accessToken  = await SessionManager.getAccessToken();
    const refreshToken = await SessionManager.getRefreshToken();
    if (accessToken && refreshToken) {
      return { accessToken, refreshToken, expiresAt: Date.now() + 15 * 60 * 1000 };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function openSocialAuth(provider: "google"): Promise<SocialAuthResult> {
  if (!BASE) {
    throw new Error("EXPO_PUBLIC_API_URL is not set.");
  }

  // Clear any old tokens so the grace-period check cannot pick up stale ones.
  await SessionManager.clearTokens();

  // Resolves per platform:
  //   Expo Go    exp://192.168.x.x:8081/--/oauth/callback
  //   Dev/APK    career-assistant://oauth/callback
  //   Web        https://<origin>/oauth/callback
  // All three must be accepted by isAllowedRedirectUri() on the server; the
  // web origin needs adding to WEB_ORIGINS there, and the server now returns a
  // readable error page instead of failing silently if it is not.
  const redirectUri = Linking.createURL("oauth/callback");
  const authUrl = `${BASE}/api/auth/${provider}?redirectUri=${encodeURIComponent(redirectUri)}`;

  // openAuthSessionAsync — not openBrowserAsync — is the API built for this:
  // it knows the redirect URI it is waiting for and hands back the callback URL
  // directly (ASWebAuthenticationSession on iOS, Custom Tabs on Android, a
  // popup on web), so success does not depend on polling shared storage.
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type === "success" && result.url) {
    const tokens = tokensFromUrl(result.url);
    if (tokens) {
      await SessionManager.saveTokens(tokens);
      return tokens;
    }
  }

  // Either the global deep-link handler consumed the URL first, or the user
  // closed the window. Give the former a brief chance before concluding the latter.
  const stored = await awaitStoredTokens(GRACE_MS);
  if (stored) return stored;

  if (result.type === "cancel" || result.type === "dismiss") {
    throw new Error("Sign-in was cancelled.");
  }
  throw new Error("Sign-in could not be completed. Please try again.");
}

export const SocialAuthService = {
  async signInWithGoogle(): Promise<SocialAuthResult> {
    return openSocialAuth("google");
  },
};
