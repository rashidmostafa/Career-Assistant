import { BriefcaseBusiness, ChevronRight, ChevronLeft, CheckCircle, TrendingUp, Search } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInRight, FadeInLeft } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

// ─── Data ──────────────────────────────────────────────────────────────────

const BACKGROUNDS = [
  { id: "cs", label: "Computer Science / IT", icon: "💻" },
  { id: "ee", label: "Electrical Engineering", icon: "⚡" },
  { id: "me", label: "Mechanical Engineering", icon: "⚙️" },
  { id: "ce", label: "Civil Engineering", icon: "🏗️" },
  { id: "biz", label: "Business / Marketing", icon: "📊" },
  { id: "fin", label: "Chartered Accountancy / Finance", icon: "💰" },
  { id: "other", label: "Other", icon: "🔍" },
] as const;

type BackgroundId = typeof BACKGROUNDS[number]["id"];

const EXPERIENCE_LEVELS = [
  { id: "student", label: "Student", sub: "Currently studying, no professional experience" },
  { id: "entry", label: "Entry Level", sub: "0–2 years of experience" },
  { id: "mid", label: "Mid Level", sub: "3–5 years of experience" },
  { id: "senior", label: "Senior", sub: "6–9 years of experience" },
  { id: "lead", label: "Lead", sub: "10+ years of experience, team management" },
] as const;

type ExperienceLevelId = typeof EXPERIENCE_LEVELS[number]["id"];

interface RoleSuggestion {
  title: string;
  demand: "high" | "medium" | "low";
  count: number;
}

