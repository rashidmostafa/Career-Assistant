import { BriefcaseBusiness, AlertCircle, CheckCircle, AlertTriangle, Eye, EyeOff, Mail, Lock } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
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
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const COMMON_TYPOS: Record<string, string> = {
  "gmail.con": "gmail.com",
  "gmail.cmo": "gmail.com",
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmail.co": "gmail.com",
  "yahooo.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "hotmali.com": "hotmail.com",
  "outlok.com": "outlook.com",
};

function detectEmailTypo(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain) return null;
  const fix = COMMON_TYPOS[domain.toLowerCase()];
  return fix ? `${email.split("@")[0]}@${fix}` : null;
}

function getEmailState(email: string) {
  if (!email) return { valid: false, hint: null, typoSuggestion: null };
  const typoSuggestion = detectEmailTypo(email);
  if (!EMAIL_REGEX.test(email)) {
    return {
      valid: false,
      hint: "Please enter a valid email (e.g., name@domain.com)",
      typoSuggestion: null,
    };
  }
  return { valid: true, hint: null, typoSuggestion };
}

function getPasswordState(password: string) {
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);
  const hasNoSpaces = !/\s/.test(password);

  return {
    valid: hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecialChar && hasNoSpaces,
    rules: {
      hasMinLength,
      hasUppercase,
      hasLowercase,
      hasNumber,
      hasSpecialChar,
      hasNoSpaces,
    },
  };
}

type Mode = "login" | "register";

