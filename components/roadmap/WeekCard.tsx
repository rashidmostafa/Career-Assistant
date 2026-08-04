import React, { useEffect, useRef, useState } from "react";
import { Animated, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BookOpen, ChevronDown, ChevronUp, CheckCircle2, Circle, ExternalLink, Lock, Play, Star, Zap } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import type { RoadmapWeek, Skill } from "@/context/RoadmapContext";
import { CircularProgress, SKILL_STATUS_COLORS } from "./CircularProgress";

const LEVEL_COLORS = { Beginner: "#22c55e", Intermediate: "#f59e0b", Advanced: "#ef4444" };
const TRACK_COLORS = { job: "#6366f1", career: "#0891b2" };
const RESOURCE_ICONS: Record<string, React.ElementType> = { video: Play, article: BookOpen, course: Zap };

interface Props {
  week: RoadmapWeek;
  onComplete: () => void;
  onToggleSkill: (skillId: string) => void;
  reducedMotion?: boolean;
  highContrast?: boolean;
  isNew?: boolean;
}

export function WeekCard({ week, onComplete, onToggleSkill, reducedMotion = false, highContrast = false, isNew = false }: Props) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const slideY  = useRef(new Animated.Value(isNew ? 30 : 0)).current;
  const scaleA  = useRef(new Animated.Value(isNew ? 0.95 : 1)).current;
  const glowA   = useRef(new Animated.Value(0)).current;
  const glowLoop = useRef<Animated.CompositeAnimation | null>(null);
  const locked   = !week.isUnlocked;
  const trackColor = TRACK_COLORS[week.track];
  const levelColor = LEVEL_COLORS[week.level];

  useEffect(() => {
    if (isNew && !reducedMotion) {
      Animated.parallel([
        Animated.spring(slideY,  { toValue: 0, friction: 8, tension: 100, useNativeDriver: true }),
        Animated.spring(scaleA,  { toValue: 1, friction: 8, useNativeDriver: true }),
      ]).start();
    }
  }, [isNew, reducedMotion]);

  useEffect(() => {
    if (!week.isUnlocked || week.isCompleted || reducedMotion) { glowLoop.current?.stop(); return; }
    glowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(glowA, { toValue: 1, duration: 1500, useNativeDriver: true }),
      Animated.timing(glowA, { toValue: 0, duration: 1500, useNativeDriver: true }),
    ]));
    glowLoop.current.start();
    const t = setTimeout(() => glowLoop.current?.stop(), 6000);
    return () => { clearTimeout(t); glowLoop.current?.stop(); };
  }, [week.isUnlocked, week.isCompleted, reducedMotion]);

  const weekProgress = week.skills.length > 0
    ? Math.round((week.skills.filter((s) => s.status === "Mastered" || s.status === "Expert").length / week.skills.length) * 100)
    : week.isCompleted ? 100 : 0;

  const glowOpacity = glowA.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] });

  const handleComplete = () => {
    if (locked) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onComplete();
  };

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: week.isCompleted ? "#10b981" : isNew ? trackColor : colors.border,
          borderWidth: week.isCompleted || isNew ? 1.5 : 1,
          opacity: locked ? 0.6 : 1,
          transform: [{ translateY: slideY }, { scale: scaleA }],
        },
      ]}
      accessible
      accessibilityLabel={`Week ${week.weekNumber}: ${week.topic}. ${week.isCompleted ? "Completed." : locked ? "Locked." : `${weekProgress}% complete.`}`}
    >
      {/* Glow overlay */}
      {!reducedMotion && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: trackColor, opacity: glowOpacity, borderRadius: 20 }]}
          pointerEvents="none"
        />
      )}

      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => !locked && setExpanded((e) => !e)}
        activeOpacity={locked ? 1 : 0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: locked, expanded }}
        accessibilityLabel={expanded ? "Collapse week" : "Expand week"}
      >
        <View style={styles.headerLeft}>
          <View style={styles.progressWrap}>
            <CircularProgress progress={weekProgress} level="micro" animate={!reducedMotion} highContrast={highContrast} />
            <Text style={[styles.weekNum, { color: colors.mutedForeground }]}>Wk {week.weekNumber}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <View style={styles.topicRow}>
              <Text style={[styles.topic, { color: locked ? colors.mutedForeground : colors.foreground }]} numberOfLines={expanded ? undefined : 2}>
                {week.topic}
              </Text>
              {isNew && (
                <View style={[styles.newBadge, { backgroundColor: trackColor }]}>
                  <Text style={styles.newBadgeText}>NEW</Text>
                </View>
              )}
            </View>
            <View style={styles.badgeRow}>
              <View style={[styles.levelBadge, { backgroundColor: levelColor + "18" }]}>
                <View style={[styles.dot, { backgroundColor: levelColor }]} />
                <Text style={[styles.levelText, { color: levelColor }]}>{week.level}</Text>
              </View>
              <View style={[styles.trackBadge, { backgroundColor: trackColor + "18" }]}>
                <Text style={[styles.trackText, { color: trackColor }]}>
                  {week.track === "job" ? "🎯 Job" : "🚀 Career"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.headerRight}>
          {locked ? (
            <Lock size={20} color={colors.mutedForeground} />
          ) : (
            <TouchableOpacity
              style={[styles.completeBtn, { borderColor: week.isCompleted ? "#10b981" : colors.border, backgroundColor: week.isCompleted ? "#10b981" : "transparent" }]}
              onPress={handleComplete}
              accessibilityRole="checkbox"
              accessibilityLabel={week.isCompleted ? "Mark incomplete" : "Mark complete"}
              accessibilityState={{ checked: week.isCompleted }}
            >
              {week.isCompleted ? <CheckCircle2 size={22} color="#fff" /> : <Circle size={22} color={colors.mutedForeground} />}
            </TouchableOpacity>
          )}
          {!locked && (expanded ? <ChevronUp size={18} color={colors.mutedForeground} /> : <ChevronDown size={18} color={colors.mutedForeground} />)}
        </View>
      </TouchableOpacity>

      {/* Expanded body */}
      {expanded && !locked && (
        <View style={styles.body}>
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>{week.description}</Text>

          {week.skills.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Skills</Text>
              <View style={styles.skillsRow}>
                {week.skills.map((skill) => (
                  <SkillChip
                    key={skill.id}
                    skill={skill}
                    onPress={() => onToggleSkill(skill.id)}
                    reducedMotion={reducedMotion}
                    highContrast={highContrast}
                  />
                ))}
              </View>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tasks this week</Text>
          {week.tasks.map((task, i) => (
            <View key={i} style={styles.taskRow}>
              <View style={[styles.taskDot, { backgroundColor: trackColor }]} />
              <Text style={[styles.taskText, { color: colors.foreground }]}>{task}</Text>
            </View>
          ))}

          {week.resources.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 4 }]}>Resources</Text>
              {week.resources.map((res, i) => {
                const Icon = RESOURCE_ICONS[res.type] ?? BookOpen;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.resourceRow, { borderColor: colors.border }]}
                    onPress={() => Linking.openURL(res.url).catch(() => {})}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${res.title}`}
                  >
                    <View style={[styles.resourceIcon, { backgroundColor: trackColor + "18" }]}>
                      <Icon size={16} color={trackColor} />
                    </View>
                    <Text style={[styles.resourceTitle, { color: colors.foreground }]} numberOfLines={2}>{res.title}</Text>
                    <ExternalLink size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      )}
    </Animated.View>
  );
}

// ── Skill chip ─────────────────────────────────────────────────────────────────
function SkillChip({ skill, onPress, reducedMotion, highContrast }: { skill: Skill; onPress: () => void; reducedMotion?: boolean; highContrast?: boolean }) {
  const colors = useColors();
  const pressScale = useRef(new Animated.Value(1)).current;
  const statusColor = SKILL_STATUS_COLORS[skill.status];

  const handlePress = () => {
    if (!reducedMotion) {
      Animated.sequence([
        Animated.timing(pressScale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
        Animated.spring(pressScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${skill.name}: ${skill.status}. Tap to advance.`}
    >
      <Animated.View style={[styles.skillChip, { backgroundColor: statusColor + "18", borderColor: statusColor + "60", transform: [{ scale: pressScale }] }]}>
        <CircularProgress progress={skill.xpPoints} level="individual" status={skill.status} animate={!reducedMotion} highContrast={highContrast} />
        <Text style={[styles.skillName, { color: colors.foreground }]} numberOfLines={1}>{skill.name}</Text>
        <Text style={[styles.skillStatus, { color: statusColor }]}>{skill.status}</Text>
        {skill.inCareerTrack && <Star size={10} color={statusColor} fill={statusColor} />}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 16, marginBottom: 10, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  headerLeft: { flex: 1, flexDirection: "row", gap: 12, alignItems: "flex-start" },
  progressWrap: { alignItems: "center", gap: 4 },
  weekNum: { fontFamily: "Inter_700Bold", fontSize: 10 },
  topicRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  topic: { fontFamily: "Inter_700Bold", fontSize: 16, letterSpacing: -0.2, flex: 1 },
  newBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", marginTop: 2 },
  newBadgeText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 9 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  levelBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  levelText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  trackBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  trackText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  completeBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  body: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(0,0,0,0.07)", paddingTop: 14 },
  desc: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21, marginBottom: 16 },
  section: { marginBottom: 14 },
  skillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  skillChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  skillName: { fontFamily: "Inter_600SemiBold", fontSize: 12, maxWidth: 100 },
  skillStatus: { fontFamily: "Inter_500Medium", fontSize: 10 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 13, marginBottom: 8 },
  taskRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  taskDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  taskText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  resourceRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  resourceIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  resourceTitle: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 19 },
});
