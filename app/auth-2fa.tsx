/**
 * auth-2fa.tsx — 2FA verification screen.
 *
 * Shows the account's actual configured method (TOTP or Email — set once at
 * 2FA setup time) as the challenge. No backup-code fallback here by design.
 */
import { ArrowLeft, Shield, Smartphone } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { OtpInput } from "@/components/auth/OtpInput";

type PrimaryMethod = "totp" | "email";

const METHOD_INFO: Record<PrimaryMethod, { label: string; icon: string; desc: string }> = {
  totp:  { label: "Authenticator App", icon: "📱", desc: "Enter the 6-digit code from your authenticator app." },
  email: { label: "Email Code",        icon: "✉️",  desc: "We've sent a 6-digit code to your email address." },
};

export default function TwoFAScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors() as any;
  const params  = useLocalSearchParams<{ userId: string; method?: string }>();
  const userId  = params.userId ?? "";
  const primaryMethod: PrimaryMethod = params.method === "email" ? "email" : "totp";
  const { verify2FA } = useAuth();

  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [trustDevice, setTrustDevice] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);

  // The initial code was already dispatched by the server as part of the
  // login response — this only asks the server to issue a fresh one.
  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || resendLoading) return;
    setResendLoading(true);
    try {
      const { AuthApiService } = await import("@/services/authApiService");
      await AuthApiService.resend2FA({ userId, method: primaryMethod });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setResendCooldown(30);
      const interval = setInterval(() => {
        setResendCooldown((c) => { if (c <= 1) { clearInterval(interval); return 0; } return c - 1; });
      }, 1000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResendLoading(false);
    }
  }, [primaryMethod, userId, resendCooldown, resendLoading]);

  const handleOtpComplete = useCallback(async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      await verify2FA(code, primaryMethod, trustDevice);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [primaryMethod, trustDevice, verify2FA, router]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => router.back()}
        accessibilityRole="button" accessibilityLabel="Go back">
        <ArrowLeft size={22} color={colors.foreground} />
      </TouchableOpacity>

      <Animated.View entering={FadeInDown.duration(350)} style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
          <Shield size={32} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Two-step verification</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {METHOD_INFO[primaryMethod].desc}
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300)} style={styles.otpSection}>
        <OtpInput onComplete={handleOtpComplete} disabled={loading} autoFocus />

        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}

        <TouchableOpacity
          onPress={handleResend}
          disabled={resendCooldown > 0 || resendLoading}
          accessibilityRole="button"
          accessibilityLabel={resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
        >
          <Text style={[styles.linkText, { color: (resendCooldown > 0 || resendLoading) ? colors.mutedForeground : colors.primary }]}>
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : resendLoading ? "Sending…" : "Resend code"}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Error */}
      {error && (
        <View style={[styles.errorBanner, { backgroundColor: "#ef444418" }]}
          accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={{ color: "#ef4444", fontFamily: "Inter_500Medium", fontSize: 13 }}>{error}</Text>
        </View>
      )}

      {/* Trust device */}
      <TouchableOpacity
        style={styles.trustRow}
        onPress={() => setTrustDevice((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: trustDevice }}
      >
        <View style={[styles.checkbox, { borderColor: trustDevice ? colors.primary : colors.border, backgroundColor: trustDevice ? colors.primary : "transparent" }]}>
          {trustDevice && <Text style={{ color: "#fff", fontSize: 11 }}>✓</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.trustLabel, { color: colors.foreground }]}>Trust this device for 30 days</Text>
          <Text style={[styles.trustSub, { color: colors.mutedForeground }]}>
            Skip 2FA on this device until {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Security note */}
      <View style={[styles.secNote, { backgroundColor: colors.accent, borderColor: colors.border }]}>
        <Smartphone size={14} color={colors.accentForeground} />
        <Text style={[styles.secNoteText, { color: colors.accentForeground }]}>
          We're keeping your data safe 🔒 — two-step verification prevents unauthorised access even if your password is compromised.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 8, alignSelf: "flex-start", padding: 4 },
  header: { alignItems: "center", marginBottom: 24 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, letterSpacing: -0.6, marginBottom: 8, textAlign: "center" },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center", lineHeight: 22, paddingHorizontal: 12 },
  otpSection: { alignItems: "center", gap: 16, marginBottom: 8 },
  linkText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  errorBanner: { borderRadius: 10, padding: 12, marginTop: 12 },
  trustRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginVertical: 16 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 2 },
  trustLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  trustSub: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  secNote: { flexDirection: "row", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, alignItems: "flex-start" },
  secNoteText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
});
