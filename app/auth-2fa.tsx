/**
 * auth-2fa.tsx — 2FA verification screen.
 * Supports: TOTP (Authenticator App), SMS, Email OTP, Backup Code.
 * Timer countdown for TOTP step. Device trust option.
 */
import { ArrowLeft, Clock, RefreshCw, Shield, Smartphone } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { OtpInput } from "@/components/auth/OtpInput";
import { OtpService } from "@/services/otpService";

type TwoFAMethod = "totp" | "sms" | "email" | "backup";

const METHOD_INFO: Record<TwoFAMethod, { label: string; icon: string; desc: string }> = {
  totp:   { label: "Authenticator App", icon: "📱", desc: "Enter the 6-digit code from your authenticator app (e.g. Google Authenticator)." },
  sms:    { label: "SMS Code",          icon: "💬", desc: "We'll send a 6-digit code to your registered phone number." },
  email:  { label: "Email Code",        icon: "✉️",  desc: "We'll send a 6-digit code to your email address." },
  backup: { label: "Backup Code",       icon: "🔑", desc: "Use one of your 10 single-use backup codes." },
};

export default function TwoFAScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors() as any;
  const params  = useLocalSearchParams<{ userId: string }>();
  const userId  = params.userId ?? "";
  const { verify2FA } = useAuth();

  const [method, setMethod]           = useState<TwoFAMethod>("totp");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [trustDevice, setTrustDevice] = useState(false);
  const [backupCode, setBackupCode]   = useState("");
  const [totpStep, setTotpStep]       = useState(OtpService.getTotpStepRemainingSecs());
  const [codeSent, setCodeSent]       = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // TOTP step countdown
  useEffect(() => {
    stepTimer.current = setInterval(() => {
      setTotpStep(OtpService.getTotpStepRemainingSecs());
    }, 1000);
    return () => { if (stepTimer.current) clearInterval(stepTimer.current); };
  }, []);

  const sendOtp = useCallback(async (m: "sms" | "email") => {
    setLoading(true);
    try {
      const otp = await OtpService.createOtp(`2fa_${m}_${userId}`);
      console.log(`[DEV] 2FA OTP (${m}) for ${userId}: ${otp}`);
      setCodeSent(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const handleSwitchMethod = (m: TwoFAMethod) => {
    setMethod(m);
    setError(null);
    setCodeSent(false);
    if (m === "sms" || m === "email") sendOtp(m);
  };

  const handleOtpComplete = useCallback(async (code: string) => {
    setError(null);
    setLoading(true);
    try {
      await verify2FA(code, method, trustDevice);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [method, trustDevice, verify2FA, router]);

  const handleBackupSubmit = useCallback(async () => {
    if (!backupCode.trim()) { setError("Please enter your backup code."); return; }
    await handleOtpComplete(backupCode.trim().toUpperCase());
  }, [backupCode, handleOtpComplete]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}
        accessibilityRole="button" accessibilityLabel="Go back">
        <ArrowLeft size={22} color={colors.foreground} />
      </TouchableOpacity>

      <Animated.View entering={FadeInDown.duration(350)} style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
          <Shield size={32} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Two-step verification</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {METHOD_INFO[method].desc}
        </Text>
      </Animated.View>

      {/* Method switcher */}
      <View style={styles.methodRow}>
        {(Object.keys(METHOD_INFO) as TwoFAMethod[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.methodChip, {
              backgroundColor: method === m ? colors.primary + "18" : colors.card,
              borderColor: method === m ? colors.primary : colors.border,
            }]}
            onPress={() => handleSwitchMethod(m)}
            accessibilityRole="tab"
            accessibilityLabel={METHOD_INFO[m].label}
            accessibilityState={{ selected: method === m }}
          >
            <Text style={styles.methodEmoji}>{METHOD_INFO[m].icon}</Text>
            <Text style={[styles.methodLabel, { color: method === m ? colors.primary : colors.mutedForeground }]}
              numberOfLines={1}>
              {METHOD_INFO[m].label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* TOTP / SMS / Email OTP input */}
      {method !== "backup" && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.otpSection}>
          {/* TOTP timer */}
          {method === "totp" && (
            <View style={[styles.timerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Clock size={16} color={totpStep <= 10 ? "#ef4444" : colors.mutedForeground} />
              <Text style={[styles.timerText, { color: totpStep <= 10 ? "#ef4444" : colors.mutedForeground }]}>
                Code refreshes in {totpStep}s
              </Text>
              <View style={[styles.timerBar, { backgroundColor: colors.border }]}>
                <View style={[styles.timerFill, {
                  width: `${(totpStep / 30) * 100}%` as any,
                  backgroundColor: totpStep <= 10 ? "#ef4444" : colors.primary,
                }]} />
              </View>
            </View>
          )}

          {/* Code sent confirmation */}
          {codeSent && (method === "sms" || method === "email") && (
            <View style={[styles.sentBanner, { backgroundColor: "#10b98118", borderColor: "#10b981" }]}>
              <Text style={{ color: "#10b981", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                ✓ Code sent! Check your {method === "sms" ? "phone" : "email"}.
              </Text>
            </View>
          )}

          <OtpInput onComplete={handleOtpComplete} disabled={loading} autoFocus={method === "totp"} />

          {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />}
        </Animated.View>
      )}

      {/* Backup code input */}
      {method === "backup" && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.backupSection}>
          <TextInput
            style={[styles.backupInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="XXXX-XXXX"
            placeholderTextColor={colors.mutedForeground}
            value={backupCode}
            onChangeText={setBackupCode}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Backup code"
          />
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: backupCode.trim() ? 1 : 0.5 }]}
            onPress={handleBackupSubmit}
            disabled={loading || !backupCode.trim()}
            accessibilityRole="button"
            accessibilityLabel="Verify backup code"
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitText}>Verify Backup Code</Text>
            }
          </TouchableOpacity>
        </Animated.View>
      )}

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
  methodRow: { flexDirection: "row", gap: 8, marginBottom: 24, flexWrap: "wrap" },
  methodChip: { flex: 1, alignItems: "center", paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14, borderWidth: 1, gap: 4, minWidth: 70 },
  methodEmoji: { fontSize: 18 },
  methodLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10, textAlign: "center" },
  otpSection: { alignItems: "center", gap: 16, marginBottom: 20 },
  timerCard: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, padding: 10, width: "100%", flexWrap: "wrap" },
  timerText: { fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 },
  timerBar: { width: "100%", height: 3, borderRadius: 2, overflow: "hidden" },
  timerFill: { height: 3, borderRadius: 2 },
  sentBanner: { borderRadius: 10, borderWidth: 1, padding: 10, width: "100%", alignItems: "center" },
  backupSection: { gap: 14, marginBottom: 20 },
  backupInput: { borderWidth: 1, borderRadius: 14, padding: 16, fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center", letterSpacing: 4 },
  submitBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center" },
  submitText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  errorBanner: { borderRadius: 10, padding: 12, marginBottom: 12 },
  trustRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginVertical: 16 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 2 },
  trustLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  trustSub: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  secNote: { flexDirection: "row", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, alignItems: "flex-start" },
  secNoteText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
});