// Role suggestions matrix: background × experience level
const ROLE_MAP: Record<BackgroundId, Record<ExperienceLevelId, RoleSuggestion[]>> = {
  cs: {
    student: [
      { title: "Junior React Developer", demand: "high", count: 3820 },
      { title: "Associate Software Engineer", demand: "high", count: 5670 },
      { title: "IT Support Specialist", demand: "medium", count: 4120 },
      { title: "Junior Python Developer", demand: "high", count: 3340 },
      { title: "QA Tester", demand: "medium", count: 2890 },
      { title: "Software Trainee", demand: "medium", count: 2100 },
    ],
    entry: [
      { title: "Junior React Developer", demand: "high", count: 6450 },
      { title: "Associate Software Engineer", demand: "high", count: 8230 },
      { title: "Frontend Developer", demand: "high", count: 7890 },
      { title: "Backend Developer (Node.js)", demand: "high", count: 6720 },
      { title: "Mobile Developer (React Native)", demand: "high", count: 4230 },
      { title: "Junior Data Analyst", demand: "medium", count: 3870 },
      { title: "DevOps Trainee", demand: "medium", count: 2760 },
    ],
    mid: [
      { title: "React Developer", demand: "high", count: 12450 },
      { title: "Full Stack Developer", demand: "high", count: 15670 },
      { title: "Backend Engineer (Node.js/Python)", demand: "high", count: 11340 },
      { title: "Mobile Developer", demand: "high", count: 6780 },
      { title: "Data Engineer", demand: "high", count: 8340 },
      { title: "DevOps Engineer", demand: "high", count: 9200 },
      { title: "Cloud Engineer (AWS/GCP)", demand: "high", count: 7930 },
      { title: "Machine Learning Engineer", demand: "high", count: 7120 },
    ],
    senior: [
      { title: "Senior React Developer", demand: "high", count: 9870 },
      { title: "Senior Full Stack Engineer", demand: "high", count: 11230 },
      { title: "Lead Software Engineer", demand: "high", count: 8760 },
      { title: "Senior Data Scientist", demand: "high", count: 6540 },
      { title: "Senior DevOps Engineer", demand: "medium", count: 5430 },
      { title: "Technical Architect", demand: "medium", count: 4120 },
      { title: "Senior Cloud Architect", demand: "high", count: 5890 },
    ],
    lead: [
      { title: "Principal Engineer", demand: "medium", count: 3210 },
      { title: "VP of Engineering", demand: "medium", count: 1870 },
      { title: "CTO / Technical Director", demand: "medium", count: 1230 },
      { title: "Engineering Manager", demand: "high", count: 4560 },
      { title: "Solutions Architect", demand: "medium", count: 4560 },
      { title: "Head of Platform Engineering", demand: "medium", count: 2340 },
    ],
  },
  ee: {
    student: [
      { title: "Electrical Engineering Intern", demand: "medium", count: 2340 },
      { title: "Embedded Systems Trainee", demand: "medium", count: 1870 },
      { title: "Hardware Test Technician", demand: "medium", count: 2100 },
    ],
    entry: [
      { title: "Embedded Software Engineer", demand: "high", count: 4560 },
      { title: "PCB Design Engineer", demand: "medium", count: 2870 },
      { title: "Power Systems Engineer", demand: "medium", count: 3120 },
      { title: "Control Systems Engineer", demand: "medium", count: 2650 },
      { title: "IoT Developer", demand: "high", count: 5230 },
    ],
    mid: [
      { title: "Embedded Systems Engineer", demand: "high", count: 6780 },
      { title: "Firmware Engineer", demand: "high", count: 5430 },
      { title: "FPGA Engineer", demand: "medium", count: 3210 },
      { title: "RF Engineer", demand: "medium", count: 2870 },
      { title: "Power Electronics Engineer", demand: "medium", count: 3450 },
    ],
    senior: [
      { title: "Senior Embedded Engineer", demand: "high", count: 4560 },
      { title: "Senior Hardware Engineer", demand: "medium", count: 3120 },
      { title: "Lead Firmware Engineer", demand: "medium", count: 2650 },
      { title: "Senior IoT Architect", demand: "high", count: 3890 },
    ],
    lead: [
      { title: "Principal Hardware Engineer", demand: "medium", count: 1560 },
      { title: "Head of Hardware Engineering", demand: "medium", count: 1230 },
      { title: "Engineering Director (EE)", demand: "medium", count: 890 },
    ],
  },
  me: {
    student: [
      { title: "Mechanical Engineering Intern", demand: "medium", count: 2100 },
      { title: "CAD Designer (Trainee)", demand: "medium", count: 1780 },
    ],
    entry: [
      { title: "Mechanical Design Engineer", demand: "medium", count: 4230 },
      { title: "CAD/CAM Engineer", demand: "medium", count: 3560 },
      { title: "Product Design Engineer", demand: "medium", count: 4120 },
      { title: "Manufacturing Engineer", demand: "medium", count: 3890 },
    ],
    mid: [
      { title: "Senior Mechanical Engineer", demand: "medium", count: 5670 },
      { title: "Structural Engineer", demand: "medium", count: 4320 },
      { title: "R&D Engineer", demand: "medium", count: 3780 },
      { title: "Automotive Engineer", demand: "medium", count: 4560 },
    ],
    senior: [
      { title: "Lead Mechanical Engineer", demand: "medium", count: 3210 },
      { title: "Senior Product Engineer", demand: "medium", count: 2870 },
      { title: "Engineering Project Manager", demand: "medium", count: 3450 },
    ],
    lead: [
      { title: "Principal Mechanical Engineer", demand: "medium", count: 1340 },
      { title: "VP of Engineering (ME)", demand: "medium", count: 890 },
      { title: "Head of Product Development", demand: "medium", count: 1120 },
    ],
  },
  ce: {
    student: [
      { title: "Civil Engineering Intern", demand: "medium", count: 2340 },
      { title: "Site Assistant", demand: "medium", count: 1980 },
    ],
    entry: [
      { title: "Graduate Civil Engineer", demand: "medium", count: 3870 },
      { title: "Structural Engineer (Junior)", demand: "medium", count: 3120 },
      { title: "Site Engineer", demand: "medium", count: 4230 },
    ],
    mid: [
      { title: "Civil Engineer", demand: "medium", count: 6780 },
      { title: "Structural Engineer", demand: "medium", count: 5430 },
      { title: "Project Engineer", demand: "medium", count: 6120 },
      { title: "Geotechnical Engineer", demand: "medium", count: 3450 },
    ],
    senior: [
      { title: "Senior Civil Engineer", demand: "medium", count: 4560 },
      { title: "Senior Structural Engineer", demand: "medium", count: 3870 },
      { title: "Principal Engineer (Civil)", demand: "medium", count: 2340 },
    ],
    lead: [
      { title: "Project Director (Civil)", demand: "medium", count: 1230 },
      { title: "Head of Civil Engineering", demand: "medium", count: 890 },
    ],
  },
  biz: {
    student: [
      { title: "Marketing Intern", demand: "medium", count: 4560 },
      { title: "Business Analyst Trainee", demand: "medium", count: 3120 },
      { title: "Sales Development Representative", demand: "high", count: 5670 },
    ],
    entry: [
      { title: "Digital Marketing Specialist", demand: "high", count: 8230 },
      { title: "Business Analyst", demand: "high", count: 9870 },
      { title: "Content Marketing Manager", demand: "medium", count: 5430 },
      { title: "Social Media Manager", demand: "medium", count: 6780 },
      { title: "Marketing Coordinator", demand: "medium", count: 4320 },
    ],
    mid: [
      { title: "Marketing Manager", demand: "high", count: 12450 },
      { title: "Brand Strategist", demand: "medium", count: 7890 },
      { title: "Digital Marketing Lead", demand: "high", count: 9340 },
      { title: "Product Marketing Manager", demand: "high", count: 8760 },
      { title: "Growth Manager", demand: "high", count: 7120 },
    ],
    senior: [
      { title: "Senior Marketing Manager", demand: "medium", count: 8430 },
      { title: "Head of Marketing", demand: "medium", count: 5670 },
      { title: "Senior Brand Strategist", demand: "medium", count: 4320 },
      { title: "VP of Marketing", demand: "medium", count: 3210 },
    ],
    lead: [
      { title: "Chief Marketing Officer", demand: "medium", count: 1870 },
      { title: "VP of Growth", demand: "medium", count: 2340 },
      { title: "Director of Marketing", demand: "medium", count: 3120 },
    ],
  },
  fin: [
    // handled below as flat
  ] as any,
  other: [] as any,
};

