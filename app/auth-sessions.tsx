/**
 * auth-sessions.tsx — Active sessions list + revoke-a-device.
 * GET /api/user/sessions and DELETE /api/user/sessions/:id.
 */
import { ArrowLeft, Laptop, LogOut, Smartphone } from "lucide-react-native";
import * as Haptics from "expo-haptics";
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
import { SessionManager } from "@/services/sessionManager";
import { showAlert } from "@/utils/alert";

interface SessionRow {
  _id: string;
  deviceId: string;
  deviceInfo?: string;
  ipAddress?: string;
  createdAt: string;
  lastRefreshedAt: string;
  sessionStartedAt: string;
}

export default function SessionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors() as any;

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [{ sessions: rows }, deviceId] = await Promise.all([
        AuthApiService.getSessions(),
        SessionManager.getOrCreateDeviceId(),
      ]);
      setSessions(rows);
      setCurrentDeviceId(deviceId);
    } catch (e: any) {
      setError(e.message ?? "Failed to load sessions.");
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = useCallback((session: SessionRow) => {
    const isCurrent = session.deviceId === currentDeviceId;
    showAlert(
      isCurrent ? "Sign out this device?" : "Revoke this session?",
      isCurrent
        ? "This is your current device — revoking will sign you out immediately."
        : "That device will be signed out immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isCurrent ? "Sign Out" : "Revoke",
          style: "destructive",
          onPress: async () => {
            setRevokingId(session._id);
            try {
              await AuthApiService.revokeSession(session._id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              if (isCurrent) {
                // Local tokens are now invalid server-side — clear them so
                // the app doesn't keep trying to use a revoked session.
                await SessionManager.clearTokens();
                router.replace("/auth");
                return;
              }
              setSessions((prev) => prev.filter((s) => s._id !== session._id));
            } catch (e: any) {
              showAlert("Error", e.message ?? "Failed to revoke session.");
            } finally {
              setRevokingId(null);
            }
          },
        },
      ]
    );
  }, [currentDeviceId, router]);

  const formatRelative = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}
        accessibilityRole="button" accessibilityLabel="Go back">
        <ArrowLeft size={22} color={colors.foreground} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.foreground }]}>Active Sessions</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Devices currently signed in to your account. Revoke any you don't recognise.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active sessions found.</Text>
        </View>
      ) : (
        sessions.map((s) => {
          const isCurrent = s.deviceId === currentDeviceId;
          return (
            <View key={s._id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primary + "18" }]}>
                  {s.deviceInfo?.toLowerCase().includes("web") || s.deviceInfo?.toLowerCase().includes("desktop")
                    ? <Laptop size={18} color={colors.primary} />
                    : <Smartphone size={18} color={colors.primary} />}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[styles.deviceLabel, { color: colors.foreground }]} numberOfLines={1}>
                      {s.deviceInfo || s.deviceId}
                    </Text>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: "#10b98118" }]}>
                        <Text style={[styles.currentBadgeText, { color: "#10b981" }]}>This device</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {s.ipAddress ? `${s.ipAddress} · ` : ""}Active {formatRelative(s.lastRefreshedAt)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.revokeBtn, { borderColor: "#ef4444" + "40", backgroundColor: "#ef444410" }]}
                onPress={() => handleRevoke(s)}
                disabled={revokingId === s._id}
                accessibilityRole="button" accessibilityLabel={isCurrent ? "Sign out this device" : "Revoke session"}>
                {revokingId === s._id
                  ? <ActivityIndicator color="#ef4444" size="small" />
                  : <LogOut size={14} color="#ef4444" />}
                <Text style={[styles.revokeBtnText, { color: "#ef4444" }]}>
                  {isCurrent ? "Sign Out" : "Revoke"}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })
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
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  deviceLabel: { fontFamily: "Inter_700Bold", fontSize: 14, flexShrink: 1 },
  currentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  currentBadgeText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  metaText: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  revokeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 10 },
  revokeBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" },
});
