import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function MatchBadge({ score }: { score: number }) {
  const colors = useColors();
  const bg =
    score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.destructive;
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
