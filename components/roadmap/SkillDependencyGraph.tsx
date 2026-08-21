import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Line } from "react-native-svg";
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
  tier: number;
  x: number;
  y: number;
  isUnlocked: boolean;
}

const NODE_W = 116;
const NODE_H = 68;
const GAP_X = 16;
const ROW_H = 116; // node height plus room for the connector lines between tiers
const PAD = 18;

export function SkillDependencyGraph({ weeks, onToggleSkill, highContrast = false }: Props) {
  const colors = useColors();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { nodes, nodeMap, graphW, graphH } = useMemo(() => {
    const flat = weeks.flatMap((w) =>
      w.skills.map((s) => ({ skill: s, weekId: w.id, weekNumber: w.weekNumber, isUnlocked: w.isUnlocked })),
    );
    const byId = new Map(flat.map((n) => [n.skill.id, n]));

    // Tier by prerequisite depth rather than by week. Laying rows out by week
    // put every skill of a week on one row, and since most weeks carry one or
    // two skills the graph collapsed into a single vertical column — which
    // showed none of the structure it exists to show. Depth groups skills that
    // are genuinely available at the same time, side by side.
    const depth = new Map<string, number>();
    const resolve = (id: string, seen: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      // A cycle would recurse forever; treat it as a root rather than crashing.
      if (seen.has(id)) return 0;
      const node = byId.get(id);
      if (!node) return 0;
      const parents = node.skill.prerequisites.filter((p) => byId.has(p));
      const d = parents.length
        ? 1 + Math.max(...parents.map((p) => resolve(p, new Set([...seen, id]))))
        : 0;
      depth.set(id, d);
      return d;
    };
    flat.forEach((n) => resolve(n.skill.id, new Set()));

    const tiers = new Map<number, typeof flat>();
    flat.forEach((n) => {
      const d = depth.get(n.skill.id) ?? 0;
      tiers.set(d, [...(tiers.get(d) ?? []), n]);
    });

    const tierKeys = [...tiers.keys()].sort((a, b) => a - b);
    const widest = Math.max(...tierKeys.map((k) => tiers.get(k)!.length), 1);
    const rowWidth = widest * NODE_W + (widest - 1) * GAP_X;

    const placed: Node[] = [];
    tierKeys.forEach((tier, rowIndex) => {
      const row = tiers.get(tier)!;
      const thisWidth = row.length * NODE_W + (row.length - 1) * GAP_X;
      // Centre each tier so the graph reads as a tree rather than left-stacked.
      const offset = (rowWidth - thisWidth) / 2;
      row.forEach((n, i) => {
        placed.push({
          ...n,
          tier,
          x: PAD + offset + i * (NODE_W + GAP_X),
          y: PAD + rowIndex * ROW_H,
        });
      });
    });

    return {
      nodes: placed,
      nodeMap: Object.fromEntries(placed.map((n) => [n.skill.id, n])) as Record<string, Node>,
      graphW: rowWidth + PAD * 2,
      graphH: tierKeys.length * ROW_H + PAD * 2,
    };
  }, [weeks]);

  const selected = selectedId ? nodeMap[selectedId] : null;

  // Prerequisite -> dependent, for the connector lines.
  const edges = useMemo(
    () =>
      nodes.flatMap((n) =>
        n.skill.prerequisites
          .map((pid) => nodeMap[pid])
          .filter(Boolean)
          .map((parent) => ({ from: parent, to: n })),
      ),
    [nodes, nodeMap],
  );

  return (
    <View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Skill Map</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Skills sit below what they depend on. Tap one to trace its links.
        </Text>

        <View style={styles.legend}>
          {(Object.keys(SKILL_STATUS_COLORS) as (keyof typeof SKILL_STATUS_COLORS)[]).map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: SKILL_STATUS_COLORS[s] }]} />
              <Text style={[styles.legendLabel, { color: colors.mutedForeground }]}>{s}</Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            <View style={{ width: graphW, height: graphH }}>
              {/* Connectors sit under the nodes so lines never cross labels. */}
              <Svg width={graphW} height={graphH} style={StyleSheet.absoluteFill}>
                {edges.map(({ from, to }, i) => {
                  const active =
                    selected && (selected.skill.id === from.skill.id || selected.skill.id === to.skill.id);
                  return (
                    <Line
                      key={i}
                      x1={from.x + NODE_W / 2}
                      y1={from.y + NODE_H}
                      x2={to.x + NODE_W / 2}
                      y2={to.y}
                      stroke={active ? "#f59e0b" : highContrast ? "#999" : colors.border}
                      strokeWidth={active ? 2.5 : 1.5}
                      // Unmet dependencies read as provisional; met ones as solid.
                      strokeDasharray={to.isUnlocked ? undefined : "4 4"}
                    />
                  );
                })}
              </Svg>

              {nodes.map((n) => {
                const sc = SKILL_STATUS_COLORS[n.skill.status];
                const isSel = selectedId === n.skill.id;
                const isPrereq = selected?.skill.prerequisites.includes(n.skill.id);
                const isDep = selected && n.skill.prerequisites.includes(selected.skill.id);
                const locked = !n.isUnlocked;

                return (
                  <TouchableOpacity
                    key={n.skill.id}
                    style={[
                      styles.node,
                      {
                        left: n.x,
                        top: n.y,
                        width: NODE_W,
                        height: NODE_H,
                        backgroundColor: isSel ? sc + "30" : isPrereq || isDep ? colors.accent : locked ? colors.muted : colors.secondary,
                        borderColor: isSel ? sc : isPrereq ? "#f59e0b" : isDep ? "#3b82f6" : locked ? colors.border : sc + "60",
                        opacity: locked ? 0.6 : 1,
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
                    <View style={styles.nodeTop}>
                      <View style={[styles.nodeStatus, { backgroundColor: sc }]} />
                      {locked && <Text style={styles.lockIcon}>🔒</Text>}
                    </View>
                    <Text
                      style={[styles.nodeName, { color: locked ? colors.mutedForeground : colors.foreground }]}
                      numberOfLines={2}
                    >
                      {n.skill.name}
                    </Text>
                    <Text style={[styles.nodeWeek, { color: colors.mutedForeground }]}>Week {n.weekNumber}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

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
              <Text style={[styles.prereqLabel, { color: colors.mutedForeground }]}>Needs first: </Text>
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
  title: { fontFamily: "Inter_700Bold", fontSize: 18, marginBottom: 4 },
  subtitle: { fontFamily: "Inter_500Medium", fontSize: 13.5, marginBottom: 14, lineHeight: 19 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontFamily: "Inter_500Medium", fontSize: 12.5 },
  node: { position: "absolute", borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 8, justifyContent: "space-between" },
  nodeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nodeStatus: { width: 8, height: 8, borderRadius: 4 },
  nodeName: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 16 },
  nodeWeek: { fontFamily: "Inter_500Medium", fontSize: 12.5 },
  lockIcon: { fontSize: 12 },
  detail: { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 12 },
  detailName: { fontFamily: "Inter_700Bold", fontSize: 17, marginBottom: 10 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },
  xpText: { fontFamily: "Inter_500Medium", fontSize: 13.5 },
  careerPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9 },
  careerPillText: { fontFamily: "Inter_700Bold", fontSize: 12.5 },
  prereqRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 },
  prereqLabel: { fontFamily: "Inter_500Medium", fontSize: 13.5 },
  prereqPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  prereqText: { fontFamily: "Inter_600SemiBold", fontSize: 12.5 },
});
