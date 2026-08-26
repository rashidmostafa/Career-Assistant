/**
 * Roadmap — step 1: gate, generate, list.
 *
 * The gate comes first by design. A roadmap is the gap between a CV and a
 * target role, so without a CV there is nothing to compute a gap from — the
 * screen says so and points at the fix rather than offering a button that
 * would produce generic advice.
 *
 * There is no calendar, no timeline and no overall duration. Each milestone
 * carries its own estimate, which varies with how deep that particular gap is.
 */
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useRoadmap } from "@/context/RoadmapContext";
import type { Milestone, RoadmapResource } from "@/services/roadmapAI";

export default function RoadmapScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { roadmap, isLoading, isGenerating, error, blocker, targetRole, build } = useRoadmap();

  const accent = colors.roadmap || colors.primary;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const onBuild = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await build();
  };

  const Header = () => (
    <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>Roadmap</Text>
        {!!targetRole && (
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
            Toward {targetRole}
          </Text>
        )}
      </View>
      {!!roadmap && (
        <Pressable
          onPress={onBuild}
          disabled={isGenerating}
          style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed || isGenerating ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Regenerate roadmap"
        >
          <Feather name="refresh-cw" size={17} color={colors.foreground} />
        </Pressable>
      )}
    </View>
  );

  const Gate = ({ icon, headline, body, cta, onPress }: {
    icon: any; headline: string; body: string; cta?: string; onPress?: () => void;
  }) => (
    <View style={[styles.gate, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon} size={30} color={accent} />
      <Text style={[styles.gateTitle, { color: colors.foreground }]}>{headline}</Text>
      <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>{body}</Text>
      {!!cta && (
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [styles.cta, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>{cta}</Text>
        </Pressable>
      )}
    </View>
  );

  const body = () => {
    if (isLoading) {
      return (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      );
    }

    // Rule 1 — no CV, no roadmap.
    if (blocker === "no_cv") {
      return (
        <Gate
          icon="file-text"
          headline="Upload your CV first"
          body="Your roadmap is built from the gap between your CV and your target role. Without a CV there's nothing to measure that gap against."
          cta="Go to CV"
          onPress={() => router.push("/(tabs)/cv" as any)}
        />
      );
    }

    if (blocker === "no_target_role") {
      return (
        <Gate
          icon="target"
          headline="Set a target role"
          body="Pick the role you're aiming for and the roadmap will show what stands between your CV and it."
          cta="Go to Profile"
          onPress={() => router.push("/(tabs)/profile" as any)}
        />
      );
    }

    if (isGenerating && !roadmap) {
      return (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={[styles.gateTitle, { color: colors.foreground }]}>Reading your CV…</Text>
          <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>
            Working out what actually stands between you and {targetRole}.
          </Text>
        </View>
      );
    }

    if (!roadmap) {
      return (
        <Gate
          icon="map"
          headline="No roadmap yet"
          body={`Build a plan from your CV toward ${targetRole}.`}
          cta="Generate roadmap"
          onPress={onBuild}
        />
      );
    }

    return (
      <>
        {(!!roadmap.profileSummary || !!roadmap.gapAnalysis) && (
          <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {!!roadmap.profileSummary && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>WHERE YOU ARE</Text>
                <Text style={[styles.text, { color: colors.foreground }]}>{roadmap.profileSummary}</Text>
              </View>
            )}
            {!!roadmap.gapAnalysis && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>WHAT'S MISSING</Text>
                <Text style={[styles.text, { color: colors.foreground }]}>{roadmap.gapAnalysis}</Text>
              </View>
            )}
          </View>
        )}

        {roadmap.milestones.map((m, i) => (
          <MilestoneRow key={m.id} milestone={m} index={i} accent={accent} colors={colors} />
        ))}

        {isGenerating && (
          <View style={styles.inlineBusy}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>Rebuilding…</Text>
          </View>
        )}
      </>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 100, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {!!error && (
          <View style={[styles.error, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "40" }]}>
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.text, { color: colors.foreground, flex: 1 }]}>{error}</Text>
          </View>
        )}
        {body()}
      </ScrollView>
    </View>
  );
}

