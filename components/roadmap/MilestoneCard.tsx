/**
 * One milestone in the roadmap's vertical stack.
 *
 * Collapsed it shows only the title and why it matters, because a roadmap read
 * top to bottom is a list of reasons, not a wall of detail. Everything else —
 * description, skills, actions, resources, success criteria — is one tap away.
 *
 * There is deliberately no date, duration or progress bar anywhere here: the
 * plan is ordered by dependency, not by time.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { Milestone } from "@/services/roadmapAI";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const STATUS_META = {
  locked:      { icon: "🔒", label: "Locked",      tone: "muted" },
  in_progress: { icon: "🔄", label: "In Progress", tone: "active" },
  completed:   { icon: "✅", label: "Completed",   tone: "done" },
} as const;

interface Props {
  milestone: Milestone;
  index: number;
  isBusy: boolean;
  onComplete: (id: string) => void;
  onAsk: (milestone: Milestone) => void;
}

export function MilestoneCard({ milestone, index, isBusy, onComplete, onAsk }: Props) {
  const colors = useColors() as any;
  const [expanded, setExpanded] = useState(false);

  const meta = STATUS_META[milestone.status];
  const accent =
    milestone.status === "completed" ? (colors.success || "#16a34a")
    : milestone.status === "in_progress" ? (colors.roadmap || colors.primary)
    : colors.mutedForeground;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => !e);
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {children}
    </View>
  );

  const Bullets = ({ items, bullet = "•" }: { items: string[]; bullet?: string }) => (
    <View style={{ gap: 6 }}>
      {items.map((t, i) => (
        <View key={`${t}-${i}`} style={styles.bulletRow}>
          <Text style={[styles.bullet, { color: accent }]}>{bullet}</Text>
          <Text style={[styles.bodyText, { color: colors.foreground }]}>{t}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: milestone.status === "in_progress" ? accent + "66" : colors.border,
          opacity: milestone.status === "locked" ? 0.72 : 1,
        },
      ]}
    >
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${milestone.title}. ${meta.label}. ${expanded ? "Collapse" : "Expand"} details.`}
        style={styles.head}
      >
        <View style={styles.headTop}>
          <View style={[styles.stepDot, { borderColor: accent }]}>
            <Text style={[styles.stepNum, { color: accent }]}>{index + 1}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.title,
                {
                  color: colors.foreground,
                  textDecorationLine: milestone.status === "completed" ? "line-through" : "none",
                },
              ]}
            >
              {milestone.title}
            </Text>
            {!!milestone.why && (
              <Text style={[styles.why, { color: colors.mutedForeground }]} numberOfLines={expanded ? undefined : 3}>
                {milestone.why}
              </Text>
            )}
          </View>

          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.mutedForeground}
          />
        </View>

        <View style={[styles.badge, { backgroundColor: accent + "1A", borderColor: accent + "40" }]}>
          <Text style={[styles.badgeText, { color: accent }]}>
            {meta.icon}  {meta.label}
          </Text>
        </View>
      </Pressable>

      {expanded && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          {!!milestone.description && (
            <Section title="WHAT THIS IS">
              <Text style={[styles.bodyText, { color: colors.foreground }]}>{milestone.description}</Text>
            </Section>
          )}

          {milestone.skills_addressed.length > 0 && (
            <Section title="SKILLS ADDRESSED">
              <View style={styles.chips}>
                {milestone.skills_addressed.map((sk, i) => (
                  <View key={`${sk}-${i}`} style={[styles.chip, { backgroundColor: accent + "14", borderColor: accent + "33" }]}>
                    <Text style={[styles.chipText, { color: accent }]}>{sk}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {milestone.actions.length > 0 && (
            <Section title="ACTIONS">
              <Bullets items={milestone.actions} bullet="→" />
            </Section>
          )}

          {milestone.resources.length > 0 && (
            <Section title="RESOURCES">
              <Bullets items={milestone.resources} />
            </Section>
          )}

          {!!milestone.success_criteria && (
            <Section title="YOU'RE DONE WHEN">
              <Text style={[styles.bodyText, { color: colors.foreground }]}>{milestone.success_criteria}</Text>
            </Section>
          )}
        </View>
      )}

      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={() => onAsk(milestone)}
          style={({ pressed }) => [styles.actionBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Ask AI about ${milestone.title}`}
        >
          <Feather name="message-circle" size={15} color={colors.foreground} />
          <Text style={[styles.actionText, { color: colors.foreground }]}>Ask AI</Text>
        </Pressable>

        {/* Only the active milestone can be completed — locked ones are not
            started yet, and completed ones are already done. */}
        {milestone.status === "in_progress" && (
          <Pressable
            onPress={() => onComplete(milestone.id)}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.primaryBtn,
              { backgroundColor: accent, opacity: pressed || isBusy ? 0.75 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${milestone.title} as complete`}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="check" size={15} color="#fff" />
                <Text style={[styles.actionText, { color: "#fff" }]}>Mark as Complete</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  head: { padding: 16, gap: 12 },
  headTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepDot: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  stepNum: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  why: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  badge: {
    alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  body: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 14, borderTopWidth: 1, gap: 16 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
  bodyText: { fontSize: 14, lineHeight: 21, flex: 1 },
  bulletRow: { flexDirection: "row", gap: 8 },
  bullet: { fontSize: 14, lineHeight: 21, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1,
  },
  primaryBtn: { flex: 1, borderWidth: 0 },
  actionText: { fontSize: 13, fontWeight: "600" },
});
