import React, { useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { RoadmapWeek } from "@/context/RoadmapContext";
import { CircularProgress } from "./CircularProgress";

interface Props {
  weeks: RoadmapWeek[];
  onSelectWeek: (weekId: string) => void;
  selectedWeekId?: string | null;
  reducedMotion?: boolean;
  highContrast?: boolean;
}

const TRACK_COLORS = { job: "#6366f1", career: "#0891b2" };
const LEVEL_COLORS = { Beginner: "#22c55e", Intermediate: "#f59e0b", Advanced: "#ef4444" };
const NUM_COLS = 4;

export function CalendarView({ weeks, onSelectWeek, selectedWeekId, reducedMotion = false, highContrast = false }: Props) {
  const colors = useColors();

  const rows: RoadmapWeek[][] = [];
  for (let i = 0; i < weeks.length; i += NUM_COLS) rows.push(weeks.slice(i, i + NUM_COLS));

  return (
    <View>
      <View style={styles.legend}>
        {[
          { color: TRACK_COLORS.job,    label: "Job Track" },
          { color: TRACK_COLORS.career, label: "Career Track" },
          { color: "#10b981",           label: "Completed" },
          { color: "#94a3b8",           label: "Locked" },
        ].map((l) => (
          <View key={l.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: l.color }]} />
            <Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>{l.label}</Text>
          </View>
        ))}
      </View>

      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((week) => (
            <CalCell
              key={week.id}
              week={week}
              isSelected={selectedWeekId === week.id}
              onPress={() => onSelectWeek(week.id)}
              reducedMotion={reducedMotion}
              highContrast={highContrast}
              colors={colors}
            />
          ))}
          {row.length < NUM_COLS &&
            Array.from({ length: NUM_COLS - row.length }).map((_, i) => (
              <View key={`e_${i}`} style={styles.emptyCell} />
            ))}
        </View>
      ))}
    </View>
  );
}

function CalCell({ week, isSelected, onPress, reducedMotion, highContrast, colors }: {
  week: RoadmapWeek; isSelected: boolean; onPress: () => void;
  reducedMotion?: boolean; highContrast?: boolean; colors: any;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const trackColor = TRACK_COLORS[week.track];
  const locked = !week.isUnlocked;

  const weekProgress = week.skills.length > 0
    ? Math.round((week.skills.filter((s) => s.status === "Mastered" || s.status === "Expert").length / week.skills.length) * 100)
    : week.isCompleted ? 100 : 0;

  const handlePress = () => {
    if (locked) return;
    if (!reducedMotion) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    }
    onPress();
  };

  return (
    <TouchableOpacity
      style={styles.cellWrap}
      onPress={handlePress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={`Week ${week.weekNumber}: ${week.topic}. ${week.isCompleted ? "Completed" : locked ? "Locked" : weekProgress + "% done"}`}
      accessibilityState={{ selected: isSelected, disabled: locked }}
    >
      <Animated.View
        style={[
          styles.cell,
          {
            backgroundColor: week.isCompleted ? "#10b981" + "18" : isSelected ? trackColor + "20" : locked ? colors.muted : colors.card,
            borderColor: week.isCompleted ? "#10b981" : isSelected ? trackColor : highContrast ? colors.foreground : colors.border,
            borderWidth: isSelected || week.isCompleted ? 1.5 : 1,
            opacity: locked ? 0.5 : 1,
            transform: [{ scale }],
          },
        ]}
      >
        <View style={[styles.trackBar, { backgroundColor: trackColor }]} />
        <CircularProgress progress={weekProgress} level="micro" size={46} strokeWidth={5} animate={!reducedMotion} highContrast={highContrast} />
        <Text style={[styles.cellWeek, { color: colors.mutedForeground }]} allowFontScaling={false}>Wk {week.weekNumber}</Text>
        <Text style={[styles.cellTopic, { color: locked ? colors.mutedForeground : colors.foreground }]} numberOfLines={2} allowFontScaling={false}>
          {week.topic}
        </Text>
        <Text style={styles.statusIcon} allowFontScaling={false}>
          {week.isCompleted ? "✅" : locked ? "🔒" : week.track === "job" ? "🎯" : "🚀"}
        </Text>
        <View style={[styles.levelDot, { backgroundColor: LEVEL_COLORS[week.level] }]} />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontFamily: "Inter_500Medium", fontSize: 12.5 },
  row: { flexDirection: "row", gap: 8, marginBottom: 8 },
  emptyCell: { flex: 1 },
  cellWrap: { flex: 1 },
  cell: { borderRadius: 14, padding: 8, alignItems: "center", overflow: "hidden", minHeight: 118, justifyContent: "space-between" },
  trackBar: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  cellWeek: { fontFamily: "Inter_700Bold", fontSize: 11.5, marginTop: 4 },
  cellTopic: { fontFamily: "Inter_600SemiBold", fontSize: 12, textAlign: "center", lineHeight: 14 },
  statusIcon: { fontSize: 14, marginTop: 2 },
  levelDot: { width: 5, height: 5, borderRadius: 2.5, alignSelf: "flex-end" },
});
