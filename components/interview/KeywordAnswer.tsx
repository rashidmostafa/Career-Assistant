/**
 * KeywordAnswer — the ideal answer, coloured by what the user actually said.
 *
 * Green is a term they used, red is one they missed. Both are given a weight
 * and a background as well as a colour, because roughly one man in twelve
 * cannot reliably tell this particular red from this particular green, and a
 * feature whose entire meaning is carried by hue would tell them nothing.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AnswerSegment } from "@/services/interviewScoring";

interface Props {
  segments: AnswerSegment[];
  colors: any;
  /** Legend counts. Hidden on flashcards, where nothing is scored yet. */
  matchedCount?: number;
  missedCount?: number;
}

export function KeywordAnswer({ segments, colors, matchedCount, missedCount }: Props) {
  const hit = colors.success;
  const miss = colors.destructive;

  return (
    <View>
      <Text style={[styles.body, { color: colors.foreground }]}>
        {segments.map((s, i) => {
          if (s.status === "plain") return <Text key={i}>{s.text}</Text>;
          const tint = s.status === "hit" ? hit : miss;
          return (
            <Text
              key={i}
              style={[styles.marked, { color: tint, backgroundColor: tint + "1f" }]}
            >
              {s.text}
            </Text>
          );
        })}
      </Text>

      {(matchedCount != null || missedCount != null) && (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: hit + "2e", borderColor: hit }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
              {matchedCount ?? 0} you covered
            </Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: miss + "2e", borderColor: miss }]} />
            <Text style={[styles.legendText, { color: colors.mutedForeground }]}>
              {missedCount ?? 0} you missed
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: "Inter_400Regular", fontSize: 14.5, lineHeight: 23 },
  // Weight carries the same signal as colour, for readers who cannot separate
  // the two hues.
  marked: { fontFamily: "Inter_700Bold" },
  legend: { flexDirection: "row", gap: 16, marginTop: 12, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 13, height: 13, borderRadius: 4, borderWidth: 1 },
  legendText: { fontFamily: "Inter_500Medium", fontSize: 12 },
});
