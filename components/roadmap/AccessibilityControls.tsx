import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  reducedMotion: boolean;
  highContrast: boolean;
  onToggleReducedMotion: (v: boolean) => void;
  onToggleHighContrast: (v: boolean) => void;
}

export function AccessibilityControls({ reducedMotion, highContrast, onToggleReducedMotion, onToggleHighContrast }: Props) {
  const colors = useColors();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessible
      accessibilityRole="none"
      accessibilityLabel="Accessibility controls"
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Accessibility (WCAG 2.1 AA)</Text>
      <ToggleRow
        label="Reduced Motion"
        desc="Disable all animations and transitions"
        value={reducedMotion}
        onChange={onToggleReducedMotion}
        a11yLabel="Reduced motion"
        colors={colors}
      />
      <ToggleRow
        label="High Contrast"
        desc="Increase contrast for better readability"
        value={highContrast}
        onChange={onToggleHighContrast}
        a11yLabel="High contrast mode"
        colors={colors}
        last
      />
    </View>
  );
}

function ToggleRow({ label, desc, value, onChange, a11yLabel, colors, last }: {
  label: string; desc: string; value: boolean; onChange: (v: boolean) => void;
  a11yLabel: string; colors: any; last?: boolean;
}) {
  return (
    <View style={[styles.row, last && { marginBottom: 0 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.desc, { color: colors.mutedForeground }]}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
        accessibilityRole="switch"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 14, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 2 },
  desc: { fontFamily: "Inter_500Medium", fontSize: 12 },
});
