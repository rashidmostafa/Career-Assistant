/**
 * auth-audit-log.tsx — Paginated security event history.
 * GET /api/user/audit-log?page=&limit=
 */
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react-native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AuthApiService } from "@/services/authApiService";

interface LogRow {
  _id: string;
  event: string;
  success: boolean;
  ipAddress?: string;
  deviceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  register: "Account registered",
  email_verified: "Email verified",
  verification_email_resent: "Verification email resent",
  login_success: "Signed in",
  login_failure: "Sign-in failed",
  logout: "Signed out",
  "2fa_required": "2FA challenge sent",
  "2fa_verified": "2FA verified",
  "2fa_enabled": "2FA enabled",
  "2fa_disabled": "2FA disabled",
  "2fa_code_resent": "2FA code resent",
  reauth: "Re-authenticated",
  high_risk_login: "High-risk sign-in",
  security_questions_set: "Security questions set",
  biometric_register: "Biometric enrolled",
  biometric_login: "Biometric sign-in",
  biometric_disable: "Biometric disabled",
  social_login: "Signed in with social account",
  recovery_initiated: "Password recovery started",
  password_reset: "Password reset",
  deletion_requested: "Account deletion requested",
};

function labelFor(event: string): string {
  return EVENT_LABELS[event] ?? event.replace(/_/g, " ");
}

const PAGE_SIZE = 20;

export default function AuditLogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors() as any;

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number, mode: "initial" | "refresh" | "more") => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    if (mode === "more") setLoadingMore(true);
    setError(null);
    try {
      const result = await AuthApiService.getAuditLog(targetPage, PAGE_SIZE);
      setLogs((prev) => (targetPage === 1 ? (result.logs as LogRow[]) : [...prev, ...(result.logs as LogRow[])]));
      setPage(targetPage);
      setTotal(result.total ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Failed to load audit log.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load(1, "initial"); }, [load]);

  const hasMore = logs.length < total;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, "refresh")} tintColor={colors.primary} />}
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}
        accessibilityRole="button" accessibilityLabel="Go back">
        <ArrowLeft size={22} color={colors.foreground} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.foreground }]}>Security Activity</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        A history of security-relevant events on your account.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
        </View>
      ) : logs.length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No activity recorded yet.</Text>
        </View>
      ) : (
        <>
          {logs.map((l) => (
            <View key={l._id} style={[styles.row, { borderColor: colors.border }]}>
              {l.success
                ? <CheckCircle2 size={18} color="#10b981" />
                : <XCircle size={18} color="#ef4444" />}
              <View style={{ flex: 1 }}>
                <Text style={[styles.eventLabel, { color: colors.foreground }]}>{labelFor(l.event)}</Text>
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {new Date(l.createdAt).toLocaleString()}{l.ipAddress ? ` · ${l.ipAddress}` : ""}
                </Text>
              </View>
            </View>
          ))}

          {hasMore && (
            <TouchableOpacity
              style={[styles.loadMoreBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => load(page + 1, "more")}
              disabled={loadingMore}
              accessibilityRole="button" accessibilityLabel="Load more">
              {loadingMore
                ? <ActivityIndicator color={colors.primary} size="small" />
                : <Text style={[styles.loadMoreText, { color: colors.primary }]}>Load more</Text>}
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20 },
  backBtn: { marginBottom: 8, alignSelf: "flex-start", padding: 4 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.7, marginBottom: 8 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20, marginBottom: 20 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  eventLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, textTransform: "capitalize" },
  metaText: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  loadMoreBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 8 },
  loadMoreText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" },
});
