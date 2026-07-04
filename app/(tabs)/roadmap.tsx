import { Map, ChevronDown, ChevronUp, CheckCircle2, Circle, BookOpen, Play, RefreshCw, Zap, ExternalLink, Lock } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Linking } from "react-native";
import React, { useState, useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoadmap, type RoadmapModule } from "@/context/RoadmapContext";
import { useAuth } from "@/context/AuthContext";
import { useCV } from "@/context/CVContext";
import { useColors } from "@/hooks/useColors";

const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;
type Level = typeof LEVELS[number];

const LEVEL_COLORS: Record<Level, string> = {
  Beginner: "#22c55e",
  Intermediate: "#f59e0b",
  Advanced: "#ef4444",
};

const LEVEL_ICONS: Record<Level, string> = {
  Beginner: "🌱",
  Intermediate: "⚡",
  Advanced: "🔥",
};

const RESOURCE_ICONS: Record<string, React.ElementType> = {
  video: Play,
  article: BookOpen,
  course: Zap,
};

function ModuleCard({ module, onToggle, locked }: { module: RoadmapModule; onToggle: () => void; locked: boolean }) {
  const colors = useColors() as any;
  const roadmapColor = colors.roadmap || colors.primary;
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={[styles.moduleCard, {
      backgroundColor: locked ? colors.muted : colors.card,
      borderColor: module.completed ? roadmapColor + "50" : colors.border,
      opacity: locked ? 0.6 : 1,
    }]}>
      <TouchableOpacity style={styles.moduleHeader} onPress={() => !locked && setExpanded(!expanded)} activeOpacity={locked ? 1 : 0.85}>
        <View style={styles.moduleHeaderLeft}>
          <View style={[styles.weekBadge, { backgroundColor: module.completed ? roadmapColor + "20" : colors.secondary }]}>
            <Text style={[styles.weekText, { color: module.completed ? roadmapColor : colors.mutedForeground }]}>Wk {module.week}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.moduleTopic, { color: locked ? colors.mutedForeground : colors.foreground }]} numberOfLines={expanded ? undefined : 2}>{module.topic}</Text>
            <View style={[styles.levelBadge, { backgroundColor: LEVEL_COLORS[module.level as Level] + "15" }]}>
              <View style={[styles.levelDot, { backgroundColor: LEVEL_COLORS[module.level as Level] }]} />
              <Text style={[styles.levelText, { color: LEVEL_COLORS[module.level as Level] }]}>{module.level}</Text>
            </View>
          </View>
        </View>
        <View style={styles.moduleHeaderRight}>
          {locked ? (
            <Lock size={18} color={colors.mutedForeground} />
          ) : (
            <TouchableOpacity style={[styles.checkBtn, { borderColor: module.completed ? roadmapColor : colors.border, backgroundColor: module.completed ? roadmapColor : "transparent" }]}
              onPress={(e) => { e.stopPropagation?.(); onToggle(); }}>
              {module.completed ? <CheckCircle2 size={20} color="#fff" /> : <Circle size={20} color={colors.mutedForeground} />}
            </TouchableOpacity>
          )}
          {!locked && (expanded ? <ChevronUp size={20} color={colors.mutedForeground} /> : <ChevronDown size={20} color={colors.mutedForeground} />)}
        </View>
      </TouchableOpacity>

      {expanded && !locked && (
        <View style={styles.moduleBody}>
          <Text style={[styles.moduleDesc, { color: colors.mutedForeground }]}>{module.description}</Text>
          <Text style={[styles.subSection, { color: colors.foreground }]}>Tasks this week</Text>
          {module.tasks.map((task, i) => (
            <View key={i} style={styles.taskRow}>
              <View style={[styles.taskDot, { backgroundColor: roadmapColor }]} />
              <Text style={[styles.taskText, { color: colors.foreground }]}>{task}</Text>
            </View>
          ))}
          {module.resources.length > 0 && (
            <>
              <Text style={[styles.subSection, { color: colors.foreground, marginTop: 16 }]}>Resources</Text>
              {module.resources.map((r, i) => {
                const Icon = RESOURCE_ICONS[r.type] || BookOpen;
                return (
                  <TouchableOpacity key={i} style={[styles.resourceRow, { backgroundColor: colors.muted, borderColor: colors.border }]} onPress={() => Linking.openURL(r.url)}>
                    <View style={[styles.resourceIcon, { backgroundColor: roadmapColor + "20" }]}><Icon size={16} color={roadmapColor} /></View>
                    <Text style={[styles.resourceTitle, { color: colors.foreground }]}>{r.title}</Text>
                    <ExternalLink size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      )}
    </View>
  );
}

export default function RoadmapScreen() {
  const colors = useColors() as any;
  const roadmapColor = colors.roadmap || colors.primary;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { cvProfile } = useCV();
  const { roadmap, isGenerating, generateRoadmap, toggleModule, clearRoadmap } = useRoadmap();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const skillGaps = useMemo(() => cvProfile?.suggestions?.slice(0, 3) || [], [cvProfile]);

  const handleGenerate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const role = user?.targetRole || "Software Engineer";
    const level = user?.experienceLevel || "";
    await generateRoadmap(skillGaps, role, level);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Group modules by level in order
  const modulesByLevel = useMemo(() => {
    if (!roadmap) return {} as Record<Level, RoadmapModule[]>;
    return LEVELS.reduce((acc, lv) => {
      acc[lv] = roadmap.modules.filter((m) => m.level === lv);
      return acc;
    }, {} as Record<Level, RoadmapModule[]>);
  }, [roadmap]);

  const completionByLevel = useMemo(() => {
    if (!roadmap) return {} as Record<Level, number>;
    return LEVELS.reduce((acc, lv) => {
      const mods = modulesByLevel[lv] || [];
      acc[lv] = mods.length === 0 ? 0 : mods.filter((m) => m.completed).length / mods.length;
      return acc;
    }, {} as Record<Level, number>);
  }, [roadmap, modulesByLevel]);

  const isLevelUnlocked = (lv: Level): boolean => {
    const idx = LEVELS.indexOf(lv);
    if (idx === 0) return true;
    const prevLevel = LEVELS[idx - 1];
    return completionByLevel[prevLevel] >= 0.5; // unlock next when 50% of current done
  };

  const totalCompleted = roadmap?.modules.filter((m) => m.completed).length ?? 0;
  const totalModules = roadmap?.modules.length ?? 12;
  const progressPct = totalModules > 0 ? Math.round((totalCompleted / totalModules) * 100) : 0;

  if (!roadmap) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Roadmap</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Role-specific · 3 levels · 12 weeks</Text>
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: roadmapColor + "15" }]}>
            <Map size={40} color={roadmapColor} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your Roadmap Awaits</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Generate a 12-week learning roadmap tailored to your target role:{" "}
            <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>{user?.targetRole || "Not set"}</Text>
          </Text>
          <View style={[styles.levelPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {LEVELS.map((lv, i) => (
              <View key={lv} style={styles.levelPreviewItem}>
                <Text style={styles.levelPreviewIcon}>{LEVEL_ICONS[lv]}</Text>
                <Text style={[styles.levelPreviewLabel, { color: LEVEL_COLORS[lv] }]}>{lv}</Text>
                {i < LEVELS.length - 1 && <Text style={{ color: colors.mutedForeground, marginHorizontal: 4 }}>→</Text>}
              </View>
            ))}
          </View>
          <TouchableOpacity style={[styles.generateBtn, { backgroundColor: roadmapColor, opacity: isGenerating ? 0.7 : 1 }]} onPress={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <ActivityIndicator color="#fff" size="small" /> : <Zap size={22} color="#fff" />}
            <Text style={styles.generateBtnText}>{isGenerating ? "Generating Roadmap…" : "Generate My Roadmap"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Roadmap</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{roadmap.role} · {progressPct}% complete</Text>
        </View>
        <TouchableOpacity style={[styles.refreshBtn, { backgroundColor: colors.muted }]} onPress={() => { clearRoadmap(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
          <RefreshCw size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 100 }} showsVerticalScrollIndicator={false}>
        {/* Overall progress */}
        <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.progressRow}>
            <Text style={[styles.progressTitle, { color: colors.foreground }]}>Overall Progress</Text>
            <Text style={[styles.progressPct, { color: roadmapColor }]}>{progressPct}%</Text>
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
            <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: roadmapColor }]} />
          </View>
          <Text style={[styles.progressSub, { color: colors.mutedForeground }]}>{totalCompleted} of {totalModules} weeks completed</Text>
        </View>

        {/* Level sections */}
        {LEVELS.map((lv) => {
          const mods = modulesByLevel[lv] || [];
          if (mods.length === 0) return null;
          const unlocked = isLevelUnlocked(lv);
          const lvCompleted = mods.filter((m) => m.completed).length;
          const lvPct = mods.length > 0 ? Math.round((lvCompleted / mods.length) * 100) : 0;

          return (
            <View key={lv} style={styles.levelSection}>
              {/* Level header */}
              <View style={[styles.levelHeader, { backgroundColor: LEVEL_COLORS[lv] + "15", borderColor: LEVEL_COLORS[lv] + "40" }]}>
                <Text style={styles.levelHeaderIcon}>{LEVEL_ICONS[lv]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.levelHeaderTitle, { color: LEVEL_COLORS[lv] }]}>{lv} Level</Text>
                  <Text style={[styles.levelHeaderSub, { color: colors.mutedForeground }]}>{mods.length} weeks · {lvCompleted}/{mods.length} done</Text>
                </View>
                <View style={[styles.lvBadge, { backgroundColor: LEVEL_COLORS[lv] }]}>
                  <Text style={styles.lvBadgeText}>{lvPct}%</Text>
                </View>
                {!unlocked && (
                  <View style={[styles.lockBadge, { backgroundColor: colors.muted }]}>
                    <Lock size={12} color={colors.mutedForeground} />
                    <Text style={[styles.lockText, { color: colors.mutedForeground }]}>Complete 50% of {LEVELS[LEVELS.indexOf(lv) - 1] ?? "previous"} level to unlock</Text>
                  </View>
                )}
              </View>

              {mods.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  module={mod}
                  locked={!unlocked}
                  onToggle={() => { toggleModule(mod.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 0 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSub: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 3 },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyIcon: { width: 96, height: 96, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 24, marginBottom: 12, letterSpacing: -0.5, textAlign: "center" },
  emptySub: { fontFamily: "Inter_500Medium", fontSize: 16, textAlign: "center", lineHeight: 24, marginBottom: 24 },
  levelPreview: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 32 },
  levelPreviewItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  levelPreviewIcon: { fontSize: 16 },
  levelPreviewLabel: { fontFamily: "Inter_700Bold", fontSize: 13 },
  generateBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 18, paddingHorizontal: 32, borderRadius: 20 },
  generateBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 },
  progressCard: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 24 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  progressTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  progressPct: { fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.5 },
  progressBar: { height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 },
  progressFill: { height: "100%", borderRadius: 4 },
  progressSub: { fontFamily: "Inter_500Medium", fontSize: 13 },
  levelSection: { marginBottom: 24 },
  levelHeader: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, flexWrap: "wrap" },
  levelHeaderIcon: { fontSize: 24 },
  levelHeaderTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  levelHeaderSub: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  lvBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  lvBadgeText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 12 },
  lockBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, width: "100%", marginTop: 6 },
  lockText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  moduleCard: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 10 },
  moduleHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  moduleHeaderLeft: { flex: 1, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  moduleHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  weekBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: "flex-start", marginTop: 2 },
  weekText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  moduleTopic: { fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 6, letterSpacing: -0.2 },
  levelBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  levelDot: { width: 6, height: 6, borderRadius: 3 },
  levelText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  checkBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  moduleBody: { marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.06)", paddingTop: 16 },
  moduleDesc: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 22, marginBottom: 16 },
  subSection: { fontFamily: "Inter_700Bold", fontSize: 13, marginBottom: 10 },
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  taskDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 7 },
  taskText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21 },
  resourceRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  resourceIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  resourceTitle: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 19 },
});
