/**
 * auth.tsx — Full authentication screen.
 * Modes: login | register | verify-otp | security-questions | 2fa-choice
 * Features: email/OTP verify, password strength, social placeholders,
 *           biometric login, security questions, consent, risk display.
 */
import {
  AlertCircle, ArrowLeft, CheckCircle, Eye, EyeOff,
  Fingerprint, Lock, Mail, Phone, User as UserIcon, Shield,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { OtpInput } from "@/components/auth/OtpInput";
import { PasswordStrengthBar } from "@/components/auth/PasswordStrengthBar";
import { BiometricButton } from "@/components/auth/BiometricButton";
import { SecurityQuestionsForm } from "@/components/auth/SecurityQuestionsForm";
import { SocialAuthService } from "@/services/socialAuthService";
import { useBiometric } from "@/hooks/useBiometric";

// ─── Helpers ───────────────────────────────────────────────────────────────────
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const COMMON_TYPOS: Record<string, string> = {
  "gmail.con": "gmail.com", "gmail.cmo": "gmail.com", "gmal.com": "gmail.com",
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com",
  "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmali.com": "hotmail.com",
  "outlok.com": "outlook.com",
};

function detectEmailTypo(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain) return null;
  const fix = COMMON_TYPOS[domain.toLowerCase()];
  return fix ? `${email.split("@")[0]}@${fix}` : null;
}

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