export default function AuthScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, signUp, pendingVerificationEmail, confirmEmailVerified, resendVerification } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resentSuccess, setResentSuccess] = useState(false);

  const emailState = getEmailState(email);
  const passwordState = getPasswordState(password);

  const showEmailError = emailTouched && !emailState.valid && email.length > 0;
  const showEmailSuccess = emailTouched && emailState.valid;
  const emailBorderColor = showEmailError ? colors.destructive : showEmailSuccess ? colors.success : colors.border;

  const showPasswordError = passwordTouched && mode === "register" && password.length > 0 && !passwordState.valid;
  const showPasswordSuccess = passwordTouched && mode === "register" && passwordState.valid;
  const passwordBorderColor = showPasswordError
    ? colors.destructive
    : showPasswordSuccess
      ? colors.success
      : colors.border;

  if (pendingVerificationEmail) {
    return (
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: topPad + 60, paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeInDown.duration(600).springify()} style={styles.header}>
            <View style={[styles.logoWrap, { backgroundColor: colors.primary }]}>
              <Mail size={32} color="#fff" strokeWidth={2} />
            </View>
            <Text style={[styles.appName, { color: colors.foreground }]}>Check Your Email</Text>
            <Text style={[styles.tagline, { color: colors.mutedForeground, textAlign: "center" }]}>
              We sent a verification link to{"\n"}
              <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>
                {pendingVerificationEmail}
              </Text>
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInUp.duration(800).springify()}
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.verifyDesc, { color: colors.mutedForeground }]}>
              Please verify your email before continuing. Click the link in the email we sent you.
            </Text>

            <View style={[styles.verifyBox, { backgroundColor: colors.accent, borderColor: colors.primary + "30" }]}>
              <CheckCircle size={20} color={colors.primary} />
              <Text style={[styles.verifyBoxText, { color: colors.primary }]}>
                Once verified, tap the button below to continue.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary, marginTop: 24 }]}
              onPress={async () => {
                await confirmEmailVerified();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }}
            >
              <Text style={styles.btnText}>I've Verified My Email</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resendBtn}
              onPress={async () => {
                await resendVerification();
                setResentSuccess(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setTimeout(() => setResentSuccess(false), 3000);
              }}
            >
              <Text style={[styles.resendText, { color: resentSuccess ? colors.success : colors.primary }]}>
                {resentSuccess ? "✓ Verification email resent!" : "Resend verification email"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resendBtn}
              onPress={() => {
                setMode("login");
              }}
            >
              <Text style={[styles.resendText, { color: colors.mutedForeground }]}>Back to Sign In</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const handleSubmit = async () => {
    setError("");

    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    if (!emailState.valid) {
      setError("Please enter a valid email address.");
      return;
    }

    if (mode === "register" && !name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (mode === "register" && !passwordState.valid) {
      setError("Password must be 8+ characters and include uppercase, lowercase, number, special character, and no spaces.");
      return;
    }

    if (mode === "login" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/(tabs)");
      } else {
        await signUp({ name: name.trim(), email, password });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const SocialButton = ({
    icon,
    label,
    onPress,
  }: {
    icon: string;
    label: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      style={[styles.socialBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.socialBtnIcon}>{icon}</Text>
      <Text style={[styles.socialBtnText, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 60, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={FadeInDown.duration(600).springify()} style={styles.header}>
          <View style={[styles.logoWrap, { backgroundColor: colors.primary }]}>
            <BriefcaseBusiness size={32} color="#fff" strokeWidth={2.5} />
          </View>
          <Text style={[styles.appName, { color: colors.foreground }]}>CareerAI</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
            Your intelligent career assistant
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInUp.duration(800).springify()}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.tabRow, { backgroundColor: colors.muted }]}>
            {(["login", "register"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.tab, m === mode && { backgroundColor: colors.card }]}
                onPress={() => {
                  setMode(m);
                  setError("");
                  setEmailTouched(false);
                  setPasswordTouched(false);
                }}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: m === mode ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {m === "login" ? "Sign In" : "Sign Up"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === "register" && (
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Full Name</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border },
                ]}
                placeholder="John Doe"
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.background, borderColor: emailBorderColor }]}>
              <Mail size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.inputInner, { color: colors.foreground }]}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  setEmailTouched(false);
                }}
                onBlur={() => setEmailTouched(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {showEmailSuccess && <CheckCircle size={18} color={colors.success} />}
              {showEmailError && <AlertCircle size={18} color={colors.destructive} />}
            </View>
            {showEmailError && (
              <Text style={[styles.fieldHint, { color: colors.destructive }]}>{emailState.hint}</Text>
            )}
            {emailState.typoSuggestion && emailState.valid && (
              <TouchableOpacity
                style={[
                  styles.typoHint,
                  { backgroundColor: colors.warning + "15", borderColor: colors.warning + "40" },
                ]}
                onPress={() => setEmail(emailState.typoSuggestion!)}
              >
                <AlertTriangle size={14} color={colors.warning} />
                <Text style={[styles.typoText, { color: colors.warning }]}>
                  Did you mean <Text style={{ fontFamily: "Inter_700Bold" }}>{emailState.typoSuggestion}</Text>? Tap to fix
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.background, borderColor: passwordBorderColor }]}>
              <Lock size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.inputInner, { color: colors.foreground }]}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                onBlur={() => setPasswordTouched(true)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((v) => !v)}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {showPassword ? (
                  <EyeOff size={18} color={colors.mutedForeground} />
                ) : (
                  <Eye size={18} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
            </View>

            {mode === "register" && (
              <View style={styles.passwordRules}>
                <PasswordRule ok={passwordState.rules.hasMinLength} text="At least 8 characters" colors={colors} />
                <PasswordRule ok={passwordState.rules.hasUppercase} text="One uppercase letter" colors={colors} />
                <PasswordRule ok={passwordState.rules.hasLowercase} text="One lowercase letter" colors={colors} />
                <PasswordRule ok={passwordState.rules.hasNumber} text="One number" colors={colors} />
                <PasswordRule ok={passwordState.rules.hasSpecialChar} text="One special character" colors={colors} />
                <PasswordRule ok={passwordState.rules.hasNoSpaces} text="No spaces" colors={colors} />
              </View>
            )}

            {mode === "register" && showPasswordError && (
              <Text style={[styles.fieldHint, { color: colors.destructive }]}>
                Password does not meet the required criteria.
              </Text>
            )}

            {mode === "login" && password.length > 0 && password.length < 6 && (
              <Text style={[styles.fieldHint, { color: colors.destructive }]}>
                Password must be at least 6 characters
              </Text>
            )}
          </View>

          {error ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" },
              ]}
            >
              <AlertCircle size={16} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.socialGroup}>
            <SocialButton
              icon="G"
              label="Continue with Google"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setError("Google login requires additional setup. Please use email/password for now.");
              }}
            />
            <SocialButton
              icon="f"
              label="Continue with Facebook"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setError("Facebook login requires additional setup. Please use email/password for now.");
              }}
            />
            <SocialButton
              icon="✉"
              label="Continue with Email"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setError("");
              }}
            />
            <SocialButton
              icon="···"
              label="Continue with another way"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setError("Additional sign-in options coming soon.");
              }}
            />
          </View>

          {mode === "login" && (
            <Text style={[styles.switchText, { color: colors.mutedForeground }]}>
              Don't have an account?{" "}
              <Text
                style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}
                onPress={() => {
                  setMode("register");
                  setError("");
                }}
              >
                Sign Up
              </Text>
            </Text>
          )}
          {mode === "register" && (
            <Text style={[styles.switchText, { color: colors.mutedForeground }]}>
              Already have an account?{" "}
              <Text
                style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}
                onPress={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Sign In
              </Text>
            </Text>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordRule({
  ok,
  text,
  colors,
}: {
  ok: boolean;
  text: string;
  colors: any;
}) {
  return (
    <View style={styles.passwordRuleRow}>
      <CheckCircle size={14} color={ok ? colors.success : colors.mutedForeground} />
      <Text style={[styles.passwordRuleText, { color: ok ? colors.success : colors.mutedForeground }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24, flexGrow: 1, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 40 },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: { fontSize: 32, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  tagline: { fontSize: 15, fontFamily: "Inter_500Medium", marginTop: 6 },
  card: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.05,
    shadowRadius: 24,
    elevation: 4,
  },
  tabRow: { flexDirection: "row", borderRadius: 12, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  tabText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  socialGroup: { gap: 10, marginBottom: 20 },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
  },
  socialBtnIcon: { fontSize: 18, fontFamily: "Inter_700Bold", width: 24, textAlign: "center" },
  socialBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  fieldGroup: { marginBottom: 20 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8, letterSpacing: 0.2 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    borderWidth: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    gap: 8,
  },
  inputInner: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 20,
    borderWidth: 1,
  },
  errorText: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  fieldHint: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 6, paddingLeft: 4 },
  typoHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  typoText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  btn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  btnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16, letterSpacing: 0.3 },
  switchText: { textAlign: "center", marginTop: 20, fontSize: 14, fontFamily: "Inter_500Medium" },
  verifyDesc: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    lineHeight: 22,
    marginBottom: 20,
    textAlign: "center",
  },
  verifyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  verifyBoxText: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 20 },
  resendBtn: { alignItems: "center", paddingVertical: 14 },
  resendText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  passwordRules: { gap: 6, marginTop: 8 },
  passwordRuleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  passwordRuleText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
});