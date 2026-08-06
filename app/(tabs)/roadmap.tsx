import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  Animated,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshCw, Map, List, GitBranch, Settings2, Trash2, Zap } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRoadmap } from "@/context/RoadmapContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { MacroProgressHeader } from "@/components/roadmap/MacroProgressHeader";
import { WeekCard } from "@/components/roadmap/WeekCard";
import { CalendarView } from "@/components/roadmap/CalendarView";
import { RiskBanner } from "@/components/roadmap/RiskBanner";
import { SkillDependencyGraph } from "@/components/roadmap/SkillDependencyGraph";
import { CelebrationOverlay } from "@/components/roadmap/CelebrationOverlay";
import { AccessibilityControls } from "@/components/roadmap/AccessibilityControls";
import type { EmergencyStrategy } from "@/context/RoadmapContext";

// ─── Tab definitions ───────────────────────────────────────────────────────────
type TabId = "list" | "calendar" | "graph" | "settings";
const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: "list",     label: "Timeline", Icon: List      },
  { id: "calendar", label: "Calendar", Icon: Map       },
  { id: "graph",    label: "Skills",   Icon: GitBranch },
  { id: "settings", label: "Settings", Icon: Settings2 },
];

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onGenerate, isGenerating, colors }: { onGenerate: () => void; isGenerating: boolean; colors: any }) {
  const pulse = useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View
      style={styles.emptyWrap}
      accessible
      accessibilityRole="none"
      accessibilityLabel="No roadmap yet. Tap the button to generate one."
    >
      <Animated.Text style={[styles.emptyEmoji, { transform: [{ scale: pulse }] }]}>🗺️</Animated.Text>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your Living Roadmap</Text>
      <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
        A dynamic guide that adapts to your pace — not a rigid schedule you must follow.
      </Text>

      <View style={[styles.levelPreview, { borderColor: colors.border }]}>
        {["🌱 Beginner", "⚡ Intermediate", "🔥 Advanced"].map((l, i) => (
          <Text key={i} style={[styles.levelLabel, { color: colors.foreground }]}>{l}</Text>
        ))}
      </View>

      {[
        "📊 Dynamic duration — weeks adapt to your learning pace",
        "🎯 Job deadline tracking with 4 emergency strategies",
        "🔗 Skill dependency visualisation with lock gates",
        "🚀 Dual tracks: Job-Specific + Generic Career",
        "🎉 Celebratory animations for milestones",
        "♿ WCAG 2.1 AA accessible, reduced motion & high contrast",
      ].map((f, i) => (
        <View key={i} style={styles.featureRow}>
          <Text style={[styles.featureText, { color: colors.mutedForeground }]}>{f}</Text>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.generateBtn, { backgroundColor: colors.roadmap ?? colors.primary }]}
        onPress={onGenerate}
        disabled={isGenerating}
        accessibilityRole="button"
        accessibilityLabel="Generate my roadmap"
        accessibilityState={{ busy: isGenerating }}
      >
        {isGenerating ? (
          <RefreshCw size={20} color="#fff" />
        ) : (
          <Zap size={20} color="#fff" />
        )}
        <Text style={styles.generateBtnText}>
          {isGenerating ? "Generating…" : "Generate My Roadmap"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
export default function RoadmapScreen() {
  const insets  = useSafeAreaInsets();
  const colors  = useColors() as any;
  const { user } = useAuth();
  const {
    weeks, isGenerating, macroProgress, completedWeeks, totalWeeks,
    targetRole, careerTrackSkills, jobDeadlines, lastRegeneratedAt,
    reducedMotion, highContrast,
    generateRoadmap, toggleSkillStatus, markWeekComplete, clearRoadmap,
    setViewMode, setReducedMotion, setHighContrast,
    applyEmergencyStrategy, dismissExpiredJob,
  } = useRoadmap();

  const roadmapColor = colors.roadmap ?? colors.primary;

  const [activeTab, setActiveTab]         = useState<TabId>("list");
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [refreshing, setRefreshing]       = useState(false);
  const [celebration, setCelebration]     = useState<{
    visible: boolean;
    type: "week" | "milestone" | "graduation";
    title: string;
    subtitle?: string;
  }>({ visible: false, type: "week", title: "" });

  const fadeTrans = useRef(new Animated.Value(1)).current;

  // ── Generate ────────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!user) return;
    const skillGaps = (user.background ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    await generateRoadmap(skillGaps, user.targetRole || "Frontend Developer", user.experienceLevel || "Intermediate");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [user, generateRoadmap]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await handleGenerate();
    setRefreshing(false);
  }, [handleGenerate]);

  // ── Week complete ────────────────────────────────────────────────────────────
  const handleWeekComplete = useCallback(async (weekId: string) => {
    const week = weeks.find((w) => w.id === weekId);
    if (!week) return;
    await markWeekComplete(weekId);

    const newDone = completedWeeks + 1;
    const isGrad  = newDone >= totalWeeks;
    const isMile  = !isGrad && (newDone % 3 === 0 || newDone === Math.floor(totalWeeks / 2));

    setCelebration({
      visible: true,
      type: isGrad ? "graduation" : isMile ? "milestone" : "week",
      title: isGrad
        ? "Roadmap Complete! 🎓"
        : isMile
        ? `${newDone} Weeks Done! 🌟`
        : `Week ${week.weekNumber} Complete!`,
      subtitle: isGrad
        ? "You've mastered all the skills. Time to land that role!"
        : isMile
        ? `${newDone} weeks of consistent learning. Your skills are growing fast!`
        : `"${week.topic}" — knowledge locked in. Keep going!`,
    });
  }, [weeks, completedWeeks, totalWeeks, markWeekComplete]);

  // ── Tab switch ───────────────────────────────────────────────────────────────
  const switchTab = useCallback((tab: TabId) => {
    if (!reducedMotion) {
      Animated.sequence([
        Animated.timing(fadeTrans, { toValue: 0.6, duration: 80, useNativeDriver: true }),
        Animated.timing(fadeTrans, { toValue: 1,   duration: 200, useNativeDriver: true }),
      ]).start();
    }
    setActiveTab(tab);
    if (tab === "list")     setViewMode("list");
    if (tab === "calendar") setViewMode("calendar");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [reducedMotion, fadeTrans, setViewMode]);

  const selectedWeek = useMemo(() => weeks.find((w) => w.id === selectedWeekId) ?? null, [weeks, selectedWeekId]);
  const hasRoadmap   = weeks.length > 0;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* Screen header */}
      <View
        style={[
          styles.screenHeader,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + (Platform.OS === "android" ? 8 : 4),
          },
        ]}
      >
        <View style={styles.headerTop}>
          <View>
            <Text
              style={[styles.screenTitle, { color: colors.foreground }]}
              accessibilityRole="header"
            >
              Roadmap
            </Text>
            {hasRoadmap && (
              <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>
                {targetRole} · {totalWeeks} weeks
              </Text>
            )}
          </View>

          {hasRoadmap && (
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={[styles.iconBtn, { borderColor: colors.border }]}
                onPress={handleRefresh}
                disabled={isGenerating}
                accessibilityRole="button"
                accessibilityLabel="Regenerate roadmap"
              >
                <RefreshCw size={18} color={isGenerating ? colors.mutedForeground : roadmapColor} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.iconBtn, { borderColor: colors.border }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  clearRoadmap();
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear roadmap"
              >
                <Trash2 size={18} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* View tabs */}
        {hasRoadmap && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
            accessibilityRole="tablist"
          >
            {TABS.map((t) => {
              const active = activeTab === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.tab, active && { borderBottomColor: roadmapColor }]}
                  onPress={() => switchTab(t.id)}
                  accessibilityRole="tab"
                  accessibilityLabel={t.label}
                  accessibilityState={{ selected: active }}
                >
                  <t.Icon size={15} color={active ? roadmapColor : colors.mutedForeground} />
                  <Text
                    style={[
                      styles.tabLabel,
                      { color: active ? roadmapColor : colors.mutedForeground },
                      active && { fontFamily: "Inter_700Bold" },
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Body */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={
          hasRoadmap ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={roadmapColor}
              title="Adapting your roadmap…"
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Empty state */}
        {!hasRoadmap && !isGenerating && (
          <EmptyState onGenerate={handleGenerate} isGenerating={isGenerating} colors={colors} />
        )}

        {/* Generating state */}
        {isGenerating && (
          <View
            style={styles.generatingWrap}
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel="Generating your roadmap"
          >
            <RefreshCw size={28} color={roadmapColor} />
            <Text style={[styles.genTitle, { color: colors.foreground }]}>
              Building your dynamic roadmap…
            </Text>
            <Text style={[styles.genSub, { color: colors.mutedForeground }]}>
              Analysing skill gaps and market signals…
            </Text>
          </View>
        )}

        {hasRoadmap && !isGenerating && (
          <>
            {/* Macro progress */}
            <MacroProgressHeader
              macroProgress={macroProgress}
              completedWeeks={completedWeeks}
              totalWeeks={totalWeeks}
              targetRole={targetRole}
              careerTrackSkillCount={careerTrackSkills.length}
              lastRegeneratedAt={lastRegeneratedAt}
              reducedMotion={reducedMotion}
              highContrast={highContrast}
            />

            {/* Risk banners */}
            {jobDeadlines.length > 0 && (
              <View>
                {jobDeadlines.map((dl) => (
                  <RiskBanner
                    key={dl.jobId}
                    deadline={dl}
                    onApplyStrategy={(sid: EmergencyStrategy["id"]) => applyEmergencyStrategy(dl.jobId, sid)}
                    onDismiss={() => dismissExpiredJob(dl.jobId)}
                  />
                ))}
              </View>
            )}

            {/* ── Timeline tab ── */}
            {activeTab === "list" && (
              <Animated.View style={{ opacity: fadeTrans }}>
                {/* Track summary */}
                <View style={styles.trackRow}>
                  <View style={[styles.trackPill, { backgroundColor: "#6366f1" + "18" }]}>
                    <Text style={[styles.trackPillText, { color: "#6366f1" }]}>
                      🎯 Job Track · {weeks.filter((w) => w.track === "job").length} weeks
                    </Text>
                  </View>
                  <View style={[styles.trackPill, { backgroundColor: "#0891b2" + "18" }]}>
                    <Text style={[styles.trackPillText, { color: "#0891b2" }]}>
                      🚀 Career Track · {weeks.filter((w) => w.track === "career").length} weeks
                    </Text>
                  </View>
                </View>

                {weeks.map((week, idx) => (
                  <WeekCard
                    key={week.id}
                    week={week}
                    onComplete={() => handleWeekComplete(week.id)}
                    onToggleSkill={(skillId) => toggleSkillStatus(week.id, skillId)}
                    reducedMotion={reducedMotion}
                    highContrast={highContrast}
                    isNew={idx === weeks.length - 1 && idx > 5}
                  />
                ))}

                {/* Career track skills earned */}
                {careerTrackSkills.length > 0 && (
                  <View style={[styles.careerSection, { backgroundColor: colors.card, borderColor: "#0891b2" }]}>
                    <Text style={[styles.careerTitle, { color: colors.foreground }]}>
                      🚀 Career Track Skills Earned
                    </Text>
                    <Text style={[styles.careerSub, { color: colors.mutedForeground }]}>
                      These skills are yours permanently — regardless of any specific job.
                    </Text>
                    <View style={styles.careerChips}>
                      {careerTrackSkills.map((skill) => (
                        <View
                          key={skill.id}
                          style={[styles.careerChip, { backgroundColor: "#0891b2" + "18", borderColor: "#0891b2" + "40" }]}
                          accessible
                          accessibilityLabel={`${skill.name}: ${skill.status}`}
                        >
                          <Text style={[styles.careerChipText, { color: "#0891b2" }]}>{skill.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </Animated.View>
            )}

            {/* ── Calendar tab ── */}
            {activeTab === "calendar" && (
              <Animated.View style={{ opacity: fadeTrans }}>
                <CalendarView
                  weeks={weeks}
                  selectedWeekId={selectedWeekId}
                  onSelectWeek={(id) => {
                    setSelectedWeekId(selectedWeekId === id ? null : id);
                    // Jump to timeline for details
                    if (selectedWeekId !== id) switchTab("list");
                  }}
                  reducedMotion={reducedMotion}
                  highContrast={highContrast}
                />
                {selectedWeek && activeTab === "calendar" && (
                  <View style={[styles.calDetail, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.calDetailTitle, { color: colors.foreground }]}>{selectedWeek.topic}</Text>
                    <Text style={[styles.calDetailSub, { color: colors.mutedForeground }]}>
                      Week {selectedWeek.weekNumber} · {selectedWeek.level} · Tap to jump to Timeline
                    </Text>
                  </View>
                )}
              </Animated.View>
            )}

            {/* ── Skill graph tab ── */}
            {activeTab === "graph" && (
              <Animated.View style={{ opacity: fadeTrans }}>
                <SkillDependencyGraph
                  weeks={weeks}
                  onToggleSkill={(weekId, skillId) => toggleSkillStatus(weekId, skillId)}
                  highContrast={highContrast}
                />
              </Animated.View>
            )}

            {/* ── Settings tab ── */}
            {activeTab === "settings" && (
              <Animated.View style={{ opacity: fadeTrans }}>
                <AccessibilityControls
                  reducedMotion={reducedMotion}
                  highContrast={highContrast}
                  onToggleReducedMotion={setReducedMotion}
                  onToggleHighContrast={setHighContrast}
                />

                <View style={[styles.actionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.actionsTitle, { color: colors.foreground }]}>Roadmap Actions</Text>

                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "10" }]}
                    onPress={handleGenerate}
                    disabled={isGenerating}
                    accessibilityRole="button"
                    accessibilityLabel="Regenerate roadmap"
                  >
                    <RefreshCw size={18} color={colors.primary} />
                    <Text style={[styles.actionBtnText, { color: colors.primary }]}>Regenerate Roadmap</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.destructive + "40", backgroundColor: colors.destructive + "10" }]}
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                      clearRoadmap();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all roadmap data"
                  >
                    <Trash2 size={18} color={colors.destructive} />
                    <Text style={[styles.actionBtnText, { color: colors.destructive }]}>Clear Roadmap</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.philosophyCard, { backgroundColor: colors.accent, borderColor: colors.accentForeground + "20" }]}>
                  <Text style={[styles.philosophyTitle, { color: colors.accentForeground }]}>📖 UX Philosophy</Text>
                  <Text style={[styles.philosophyText, { color: colors.accentForeground }]}>
                    This roadmap is a living, breathing guide that adapts to you — not a rigid schedule.
                    {"\n\n"}Your skills are valuable regardless of any specific job. Every update is framed to empower, never to stress.
                  </Text>
                </View>
              </Animated.View>
            )}
          </>
        )}
      </ScrollView>

      {/* Celebration overlay */}
      <CelebrationOverlay
        visible={celebration.visible}
        type={celebration.type}
        title={celebration.title}
        subtitle={celebration.subtitle}
        onDismiss={() => setCelebration((c) => ({ ...c, visible: false }))}
        reducedMotion={reducedMotion}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  screenHeader: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingBottom: 0 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 },
  screenTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.8 },
  screenSub: { fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 1 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  tabsRow: { flexDirection: "row", paddingBottom: 0 },
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent", marginRight: 4 },
  tabLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  body: { padding: 16 },

  emptyWrap: { alignItems: "center", paddingTop: 36, paddingHorizontal: 20 },
  emptyEmoji: { fontSize: 70, marginBottom: 18 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 26, textAlign: "center", letterSpacing: -0.6, marginBottom: 10 },
  emptySub: { fontFamily: "Inter_500Medium", fontSize: 15, textAlign: "center", lineHeight: 23, marginBottom: 20 },
  levelPreview: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12, marginBottom: 18, gap: 14 },
  levelLabel: { fontFamily: "Inter_700Bold", fontSize: 13 },
  featureRow: { alignSelf: "stretch", paddingLeft: 8, marginBottom: 7 },
  featureText: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21 },
  generateBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 18, paddingHorizontal: 36, borderRadius: 20, marginTop: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 },
  generateBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17 },

  generatingWrap: { alignItems: "center", paddingVertical: 60, gap: 14 },
  genTitle: { fontFamily: "Inter_700Bold", fontSize: 18, textAlign: "center" },
  genSub: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" },

  trackRow: { flexDirection: "row", gap: 10, marginBottom: 14, flexWrap: "wrap" },
  trackPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  trackPillText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  careerSection: { borderRadius: 20, borderWidth: 1.5, padding: 16, marginTop: 8 },
  careerTitle: { fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 4 },
  careerSub: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19, marginBottom: 12 },
  careerChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  careerChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  careerChipText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  calDetail: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 8 },
  calDetailTitle: { fontFamily: "Inter_700Bold", fontSize: 15, marginBottom: 4 },
  calDetailSub: { fontFamily: "Inter_500Medium", fontSize: 12 },

  actionsCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12, gap: 10 },
  actionsTitle: { fontFamily: "Inter_700Bold", fontSize: 14, marginBottom: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1 },
  actionBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },

  philosophyCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  philosophyTitle: { fontFamily: "Inter_700Bold", fontSize: 15, marginBottom: 8 },
  philosophyText: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21 },
});
