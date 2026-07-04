import { Github, Code2, CheckCircle2, Trash2, RefreshCw } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortfolio } from "@/context/PortfolioContext";
import { useColors } from "@/hooks/useColors";

export default function PortfolioScreen() {
  const colors = useColors() as any;
  const portfolioColor = colors.portfolio || colors.primary;
  const insets = useSafeAreaInsets();
  const { portfolio, isSyncing, syncGithub, syncCodeforces, clearPortfolio } = usePortfolio();
  const [ghUsername, setGhUsername] = useState("");
  const [cfHandle, setCfHandle] = useState("");
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleGithub = async () => {
    if (!ghUsername.trim()) return;
    try {
      await syncGithub(ghUsername.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not sync GitHub. Check the username.");
    }
  };

  const handleCodeforces = async () => {
    if (!cfHandle.trim()) return;
    try {
      await syncCodeforces(cfHandle.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not sync Codeforces. Check the handle.");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Portfolio Sync</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Connect your developer profiles</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: bottomPad + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: portfolio?.github ? colors.success : "#000" }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: colors.foreground }]}>
              <Github size={24} color={colors.background} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>GitHub</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                {portfolio?.github ? `Connected as ${portfolio.github.username}` : "Not connected"}
              </Text>
            </View>
            {portfolio?.github && (
              <View style={[styles.badge, { backgroundColor: colors.success + "20" }]}>
                <Text style={[styles.badgeText, { color: colors.success }]}>Live</Text>
              </View>
            )}
          </View>

          {portfolio?.github ? (
            <View style={styles.metricsGrid}>
              {[
                { label: "Repos", value: portfolio.github.repos },
                { label: "Stars", value: portfolio.github.stars },
                { label: "Commits", value: `${portfolio.github.commits}+` },
              ].map((m) => (
                <View key={m.label} style={[styles.metricBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.metricValue, { color: colors.foreground }]}>{m.value}</Text>
                  <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                </View>
              ))}
              <View style={[styles.metricBox, styles.metricWide, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.metricValue, { color: colors.foreground }]}>
                  {portfolio.github.topLanguages.slice(0, 3).join(", ") || "—"}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Top Languages</Text>
              </View>
            </View>
          ) : (
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="GitHub username"
                placeholderTextColor={colors.mutedForeground}
                value={ghUsername}
                onChangeText={setGhUsername}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.syncBtn, { backgroundColor: colors.foreground, opacity: isSyncing ? 0.7 : 1 }]}
                onPress={handleGithub}
                disabled={isSyncing}
              >
                {isSyncing ? <ActivityIndicator color={colors.background} size="small" /> : <RefreshCw size={20} color={colors.background} />}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: portfolio?.codeforces ? colors.success : "#000" }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: "#1890ff" }]}>
              <Code2 size={24} color="#fff" strokeWidth={2} />
            </View>
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Codeforces</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                {portfolio?.codeforces ? `Connected as ${portfolio.codeforces.handle}` : "Not connected"}
              </Text>
            </View>
            {portfolio?.codeforces && (
              <View style={[styles.badge, { backgroundColor: colors.success + "20" }]}>
                <Text style={[styles.badgeText, { color: colors.success }]}>Live</Text>
              </View>
            )}
          </View>

          {portfolio?.codeforces ? (
            <View style={styles.metricsGrid}>
              {[
                { label: "Rating", value: portfolio.codeforces.rating },
                { label: "Max Rating", value: portfolio.codeforces.maxRating },
                { label: "Solved", value: portfolio.codeforces.solved },
              ].map((m) => (
                <View key={m.label} style={[styles.metricBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.metricValue, { color: colors.foreground }]}>{m.value}</Text>
                  <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                </View>
              ))}
              <View style={[styles.metricBox, styles.metricWide, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.metricValue, { color: colors.foreground }]}>{portfolio.codeforces.rank}</Text>
                <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Rank</Text>
              </View>
            </View>
          ) : (
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Codeforces handle"
                placeholderTextColor={colors.mutedForeground}
                value={cfHandle}
                onChangeText={setCfHandle}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.syncBtn, { backgroundColor: "#1890ff", opacity: isSyncing ? 0.7 : 1 }]}
                onPress={handleCodeforces}
                disabled={isSyncing}
              >
                {isSyncing ? <ActivityIndicator color="#fff" size="small" /> : <RefreshCw size={20} color="#fff" />}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {portfolio && (
          <>
            <View style={[styles.infoBox, { backgroundColor: portfolioColor + "10", borderColor: portfolioColor + "30" }]}>
              <CheckCircle2 size={20} color={portfolioColor} />
              <Text style={[styles.infoText, { color: colors.foreground }]}>
                Your portfolio metrics will automatically appear in your optimized CV.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.clearBtn, { borderColor: colors.destructive, backgroundColor: colors.card }]}
              onPress={() => Alert.alert("Clear Portfolio", "Remove all synced data?", [
                { text: "Cancel", style: "cancel" },
                { text: "Clear", style: "destructive", onPress: clearPortfolio },
              ])}
            >
              <Trash2 size={18} color={colors.destructive} />
              <Text style={[styles.clearText, { color: colors.destructive }]}>Clear all data</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSub: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 4 },
  card: { borderRadius: 24, padding: 24, borderWidth: 1, marginBottom: 24, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.05, shadowRadius: 16, elevation: 4 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  iconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  cardSub: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricBox: { flex: 1, minWidth: "28%", borderRadius: 16, padding: 16, alignItems: "center", borderWidth: 1 },
  metricWide: { minWidth: "100%" },
  metricValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  metricLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  inputRow: { flexDirection: "row", gap: 12 },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontFamily: "Inter_500Medium", borderWidth: 1 },
  syncBtn: { width: 52, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  infoBox: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 24 },
  infoText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22 },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", paddingVertical: 16, borderRadius: 16, borderWidth: 1 },
  clearText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