// Finance roles
const FIN_ROLES: Record<ExperienceLevelId, RoleSuggestion[]> = {
  student: [
    { title: "Accounts Assistant (Trainee)", demand: "medium", count: 3450 },
    { title: "Finance Intern", demand: "medium", count: 2870 },
    { title: "Tax Trainee", demand: "medium", count: 1980 },
  ],
  entry: [
    { title: "Accountant", demand: "high", count: 7890 },
    { title: "Financial Analyst", demand: "high", count: 8760 },
    { title: "Audit Associate", demand: "medium", count: 5430 },
    { title: "Tax Consultant", demand: "medium", count: 4560 },
    { title: "Management Accountant", demand: "medium", count: 4120 },
  ],
  mid: [
    { title: "Senior Accountant", demand: "high", count: 9870 },
    { title: "Finance Manager", demand: "high", count: 8430 },
    { title: "Investment Analyst", demand: "medium", count: 5670 },
    { title: "Financial Controller", demand: "medium", count: 4320 },
    { title: "Risk Manager", demand: "medium", count: 4890 },
  ],
  senior: [
    { title: "Senior Finance Manager", demand: "medium", count: 6780 },
    { title: "Head of Finance", demand: "medium", count: 4320 },
    { title: "Senior Financial Analyst", demand: "medium", count: 5430 },
    { title: "Director of Finance", demand: "medium", count: 3120 },
  ],
  lead: [
    { title: "CFO / Finance Director", demand: "medium", count: 1870 },
    { title: "VP of Finance", demand: "medium", count: 2340 },
    { title: "Chief Accountant", demand: "medium", count: 1560 },
  ],
};

