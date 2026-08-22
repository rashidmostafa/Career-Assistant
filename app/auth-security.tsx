/**
 * auth-security.tsx — Account security settings screen.
 * Covers: profile, 2FA setup, biometric, session, GDPR data export/deletion.
 */
import {
  ArrowLeft, Bell, Check, Copy, Download, Eye, Fingerprint, Key, Laptop, Lock,
  LogOut, RefreshCw, ScrollText, Shield, Trash2, User as UserIcon,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { OtpInput } from "@/components/auth/OtpInput";
import { SessionManager } from "@/services/sessionManager";
import type { RiskLevel } from "@/services/riskScoring";
import { showAlert } from "@/utils/alert";

const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: "#10b981", MEDIUM: "#f59e0b", HIGH: "#ef4444", CRITICAL: "#7c3aed",
};

export default function SecurityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors() as any;
  const {
    user, biometricAvailable, biometricType, riskLevel,
    sessionDaysRemaining, reauthUrgency,
    enrollBiometric, disableBiometric, setSecurityQuestions,
    exportData, requestAccountDeletion, cancelAccountDeletion, grantConsent,
    signOut, updateUser,
  } = useAuth();

  const [twoFAResult, setTwoFAResult] = useState<{ method: "email"; backupCodes: string[] } | null>(null);
  const [loading, setLoading]     = useState<string | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<"backupCodes" | null>(null);
  const [showDisableInput, setShowDisableInput] = useState(false);
  const [disableError, setDisableError] = useState(false);

  useEffect(() => {
    if (user) {
      SessionManager.getSessionStartMs().then(setSessionStart);
    }
  }, [user?.id]);

  const handleCopy = useCallback(async (field: "backupCodes", text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
  }, []);

  // ── 2FA setup (Email) ──────────────────────────────────────────────────────────
  // No secret/QR involved — each login sends a fresh one-time code by email.
  // Calls the real server endpoint, which marks the account 2FA-enabled there
  // (what login actually checks).
  const handleSetupOtp2FA = useCallback(async (method: "email") => {
    if (!user) return;
    setLoading(method);
    try {
      const { AuthApiService } = await import("@/services/authApiService");
      const setup = await AuthApiService.setup2FAOtp(method);
      setTwoFAResult({ method, backupCodes: setup.backupCodes });
      await updateUser({ twoFactorEnabled: true, twoFactorMethod: method, backupCodesRemaining: setup.backupCodes.length });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      showAlert("Error", e.message);
    } finally {
      setLoading(null);
    }
  }, [user, updateUser]);

  // Disabling 2FA server-side requires proving you still hold access to the
  // 2FA channel — otherwise anyone with a stolen session could silently turn
  // it off. For email we have to actually send a fresh code first (there's
  // no rotating code sitting on-device the way TOTP has).
  const handleDisable2FA = useCallback(() => {
    showAlert(
      "Disable 2FA",
      user?.twoFactorMethod === "totp"
        ? "Removing 2FA will make your account less secure. You'll need to enter your current authenticator code to confirm."
        : "Removing 2FA will make your account less secure. We'll send a code to your email to confirm.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: async () => {
            if (user?.twoFactorMethod !== "totp") {
              setLoading("disable2fa");
              try {
                const { AuthApiService } = await import("@/services/authApiService");
                await AuthApiService.resend2FA({ userId: user!.id, method: user!.twoFactorMethod as string });
              } catch (e: any) {
                showAlert("Error", e.message);
                setLoading(null);
                return;
              }
              setLoading(null);
            }
            setShowDisableInput(true);
          },
        },
      ]
    );
  }, [user]);

  const confirmDisable2FA = useCallback(async (code: string) => {
    setLoading("disable2fa");
    try {
      const { AuthApiService } = await import("@/services/authApiService");
      await AuthApiService.disable2FA(code);
      await updateUser({ twoFactorEnabled: false, twoFactorMethod: undefined, backupCodesRemaining: undefined });
      setShowDisableInput(false);
      setDisableError(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      setDisableError(true);
      showAlert("Incorrect code", e.message ?? "That code didn't match. Please try again.");
    } finally {
      setLoading(null);
    }
  }, [updateUser]);

  // ── Biometric ────────────────────────────────────────────────────────────────
  const handleToggleBiometric = useCallback(async () => {
    if (!user) return;
    if (user.biometricEnabled) {
      await disableBiometric();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } else {
      setLoading("bio");
      const ok = await enrollBiometric();
      setLoading(null);
      if (!ok) showAlert("Biometric Setup", "Biometric enrollment failed. Please try again.");
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [user, enrollBiometric, disableBiometric]);

  // ── GDPR consent ─────────────────────────────────────────────────────────────
  const handleGrantConsent = useCallback(async () => {
    setLoading("consent");
    try {
      await grantConsent();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      showAlert("Error", e.message);
    } finally {
      setLoading(null);
    }
  }, [grantConsent]);

  // ── Data export ───────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    setLoading("export");
    try {
      const data = await exportData();
      const json = JSON.stringify(data, null, 2);
      await Share.share({ message: json, title: "Career Assistant — Data Export" });
    } catch (e: any) {
      showAlert("Export Failed", e.message);
    } finally {
      setLoading(null);
    }
  }, [exportData]);

  // ── Account deletion ──────────────────────────────────────────────────────────
  const handleRequestDeletion = useCallback(() => {
    showAlert(
      "Delete Account",
      "Your account and all data will be permanently deleted after a 30-day grace period. You can cancel anytime during this period.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Request Deletion",
          style: "destructive",
          onPress: async () => {
            await requestAccountDeletion();
            showAlert("Deletion Scheduled", "Your account is scheduled for deletion in 30 days. You can cancel from this screen.");
          },
        },
      ]
    );
  }, [requestAccountDeletion]);

  const handleCancelDeletion = useCallback(() => {
    showAlert("Cancel Deletion", "This will cancel the scheduled account deletion.", [
      { text: "Dismiss", style: "cancel" },
      { text: "Cancel Deletion", onPress: cancelAccountDeletion },
    ]);
  }, [cancelAccountDeletion]);

  if (!user) return null;

  const riskColor = riskLevel ? RISK_COLORS[riskLevel] : colors.mutedForeground;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}
        accessibilityRole="button" accessibilityLabel="Go back">
        <ArrowLeft size={22} color={colors.foreground} />
      </TouchableOpacity>

      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Account & Security</Text>

      {/* ── Session status ── */}
      <SectionHeader title="Session" icon="🛡️" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Row label="Session days remaining" value={`${sessionDaysRemaining} / 56`} colors={colors} />
        <Row label="Re-auth urgency"
          value={reauthUrgency === "none" ? "None" : reauthUrgency.toUpperCase()}
          valueColor={reauthUrgency !== "none" ? "#ef4444" : "#10b981"}
          colors={colors} />
        {sessionStart && (
          <Row label="Session started" value={new Date(sessionStart).toLocaleDateString()} colors={colors} />
        )}
        {riskLevel && (
          <Row label="Risk level" value={riskLevel} valueColor={riskColor} colors={colors} />
        )}
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10" }]}
          onPress={() => router.push("/auth-reauth")}
          accessibilityRole="button" accessibilityLabel="Re-authenticate now">
          <RefreshCw size={16} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>Re-authenticate now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
          onPress={() => router.push("/auth-sessions")}
          accessibilityRole="button" accessibilityLabel="View active sessions">
          <Laptop size={16} color={colors.foreground} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Active Sessions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
          onPress={() => router.push("/auth-audit-log")}
          accessibilityRole="button" accessibilityLabel="View security activity log">
          <ScrollText size={16} color={colors.foreground} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Security Activity Log</Text>
        </TouchableOpacity>
      </View>

      {/* ── Two-Factor Authentication ── */}
      <SectionHeader title="Two-Factor Authentication" icon="🔑" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Row label="2FA enabled" value={user.twoFactorEnabled ? "Yes ✓" : "No"} valueColor={user.twoFactorEnabled ? "#10b981" : undefined} colors={colors} />
        {user.twoFactorEnabled && (
          <Row label="Method" value={user.twoFactorMethod?.toUpperCase() ?? "TOTP"} colors={colors} />
        )}
        {user.twoFactorEnabled && (
          <Row
            label="Backup codes remaining"
            value={`${user.backupCodesRemaining ?? "—"} / 10`}
            valueColor={(user.backupCodesRemaining ?? 10) < 3 ? "#f59e0b" : undefined}
            colors={colors}
          />
        )}

        {!user.twoFactorEnabled ? (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: "#10b981" + "40", backgroundColor: "#10b98110" }]}
            onPress={() => handleSetupOtp2FA("email")} disabled={loading === "email"}
            accessibilityRole="button" accessibilityLabel="Set up Email 2FA">
            {loading === "email" ? <ActivityIndicator color="#10b981" size="small" /> : <Shield size={16} color="#10b981" />}
            <Text style={[styles.actionBtnText, { color: "#10b981" }]}>Set up Email 2FA</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: "#ef4444" + "40", backgroundColor: "#ef444410" }]}
            onPress={handleDisable2FA}
            accessibilityRole="button" accessibilityLabel="Disable 2FA">
            <Lock size={16} color="#ef4444" />
            <Text style={[styles.actionBtnText, { color: "#ef4444" }]}>Disable 2FA</Text>
          </TouchableOpacity>
        )}

        {showDisableInput && (
          <View style={[styles.totpSetupCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.totpTitle, { color: colors.foreground }]}>Enter your current code</Text>
            <Text style={[styles.totpSub, { color: colors.mutedForeground, marginBottom: 10 }]}>
              {user.twoFactorMethod === "totp"
                ? "Confirm with the 6-digit code from your authenticator app to disable 2FA."
                : "Confirm with the code we just sent to your email to disable 2FA."}
            </Text>
            {loading === "disable2fa"
              ? <ActivityIndicator color="#ef4444" style={{ marginVertical: 12 }} />
              : <OtpInput onComplete={confirmDisable2FA} hasError={disableError} />}
            <TouchableOpacity
              style={[styles.copyBtn, { alignSelf: "center", marginTop: 12 }]}
              onPress={() => { setShowDisableInput(false); setDisableError(false); }}
              accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={[styles.copyBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {twoFAResult && (
          <View style={[styles.totpSetupCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.totpTitle, { color: colors.foreground }]}>✉️ Email 2FA enabled</Text>
            <Text style={[styles.totpSub, { color: colors.mutedForeground }]}>
              From now on, sign-in will send a 6-digit code to your email.
            </Text>
            <View style={styles.totpSubRow}>
              <Text style={[styles.totpSub, { color: colors.mutedForeground, marginTop: 10, flex: 1 }]}>
                Backup codes (shown once — store securely):
              </Text>
              <TouchableOpacity
                style={[styles.copyBtn, { backgroundColor: colors.primary + "18", marginTop: 10 }]}
                onPress={() => handleCopy("backupCodes", twoFAResult.backupCodes.join("\n"))}
                accessibilityRole="button"
                accessibilityLabel="Copy all backup codes"
              >
                {copiedField === "backupCodes"
                  ? <Check size={16} color={colors.primary} />
                  : <Copy size={16} color={colors.primary} />}
                <Text style={[styles.copyBtnText, { color: colors.primary }]}>
                  {copiedField === "backupCodes" ? "Copied" : "Copy all"}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.backupGrid}>
              {twoFAResult.backupCodes.map((c) => (
                <View key={c} style={[styles.backupCode, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.backupCodeText, { color: colors.foreground }]}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* ── Biometric ── */}
      {biometricAvailable && (
        <>
          <SectionHeader title="Biometric Authentication" icon={biometricType === "FaceID" ? "😶" : "👆"} colors={colors} />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchLabel, { color: colors.foreground }]}>
                  {biometricType === "FaceID" ? "Face ID" : "Fingerprint"} Login
                </Text>
                <Text style={[styles.switchSub, { color: colors.mutedForeground }]}>
                  Sign in instantly using biometrics
                </Text>
              </View>
              {loading === "bio"
                ? <ActivityIndicator color={colors.primary} />
                : (
                  <Switch
                    value={user.biometricEnabled}
                    onValueChange={handleToggleBiometric}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                    accessibilityRole="switch"
                    accessibilityLabel={`${biometricType} login`}
                    accessibilityState={{ checked: user.biometricEnabled }}
                  />
                )
              }
            </View>
          </View>
        </>
      )}

      {/* ── Security questions ── */}
      <SectionHeader title="Account Recovery" icon="❓" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Row
          label="Security questions"
          value={user.securityQuestionsSet ? "Set ✓" : "Not set"}
          valueColor={user.securityQuestionsSet ? "#10b981" : "#f59e0b"}
          colors={colors}
        />
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10" }]}
          onPress={() => router.push({ pathname: "/auth-reauth", params: { skipCheck: "true" } })}
          accessibilityRole="button" accessibilityLabel={user.securityQuestionsSet ? "Update security questions" : "Set security questions"}>
          <Key size={16} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>
            {user.securityQuestionsSet ? "Update Security Questions" : "Set Security Questions"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── GDPR / Privacy ── */}
      <SectionHeader title="Privacy & Data (GDPR)" icon="🔐" colors={colors} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Row label="Consent given" value={user.consentGiven ? "Yes ✓" : "No"} valueColor={user.consentGiven ? "#10b981" : "#f59e0b"} colors={colors} />
        {!user.consentGiven && (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: "#10b981" + "40", backgroundColor: "#10b98110" }]}
            onPress={handleGrantConsent} disabled={loading === "consent"}
            accessibilityRole="button" accessibilityLabel="Grant consent">
            {loading === "consent" ? <ActivityIndicator color="#10b981" size="small" /> : <Shield size={16} color="#10b981" />}
            <Text style={[styles.actionBtnText, { color: "#10b981" }]}>Grant Consent</Text>
          </TouchableOpacity>
        )}
        {user.deletionScheduledAt && (
          <Row
            label="Deletion scheduled"
            value={new Date(user.deletionScheduledAt).toLocaleDateString()}
            valueColor="#ef4444"
            colors={colors}
          />
        )}

        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10" }]}
          onPress={handleExport} disabled={loading === "export"}
          accessibilityRole="button" accessibilityLabel="Export my data">
          {loading === "export" ? <ActivityIndicator color={colors.primary} size="small" /> : <Download size={16} color={colors.primary} />}
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>Export My Data (JSON)</Text>
        </TouchableOpacity>

        {user.deletionScheduledAt ? (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: "#10b981" + "40", backgroundColor: "#10b98110" }]}
            onPress={handleCancelDeletion}
            accessibilityRole="button" accessibilityLabel="Cancel account deletion">
            <RefreshCw size={16} color="#10b981" />
            <Text style={[styles.actionBtnText, { color: "#10b981" }]}>Cancel Scheduled Deletion</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: "#ef4444" + "40", backgroundColor: "#ef444410" }]}
            onPress={handleRequestDeletion}
            accessibilityRole="button" accessibilityLabel="Request account deletion">
            <Trash2 size={16} color="#ef4444" />
            <Text style={[styles.actionBtnText, { color: "#ef4444" }]}>Request Account Deletion</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Sign out ── */}
      <TouchableOpacity
        style={[styles.signOutBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => { signOut(); router.replace("/auth"); }}
        accessibilityRole="button" accessibilityLabel="Sign out">
        <LogOut size={18} color="#ef4444" />
        <Text style={[styles.signOutText, { color: "#ef4444" }]}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionHeader({ title, icon, colors }: { title: string; icon: string; colors: any }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIcon}>{icon}</Text>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

function Row({ label, value, valueColor, colors }: { label: string; value: string; valueColor?: string; colors: any }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20 },
  backBtn: { marginBottom: 8, alignSelf: "flex-start", padding: 4 },
  pageTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.7, marginBottom: 20 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 10 },
  sectionIcon: { fontSize: 18 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 2 },
  rowLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  rowValue: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, marginTop: 4 },
  actionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  switchSub: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  totpSetupCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 8 },
  totpTitle: { fontFamily: "Inter_700Bold", fontSize: 14, marginBottom: 6 },
  totpSub: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18 },
  totpSubRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  secretBox: { borderRadius: 10, borderWidth: 1.5, padding: 12, marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  secretText: { fontFamily: "Inter_700Bold", fontSize: 15, letterSpacing: 2, flex: 1 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  copyBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  backupGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  backupCode: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  backupCodeText: { fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 1 },
  signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 16, borderWidth: 1, paddingVertical: 15, marginTop: 24 },
  signOutText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
