/**
 * auth-recover.tsx — Forgot password / account recovery.
 *
 * Flow: enter email → server emails a 6-digit recovery code (1-hour TTL) →
 * enter code → server issues a one-hour recoveryToken → set a new password.
 * All three steps hit the real server (server/services/authService.js:
 * recoverAccount / verifyRecoveryOtp / resetPassword) — there's no local
 * fallback, matching the rest of the auth system.
 */
import { ArrowLeft, Eye, EyeOff, Lock, Mail } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { useColors } from "@/hooks/useColors";
import { OtpInput } from "@/components/auth/OtpInput";
import { PasswordStrengthBar } from "@/components/auth/PasswordStrengthBar";
import { AuthApiService } from "@/services/authApiService";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function getPasswordRules(password: string) {
  return {
    hasMinLength:   password.length >= 8,
    hasUppercase:   /[A-Z]/.test(password),
    hasLowercase:   /[a-z]/.test(password),
    hasNumber:      /\d/.test(password),
    hasSpecialChar: /[^A-Za-z0-9]/.test(password),
    hasNoSpaces:    !/\s/.test(password),
  };
}

type Step = "email" | "otp" | "reset" | "done";

export default function RecoverScreen() {
  const router = useRouter();
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState(false);

  const pwRules = getPasswordRules(newPassword);
  const pwValid = Object.values(pwRules).every(Boolean);

  // ── Step 1: request a recovery code ───────────────────────────────────────────
  const handleRequestCode = useCallback(async () => {
    setError(null);
    if (!EMAIL_REGEX.test(email)) { setError("Please enter a valid email."); return; }
    setLoading(true);
    try {
      const result = await AuthApiService.recoverAccount({ method: "email", email: email.trim().toLowerCase() });
      // The server always returns a generic success message to prevent
      // account enumeration — if no account exists, userId is simply absent
      // and step 2 (OTP) will fail with "expired or not found" rather than
      // confirming or denying the account exists.
      setUserId(result.userId ?? null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep("otp");
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [email]);

  // ── Step 2: verify the emailed code ───────────────────────────────────────────
  const handleVerifyOtp = useCallback(async (code: string) => {
    setOtpError(false);
    setError(null);
    if (!userId) {
      setError("No account found with that email.");
      setOtpError(true);
      return;
    }
    setLoading(true);
    try {
      const result = await AuthApiService.verifyRecoveryOtp({ userId, otp: code });
      setRecoveryToken(result.recoveryToken);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep("reset");
    } catch (e: any) {
      setError(e.message);
      setOtpError(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // ── Step 3: set the new password ──────────────────────────────────────────────
  const handleResetPassword = useCallback(async () => {
    setError(null);
    if (!pwValid) { setError("Password does not meet all requirements."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    if (!recoveryToken) { setError("Recovery session expired. Please start over."); return; }
    setLoading(true);
    try {
      await AuthApiService.resetPassword({ recoveryToken, newPassword });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep("done");
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [pwValid, newPassword, confirmPassword, recoveryToken]);

  const handleBack = () => {
    if (step === "email") { router.back(); return; }
    if (step === "otp") { setStep("email"); setOtpError(false); setError(null); return; }
    if (step === "reset") { setStep("otp"); setError(null); return; }
    router.replace("/auth");
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}
          accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={colors.foreground} />
        </TouchableOpacity>

        {step === "email" && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
              <Mail size={32} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Reset your password</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter the email on your account — we'll send you a 6-digit code.
            </Text>

            <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Mail size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Email"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                accessibilityLabel="Email"
              />
            </View>

            {error && <ErrorBanner message={error} />}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
              onPress={handleRequestCode}
              disabled={loading}
              accessibilityRole="button" accessibilityLabel="Send recovery code">
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send Code</Text>}
            </TouchableOpacity>
          </Animated.View>
        )}

        {step === "otp" && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <Text style={[styles.title, { color: colors.foreground }]}>Enter the code</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              We sent a 6-digit code to {email}. It's valid for 1 hour.
            </Text>

            <View style={{ marginVertical: 20 }}>
              <OtpInput onComplete={handleVerifyOtp} hasError={otpError} disabled={loading} />
            </View>

            {loading && <ActivityIndicator color={colors.primary} style={{ marginBottom: 16 }} />}
            {error && <ErrorBanner message={error} />}
          </Animated.View>
        )}

        {step === "reset" && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
              <Lock size={32} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Set a new password</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Choose a strong password you haven't used before.
            </Text>

            <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Lock size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="New password"
                placeholderTextColor={colors.mutedForeground}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                accessibilityLabel="New password"
              />
              <TouchableOpacity onPress={() => setShowPw((v) => !v)}
                accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"}>
                {showPw ? <EyeOff size={18} color={colors.mutedForeground} /> : <Eye size={18} color={colors.mutedForeground} />}
              </TouchableOpacity>
            </View>
            {newPassword.length > 0 && <PasswordStrengthBar password={newPassword} rules={pwRules} />}

            <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
              <Lock size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                accessibilityLabel="Confirm new password"
              />
            </View>

            {error && <ErrorBanner message={error} />}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: (loading || !pwValid) ? 0.5 : 1, marginTop: 16 }]}
              onPress={handleResetPassword}
              disabled={loading || !pwValid}
              accessibilityRole="button" accessibilityLabel="Reset password">
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Reset Password</Text>}
            </TouchableOpacity>
          </Animated.View>
        )}

        {step === "done" && (
          <Animated.View entering={FadeInDown.duration(350)} style={{ alignItems: "center" }}>
            <View style={[styles.iconCircle, { backgroundColor: "#10b98118" }]}>
              <Lock size={32} color="#10b981" />
            </View>
            <Text style={[styles.title, { color: colors.foreground, textAlign: "center" }]}>Password updated</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: "center" }]}>
              Your password has been reset and all other devices have been signed out. Sign in with your new password.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 20, alignSelf: "stretch" }]}
              onPress={() => router.replace("/auth")}
              accessibilityRole="button" accessibilityLabel="Back to sign in">
              <Text style={styles.primaryBtnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ErrorBanner({ message }: { message: string }) {
  const colors = useColors() as any;
  return (
    <View style={[styles.errorBanner, { backgroundColor: "#ef444418" }]}
      accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: "#ef4444", fontFamily: "Inter_500Medium", fontSize: 13 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 20, alignSelf: "flex-start", padding: 4 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 20, alignSelf: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, letterSpacing: -0.6, marginBottom: 8, textAlign: "center" },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 54 },
  input: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 15, height: "100%" },
  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  errorBanner: { borderRadius: 10, padding: 12, marginTop: 16 },
});