/** One milestone. Step 1 renders it fully expanded; collapsing comes later. */
function MilestoneRow({ milestone, index, accent, colors }: {
  milestone: Milestone; index: number; accent: string; colors: any;
}) {
  const Block = ({ title, items }: { title: string; items: string[] }) =>
    items.length === 0 ? null : (
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{title}</Text>
        {items.map((t, i) => (
          <View key={`${t}-${i}`} style={styles.bulletRow}>
            <Text style={[styles.bullet, { color: accent }]}>•</Text>
            <Text style={[styles.text, { color: colors.foreground, flex: 1 }]}>{t}</Text>
          </View>
        ))}
      </View>
    );

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <View style={[styles.step, { borderColor: accent }]}>
          <Text style={[styles.stepNum, { color: accent }]}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{milestone.title}</Text>
          {!!milestone.why && (
            <Text style={[styles.why, { color: colors.mutedForeground }]}>{milestone.why}</Text>
          )}
        </View>
        {/* Per-milestone effort, not a deadline and not part of a total. */}
        <View style={[styles.estimate, { backgroundColor: accent + "14", borderColor: accent + "33" }]}>
          <Text style={[styles.estimateText, { color: accent }]}>{milestone.estimate}</Text>
        </View>
      </View>

      <View style={{ gap: 14 }}>
        {milestone.skills.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>CLOSES</Text>
            <View style={styles.chips}>
              {milestone.skills.map((s, i) => (
                <View key={`${s}-${i}`} style={[styles.chip, { backgroundColor: accent + "12", borderColor: accent + "30" }]}>
                  <Text style={[styles.chipText, { color: accent }]}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        <Block title="ACTIONS" items={milestone.actions} />
        <Resources items={milestone.resources} accent={accent} colors={colors} />
        {!!milestone.successCriteria && (
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>YOU'RE DONE WHEN</Text>
            <Text style={[styles.text, { color: colors.foreground }]}>{milestone.successCriteria}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Resources, opened in the device browser.
 *
 * A resource without a usable URL still renders — as plain text rather than a
 * dead tappable row. The model is asked to omit a URL it is unsure of instead
 * of guessing, so this case is expected rather than exceptional.
 */
function Resources({ items, accent, colors }: {
  items: RoadmapResource[]; accent: string; colors: any;
}) {
  if (items.length === 0) return null;

  const open = async (r: RoadmapResource) => {
    if (!r.url) return;
    try {
      await Linking.openURL(r.url);
    } catch {
      // Nothing on the device could open it; leaving the row inert is better
      // than an error the user cannot act on.
    }
  };

  const host = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>RESOURCES</Text>
      {items.map((r, i) =>
        r.url ? (
          <Pressable
            key={`${r.title}-${i}`}
            onPress={() => open(r)}
            style={({ pressed }) => [styles.resourceRow, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="link"
            accessibilityLabel={`${r.title}, opens ${host(r.url)} in your browser`}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.text, { color: colors.foreground }]}>{r.title}</Text>
              <Text style={[styles.resourceHost, { color: accent }]}>{host(r.url)}</Text>
            </View>
            <Feather name="external-link" size={15} color={accent} />
          </Pressable>
        ) : (
          <View key={`${r.title}-${i}`} style={styles.bulletRow}>
            <Text style={[styles.bullet, { color: accent }]}>•</Text>
            <Text style={[styles.text, { color: colors.foreground, flex: 1 }]}>{r.title}</Text>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title: { fontSize: 24, fontWeight: "800" },
  sub: { fontSize: 13, marginTop: 2 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  centred: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 60, paddingHorizontal: 24 },
  gate: { alignItems: "center", gap: 12, padding: 28, borderRadius: 16, borderWidth: 1 },
  gateTitle: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  gateBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  cta: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  error: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  summary: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 14 },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
  text: { fontSize: 14, lineHeight: 21 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 14 },
  cardHead: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  step: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 2 },
  stepNum: { fontSize: 12, fontWeight: "700" },
  cardTitle: { fontSize: 16, fontWeight: "700", lineHeight: 22 },
  why: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  estimate: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  estimateText: { fontSize: 12, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: "600" },
  bulletRow: { flexDirection: "row", gap: 8 },
  resourceRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1,
  },
  resourceHost: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  bullet: { fontSize: 14, lineHeight: 21, fontWeight: "700" },
  inlineBusy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
});