// All roles for "Other"
const ALL_ROLES: RoleSuggestion[] = [
  { title: "Software Engineer", demand: "high", count: 45600 },
  { title: "Frontend Developer", demand: "high", count: 18920 },
  { title: "Backend Developer", demand: "high", count: 21340 },
  { title: "Full Stack Developer", demand: "high", count: 15670 },
  { title: "Data Scientist", demand: "high", count: 9870 },
  { title: "Marketing Manager", demand: "high", count: 12450 },
  { title: "Business Analyst", demand: "high", count: 9870 },
  { title: "Financial Analyst", demand: "high", count: 8760 },
  { title: "Product Manager", demand: "medium", count: 8900 },
  { title: "UX/UI Designer", demand: "medium", count: 7890 },
  { title: "DevOps Engineer", demand: "high", count: 11200 },
  { title: "Data Engineer", demand: "high", count: 8340 },
  { title: "Machine Learning Engineer", demand: "high", count: 7120 },
  { title: "Cloud Engineer", demand: "high", count: 9340 },
  { title: "Mobile Developer", demand: "high", count: 6780 },
  { title: "Site Reliability Engineer", demand: "medium", count: 5430 },
  { title: "QA Engineer", demand: "medium", count: 6230 },
  { title: "Cybersecurity Analyst", demand: "high", count: 7450 },
  { title: "Sales Manager", demand: "medium", count: 11230 },
  { title: "HR Manager", demand: "medium", count: 8760 },
];

function getRoleSuggestions(bg: BackgroundId, level: ExperienceLevelId): RoleSuggestion[] {
  if (bg === "other") return ALL_ROLES;
  if (bg === "fin") return FIN_ROLES[level] || [];
  const map = ROLE_MAP[bg];
  return map?.[level] ?? [];
}

