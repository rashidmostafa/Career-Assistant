import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProviderCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { JobsProvider } from "@/context/JobsContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { InterviewProvider } from "@/context/InterviewContext";
import { RoadmapProvider } from "@/context/RoadmapContext";
import { PortfolioProvider } from "@/context/PortfolioContext";
import { DialogProvider } from "@/components/ui/AppDialog";
import { SessionManager } from "@/services/sessionManager";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// ── Auth + re-auth gate ───────────────────────────────────────────────────────
function AuthGate({ children, isOAuthLoading }: { children: React.ReactNode; isOAuthLoading?: React.MutableRefObject<boolean> }) {
  const { user, isLoading, reauthUrgency } = useAuth();
  const router   = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    // Don't redirect while OAuth callback is loading user profile
    if (isOAuthLoading?.current) return;

    // "auth-2fa" and "auth-recover" are sibling routes (app/auth-2fa.tsx,
    // app/auth-recover.tsx), not nested under "auth" — segments[0] === "auth"
    // alone missed them, so the gate was bouncing users straight back to
    // /auth the instant they navigated there (both screens are used while
    // `user` is still null — mid-2FA-challenge or recovering a forgotten
    // password before ever signing in).
    const inAuth       = segments[0] === "auth" || segments[0] === "auth-2fa" || segments[0] === "auth-recover";
    const inOnboarding = segments[0] === "onboarding";
    const inReauth     = (segments as string[]).some((s) => s === "auth-reauth");
    const inTabs       = segments[0] === "(tabs)";

    if (!user && !inAuth) {
      router.replace("/auth");
      return;
    }

    if (user && !user.onboardingComplete && !inOnboarding && !inAuth) {
      router.replace("/onboarding");
      return;
    }

    if (user && user.onboardingComplete && (inAuth || inOnboarding)) {
      router.replace("/(tabs)");
      return;
    }

    // 8-week re-auth: redirect to re-auth screen when session expires/grace
    if (user && (reauthUrgency === "expired" || reauthUrgency === "grace") && !inReauth) {
      router.replace("/auth-reauth");
    }
  }, [user, isLoading, segments, router, reauthUrgency]);

  return <>{children}</>;
}

/**
 * OAuthDeepLinkHandler — listens for incoming deep links and processes
 * OAuth callback tokens when the app is opened via a deep link.
 *
 * This is the critical piece for Expo Go support:
 *   • Expo Go uses    exp://ip:port/--/oauth/callback?accessToken=...
 *   • Standalone uses career-assistant://oauth/callback?accessToken=...
 *
 * Both are handled here by watching for the "oauth/callback" path segment.
 * The tokens are extracted from the URL and saved to SecureStore, then
 * the AuthContext's signInWithSocial flow picks them up via getProfile().
 */
function OAuthDeepLinkHandler({ onTokensReceived }: { onTokensReceived: (tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => void }) {
  const handledUrls = useRef<Set<string>>(new Set());

  const handleUrl = async (url: string) => {
    // Deduplicate: Linking can fire multiple events for the same URL
    if (handledUrls.current.has(url)) return;
    handledUrls.current.add(url);

    try {
      const parsed = new URL(url);
      const path = parsed.pathname || parsed.host || "";

      // Match both  career-assistant://oauth/callback  and  exp://…/--/oauth/callback
      const isOAuthCallback =
        path.includes("oauth/callback") ||
        parsed.hostname === "oauth" ||   // career-assistant://oauth/callback
        url.includes("oauth/callback");

      if (!isOAuthCallback) return;

      const accessToken  = parsed.searchParams.get("accessToken");
      const refreshToken = parsed.searchParams.get("refreshToken");
      const expiresAtStr = parsed.searchParams.get("expiresAt");
      const error        = parsed.searchParams.get("error");

      if (error) {
        console.warn("[OAuth] Callback error:", error);
        return;
      }

      if (!accessToken || !refreshToken || !expiresAtStr) return;

      const tokens = {
        accessToken,
        refreshToken,
        expiresAt: parseInt(expiresAtStr, 10),
      };

      // Persist to SecureStore immediately so the rest of the app can use them
      await SessionManager.saveTokens(tokens);
      onTokensReceived(tokens);
    } catch (e) {
      console.warn("[OAuth] Failed to parse callback URL:", e);
    }
  };

  useEffect(() => {
    // Handle the URL that launched the app (cold start via deep link)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Handle URLs when the app is already running (warm start)
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, []);

  return null;
}

function RootLayoutNav() {
  const { signInWithSocial, loadUserFromServer } = useAuth();
  const router = useRouter();
  const isOAuthLoading = React.useRef(false);

  const handleOAuthTokens = async (_tokens: { accessToken: string; refreshToken: string; expiresAt: number }) => {
    // Block AuthGate redirects while we load the user profile
    isOAuthLoading.current = true;
    try {
      await loadUserFromServer();
    } catch (e) {
      console.warn("[OAuth] Failed to load user after social sign-in:", e);
    } finally {
      isOAuthLoading.current = false;
    }
    router.replace("/(tabs)");
  };

  return (
      <JobsProvider>
          <InterviewProvider>
            <RoadmapProvider>
            <PortfolioProvider>
              <DialogProvider>
              {/* OAuth deep link listener — must be inside AuthProvider */}
              <OAuthDeepLinkHandler onTokensReceived={handleOAuthTokens} />
              <AuthGate isOAuthLoading={isOAuthLoading}>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
                  <Stack.Screen name="auth"          options={{ headerShown: false }} />
                  <Stack.Screen name="auth-2fa"      options={{ headerShown: false, presentation: "modal" }} />
                  <Stack.Screen name="auth-reauth"   options={{ headerShown: false, presentation: "modal" }} />
                  <Stack.Screen name="auth-security" options={{ headerShown: false }} />
                  <Stack.Screen name="auth-recover"  options={{ headerShown: false, presentation: "modal" }} />
                  <Stack.Screen name="auth-sessions"  options={{ headerShown: false }} />
                  <Stack.Screen name="auth-audit-log" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding"    options={{ headerShown: false }} />
                </Stack>
              </AuthGate>
              </DialogProvider>
            </PortfolioProvider>
            </RoadmapProvider>
          </InterviewProvider>
      </JobsProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProviderCompat>
                <AuthProvider>
                  <RootLayoutNav />
                </AuthProvider>
              </KeyboardProviderCompat>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
