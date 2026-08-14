/**
 * auth-reauth.tsx — 8-week rolling session re-authentication reminder.
 * Shows urgency level (weekly/daily/hourly/grace), countdown, and
 * three re-auth paths: Biometric, Password+2FA, Security Questions.
 */
import { ArrowLeft, Clock, Shield, Fingerprint, Key, HelpCircle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { BiometricButton } from "@/components/auth/BiometricButton";
import { SecurityQuestionsForm } from "@/components/auth/SecurityQuestionsForm";
import { SessionManager, type ReauthUrgency } from "@/services/sessionManager";

type ReauthMethod = "biometric" | "password" | "security_questions";

const URGENCY_CONFIG: Record<ReauthUrgency, { title: string; color: string; emoji: string; bg: string }> = {
  none:    { title: "Session Active",   color: "#10b981", emoji: "✅", bg: "#10b98118" },
  weekly:  { title: "Re-auth Reminder", color: "#f59e0b", emoji: "🟡", bg: "#f59e0b18" },
  daily:   { title: "Re-auth Needed Soon", color: "#f97316", emoji: "🟠", bg: "#f9731618" },
  hourly:  { title: "Session Expiring!", color: "#ef4444", emoji: "🔴", bg: "#ef444418" },
  grace:   { title: "Grace Period", color: "#ef4444", emoji: "⚠️",  bg: "#ef444425" },
  expired: { title: "Session Expired",  color: "#7c3aed", emoji: "🟣", bg: "#7c3aed18" },
};

export default function ReauthScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors() as any;
  const params  = useLocalSearchParams<{ skipCheck?: string }>();
  // "Set Security Questions" in auth-security.tsx routes here with
  // ?skipCheck=true — this screen doubles as both the re-auth challenge
  // (verify existing answers) and the initial setup (choose questions +
  // answers for the first time). The two need different handlers below.
  const isSetupMode = params.skipCheck === "true";
  const {
    reauthUrgency, sessionDaysRemaining, biometricAvailable, biometricType,
    reauthenticate, setSecurityQuestions, getSecurityQuestions, signOut,
  } = useAuth();

  const [method, setMethod] = useState<ReauthMethod | null>(isSetupMode ? "security_questions" : null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [graceExpiry, setGraceExpiry] = useState<number | null>(null);
  const [countdown, setCountdown]     = useState(0);
  const [securityQs, setSecurityQs]   = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cfg = URGENCY_CONFIG[reauthUrgency] ?? URGENCY_CONFIG.none;

  useEffect(() => {
    (async () => {
      const expiry = await SessionManager.getGraceExpiresAt();
      if (expiry) setGraceExpiry(expiry);
    })();
  }, []);

  useEffect(() => {
    if (!graceExpiry) return;
    const tick = () => setCountdown(Math.max(0, graceExpiry - Date.now()));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [graceExpiry]);

  useEffect(() => {
    // In setup mode there's nothing to fetch yet — we're choosing questions
    // for the first time, not verifying previously-set ones.
    if (method === "security_questions" && !isSetupMode) {
      getSecurityQuestions().then(setSecurityQs);
    }
  }, [method, isSetupMode]);

  const formatCountdown = (ms: number) => {
    if (ms <= 0) return "00:00:00";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  };

  const handleBiometric = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const ok = await reauthenticate("biometric");
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.back();
      } else {
        setError("Biometric authentication failed. Please try another method.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [reauthenticate, router]);

  const handlePassword = useCallback(async () => {
    setError(null);
    if (!password) { setError("Please enter your password."); return; }
    setLoading(true);
    try {
      const ok = await reauthenticate("password", password);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.back();
      } else {
        setError("Incorrect password. Please try again.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [password, reauthenticate, router]);

  const handleSecurityQuestions = useCallback(async (answers: Array<{ question: string; answer: string }>) => {
    setError(null);
    setLoading(true);
    try {
      const ok = await reauthenticate("security_questions", answers);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.back();
      } else {
        setError("Incorrect answers. Please try again.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [reauthenticate, router]);

  // Setup mode: choosing questions + answers for the first time — saves them
  // via the real server endpoint rather than verifying against anything.
  const handleSaveSecurityQuestions = useCallback(async (questions: Array<{ question: string; answer: string }>) => {
    setError(null);
    setLoading(true);
    try {
      await setSecurityQuestions(questions);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [setSecurityQuestions, router]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {(isSetupMode || (reauthUrgency !== "expired" && reauthUrgency !== "grace")) && (
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}
          accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={22} color={colors.foreground} />
        </TouchableOpacity>
      )}

      {/* Urgency banner — not relevant when just setting up security questions */}
      {!isSetupMode && (
        <View style={[styles.urgencyBanner, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
          <Text style={styles.urgencyEmoji}>{cfg.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.urgencyTitle, { color: cfg.color }]}>{cfg.title}</Text>
            <Text style={[styles.urgencySub, { color: colors.mutedForeground }]}>
              {reauthUrgency === "expired"
                ? "Your session has expired. Please re-authenticate to continue."
                : reauthUrgency === "grace"
                ? `Grace period ends in ${formatCountdown(countdown)} — please re-authenticate.`
                : `${sessionDaysRemaining} day${sessionDaysRemaining !== 1 ? "s" : ""} remaining on your 8-week session.`
              }
            </Text>
          </View>
        </View>
      )}

      {/* Countdown (grace period) */}
      {!isSetupMode && (reauthUrgency === "grace" || reauthUrgency === "hourly") && countdown > 0 && (
        <View style={[styles.countdownCard, { backgroundColor: colors.card, borderColor: "#ef4444" }]}>
          <Clock size={18} color="#ef4444" />
          <Text style={[styles.countdownText, { color: "#ef4444" }]}>{formatCountdown(countdown)}</Text>
          <Text style={[styles.countdownLabel, { color: colors.mutedForeground }]}>until sign-out</Text>
        </View>
      )}

      <Text style={[styles.title, { color: colors.foreground }]}>
        {isSetupMode ? "Set security questions" : "Verify it's you"}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {isSetupMode
          ? "Pick 3 questions and answers — these help you recover your account and provide backup authentication."
          : "Choose the quickest way to re-authenticate. We're keeping your data safe 🔒"}
      </Text>

      {/* Method selection */}
      {!method && (
        <View style={styles.methodList}>
          {biometricAvailable && (
            <MethodCard
              icon="👆" title={biometricType === "FaceID" ? "Face ID" : "Fingerprint"}
              desc="Fastest — one touch to continue"
              color={colors.primary} bg={colors.primary + "18"} border={colors.primary + "40"}
              onPress={() => { setMethod("biometric"); setTimeout(handleBiometric, 200); }}
              colors={colors}
              recommended
            />
          )}
          <MethodCard
            icon="🔑" title="Password"
            desc="Enter your account password"
            color={colors.foreground} bg={colors.card} border={colors.border}
            onPress={() => setMethod("password")}
            colors={colors}
          />
          <MethodCard
            icon="❓" title="Security Questions"
            desc="Answer your pre-set security questions"
            color={colors.foreground} bg={colors.card} border={colors.border}
            onPress={() => setMethod("security_questions")}
            colors={colors}
          />
        </View>
      )}

      {/* Biometric */}
      {method === "biometric" && (
        <View style={{ gap: 16, marginTop: 8 }}>
          {loading
            ? <ActivityIndicator color={colors.primary} size="large" />
            : (
              <BiometricButton
                type={biometricType}
                onPress={handleBiometric}
                label="Tap to verify"
                loading={loading}
              />
            )
          }
        </View>
      )}

      {/* Password */}
      {method === "password" && (
        <View style={{ gap: 12, marginTop: 8 }}>
          <View style={[styles.pwField, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.pwInput, { color: colors.foreground }]}
              placeholder="Your password"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoFocus
              accessibilityLabel="Password"
            />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)}
              accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"}>
              <Text style={{ color: colors.mutedForeground }}>{showPw ? "🙈" : "👁️"}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: password ? 1 : 0.5 }]}
            onPress={handlePassword} disabled={loading || !password}
            accessibilityRole="button" accessibilityLabel="Verify password">
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Security questions */}
      {method === "security_questions" && (
        <View style={{ marginTop: 8 }}>
          {isSetupMode
            ? (
              <SecurityQuestionsForm
                onSubmit={handleSaveSecurityQuestions}
                loading={loading}
                submitLabel="Save Questions"
                count={3}
              />
            )
            : securityQs.length > 0
            ? (
              <SecurityQuestionsForm
                onSubmit={handleSecurityQuestions}
                loading={loading}
                submitLabel="Verify Answers"
                fixedQuestions={securityQs}
              />
            )
            : (
              <View style={[styles.noQsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.noQsText, { color: colors.mutedForeground }]}>
                  You haven't set up security questions yet. Please use another method.
                </Text>
              </View>
            )
          }
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={[styles.errorBanner, { backgroundColor: "#ef444418" }]}
          accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={{ color: "#ef4444", fontFamily: "Inter_500Medium", fontSize: 13 }}>{error}</Text>
        </View>
      )}

      {/* Back to method selection */}
      {method && (
        <TouchableOpacity style={styles.changeMethod} onPress={() => { setMethod(null); setError(null); }}
          accessibilityRole="button">
          <Text style={[styles.changeMethodText, { color: colors.primary }]}>← Use a different method</Text>
        </TouchableOpacity>
      )}

      {/* Sign out */}
      <TouchableOpacity
        style={styles.signOutBtn}
        onPress={() => { signOut(); router.replace("/auth"); }}
        accessibilityRole="button" accessibilityLabel="Sign out">
        <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out instead</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function MethodCard({ icon, title, desc, color, bg, border, onPress, colors, recommended }: any) {
  return (
    <TouchableOpacity
      style={[styles.methodCard, { backgroundColor: bg, borderColor: border }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={styles.methodIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.methodTitle, { color }]}>{title}</Text>
          {recommended && (
            <View style={[styles.recommendedBadge, { backgroundColor: color + "25" }]}>
              <Text style={[styles.recommendedText, { color }]}>Recommended</Text>
            </View>
          )}
        </View>
        <Text style={[styles.methodDesc, { color: colors.mutedForeground }]}>{desc}</Text>
      </View>
      <Text style={{ color, fontSize: 20 }}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 8, alignSelf: "flex-start", padding: 4 },
  urgencyBanner: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 20 },
  urgencyEmoji: { fontSize: 24 },
  urgencyTitle: { fontFamily: "Inter_700Bold", fontSize: 15, marginBottom: 3 },
  urgencySub: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
  countdownCard: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 16 },
  countdownText: { fontFamily: "Inter_700Bold", fontSize: 28, fontVariant: ["tabular-nums"] as any },
  countdownLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, letterSpacing: -0.6, marginBottom: 8 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 22, marginBottom: 24 },
  methodList: { gap: 12, marginBottom: 8 },
  methodCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, padding: 16 },
  methodIcon: { fontSize: 28 },
  methodTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  methodDesc: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 2 },
  recommendedBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  recommendedText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  pwField: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, gap: 10 },
  pwInput: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 16 },
  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  errorBanner: { borderRadius: 10, padding: 12, marginTop: 12 },
  changeMethod: { marginTop: 16, alignItems: "center", paddingVertical: 10 },
  changeMethodText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  signOutBtn: { marginTop: 20, alignItems: "center", paddingVertical: 10 },
  signOutText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  noQsCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
  noQsText: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21 },
});
