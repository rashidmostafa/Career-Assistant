import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { CircularProgress } from "./CircularProgress";

interface Props {
  macroProgress: number;
  completedWeeks: number;
  totalWeeks: number;
  targetRole: string;
  careerTrackSkillCount: number;
  lastRegeneratedAt: string | null;
  reducedMotion?: boolean;
  highContrast?: boolean;
}

export function MacroProgressHeader({ macroProgress, completedWeeks, totalWeeks, targetRole, careerTrackSkillCount, lastRegeneratedAt, reducedMotion = false, highContrast = false }: Props) {
  const colors = useColors();

  const lastUpdated = lastRegeneratedAt
    ? new Date(lastRegeneratedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessible
      accessibilityRole="none"
      accessibilityLabel={`Overall progress: ${macroProgress}%. ${completedWeeks} of ${totalWeeks} weeks completed.`}
    >
      <View style={styles.row}>
        <CircularProgress progress={macroProgress} level="macro" label="Overall" sublabel="Mastery" animate={!reducedMotion} highContrast={highContrast} />
        <View style={styles.right}>
          <Text style={[styles.role, { color: colors.foreground }]} numberOfLines={1}>{targetRole || "Your Roadmap"}</Text>
          <View style={styles.statRow}>
            <Stat value={`${completedWeeks}/${totalWeeks}`} label="Weeks Done" color={colors.primary} muted={colors.mutedForeground} />
            <Stat value={`${careerTrackSkillCount}`} label="Career Skills" color="#10b981" muted={colors.mutedForeground} />
          </View>
          <View style={[styles.dynamicBadge, { backgroundColor: colors.accent }]}>
            <Text style={styles.dynamicDot}>●</Text>
            <Text style={[styles.dynamicText, { color: colors.accentForeground }]}>Dynamic Roadmap Active</Text>
          </View>
        </View>
      </View>
      {lastUpdated && (
        <Text style={[styles.lastUpdated, { color: colors.mutedForeground }]}>Last adapted: {lastUpdated}</Text>
      )}
    </View>
  );
}

function Stat({ value, label, color, muted }: { value: string; label: string; color: string; muted: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]} allowFontScaling={false}>{value}</Text>
      <Text style={[styles.statLabel, { color: muted }]} allowFontScaling={false}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 20 },
  right: { flex: 1, gap: 8 },
  role: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.4, marginBottom: 2 },
  statRow: { flexDirection: "row", gap: 16 },
  stat: { alignItems: "center" },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.5 },
  statLabel: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 1 },
  dynamicBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  dynamicDot: { color: "#10b981", fontSize: 10 },
  dynamicText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  lastUpdated: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 12, textAlign: "right" },
});