type Mode = "login" | "register" | "verify-otp" | "security-questions";

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function AuthScreen() {
  const router   = useRouter();
  const colors   = useColors() as any;
  const insets   = useSafeAreaInsets();
  const {
    signIn, signUp, confirmEmailVerified, resendVerification,
    pendingVerificationEmail, pendingUserId, biometricAvailable,
    biometricType, loginWithBiometric, setSecurityQuestions,
  } = useAuth();

  // Biometric hook — drives real enrol/login/auto-prompt
  const biometric = useBiometric();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [name, setName]         = useState("");
  const [phone, setPhone]       = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [otpError, setOtpError] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  const otpTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);

  const pwRules = getPasswordRules(password);
  const pwValid = Object.values(pwRules).every(Boolean);

  // ── Switch modes ─────────────────────────────────────────────────────────────
  const goLogin    = () => { setMode("login");    setError(null); };
  const goRegister = () => { setMode("register"); setError(null); };

  // ── Login ────────────────────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    setError(null);
    if (!EMAIL_REGEX.test(email)) { setError("Please enter a valid email."); return; }
    if (password.length < 6)     { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      const result = await signIn(email.trim().toLowerCase(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (result.require2FA) {
        router.push({ pathname: "/auth-2fa", params: { userId: result.userId ?? "", method: result.method ?? "totp" } });
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [email, password, signIn, router]);

  // ── Biometric auto-prompt on login screen mount ───────────────────────────────
  React.useEffect(() => {
    if (mode !== "login") return;
    biometric.autoPromptOnMount(async (result) => {
      // Save tokens + navigate — result.user is available if needed
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Biometric login ──────────────────────────────────────────────────────────
  const handleBiometricLogin = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      // Try the hook-based biometric login first (full server round-trip)
      const result = await biometric.login();
      if (result) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace("/(tabs)");
        return;
      }
      // Fall back to legacy AuthContext biometric (local simulation)
      const ok = await loginWithBiometric();
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace("/(tabs)");
      } else {
        setError(biometric.error ?? "Biometric authentication failed. Please sign in with your password.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [biometric, loginWithBiometric, router]);

  // ── Register ─────────────────────────────────────────────────────────────────
  const handleRegister = useCallback(async () => {
    setError(null);
    if (!name.trim())            { setError("Please enter your name."); return; }
    if (!EMAIL_REGEX.test(email)) { setError("Please enter a valid email."); return; }
    if (!pwValid)                { setError("Password does not meet all requirements."); return; }
    if (password !== confirmPw)  { setError("Passwords do not match."); return; }
    if (!consentGiven)           { setError("Please accept the privacy policy to continue."); return; }
    setLoading(true);
    try {
      await signUp({ name: name.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim() || undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMode("verify-otp");
      // Start 10-minute countdown timer
      setOtpTimer(10 * 60);
      if (otpTimerRef.current) clearInterval(otpTimerRef.current);
      otpTimerRef.current = setInterval(() => {
        setOtpTimer((t) => {
          if (t <= 1) {
            clearInterval(otpTimerRef.current!);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [name, email, password, confirmPw, phone, pwValid, consentGiven, signUp]);

  // ── OTP verify ───────────────────────────────────────────────────────────────
  const handleOtpComplete = useCallback(async (code: string) => {
    setOtpError(false);
    setLoading(true);
    try {
      // confirmEmailVerified checks the code against the server (real OTP,
      // real email) and signs the user in on success.
      await confirmEmailVerified(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Prompt to set security questions
      setMode("security-questions");
    } catch (e: any) {
      setError(e.message);
      setOtpError(true);
    } finally {
      setLoading(false);
    }
  }, [confirmEmailVerified]);

  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0 || resendLoading) return;
    // Block re-taps immediately — resendCooldown itself isn't set until the
    // request resolves, which left a window for rapid double/triple taps to
    // all fire before the button visually disabled itself.
    setResendLoading(true);
    try {
      await resendVerification();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown((c) => { if (c <= 1) { clearInterval(interval); return 0; } return c - 1; });
      }, 1000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResendLoading(false);
    }
  }, [resendCooldown, resendLoading, resendVerification]);

  // ── Security questions ────────────────────────────────────────────────────────
  const handleSecurityQuestions = useCallback(async (qs: Array<{ question: string; answer: string }>) => {
    setLoading(true);
    try {
      await setSecurityQuestions(qs);
      router.replace("/onboarding");
    } catch {
      router.replace("/onboarding");
    } finally {
      setLoading(false);
    }
  }, [setSecurityQuestions, router]);

  // ── Typo hint ─────────────────────────────────────────────────────────────────
  const typoHint = EMAIL_REGEX.test(email) ? detectEmailTypo(email) : null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
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
        {/* Back button (register → login) */}
        {(mode === "register" || mode === "verify-otp" || mode === "security-questions") && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={mode === "register" ? goLogin : mode === "verify-otp" ? goRegister : goLogin}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={colors.foreground} />
          </TouchableOpacity>
        )}

        {/* Logo / brand */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.brand}>
          <View style={[styles.logoCircle, { backgroundColor: colors.primary + "18" }]}>
            <Shield size={36} color={colors.primary} />
          </View>
          <Text style={[styles.appName, { color: colors.foreground }]}>Career Assistant</Text>
        </Animated.View>

        {/* ── LOGIN ── */}
        {mode === "login" && (
          <Animated.View entering={FadeInDown.duration(350).delay(80)}>
            <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in to continue your journey</Text>

            {/* Biometric */}
            {biometricAvailable && (
              <View style={{ marginBottom: 16 }}>
                <BiometricButton
                  type={biometricType}
                  onPress={handleBiometricLogin}
                  loading={loading}
                />
                <Divider colors={colors} label="or sign in with email" />
              </View>
            )}

            <Field
              icon={<Mail size={18} color={colors.mutedForeground} />}
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              colors={colors}
              accessibilityLabel="Email address"
            />
            {typoHint && (
              <TouchableOpacity onPress={() => setEmail(typoHint)} style={styles.typoHint}>
                <Text style={[styles.typoText, { color: colors.primary }]}>
                  Did you mean {typoHint}?
                </Text>
              </TouchableOpacity>
            )}
            <PasswordField
              value={password}
              onChangeText={setPassword}
              show={showPw}
              onToggleShow={() => setShowPw((v) => !v)}
              colors={colors}
              placeholder="Password"
            />

            {error && <ErrorBanner message={error} />}

            <PrimaryButton label="Sign In" onPress={handleLogin} loading={loading} color={colors.primary} />

            {/* Social login placeholders */}
            <Divider colors={colors} label="or continue with" />
            <SocialRow colors={colors} />

            <View style={styles.switchRow}>
              <Text style={[styles.switchText, { color: colors.mutedForeground }]}>Don't have an account? </Text>
              <TouchableOpacity onPress={goRegister} accessibilityRole="button">
                <Text style={[styles.switchLink, { color: colors.primary }]}>Create one</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* ── REGISTER ── */}
        {mode === "register" && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Start your career journey today</Text>

            <Field icon={<UserIcon size={18} color={colors.mutedForeground} />}
              placeholder="Full name" value={name} onChangeText={setName}
              colors={colors} accessibilityLabel="Full name" />

            <Field icon={<Mail size={18} color={colors.mutedForeground} />}
              placeholder="Email address" value={email} onChangeText={setEmail}
              keyboardType="email-address" autoCapitalize="none"
              colors={colors} accessibilityLabel="Email address" />
            {typoHint && (
              <TouchableOpacity onPress={() => setEmail(typoHint)} style={styles.typoHint}>
                <Text style={[styles.typoText, { color: colors.primary }]}>Did you mean {typoHint}?</Text>
              </TouchableOpacity>
            )}

            <Field icon={<Phone size={18} color={colors.mutedForeground} />}
              placeholder="Phone (optional)" value={phone} onChangeText={setPhone}
              keyboardType="phone-pad"
              colors={colors} accessibilityLabel="Phone number (optional)" />

            <PasswordField value={password} onChangeText={setPassword}
              show={showPw} onToggleShow={() => setShowPw((v) => !v)}
              colors={colors} placeholder="Password (8+ characters)" />

            <PasswordStrengthBar password={password} rules={pwRules} />

            <PasswordField value={confirmPw} onChangeText={setConfirmPw}
              show={showConfirmPw} onToggleShow={() => setShowConfirmPw((v) => !v)}
              colors={colors} placeholder="Confirm password" />

            {confirmPw.length > 0 && confirmPw !== password && (
              <Text style={[styles.mismatch, { color: "#ef4444" }]}>Passwords do not match.</Text>
            )}

            {/* Consent */}
            <TouchableOpacity
              style={styles.consentRow}
              onPress={() => setConsentGiven((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consentGiven }}
            >
              <View style={[styles.checkbox, { borderColor: consentGiven ? colors.primary : colors.border, backgroundColor: consentGiven ? colors.primary : "transparent" }]}>
                {consentGiven && <Text style={{ color: "#fff", fontSize: 12, lineHeight: 16 }}>✓</Text>}
              </View>
              <Text style={[styles.consentText, { color: colors.mutedForeground }]}>
                I agree to the{" "}
                <Text style={{ color: colors.primary }}>Privacy Policy</Text>
                {" "}and{" "}
                <Text style={{ color: colors.primary }}>Terms of Service</Text>
                {" "}(GDPR compliant)
              </Text>
            </TouchableOpacity>

            {error && <ErrorBanner message={error} />}

            <PrimaryButton label="Create Account" onPress={handleRegister} loading={loading} color={colors.primary}
              disabled={!pwValid || !consentGiven} />

            <View style={styles.switchRow}>
              <Text style={[styles.switchText, { color: colors.mutedForeground }]}>Already have an account? </Text>
              <TouchableOpacity onPress={goLogin} accessibilityRole="button">
                <Text style={[styles.switchLink, { color: colors.primary }]}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* ── OTP VERIFY ── */}
        {mode === "verify-otp" && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <Text style={[styles.title, { color: colors.foreground }]}>Verify your email</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              We sent a 6-digit code to{"\n"}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>
                {pendingVerificationEmail ?? email}
              </Text>
            </Text>

            <View style={styles.otpWrap}>
              <OtpInput onComplete={handleOtpComplete} hasError={otpError} disabled={loading} />
            </View>

            {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />}
            {error && <ErrorBanner message={error} />}

            <View style={styles.resendRow}>
              <Text style={[styles.switchText, { color: colors.mutedForeground }]}>Didn't receive it? </Text>
              <TouchableOpacity
                onPress={handleResendOtp}
                disabled={resendCooldown > 0 || resendLoading}
                accessibilityRole="button"
                accessibilityLabel={resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              >
                <Text style={[styles.switchLink, { color: (resendCooldown > 0 || resendLoading) ? colors.mutedForeground : colors.primary }]}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : resendLoading ? "Sending…" : "Resend code"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.infoCard, { backgroundColor: otpTimer <= 60 && otpTimer > 0 ? "#ef444418" : otpTimer === 0 ? "#ef444418" : colors.accent, borderColor: otpTimer <= 60 && otpTimer > 0 ? "#ef4444" : colors.border }]}>
              {otpTimer > 0 ? (
                <View style={{ alignItems: "center" }}>
                  <Text style={[styles.infoText, { color: otpTimer <= 60 ? "#ef4444" : colors.accentForeground, textAlign: "center" }]}>
                    {otpTimer <= 60 ? "⚠️" : "🔒"} Code expires in{" "}
                    <Text style={{ fontFamily: "Inter_700Bold" }}>
                      {String(Math.floor(otpTimer / 60)).padStart(2, "0")}:{String(otpTimer % 60).padStart(2, "0")}
                    </Text>
                  </Text>
                  <View style={{ width: "100%", height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 10 }}>
                    <View style={{
                      width: `${(otpTimer / 600) * 100}%`,
                      height: 4,
                      backgroundColor: otpTimer <= 60 ? "#ef4444" : otpTimer <= 180 ? "#f59e0b" : "#6366f1",
                      borderRadius: 2,
                    }} />
                  </View>
                </View>
              ) : (
                <Text style={[styles.infoText, { color: "#ef4444", textAlign: "center" }]}>
                  ⏰ Code expired. Please request a new one.
                </Text>
              )}
            </View>
          </Animated.View>
        )}

        {/* ── SECURITY QUESTIONS ── */}
        {mode === "security-questions" && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <Text style={[styles.title, { color: colors.foreground }]}>Security questions</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              These help you recover your account and provide backup authentication.
            </Text>
            <SecurityQuestionsForm
              onSubmit={handleSecurityQuestions}
              loading={loading}
              count={3}
            />
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => router.replace("/onboarding")}
              accessibilityRole="button"
              accessibilityLabel="Skip security questions"
            >
              <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip for now</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function Field({ icon, placeholder, value, onChangeText, keyboardType, autoCapitalize, colors, accessibilityLabel }: any) {
  return (
    <View style={[fieldStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {icon}
      <TextInput
        style={[fieldStyles.input, { color: colors.foreground }]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

function PasswordField({ value, onChangeText, show, onToggleShow, colors, placeholder }: any) {
  return (
    <View style={[fieldStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Lock size={18} color={colors.mutedForeground} />
      <TextInput
        style={[fieldStyles.input, { color: colors.foreground }]}
        placeholder={placeholder ?? "Password"}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!show}
        autoCapitalize="none"
        textContentType="password"
        accessibilityLabel={placeholder ?? "Password"}
      />
      <TouchableOpacity onPress={onToggleShow} accessibilityRole="button" accessibilityLabel={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff size={18} color={colors.mutedForeground} /> : <Eye size={18} color={colors.mutedForeground} />}
      </TouchableOpacity>
    </View>
  );
}

function PrimaryButton({ label, onPress, loading, color, disabled }: any) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, { backgroundColor: color, opacity: disabled || loading ? 0.5 : 1 }]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled }}
    >
      {loading
        ? <ActivityIndicator color="#fff" />
        : <Text style={styles.primaryBtnText}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={errStyles.wrap} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <AlertCircle size={16} color="#ef4444" />
      <Text style={errStyles.text}>{message}</Text>
    </View>
  );
}

function Divider({ colors, label }: any) {
  return (
    <View style={styles.divider}>
      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      <Text style={[styles.dividerLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
    </View>
  );
}

function SocialRow({ colors }: any) {
  const router = useRouter();
  const [googleLoading,   setGoogleLoading]   = React.useState(false);
  const [linkedinLoading, setLinkedinLoading] = React.useState(false);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await SocialAuthService.signInWithGoogle();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    } catch (e: any) {
      if (e?.message !== "Sign-in was cancelled.") {
        Alert.alert("Google Sign-In Failed", e?.message ?? "Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLinkedIn = async () => {
    setLinkedinLoading(true);
    try {
      await SocialAuthService.signInWithLinkedIn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    } catch (e: any) {
      if (e?.message !== "Sign-in was cancelled.") {
        Alert.alert("LinkedIn Sign-In Failed", e?.message ?? "Please try again.");
      }
    } finally {
      setLinkedinLoading(false);
    }
  };

  return (
    <View style={styles.socialRow}>
      <TouchableOpacity
        style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={handleGoogle}
        disabled={googleLoading || linkedinLoading}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
      >
        {googleLoading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <Text style={styles.socialEmoji}>G</Text>
        )}
        <Text style={[styles.socialLabel, { color: colors.foreground }]}>Google</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={handleLinkedIn}
        disabled={googleLoading || linkedinLoading}
        accessibilityRole="button"
        accessibilityLabel="Continue with LinkedIn"
      >
        {linkedinLoading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <Text style={styles.socialEmoji}>in</Text>
        )}
        <Text style={[styles.socialLabel, { color: colors.foreground }]}>LinkedIn</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 8, alignSelf: "flex-start", padding: 4 },
  brand: { alignItems: "center", marginBottom: 28 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  appName: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.7, marginBottom: 6 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 15, lineHeight: 23, marginBottom: 24, color: "#888" },
  primaryBtn: { borderRadius: 16, paddingVertical: 17, alignItems: "center", marginTop: 8, marginBottom: 12 },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1 },
  dividerLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  socialRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  socialBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 13 },
  socialEmoji: { fontSize: 18 },
  socialLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  switchText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  switchLink: { fontFamily: "Inter_700Bold", fontSize: 14 },
  typoHint: { marginTop: -4, marginBottom: 8, paddingLeft: 4 },
  typoText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  mismatch: { fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 6 },
  otpWrap: { marginVertical: 24 },
  resendRow: { flexDirection: "row", justifyContent: "center", marginBottom: 16 },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  infoText: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginVertical: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  consentText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
  skipBtn: { alignItems: "center", paddingVertical: 14 },
  skipText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});

const fieldStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 12, gap: 10 },
  input: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 15 },
});

const errStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#ef444418", borderRadius: 10, padding: 12, marginBottom: 10 },
  text: { flex: 1, color: "#ef4444", fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
});
