import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { matchTier } from "@/utils/jobMatch";

/**
 * Job match percentage, colour-coded by tier:
 * green 70-100 (strong candidate) · amber 40-69 (some gaps) · red 0-39.
 *
 * Pass `score={null}` when there's nothing to score against — no CV uploaded
 * yet, or the listing publishes no skill requirements — so the badge reads
 * "N/A" instead of an unearned 0%.
 */
export function MatchBadge({ score, label }: { score: number | null; label?: string }) {
  const colors = useColors();

  if (score === null) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Text style={[styles.text, { color: colors.mutedForeground }]}>{label ?? "N/A"}</Text>
      </View>
    );
  }

  const tier = matchTier(score);
  const bg = tier === "high" ? colors.success : tier === "medium" ? colors.warning : colors.destructive;

  return (
    <View style={[styles.badge, { backgroundColor: bg + "22", borderColor: bg }]}>
      <Text style={[styles.text, { color: bg }]}>{score}% match</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  text: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
