import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CVProvider } from "@/context/CVContext";
import { JobsProvider } from "@/context/JobsContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { RoadmapProvider } from "@/context/RoadmapContext";
import { InterviewProvider } from "@/context/InterviewContext";
import { PortfolioProvider } from "@/context/PortfolioContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// ── Auth + re-auth gate ───────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading, reauthUrgency } = useAuth();
  const router   = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuth       = segments[0] === "auth";
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

function RootLayoutNav() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CVProvider>
          <JobsProvider>
            <RoadmapProvider>
              <InterviewProvider>
                <PortfolioProvider>
                  <AuthGate>
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
                      <Stack.Screen name="auth"          options={{ headerShown: false }} />
                      <Stack.Screen name="auth-2fa"      options={{ headerShown: false, presentation: "modal" }} />
                      <Stack.Screen name="auth-reauth"   options={{ headerShown: false, presentation: "modal" }} />
                      <Stack.Screen name="auth-security" options={{ headerShown: false }} />
                      <Stack.Screen name="onboarding"    options={{ headerShown: false }} />
                    </Stack>
                  </AuthGate>
                </PortfolioProvider>
              </InterviewProvider>
            </RoadmapProvider>
          </JobsProvider>
        </CVProvider>
      </AuthProvider>
    </ThemeProvider>
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
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