function DemandBadge({ demand, colors }: { demand: "high" | "medium" | "low"; colors: any }) {
  const config = {
    high: { bg: colors.success + "20", dot: colors.success, text: "High Demand" },
    medium: { bg: colors.warning + "20", dot: colors.warning, text: "Medium" },
    low: { bg: colors.mutedForeground + "20", dot: colors.mutedForeground, text: "Low" },
  }[demand];
  return (
    <View style={[styles.demandBadge, { backgroundColor: config.bg }]}>
      <View style={[styles.demandDot, { backgroundColor: config.dot }]} />
      <Text style={[styles.demandText, { color: config.dot }]}>{config.text}</Text>
    </View>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { completeOnboarding, user } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedBackground, setSelectedBackground] = useState<BackgroundId | null>(null);
  const [otherBackground, setOtherBackground] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<ExperienceLevelId | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const suggestedRoles = useMemo(() => {
    if (!selectedBackground || !selectedLevel) return [];
    return getRoleSuggestions(selectedBackground, selectedLevel);
  }, [selectedBackground, selectedLevel]);

  const filteredRoles = useMemo(() => {
    if (!roleSearch.trim()) return suggestedRoles;
    const q = roleSearch.toLowerCase();
    return suggestedRoles.filter((r) => r.title.toLowerCase().includes(q));
  }, [suggestedRoles, roleSearch]);

  const goNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 1 && selectedBackground) setStep(2);
    else if (step === 2 && selectedLevel) setStep(3);
  };

  const goBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const handleFinish = async () => {
    if (!selectedRole || !selectedBackground || !selectedLevel) return;
    setLoading(true);
    try {
      const bgLabel = selectedBackground === "other"
        ? (otherBackground.trim() || "Other")
        : BACKGROUNDS.find((b) => b.id === selectedBackground)?.label || selectedBackground;
      const levelLabel = EXPERIENCE_LEVELS.find((l) => l.id === selectedLevel)?.label || selectedLevel;
      await completeOnboarding(bgLabel, levelLabel, selectedRole);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const progressWidth = step === 1 ? "33%" : step === 2 ? "66%" : "100%";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.topBar, { paddingTop: topPad + 16, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.topBarInner}>
          {step > 1 ? (
            <TouchableOpacity onPress={goBack} style={styles.backBtn}>
              <ChevronLeft size={22} color={colors.primary} />
            </TouchableOpacity>
          ) : <View style={styles.backBtnPlaceholder} />}
          <View style={styles.stepInfo}>
            <Text style={[styles.stepLabel, { color: colors.mutedForeground }]}>Step {step} of 3</Text>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              {step === 1 ? "Your Background" : step === 2 ? "Experience Level" : "Choose Your Role"}
            </Text>
          </View>
          <View style={styles.backBtnPlaceholder} />
        </View>
        {/* Progress bar */}
        <View style={[styles.progressBarTrack, { backgroundColor: colors.muted }]}>
          <Animated.View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: progressWidth as any }]} />
        </View>
      </View>

      {/* Step 1: Background */}
      {step === 1 && (
        <Animated.View entering={FadeInRight.duration(350)} style={styles.stepContainer}>
          <ScrollView contentContainerStyle={styles.stepScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>
              Select your educational or professional background to get personalised role suggestions.
            </Text>
            {BACKGROUNDS.map((bg) => (
              <TouchableOpacity
                key={bg.id}
                style={[
                  styles.optionCard,
                  { backgroundColor: colors.card, borderColor: selectedBackground === bg.id ? colors.primary : colors.border },
                  selectedBackground === bg.id && { backgroundColor: colors.accent },
                ]}
                onPress={() => {
                  setSelectedBackground(bg.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Text style={styles.optionIcon}>{bg.icon}</Text>
                <Text style={[styles.optionLabel, { color: colors.foreground }]}>{bg.label}</Text>
                {selectedBackground === bg.id && <CheckCircle size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
            {selectedBackground === "other" && (
              <View style={[styles.otherInput, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <TextInput
                  style={[styles.otherInputText, { color: colors.foreground }]}
                  placeholder="Describe your background..."
                  placeholderTextColor={colors.mutedForeground}
                  value={otherBackground}
                  onChangeText={setOtherBackground}
                  multiline
                />
              </View>
            )}
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: selectedBackground ? colors.primary : colors.muted }]}
              onPress={goNext}
              disabled={!selectedBackground}
            >
              <Text style={[styles.nextBtnText, { color: selectedBackground ? "#fff" : colors.mutedForeground }]}>
                Continue
              </Text>
              <ChevronRight size={18} color={selectedBackground ? "#fff" : colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Step 2: Experience Level */}
      {step === 2 && (
        <Animated.View entering={FadeInRight.duration(350)} style={styles.stepContainer}>
          <ScrollView contentContainerStyle={styles.stepScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>
              Select your current experience level so we can suggest the right roles for you.
            </Text>
            {EXPERIENCE_LEVELS.map((lv) => (
              <TouchableOpacity
                key={lv.id}
                style={[
                  styles.optionCard,
                  { backgroundColor: colors.card, borderColor: selectedLevel === lv.id ? colors.primary : colors.border },
                  selectedLevel === lv.id && { backgroundColor: colors.accent },
                ]}
                onPress={() => {
                  setSelectedLevel(lv.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={styles.levelInfo}>
                  <Text style={[styles.optionLabel, { color: colors.foreground }]}>{lv.label}</Text>
                  <Text style={[styles.levelSub, { color: colors.mutedForeground }]}>{lv.sub}</Text>
                </View>
                {selectedLevel === lv.id && <CheckCircle size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: selectedLevel ? colors.primary : colors.muted }]}
              onPress={goNext}
              disabled={!selectedLevel}
            >
              <Text style={[styles.nextBtnText, { color: selectedLevel ? "#fff" : colors.mutedForeground }]}>
                See Suggested Roles
              </Text>
              <ChevronRight size={18} color={selectedLevel ? "#fff" : colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* Step 3: Role Selection */}
      {step === 3 && (
        <Animated.View entering={FadeInRight.duration(350)} style={styles.stepContainer}>
          <View style={[styles.roleHeader, { backgroundColor: colors.background }]}>
            <Text style={[styles.stepDesc, { color: colors.mutedForeground, marginBottom: 12 }]}>
              Based on your background and experience, here are the best-matching roles in today's job market.
            </Text>
            {/* Search bar */}
            <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Search size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder="Search roles..."
                placeholderTextColor={colors.mutedForeground}
                value={roleSearch}
                onChangeText={setRoleSearch}
                autoCapitalize="none"
              />
            </View>
            {/* Stats row */}
            <View style={[styles.statsRow, { backgroundColor: colors.accent, borderRadius: 10 }]}>
              <TrendingUp size={14} color={colors.primary} />
              <Text style={[styles.statsText, { color: colors.primary }]}>
                {filteredRoles.length} roles found · Live job market data
              </Text>
            </View>
          </View>
          <FlatList
            data={filteredRoles}
            keyExtractor={(item) => item.title}
            contentContainerStyle={styles.roleList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.roleCard,
                  { backgroundColor: colors.card, borderColor: selectedRole === item.title ? colors.primary : colors.border },
                  selectedRole === item.title && { backgroundColor: colors.accent },
                ]}
                onPress={() => {
                  setSelectedRole(item.title);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={styles.roleCardLeft}>
                  <Text style={[styles.roleTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <View style={styles.roleMetaRow}>
                    <DemandBadge demand={item.demand} colors={colors} />
                    <Text style={[styles.roleCount, { color: colors.mutedForeground }]}>
                      {item.count.toLocaleString()} openings
                    </Text>
                  </View>
                </View>
                {selectedRole === item.title
                  ? <CheckCircle size={22} color={colors.primary} />
                  : <ChevronRight size={20} color={colors.mutedForeground} />
                }
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No roles match your search.</Text>
              </View>
            }
          />
          <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: selectedRole ? colors.primary : colors.muted, opacity: loading ? 0.7 : 1 }]}
              onPress={handleFinish}
              disabled={!selectedRole || loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Text style={[styles.nextBtnText, { color: selectedRole ? "#fff" : colors.mutedForeground }]}>
                      Complete Profile
                    </Text>
                    <BriefcaseBusiness size={18} color={selectedRole ? "#fff" : colors.mutedForeground} />
                  </>
              }
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 12 },
  topBarInner: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  backBtnPlaceholder: { width: 40 },
  stepInfo: { flex: 1, alignItems: "center" },
  stepLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 2 },
  stepTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  progressBarTrack: { height: 4, borderRadius: 2, marginHorizontal: 24, overflow: "hidden" },
  progressBarFill: { height: 4, borderRadius: 2 },
  stepContainer: { flex: 1 },
  stepScroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 },
  stepDesc: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20, marginBottom: 20 },
  optionCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 14, borderWidth: 1.5, marginBottom: 10, gap: 12 },
  optionIcon: { fontSize: 24, width: 32, textAlign: "center" },
  optionLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  levelInfo: { flex: 1 },
  levelSub: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  otherInput: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 8, marginBottom: 8, minHeight: 80 },
  otherInputText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  nextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
  nextBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  roleHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4 },
  statsText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  roleList: { paddingHorizontal: 20, paddingBottom: 20 },
  roleCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 14, borderWidth: 1.5, marginBottom: 10, gap: 12 },
  roleCardLeft: { flex: 1 },
  roleTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  roleMetaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  demandBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  demandDot: { width: 6, height: 6, borderRadius: 3 },
  demandText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  roleCount: { fontSize: 12, fontFamily: "Inter_500Medium" },
  emptyState: { alignItems: "center", paddingVertical: 32 },
  emptyText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
