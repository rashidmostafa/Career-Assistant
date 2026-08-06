/**
 * PasswordStrengthBar — visual strength meter + rule checklist.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Check, X } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export interface PasswordRules {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  hasNoSpaces: boolean;
}

interface Props {
  password: string;
  rules: PasswordRules;
  showRules?: boolean;
}

const RULE_LABELS: Array<[keyof PasswordRules, string]> = [
  ["hasMinLength",   "8+ characters"],
  ["hasUppercase",   "One uppercase letter"],
  ["hasLowercase",   "One lowercase letter"],
  ["hasNumber",      "One number"],
  ["hasSpecialChar", "One special character (!@#…)"],
  ["hasNoSpaces",    "No spaces"],
];

function getStrength(rules: PasswordRules): { score: number; label: string; color: string } {
  const passed = Object.values(rules).filter(Boolean).length;
  if (passed <= 2) return { score: passed / 6, label: "Weak",   color: "#ef4444" };
  if (passed <= 4) return { score: passed / 6, label: "Fair",   color: "#f59e0b" };
  if (passed === 5) return { score: passed / 6, label: "Good",  color: "#3b82f6" };
  return              { score: 1,              label: "Strong", color: "#10b981" };
}

export function PasswordStrengthBar({ password, rules, showRules = true }: Props) {
  const colors = useColors();
  const { score, label, color } = getStrength(rules);

  if (!password) return null;

  return (
    <View style={styles.wrap}>
      {/* Bar */}
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${score * 100}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>

      {/* Rules */}
      {showRules && (
        <View style={styles.rules}>
          {RULE_LABELS.map(([key, text]) => (
            <View key={key} style={styles.rule}>
              {rules[key]
                ? <Check size={13} color="#10b981" />
                : <X     size={13} color="#ef4444" />
              }
              <Text style={[styles.ruleText, { color: rules[key] ? colors.mutedForeground : "#ef4444" }]}>
                {text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, marginBottom: 4 },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginBottom: 4 },
  fill: { height: 4, borderRadius: 2 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 12, textAlign: "right", marginBottom: 8 },
  rules: { gap: 5, marginTop: 2 },
  rule: { flexDirection: "row", alignItems: "center", gap: 6 },
  ruleText: { fontFamily: "Inter_500Medium", fontSize: 12 },
});
