import { BriefcaseBusiness, Map, FileText, Mic, TrendingUp, ChevronRight, Zap, Award } from "lucide-react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useCV } from "@/context/CVContext";
import { useJobs } from "@/context/JobsContext";
import { useRoadmap } from "@/context/RoadmapContext";
import { useThemeMode } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  route: string;
}

export default function HomeScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolvedTheme, setThemeMode } = useThemeMode();
  const { user } = useAuth();
  const { cvProfile } = useCV();
  const { jobs, appliedJobIds } = useJobs();
  const { roadmap } = useRoadmap();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const isDarkMode = resolvedTheme === "dark";

  const handleThemeToggle = async () => {
    await setThemeMode(isDarkMode ? "light" : "dark");
  };

  const completedModules = roadmap?.modules.filter((m) => m.completed).length ?? 0;
  const totalModules = roadmap?.modules.length ?? 12;
  const progressPct = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

  const QUICK_ACTIONS: QuickAction[] = [
    {
      id: "jobs",
      label: "Job Matches",
      description: `${jobs.length} matching ${user?.targetRole || "role"} jobs`,
      icon: BriefcaseBusiness,
      color: colors.jobs || "#7c3aed",
      route: "/(tabs)/jobs",
    },
    {
      id: "cv",
      label: "CV Engine",
      description: cvProfile ? `ATS Score: ${cvProfile.atsScore}/100` : "Analyze & optimize your CV",
      icon: FileText,
      color: colors.cv || "#0891b2",
      route: "/(tabs)/cv",
    },
    {
      id: "roadmap",
      label: "12-Week Roadmap",
      description: roadmap ? `${progressPct}% complete · ${completedModules}/${totalModules} weeks` : "Generate your learning plan",
      icon: Map,
      color: colors.roadmap || "#059669",
      route: "/(tabs)/roadmap",
    },
    {
      id: "interview",
      label: "Interview Prep",
      description: "AI mock interviews & feedback",
      icon: Mic,
      color: colors.interview || "#db2777",
      route: "/(tabs)/interview",
    },
  ];

  const stats = [
    { label: "Jobs Applied", value: String(appliedJobIds.length), color: colors.primary },
    { label: "CV Score", value: cvProfile ? `${cvProfile.atsScore}` : "—", color: colors.cv || "#0891b2" },
    { label: "Weeks Done", value: `${completedModules}/${totalModules}`, color: colors.roadmap || "#059669" },
    { label: "Matches", value: String(jobs.length), color: colors.jobs || "#7c3aed" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad + 100 }}
      >
        <View style={[styles.hero, { paddingTop: topPad + 20, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View style={styles.heroInner}>
            <TouchableOpacity
              style={styles.themeToggleOuter}
              onPress={handleThemeToggle}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
            >
              <LinearGradient
                colors={isDarkMode ? ["#0f172a", colors.primary] : [colors.primary, colors.portfolio || "#ea580c"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.themeToggle}
              >
                <View style={[styles.themeToggleIcon, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                  <Feather name={isDarkMode ? "sun" : "moon"} size={16} color="#fff" />
                </View>
                <Text style={styles.themeToggleText}>{isDarkMode ? "Light" : "Dark"}</Text>
                <Feather name="chevron-right" size={16} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
            <Animated.View entering={FadeInDown.duration(400)}>
              <View style={styles.greetRow}>
                <View style={[styles.aiDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.greetLabel, { color: colors.mutedForeground }]}>AI Career Assistant</Text>
              </View>
              <Text style={[styles.greetName, { color: colors.foreground }]}>
                Hi, {user?.name?.split(" ")[0] ?? "there"} 👋
              </Text>
              <Text style={[styles.greetSub, { color: colors.mutedForeground }]}>
                {user?.targetRole
                  ? `Targeting ${user.targetRole} · ${user.experienceLevel}`
                  : "Set a target role to personalize your experience"}
              </Text>
            </Animated.View>
          </View>
        </View>

        <Animated.View entering={FadeInDown.duration(500).delay(100)} style={{ paddingHorizontal: 24 }}>
          <View style={styles.statsGrid}>
            {stats.map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(200)} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Zap size={18} color={colors.primary} strokeWidth={2.5} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Actions</Text>
          </View>
          {QUICK_ACTIONS.map((action, i) => (
            <Animated.View key={action.id} entering={FadeInDown.duration(400).delay(i * 60 + 200)}>
              <TouchableOpacity
                style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(action.route as any);
                }}
                activeOpacity={0.85}
              >
                <View style={[styles.actionIconWrap, { backgroundColor: action.color + "15" }]}>
                  <action.icon size={22} color={action.color} strokeWidth={2.5} />
                </View>
                <View style={styles.actionText}>
                  <Text style={[styles.actionLabel, { color: colors.foreground }]}>{action.label}</Text>
                  <Text style={[styles.actionDesc, { color: colors.mutedForeground }]}>{action.description}</Text>
                </View>
                <ChevronRight size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </Animated.View>
          ))}
        </Animated.View>

        {roadmap && (
          <Animated.View entering={FadeInDown.duration(400).delay(450)} style={styles.section}>
            <View style={styles.sectionHeader}>
              <TrendingUp size={18} color={colors.roadmap || "#059669"} strokeWidth={2.5} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Roadmap Progress</Text>
            </View>
            <TouchableOpacity
              style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push("/(tabs)/roadmap" as any)}
              activeOpacity={0.85}
            >
              <View style={styles.progressRow}>
                <Text style={[styles.progressLabel, { color: colors.foreground }]}>{roadmap.title}</Text>
                <Text style={[styles.progressPct, { color: colors.roadmap || "#059669" }]}>{progressPct}%</Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.secondary }]}>
                <View style={[styles.progressFill, { width: `${progressPct}%` as any, backgroundColor: colors.roadmap || "#059669" }]} />
              </View>
              <Text style={[styles.progressSub, { color: colors.mutedForeground }]}>
                {completedModules} of {totalModules} weeks completed
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {cvProfile && (
          <Animated.View entering={FadeInDown.duration(400).delay(500)} style={[styles.section, { paddingBottom: 8 }]}>
            <View style={styles.sectionHeader}>
              <Award size={18} color={colors.cv || "#0891b2"} strokeWidth={2.5} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>CV Status</Text>
            </View>
            <TouchableOpacity
              style={[styles.cvCard, { backgroundColor: colors.card, borderColor: colors.cv ? colors.cv + "40" : colors.border, borderWidth: 1.5 }]}
              onPress={() => router.push("/(tabs)/cv" as any)}
              activeOpacity={0.85}
            >
              <View>
                <Text style={[styles.cvScore, { color: colors.cv || "#0891b2" }]}>{cvProfile.atsScore}<Text style={[styles.cvScoreMax, { color: colors.mutedForeground }]}>/100</Text></Text>
                <Text style={[styles.cvLabel, { color: colors.foreground }]}>ATS Score</Text>
                <Text style={[styles.cvNote, { color: colors.mutedForeground }]}>
                  {cvProfile.atsScore >= 80 ? "Ready to apply · Excellent ATS optimization" : cvProfile.atsScore >= 60 ? "Good · Minor improvements suggested" : "Review suggestions to improve score"}
                </Text>
              </View>
              <ChevronRight size={20} color={colors.cv || "#0891b2"} />
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 0 },
  heroInner: { paddingHorizontal: 24, position: "relative" },
  themeToggleOuter: { position: "absolute", top: 0, right: 20, zIndex: 10, borderRadius: 999, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 8 },
  themeToggle: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, minWidth: 110 },
  themeToggleIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  themeToggleText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold", lineHeight: 16 },
  greetRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  aiDot: { width: 8, height: 8, borderRadius: 4 },
  greetLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  greetName: { fontSize: 30, fontFamily: "Inter_700Bold", letterSpacing: -1, marginBottom: 6 },
  greetSub: { fontSize: 15, fontFamily: "Inter_500Medium", lineHeight: 22 },
  statsGrid: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 4 },
  statCard: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, alignItems: "center", gap: 4 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.5 },
  statLabel: { fontFamily: "Inter_500Medium", fontSize: 10, textAlign: "center" },
  section: { paddingHorizontal: 24, paddingTop: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  actionCard: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 20, padding: 18, borderWidth: 1, marginBottom: 10 },
  actionIconWrap: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionText: { flex: 1 },
  actionLabel: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 3, letterSpacing: -0.2 },
  actionDesc: { fontSize: 13, fontFamily: "Inter_500Medium" },
  progressCard: { borderRadius: 20, padding: 20, borderWidth: 1 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  progressLabel: { fontFamily: "Inter_700Bold", fontSize: 15, flex: 1, paddingRight: 12 },
  progressPct: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  progressBar: { height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 },
  progressFill: { height: "100%", borderRadius: 4 },
  progressSub: { fontFamily: "Inter_500Medium", fontSize: 12 },
  cvCard: { borderRadius: 20, padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cvScore: { fontFamily: "Inter_700Bold", fontSize: 36, letterSpacing: -1 },
  cvScoreMax: { fontSize: 18, fontFamily: "Inter_500Medium" },
  cvLabel: { fontFamily: "Inter_700Bold", fontSize: 16, marginTop: 4, marginBottom: 4 },
  cvNote: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19 },
});
