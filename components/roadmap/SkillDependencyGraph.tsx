import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { Skill, RoadmapWeek } from "@/context/RoadmapContext";
import { SKILL_STATUS_COLORS } from "./CircularProgress";

interface Props {
  weeks: RoadmapWeek[];
  onToggleSkill?: (weekId: string, skillId: string) => void;
  highContrast?: boolean;
}

interface Node {
  skill: Skill;
  weekId: string;
  weekNumber: number;
  col: number;
  row: number;
  isUnlocked: boolean;
}

export function SkillDependencyGraph({ weeks, onToggleSkill, highContrast = false }: Props) {
  const colors = useColors();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo<Node[]>(() => {
    const list: Node[] = [];
    weeks.forEach((w, wi) => {
      w.skills.forEach((s, si) => {
        list.push({ skill: s, weekId: w.id, weekNumber: w.weekNumber, col: si, row: wi, isUnlocked: w.isUnlocked });
      });
    });
    return list;
  }, [weeks]);

  const nodeMap = useMemo(() => {
    const m: Record<string, Node> = {};
    nodes.forEach((n) => { m[n.skill.id] = n; });
    return m;
  }, [nodes]);

  const CELL_W = 92;
  const CELL_H = 72;
  const PAD    = 16;
  const maxCols = Math.max(...weeks.map((w) => w.skills.length), 1);
  const graphW = maxCols * CELL_W + PAD * 2;
  const graphH = weeks.length * CELL_H + PAD * 2;
  const selected = selectedId ? nodeMap[selectedId] : null;

  return (
    <View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Skill Dependency Map</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Tap a skill to see its status and prerequisites
        </Text>

        {/* Legend */}
        <View style={styles.legend}>
          {(Object.keys(SKILL_STATUS_COLORS) as (keyof typeof SKILL_STATUS_COLORS)[]).map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: SKILL_STATUS_COLORS[s] }]} />
              <Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>{s}</Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            <View style={{ width: graphW, height: graphH }}>
              {nodes.map((n) => {
                const x = PAD + n.col * CELL_W;
                const y = PAD + n.row * CELL_H;
                const sc = SKILL_STATUS_COLORS[n.skill.status];
                const isSel    = selectedId === n.skill.id;
                const isPrereq = selected?.skill.prerequisites.includes(n.skill.id);
                const isDep    = selected && n.skill.prerequisites.includes(selected.skill.id);
                const locked   = !n.isUnlocked;

                return (
                  <TouchableOpacity
                    key={n.skill.id}
                    style={[
                      styles.node,
                      {
                        left: x, top: y, width: CELL_W - 8,
                        backgroundColor: isSel ? sc + "30" : isPrereq || isDep ? colors.accent : locked ? colors.muted : colors.secondary,
                        borderColor: isSel ? sc : isPrereq ? "#f59e0b" : isDep ? "#3b82f6" : locked ? colors.border : sc + "60",
                        opacity: locked ? 0.5 : 1,
                      },
                    ]}
                    onPress={() => {
                      setSelectedId(selectedId === n.skill.id ? null : n.skill.id);
                      if (!locked && onToggleSkill) onToggleSkill(n.weekId, n.skill.id);
                    }}
                    disabled={locked}
                    accessibilityRole="button"
                    accessibilityLabel={`${n.skill.name}, ${n.skill.status}${locked ? ", locked" : ""}`}
                    accessibilityState={{ selected: isSel, disabled: locked }}
                  >
                    <View style={[styles.nodeStatus, { backgroundColor: sc }]} />
                    <Text style={[styles.nodeName, { color: locked ? colors.mutedForeground : colors.foreground }]} numberOfLines={2}>
                      {n.skill.name}
                    </Text>
                    <Text style={[styles.nodeWeek, { color: colors.mutedForeground }]}>Wk {n.weekNumber}</Text>
                    {locked && <Text style={styles.lockIcon}>🔒</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Detail panel */}
      {selected && (
        <View style={[styles.detail, { backgroundColor: colors.card, borderColor: SKILL_STATUS_COLORS[selected.skill.status] }]}>
          <Text style={[styles.detailName, { color: colors.foreground }]}>{selected.skill.name}</Text>
          <View style={styles.detailRow}>
            <View style={[styles.statusPill, { backgroundColor: SKILL_STATUS_COLORS[selected.skill.status] + "20" }]}>
              <View style={[styles.statusDot, { backgroundColor: SKILL_STATUS_COLORS[selected.skill.status] }]} />
              <Text style={[styles.statusText, { color: SKILL_STATUS_COLORS[selected.skill.status] }]}>{selected.skill.status}</Text>
            </View>
            <Text style={[styles.xpText, { color: colors.mutedForeground }]}>XP: {selected.skill.xpPoints}/100</Text>
            {selected.skill.inCareerTrack && (
              <View style={[styles.careerPill, { backgroundColor: colors.primary + "18" }]}>
                <Text style={[styles.careerPillText, { color: colors.primary }]}>Career Track</Text>
              </View>
            )}
          </View>
          {selected.skill.prerequisites.length > 0 && (
            <View style={styles.prereqRow}>
              <Text style={[styles.prereqLabel, { color: colors.mutedForeground }]}>Prerequisites: </Text>
              {selected.skill.prerequisites.map((pid) => {
                const pn = nodeMap[pid];
                return pn ? (
                  <View key={pid} style={[styles.prereqPill, { backgroundColor: "#f59e0b" + "20" }]}>
                    <Text style={[styles.prereqText, { color: "#f59e0b" }]}>{pn.skill.name}</Text>
                  </View>
                ) : null;
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 4 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 12 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },
  node: { position: "absolute", borderRadius: 12, borderWidth: 1.5, padding: 8, alignItems: "flex-start", height: 64, justifyContent: "space-between" },
  nodeStatus: { width: 6, height: 6, borderRadius: 3, marginBottom: 2 },
  nodeName: { fontFamily: "Inter_600SemiBold", fontSize: 11, lineHeight: 15, flex: 1 },
  nodeWeek: { fontFamily: "Inter_500Medium", fontSize: 9, marginTop: 2 },
  lockIcon: { position: "absolute", top: 6, right: 6, fontSize: 10 },
  detail: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 12 },
  detailName: { fontFamily: "Inter_700Bold", fontSize: 15, marginBottom: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  xpText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  careerPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  careerPillText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  prereqRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  prereqLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  prereqPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  prereqText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
});
