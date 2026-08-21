import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AlertTriangle, CheckCircle, Clock, XCircle, Info, ChevronDown, ChevronUp, X } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";
import { daysUntil, type JobDeadline, type EmergencyStrategy } from "@/context/RoadmapContext";

interface Props {
  deadline: JobDeadline;
  /** Estimated days of study still outstanding, for the feasibility line. */
  daysOfWorkLeft?: number;
  onApplyStrategy: (strategyId: EmergencyStrategy["id"]) => void;
  onDismiss: () => void;
}

const RISK_CONFIG = {
  SAFE:     { bg: "#d1fae5", border: "#10b981", text: "#065f46", Icon: CheckCircle,   label: "On Track" },
  WATCH:    { bg: "#fef3c7", border: "#f59e0b", text: "#78350f", Icon: Clock,         label: "Watch"    },
  ALERT:    { bg: "#fee2e2", border: "#ef4444", text: "#991b1b", Icon: AlertTriangle, label: "Alert"    },
  CRITICAL: { bg: "#fce7f3", border: "#db2777", text: "#831843", Icon: XCircle,       label: "Critical" },
  EXPIRED:  { bg: "#f1f5f9", border: "#94a3b8", text: "#475569", Icon: Info,          label: "Expired"  },
} as const;

export function RiskBanner({ deadline, daysOfWorkLeft, onApplyStrategy, onDismiss }: Props) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const cfg = RISK_CONFIG[deadline.riskLevel];
  const { Icon } = cfg;

  // Derived from the date on every render. The stored weeksToDeadline was
  // written once when the roadmap was generated and never updated, so it showed
  // the same number days later — the one thing a countdown must not do.
  const daysLeft = daysUntil(deadline.deadlineDate);

  const closesOn = new Date(deadline.deadlineDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const weeksMsg = deadline.isExpired || daysLeft <= 0
    ? "Applications have closed — the skills you built still count"
    : daysLeft === 1
    ? `Last day to apply — closes ${closesOn}`
    : `${daysLeft} days left to apply · closes ${closesOn}`;

  // Days of study still needed vs days of calendar left. This is the judgement
  // the banner exists to make, and it only means anything because skills carry
  // individual estimates rather than a uniform week each.
  const feasibility =
    daysOfWorkLeft && daysLeft > 0
      ? daysOfWorkLeft <= daysLeft
        ? `About ${daysOfWorkLeft} days of study left — that fits.`
        : `About ${daysOfWorkLeft} days of study left — ${daysOfWorkLeft - daysLeft} more than you have.`
      : null;

  return (
    <View
      style={[styles.banner, { backgroundColor: cfg.bg, borderColor: cfg.border }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${cfg.label}: ${deadline.jobTitle} at ${deadline.company}. ${weeksMsg}.`}
    >
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((e) => !e)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse risk details" : "Expand risk details"}
        accessibilityState={{ expanded }}
      >
        <View style={styles.headerLeft}>
          <Icon size={18} color={cfg.border} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <View style={styles.titleRow}>
              <Text style={[styles.riskLabel, { color: cfg.text }]}>{cfg.label}</Text>
              <View style={[styles.riskPill, { backgroundColor: cfg.border }]}>
                <Text style={styles.riskPillText}>{deadline.riskLevel}</Text>
              </View>
            </View>
            <Text style={[styles.jobTitle, { color: cfg.text }]} numberOfLines={1}>
              {deadline.jobTitle} · {deadline.company}
            </Text>
            <Text style={[styles.weeksText, { color: cfg.text }]}>{weeksMsg}</Text>
            {!!feasibility && (
              <Text style={[styles.feasibility, { color: cfg.text }]}>{feasibility}</Text>
            )}
          </View>
        </View>
        <View style={styles.headerRight}>
          {expanded ? <ChevronUp size={18} color={cfg.text} /> : <ChevronDown size={18} color={cfg.text} />}
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss job deadline"
          >
            <X size={16} color={cfg.text} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.strategies}>
          <Text style={[styles.strategiesTitle, { color: cfg.text }]}>Emergency Strategies</Text>
          {deadline.emergencyStrategies.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.strategyBtn, { borderColor: cfg.border }]}
              onPress={() => onApplyStrategy(s.id)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${s.title}: ${s.description}`}
            >
              <Text style={styles.strategyEmoji}>{s.icon}</Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.strategyTitle, { color: cfg.text }]}>{s.title}</Text>
                <Text style={[styles.strategyDesc, { color: cfg.text, opacity: 0.8 }]}>{s.description}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {deadline.isExpired && (
            <View style={[styles.expiredNote, { borderColor: cfg.border }]}>
              <Text style={[styles.expiredText, { color: cfg.text }]}>
                💪 Your skills are valuable regardless of this specific job. They've been promoted to your permanent career track.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  feasibility: { fontFamily: "Inter_500Medium", fontSize: 12.5, marginTop: 3, opacity: 0.9 },
  banner: { borderRadius: 16, borderWidth: 1.5, marginBottom: 16, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", padding: 14 },
  headerLeft: { flex: 1, flexDirection: "row", alignItems: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  riskLabel: { fontFamily: "Inter_700Bold", fontSize: 14 },
  riskPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  riskPillText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 12 },
  jobTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, marginBottom: 2 },
  weeksText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: 8 },
  strategies: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.1)", paddingTop: 12 },
  strategiesTitle: { fontFamily: "Inter_700Bold", fontSize: 13, marginBottom: 10 },
  strategyBtn: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: "rgba(255,255,255,0.5)" },
  strategyEmoji: { fontSize: 20, marginTop: 1 },
  strategyTitle: { fontFamily: "Inter_700Bold", fontSize: 13, marginBottom: 2 },
  strategyDesc: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17 },
  expiredNote: { borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: "rgba(255,255,255,0.4)", marginTop: 4 },
  expiredText: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
});
