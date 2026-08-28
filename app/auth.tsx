/**
 * auth.tsx — Full authentication screen.
 * Modes: login | register | verify-otp | security-questions | 2fa-choice
 * Features: email/OTP verify, password strength, social placeholders,
 *           biometric login, security questions, consent, risk display.
 */
import {
  AlertCircle, ArrowLeft, Eye, EyeOff,
  Lock, Mail, Phone, User as UserIcon,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useThemeMode } from "@/context/ThemeContext";
import { OtpInput } from "@/components/auth/OtpInput";
import { PasswordStrengthBar } from "@/components/auth/PasswordStrengthBar";
import { BiometricButton } from "@/components/auth/BiometricButton";
import { SecurityQuestionsForm } from "@/components/auth/SecurityQuestionsForm";
import { SocialAuthService } from "@/services/socialAuthService";
import { useBiometric } from "@/hooks/useBiometric";
import { showAlert } from "@/utils/alert";

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
  const { resolvedTheme } = useThemeMode();
  const isDarkMode = resolvedTheme === "dark";
  const {
    signIn, signUp, confirmEmailVerified, resendVerification, beginEmailVerification,
    pendingVerificationEmail, pendingUserId, biometricAvailable,
    biometricType, setSecurityQuestions,
    loadUserFromServer,
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

  // Starts the 10-minute OTP countdown. Shared by registration and by the
  // unverified-login recovery path below so the two cannot drift apart.
  const startOtpCountdown = useCallback(() => {
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
  }, []);

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
      // An account registered but never verified used to dead-end here: the
      // server refuses the login, and the OTP screen was reachable only as a
      // step immediately after registration. Reloading the app (or closing it)
      // stranded the account permanently — the address is taken, so re-
      // registering fails too. Send the user back into verification with a
      // fresh code instead.
      if (e.code === "EMAIL_NOT_VERIFIED") {
        const addr = email.trim().toLowerCase();
        try {
          if (e.userId) await beginEmailVerification(e.userId, addr, password);
          setMode("verify-otp");
          startOtpCountdown();
          await resendVerification();
          setError(null);
        } catch (inner: any) {
          setError(inner.message ?? "Could not resend the verification code.");
        }
        return;
      }
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [email, password, signIn, router, beginEmailVerification, resendVerification, startOtpCountdown]);

  // ── Biometric auto-prompt on login screen mount ───────────────────────────────
  React.useEffect(() => {
    if (mode !== "login") return;
    biometric.autoPromptOnMount(async () => {
      // biometric.login() only saves tokens — AuthContext's `user` is still
      // null until we actually load the profile, otherwise AuthGate sees no
      // user and immediately routes back here even though tokens are valid.
      await loadUserFromServer();
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
      // A single real attempt — full server round-trip. There used to be a
      // "fallback" retry here that called a second, near-identical biometric
      // path, which meant any definitive server rejection (e.g. "Account is
      // locked") triggered a pointless second native biometric prompt before
      // showing the same error. One attempt, one prompt.
      const result = await biometric.login();
      if (result) {
        // Populate AuthContext.user before navigating, or AuthGate bounces
        // straight back to /auth even though tokens are valid.
        await loadUserFromServer();
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
  }, [biometric, loadUserFromServer, router]);

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
      await signUp({ name: name.trim(), email: email.trim().toLowerCase(), password, phone: phone.trim() || undefined, consentGiven });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMode("verify-otp");
      startOtpCountdown();
    } catch (e: any) {
      setError(e.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [name, email, password, confirmPw, phone, pwValid, consentGiven, signUp, startOtpCountdown]);

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
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Gradient hero brand header */}
        <View style={[styles.hero, { paddingTop: insets.top + 24 }]}>
          <LinearGradient
            colors={
              isDarkMode
                ? ["#0b1223", "#111827", colors.background]
                : ["#eef2ff", "#fff", colors.background]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          />
          <View style={[styles.heroBlob, styles.heroBlobOne, { backgroundColor: (colors.primary || "#2563eb") + "26" }]} />
          <View style={[styles.heroBlob, styles.heroBlobTwo, { backgroundColor: (colors.jobs || "#7c3aed") + "1e" }]} />

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

          <Animated.View entering={FadeInDown.duration(500).springify().damping(14)} style={styles.brand}>
            {/* The brand mark, not a stock shield. The wordmark is the Text
                below, so this is the symbol alone — showing the full lockup
                here would print "Career Assistant" twice. */}
            <View style={[styles.logoCircle, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "30" }]}>
              <Image
                source={require("@/assets/images/logo-mark.png")}
                style={styles.logoMark}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </View>
            <Text style={[styles.appName, { color: colors.foreground }]}>Career Assistant</Text>
          </Animated.View>
        </View>

        <View style={styles.body}>
          {/* ── LOGIN ── */}
          {mode === "login" && (
            <Animated.View entering={FadeInDown.duration(400).delay(60).springify().damping(14)}>
              <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in to continue your journey</Text>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {/* Biometric */}
                {biometricAvailable && (
                  <View style={{ marginBottom: 4 }}>
                    <BiometricButton
                      type={biometricType}
                      onPress={handleBiometricLogin}
                      loading={loading}
                    />
                    <Divider colors={colors} label="or sign in with email" />
                  </View>
                )}

                <Field
                  icon={<Mail size={16} color={colors.primary} />}
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

                <TouchableOpacity
                  style={styles.forgotPwLink}
                  onPress={() => router.push("/auth-recover")}
                  accessibilityRole="button" accessibilityLabel="Forgot password">
                  <Text style={[styles.switchLink, { color: colors.primary }]}>Forgot password?</Text>
                </TouchableOpacity>

                {error && <ErrorBanner message={error} />}

                <PrimaryButton label="Sign In" onPress={handleLogin} loading={loading} color={colors.primary} />

                {/* Social login */}
                <Divider colors={colors} label="or continue with" />
                <SocialRow colors={colors} />
              </View>

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
            <Animated.View entering={FadeInDown.duration(400).springify().damping(14)}>
              <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Start your career journey today</Text>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Field icon={<UserIcon size={16} color={colors.primary} />}
                  placeholder="Full name" value={name} onChangeText={setName}
                  colors={colors} accessibilityLabel="Full name" />

                <Field icon={<Mail size={16} color={colors.primary} />}
                  placeholder="Email address" value={email} onChangeText={setEmail}
                  keyboardType="email-address" autoCapitalize="none"
                  colors={colors} accessibilityLabel="Email address" />
                {typoHint && (
                  <TouchableOpacity onPress={() => setEmail(typoHint)} style={styles.typoHint}>
                    <Text style={[styles.typoText, { color: colors.primary }]}>Did you mean {typoHint}?</Text>
                  </TouchableOpacity>
                )}

                <Field icon={<Phone size={16} color={colors.primary} />}
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
              </View>

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
            <Animated.View entering={FadeInDown.duration(400).springify().damping(14)}>
              <Text style={[styles.title, { color: colors.foreground }]}>Verify your email</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                We sent a 6-digit code to{"\n"}
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>
                  {pendingVerificationEmail ?? email}
                </Text>
              </Text>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center" }]}>
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
                          backgroundColor: otpTimer <= 60 ? "#ef4444" : otpTimer <= 180 ? "#f59e0b" : colors.primary,
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
              </View>
            </Animated.View>
          )}

          {/* ── SECURITY QUESTIONS ── */}
          {mode === "security-questions" && (
            <Animated.View entering={FadeInDown.duration(400).springify().damping(14)}>
              <Text style={[styles.title, { color: colors.foreground }]}>Security questions</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                These help you recover your account and provide backup authentication.
              </Text>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <SecurityQuestionsForm
                  onSubmit={handleSecurityQuestions}
                  loading={loading}
                  count={3}
                />
              </View>
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
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function Field({ icon, placeholder, value, onChangeText, keyboardType, autoCapitalize, colors, accessibilityLabel }: any) {
  return (
    <View style={[fieldStyles.wrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={[fieldStyles.iconWrap, { backgroundColor: colors.primary + "14" }]}>{icon}</View>
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
    <View style={[fieldStyles.wrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={[fieldStyles.iconWrap, { backgroundColor: colors.primary + "14" }]}>
        <Lock size={16} color={colors.primary} />
      </View>
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
      style={[styles.primaryBtn, { backgroundColor: color, opacity: disabled || loading ? 0.5 : 1, shadowColor: color }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.88}
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
  const [googleLoading, setGoogleLoading] = React.useState(false);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await SocialAuthService.signInWithGoogle();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace("/(tabs)");
    } catch (e: any) {
      if (e?.message !== "Sign-in was cancelled.") {
        showAlert("Google Sign-In Failed", e?.message ?? "Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <View style={styles.socialRow}>
      <TouchableOpacity
        style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
        onPress={handleGoogle}
        disabled={googleLoading}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
      >
        {googleLoading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <Text style={styles.socialEmoji}>G</Text>
        )}
        <Text style={[styles.socialLabel, { color: colors.foreground }]}>Continue with Google</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  hero: { paddingBottom: 20, position: "relative", overflow: "hidden" },
  heroGradient: { ...StyleSheet.absoluteFillObject },
  heroBlob: { position: "absolute", borderRadius: 999 },
  heroBlobOne: { width: 160, height: 160, right: -34, top: 4 },
  heroBlobTwo: { width: 110, height: 110, left: -30, top: 60 },
  backBtn: { marginLeft: 20, marginBottom: 4, alignSelf: "flex-start", padding: 4 },
  brand: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  logoCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 12, borderWidth: 1 },
  // contain, so the mark is never cropped by the circle.
  logoMark: { width: 36, height: 36 },
  appName: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.4 },
  body: { paddingHorizontal: 24, paddingBottom: 40 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, letterSpacing: -0.6, marginBottom: 6, marginTop: 20 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21, marginBottom: 20 },
  card: { borderRadius: 24, borderWidth: 1, padding: 20, marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 6, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4 },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1 },
  dividerLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  socialRow: { flexDirection: "row", gap: 12 },
  socialBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 14 },
  socialEmoji: { fontSize: 16, fontFamily: "Inter_700Bold" },
  socialLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  forgotPwLink: { alignSelf: "flex-end", marginTop: 8, marginBottom: 4 },
  switchRow: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
  switchText: { fontFamily: "Inter_500Medium", fontSize: 14 },
  switchLink: { fontFamily: "Inter_700Bold", fontSize: 14 },
  typoHint: { marginTop: -4, marginBottom: 8, paddingLeft: 4 },
  typoText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  mismatch: { fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 6 },
  otpWrap: { marginTop: 4, marginBottom: 8 },
  resendRow: { flexDirection: "row", justifyContent: "center", marginBottom: 16 },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 14, width: "100%" },
  infoText: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginVertical: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  consentText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
  skipBtn: { alignItems: "center", paddingVertical: 16 },
  skipText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});

const fieldStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 12, gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 15, paddingVertical: 12 },
});

const errStyles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#ef444418", borderRadius: 10, padding: 12, marginBottom: 10, marginTop: 4 },
  text: { flex: 1, color: "#ef4444", fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20 },
});
