/**
 * Roadmap — a milestone plan, rendered as a vertical stack.
 *
 * Deliberately not a calendar, a Gantt chart or a timeline. The previous screen
 * was week-numbered, which forced every plan into the same shape and implied
 * durations nobody could honour. Milestones are ordered by dependency and
 * priority instead, and carry no dates at all.
 *
 * Only one milestone is ever "in_progress", so there is exactly one thing to do
 * next and exactly one Mark as Complete button on screen.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCV } from "@/context/CVContext";
import { useRoadmap } from "@/context/RoadmapContext";
import { MilestoneCard } from "@/components/roadmap/MilestoneCard";
import { MilestoneChatPanel } from "@/components/roadmap/MilestoneChatPanel";
import type { ChatTurn, Milestone } from "@/services/roadmapAI";

export default function RoadmapScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { cvProfile } = useCV();
  const {
    milestoneRoadmap, isBuilding, buildError, lastChangeSummary,
    buildMilestoneRoadmap, completeMilestone, levelUp, clearChangeSummary,
  } = useRoadmap();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [chatFor, setChatFor] = useState<Milestone | null>(null);
  const [threads, setThreads] = useState<Record<string, ChatTurn[]>>({});
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [levelUpText, setLevelUpText] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const milestones = milestoneRoadmap?.milestones ?? [];
  const hasRoadmap = milestones.length > 0;
  const completedCount = milestones.filter((m) => m.status === "completed").length;

  const targetRole = user?.targetRole || milestoneRoadmap?.targetRole || "your target role";
  const hasCv = !!cvProfile?.rawText;

  const onGenerate = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await buildMilestoneRoadmap();
  }, [buildMilestoneRoadmap]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await buildMilestoneRoadmap();
    setRefreshing(false);
  }, [buildMilestoneRoadmap]);

  const onComplete = useCallback(async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await completeMilestone(id);
  }, [completeMilestone]);

  const onLevelUp = useCallback(async () => {
    const text = levelUpText.trim();
    if (!text) return;
    setLevelUpOpen(false);
    setLevelUpText("");
    await levelUp(text);
  }, [levelUpText, levelUp]);

  const setThread = useCallback((milestoneId: string, turns: ChatTurn[]) => {
    setThreads((prev) => ({ ...prev, [milestoneId]: turns }));
  }, []);

  // The panel needs the live milestone, not the snapshot taken when it opened —
  // a re-plan while the panel is open would otherwise show stale detail.
  const chatMilestone = useMemo(
    () => (chatFor ? milestones.find((m) => m.id === chatFor.id) ?? chatFor : null),
    [chatFor, milestones],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Roadmap</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {hasRoadmap
              ? `${targetRole} · ${completedCount}/${milestones.length} milestones complete`
              : targetRole}
          </Text>
        </View>

        {hasRoadmap && (
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setLevelUpOpen(true)}
              disabled={isBuilding}
              style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed || isBuilding ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="I've levelled up"
            >
              <Feather name="trending-up" size={17} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={onGenerate}
              disabled={isBuilding}
              style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed || isBuilding ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Regenerate roadmap"
            >
              <Feather name="refresh-cw" size={17} color={colors.foreground} />
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 110, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          hasRoadmap ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />
          ) : undefined
        }
      >
        {/* What changed after a re-plan */}
        {!!lastChangeSummary && (
          <Pressable
            onPress={clearChangeSummary}
            style={[styles.banner, { backgroundColor: (colors.roadmap || colors.primary) + "14", borderColor: (colors.roadmap || colors.primary) + "40" }]}
            accessibilityRole="button"
            accessibilityLabel={`Plan updated: ${lastChangeSummary}. Dismiss.`}
          >
            <Feather name="git-branch" size={15} color={colors.roadmap || colors.primary} />
            <Text style={[styles.bannerText, { color: colors.foreground }]}>
              Plan updated — {lastChangeSummary}
            </Text>
            <Feather name="x" size={15} color={colors.mutedForeground} />
          </Pressable>
        )}

        {!!buildError && (
          <View style={[styles.banner, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "40" }]}>
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.bannerText, { color: colors.foreground }]}>{buildError}</Text>
          </View>
        )}

        {/* Empty state */}
        {!hasRoadmap && !isBuilding && (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="map" size={30} color={colors.roadmap || colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No roadmap yet</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              {hasCv
                ? `Build a milestone plan from your CV toward ${targetRole}.`
                : "Upload your CV first — the plan is built from your actual gaps, so without one it can only guess."}
            </Text>
            <Pressable
              onPress={onGenerate}
              style={({ pressed }) => [styles.cta, { backgroundColor: colors.roadmap || colors.primary, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <Feather name="zap" size={16} color="#fff" />
              <Text style={styles.ctaText}>Generate roadmap</Text>
            </Pressable>
          </View>
        )}

        {/* Building */}
        {isBuilding && !hasRoadmap && (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={colors.roadmap || colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Reading your CV…</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Working out what actually stands between you and {targetRole}.
            </Text>
          </View>
        )}

        {/* Summary + gaps */}
        {hasRoadmap && (!!milestoneRoadmap?.profile_summary || !!milestoneRoadmap?.gap_analysis) && (
          <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {!!milestoneRoadmap?.profile_summary && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>WHERE YOU ARE</Text>
                <Text style={[styles.summaryText, { color: colors.foreground }]}>{milestoneRoadmap.profile_summary}</Text>
              </View>
            )}
            {!!milestoneRoadmap?.gap_analysis && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>WHAT'S MISSING</Text>
                <Text style={[styles.summaryText, { color: colors.foreground }]}>{milestoneRoadmap.gap_analysis}</Text>
              </View>
            )}
          </View>
        )}

        {/* Next focus */}
        {hasRoadmap && !!milestoneRoadmap?.next_focus && (
          <View style={[styles.focus, { backgroundColor: (colors.roadmap || colors.primary) + "12", borderColor: (colors.roadmap || colors.primary) + "33" }]}>
            <Text style={[styles.summaryLabel, { color: colors.roadmap || colors.primary }]}>START HERE</Text>
            <Text style={[styles.summaryText, { color: colors.foreground }]}>{milestoneRoadmap.next_focus}</Text>
          </View>
        )}

        {/* The stack */}
        {milestones.map((m, i) => (
          <MilestoneCard
            key={m.id}
            milestone={m}
            index={i}
            isBusy={isBuilding}
            onComplete={onComplete}
            onAsk={setChatFor}
          />
        ))}

        {hasRoadmap && isBuilding && (
          <View style={styles.inlineBusy}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={[styles.inlineBusyText, { color: colors.mutedForeground }]}>Re-planning…</Text>
          </View>
        )}
      </ScrollView>

      <MilestoneChatPanel
        visible={!!chatFor}
        milestone={chatMilestone}
        roadmap={milestoneRoadmap}
        history={chatFor ? threads[chatFor.id] ?? [] : []}
        onHistoryChange={setThread}
        onClose={() => setChatFor(null)}
      />

      {/* Levelled up */}
      <Modal visible={levelUpOpen} transparent animationType="fade" onRequestClose={() => setLevelUpOpen(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setLevelUpOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>I've levelled up</Text>
            <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
              Paste anything new — skills, a project you shipped, a certification. The plan is rebuilt around it.
            </Text>
            <TextInput
              style={[styles.sheetInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="e.g. Shipped a Node.js API to production, learned Docker…"
              placeholderTextColor={colors.mutedForeground}
              value={levelUpText}
              onChangeText={setLevelUpText}
              multiline
            />
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setLevelUpOpen(false)}
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: colors.secondary, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[styles.sheetBtnText, { color: colors.secondaryForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onLevelUp}
                disabled={!levelUpText.trim()}
                style={({ pressed }) => [
                  styles.sheetBtn,
                  { backgroundColor: colors.primary, opacity: !levelUpText.trim() ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[styles.sheetBtnText, { color: colors.primaryForeground }]}>Update plan</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 24, fontWeight: "800" },
  headerSub: { fontSize: 13, marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  empty: { alignItems: "center", gap: 12, padding: 28, borderRadius: 16, borderWidth: 1 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  summary: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 14 },
  summaryLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
  summaryText: { fontSize: 14, lineHeight: 21 },
  focus: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 6 },
  inlineBusy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
  inlineBusyText: { fontSize: 13 },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 460, borderRadius: 16, borderWidth: 1, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  sheetSub: { fontSize: 13, lineHeight: 19 },
  sheetInput: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, textAlignVertical: "top" },
  sheetActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  sheetBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  sheetBtnText: { fontSize: 14, fontWeight: "600" },
});
