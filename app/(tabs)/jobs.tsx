import { Search, ArrowLeft, AlertCircle, Edit2, Check, Map, Clock, DollarSign, MapPin, Wifi, RefreshCw, ExternalLink, Send, Link, SlidersHorizontal, X, ShieldCheck, Star } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MatchBadge } from "@/components/MatchBadge";
import { useJobs, type JobListing } from "@/context/JobsContext";
import { useRoadmap } from "@/context/RoadmapContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { JOB_PLATFORMS, PLATFORM_CATEGORY_LABELS, BD_LOCATIONS, JOB_TYPES, JOB_EXPERIENCE_LEVELS, PlatformCategory } from "@/constants/jobPlatforms";

const PLATFORM_CATEGORIES: PlatformCategory[] = ["general", "blue-collar", "international"];

export default function JobsScreen() {
  const colors = useColors() as any;
  const jobsColor = colors.jobs || colors.primary;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    jobs,
    getMatch,
    generateCoverLetter,
    lastUpdated,
    appliedJobIds,
    markApplied,
    enabledPlatformIds,
    togglePlatform,
    setAllPlatformsEnabled,
    filters,
    setFilters,
    resetFilters,
  } = useJobs();
  const { generateRoadmap } = useRoadmap();
  const [search, setSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const filtered = jobs.filter((j) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      j.title.toLowerCase().includes(q) ||
      j.company.toLowerCase().includes(q) ||
      j.platformName.toLowerCase().includes(q) ||
      j.requiredSkills.some((s) => s.toLowerCase().includes(q))
    );
  });

  const activeFilterCount =
    (filters.location ? 1 : 0) +
    (filters.jobType ? 1 : 0) +
    (filters.experienceLevel ? 1 : 0) +
    (enabledPlatformIds.length < JOB_PLATFORMS.length ? 1 : 0);

  const handleGenerate = async (job: JobListing) => {
    setGeneratingId(job.id);
    try {
      const match = await generateCoverLetter(job);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await generateRoadmap(match.gapAnalysis, user?.targetRole || job.title, user?.experienceLevel);
      setSelectedJob(job);
    } catch {
      Alert.alert("Error", "Could not generate cover letter. Try again.");
    } finally {
      setGeneratingId(null);
    }
  };

  const openPlatform = (job: JobListing) => {
    Linking.openURL(job.originalUrl).catch(() => {
      Alert.alert(
        "Couldn't open link",
        `${job.platformName} may be unavailable right now. This posting was aggregated from ${job.platformName} — try again shortly or search for "${job.title}" directly on their site.`
      );
    });
  };

  const handleApplyNow = (job: JobListing) => {
    Alert.alert(
      "Apply to " + job.company,
      `You're about to open the job posting for "${job.title}" on ${job.platformName}. Ready?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open & Apply",
          onPress: async () => {
            await markApplied(job.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            openPlatform(job);
          },
        },
      ]
    );
  };

  const renderFilterChipRow = (label: string, options: string[], value: string | null, onSelect: (v: string | null) => void) => (
    <View style={{ marginBottom: 20 }}>
      <Text style={[styles.filterLabel, { color: colors.foreground }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <TouchableOpacity
          style={[styles.filterChip, { borderColor: !value ? jobsColor : colors.border, backgroundColor: !value ? jobsColor + "15" : "transparent" }]}
          onPress={() => onSelect(null)}
        >
          <Text style={[styles.filterChipText, { color: !value ? jobsColor : colors.mutedForeground }]}>All</Text>
        </TouchableOpacity>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[styles.filterChip, { borderColor: value === opt ? jobsColor : colors.border, backgroundColor: value === opt ? jobsColor + "15" : "transparent" }]}
            onPress={() => onSelect(value === opt ? null : opt)}
          >
            <Text style={[styles.filterChipText, { color: value === opt ? jobsColor : colors.mutedForeground }]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const FiltersModal = (
    <Modal visible={filtersOpen} animationType="slide" transparent onRequestClose={() => setFiltersOpen(false)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background, paddingBottom: bottomPad + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Filters & Job Sources</Text>
            <TouchableOpacity onPress={() => setFiltersOpen(false)}>
              <X size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {renderFilterChipRow("Location", BD_LOCATIONS, filters.location, (v) => setFilters({ location: v }))}
            {renderFilterChipRow("Job Type", JOB_TYPES, filters.jobType, (v) => setFilters({ jobType: v }))}
            {renderFilterChipRow("Experience Level", JOB_EXPERIENCE_LEVELS, filters.experienceLevel, (v) => setFilters({ experienceLevel: v }))}

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text style={[styles.filterLabel, { color: colors.foreground, marginBottom: 0 }]}>Job Sources</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity onPress={() => setAllPlatformsEnabled(true)}>
                  <Text style={[styles.linkAction, { color: jobsColor }]}>All On</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAllPlatformsEnabled(false)}>
                  <Text style={[styles.linkAction, { color: colors.mutedForeground }]}>All Off</Text>
                </TouchableOpacity>
              </View>
            </View>

            {PLATFORM_CATEGORIES.map((cat) => (
              <View key={cat} style={{ marginBottom: 14 }}>
                <Text style={[styles.platformCategoryLabel, { color: colors.mutedForeground }]}>{PLATFORM_CATEGORY_LABELS[cat]}</Text>
                {JOB_PLATFORMS.filter((p) => p.category === cat).map((platform) => {
                  const enabled = enabledPlatformIds.includes(platform.id);
                  return (
                    <TouchableOpacity
                      key={platform.id}
                      style={[styles.platformRow, { borderColor: colors.border, backgroundColor: enabled ? jobsColor + "0d" : "transparent" }]}
                      onPress={() => togglePlatform(platform.id)}
                    >
                      <Text style={styles.platformIcon}>{platform.icon}</Text>
                      <Text style={[styles.platformName, { color: colors.foreground }]}>{platform.name}</Text>
                      <View style={[styles.toggleTrack, { backgroundColor: enabled ? jobsColor : colors.border }]}>
                        <View style={[styles.toggleThumb, { alignSelf: enabled ? "flex-end" : "flex-start", backgroundColor: "#fff" }]} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            <TouchableOpacity
              style={[styles.resetBtn, { borderColor: colors.border }]}
              onPress={() => { resetFilters(); setAllPlatformsEnabled(true); }}
            >
              <Text style={[styles.resetBtnText, { color: colors.mutedForeground }]}>Reset All Filters</Text>
            </TouchableOpacity>
          </ScrollView>
          <TouchableOpacity style={[styles.applyFiltersBtn, { backgroundColor: jobsColor }]} onPress={() => setFiltersOpen(false)}>
            <Text style={styles.applyNowText}>Show {filtered.length} Jobs</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (selectedJob) {
    const match = getMatch(selectedJob.id);
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity onPress={() => setSelectedJob(null)} style={styles.backBtn}>
            <ArrowLeft size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Cover Letter</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: bottomPad + 100 }}
          showsVerticalScrollIndicator={false}
        >
              <View style={[styles.jobCardDetail, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.platformBadgeRow}>
                  <Text style={styles.platformIcon}>{selectedJob.platformIcon}</Text>
                  <Text style={[styles.platformBadgeText, { color: colors.mutedForeground }]}>{selectedJob.platformName}</Text>
                  {selectedJob.verified && (
                    <View style={[styles.verifiedChip, { backgroundColor: colors.success + "15" }]}>
                      <ShieldCheck size={11} color={colors.success} />
                      <Text style={[styles.verifiedChipText, { color: colors.success }]}>Verified</Text>
                    </View>
                  )}
                  {selectedJob.topCompany && (
                    <View style={[styles.verifiedChip, { backgroundColor: colors.warning + "15" }]}>
                      <Star size={11} color={colors.warning} />
                      <Text style={[styles.verifiedChipText, { color: colors.warning }]}>Top Employer</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.jobTitleDetail, { color: colors.foreground }]}>{selectedJob.title}</Text>
                <Text style={[styles.jobCompanyDetail, { color: jobsColor }]}>{selectedJob.company}</Text>
                <View style={styles.detailMeta}>
                  <View style={styles.metaChip}>
                    <MapPin size={13} color={colors.mutedForeground} />
                    <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>{selectedJob.location}</Text>
                  </View>
                  <View style={styles.metaChip}>
                    <DollarSign size={13} color={colors.mutedForeground} />
                    <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>{selectedJob.salary}</Text>
                  </View>
                </View>
                <View style={{ alignSelf: "flex-start", marginTop: 12, marginBottom: 16 }}>
                  <MatchBadge score={selectedJob.matchScore} />
                </View>
                <View style={styles.applyRow}>
                  <TouchableOpacity
                    style={[styles.applyNowBtn, { backgroundColor: jobsColor }]}
                    onPress={() => handleApplyNow(selectedJob)}
                  >
                    <Send size={16} color="#fff" />
                    <Text style={styles.applyNowText}>Apply Now</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.sourceLinkRow}
                  onPress={() => openPlatform(selectedJob)}
                >
                  <Link size={12} color={colors.mutedForeground} />
                  <Text style={[styles.sourceLinkText, { color: colors.mutedForeground }]}>
                    View on {selectedJob.platformName}
                  </Text>
                  <ExternalLink size={12} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {match?.gapAnalysis.length ? (
                <>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Skills to Develop</Text>
                  {match.gapAnalysis.map((g, i) => (
                    <View key={i} style={[styles.gapRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={[styles.gapIconWrap, { backgroundColor: colors.warning + "15" }]}>
                        <AlertCircle size={18} color={colors.warning} />
                      </View>
                      <Text style={[styles.gapText, { color: colors.foreground }]}>{g}</Text>
                    </View>
                  ))}
                </>
              ) : null}

              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Generated Cover Letter</Text>
              <View style={[styles.coverBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.coverText, { color: colors.foreground }]}>{match?.coverLetter}</Text>
              </View>
              <TouchableOpacity
                style={[styles.roadmapBtn, { backgroundColor: jobsColor + "15", borderColor: jobsColor + "30" }]}
                onPress={() => { setSelectedJob(null); router.push("/(tabs)/roadmap"); }}
              >
                <Map size={20} color={jobsColor} />
                <Text style={[styles.roadmapBtnText, { color: jobsColor }]}>View Upskilling Roadmap</Text>
              </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.headerWrap, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Job Matches</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {user?.targetRole ? `Tailored for ${user.targetRole} · ${enabledPlatformIds.length} sources` : "Set a target role for better matches"}
            </Text>
          </View>
          <View style={[styles.updateBadge, { backgroundColor: colors.secondary }]}>
            <RefreshCw size={11} color={colors.mutedForeground} />
            <Text style={[styles.updateText, { color: colors.mutedForeground }]}>{lastUpdated}</Text>
          </View>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
          <Search size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search jobs, companies, platforms…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal size={18} color={colors.foreground} />
          {activeFilterCount > 0 && (
            <View style={[styles.filterCountBadge, { backgroundColor: jobsColor }]}>
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: bottomPad + 100 }}
        renderItem={({ item }) => {
          const match = getMatch(item.id);
          const isApplied = appliedJobIds.includes(item.id);
          return (
            <View style={[styles.jobCard, { backgroundColor: colors.card, borderColor: isApplied ? colors.success + "50" : colors.border }]}>
              <View style={styles.platformBadgeRow}>
                <Text style={styles.platformIcon}>{item.platformIcon}</Text>
                <Text style={[styles.platformBadgeText, { color: colors.mutedForeground }]}>{item.platformName}</Text>
                {item.verified && (
                  <View style={[styles.verifiedChip, { backgroundColor: colors.success + "15" }]}>
                    <ShieldCheck size={10} color={colors.success} />
                    <Text style={[styles.verifiedChipText, { color: colors.success }]}>Verified</Text>
                  </View>
                )}
                {item.topCompany && (
                  <View style={[styles.verifiedChip, { backgroundColor: colors.warning + "15" }]}>
                    <Star size={10} color={colors.warning} />
                    <Text style={[styles.verifiedChipText, { color: colors.warning }]}>Top</Text>
                  </View>
                )}
              </View>
              <View style={styles.jobTop}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.jobTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.jobCompany, { color: jobsColor }]}>{item.company}</Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaChip}>
                      <MapPin size={12} color={colors.mutedForeground} />
                      <Text style={[styles.metaChipText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.location}</Text>
                    </View>
                    {item.remote && (
                      <View style={[styles.remoteBadge, { backgroundColor: colors.success + "15" }]}>
                        <Wifi size={11} color={colors.success} />
                        <Text style={[styles.remoteBadgeText, { color: colors.success }]}>Remote</Text>
                      </View>
                    )}
                    {isApplied && (
                      <View style={[styles.remoteBadge, { backgroundColor: colors.primary + "15" }]}>
                        <Check size={11} color={colors.primary} />
                        <Text style={[styles.remoteBadgeText, { color: colors.primary }]}>Applied</Text>
                      </View>
                    )}
                  </View>
                </View>
                <MatchBadge score={item.matchScore} />
              </View>

              <View style={styles.salaryRow}>
                <View style={[styles.salaryChip, { backgroundColor: colors.secondary }]}>
                  <DollarSign size={13} color={colors.foreground} />
                  <Text style={[styles.salaryText, { color: colors.foreground }]}>{item.salary}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Clock size={12} color={colors.mutedForeground} />
                  <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>{item.postedAt}</Text>
                </View>
                <View style={[styles.jobTypeChip, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.jobTypeChipText, { color: colors.mutedForeground }]}>{item.jobType} · {item.experienceLevel}</Text>
                </View>
              </View>

              <Text style={[styles.jobDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                {item.description}
              </Text>

              <View style={styles.skillsRow}>
                {item.requiredSkills.slice(0, 4).map((s) => (
                  <View key={s} style={[styles.skillChip, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.skillText, { color: colors.foreground }]}>{s}</Text>
                  </View>
                ))}
                {item.requiredSkills.length > 4 && (
                  <View style={[styles.skillChip, { borderWidth: 1, borderColor: colors.border, backgroundColor: "transparent" }]}>
                    <Text style={[styles.skillText, { color: colors.mutedForeground }]}>+{item.requiredSkills.length - 4}</Text>
                  </View>
                )}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.applyNowBtnCard, { backgroundColor: jobsColor, flex: 1 }]}
                  onPress={() => handleApplyNow(item)}
                >
                  <Send size={15} color="#fff" />
                  <Text style={styles.applyNowText}>Apply Now</Text>
                  <ExternalLink size={13} color="rgba(255,255,255,0.7)" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.coverBtnSmall,
                    match
                      ? { backgroundColor: colors.success + "15", borderWidth: 1, borderColor: colors.success + "30" }
                      : { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border },
                  ]}
                  onPress={() => match ? setSelectedJob(item) : handleGenerate(item)}
                  disabled={generatingId === item.id}
                >
                  {generatingId === item.id ? (
                    <ActivityIndicator color={jobsColor} size="small" />
                  ) : (
                    <>
                      {match ? <Check size={15} color={colors.success} /> : <Edit2 size={15} color={colors.foreground} />}
                      <Text style={[styles.coverBtnSmallText, { color: match ? colors.success : colors.foreground }]}>
                        {match ? "Cover Letter" : "Cover Letter"}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.sourceLinkRow}
                onPress={() => openPlatform(item)}
              >
                <Link size={11} color={colors.mutedForeground} />
                <Text style={[styles.sourceLinkText, { color: colors.mutedForeground }]}>
                  View on {item.platformName}
                </Text>
                <ExternalLink size={11} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {enabledPlatformIds.length === 0
                ? "No job sources enabled"
                : user?.targetRole
                ? `No jobs found for ${user.targetRole}`
                : "No jobs found"}
            </Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              {enabledPlatformIds.length === 0
                ? "Turn on at least one job source in Filters to see listings."
                : user?.targetRole
                ? `Try adjusting your filters, enabling more job sources, or updating your target role.`
                : "Update your target role in Profile for tailored job matches."}
            </Text>
          </View>
        }
      />
      {FiltersModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerWrap: { paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSub: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 3 },
  updateBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  updateText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  backBtn: { marginRight: 16 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 24, marginVertical: 16 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  filterBtn: { width: 50, height: 50, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  filterCountBadge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  filterCountText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  jobCard: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  jobCardDetail: { borderRadius: 20, padding: 24, borderWidth: 1, marginBottom: 24 },
  platformBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" },
  platformIcon: { fontSize: 14 },
  platformBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  verifiedChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  verifiedChipText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  jobTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  jobTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 3, letterSpacing: -0.3 },
  jobTitleDetail: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 6, letterSpacing: -0.5 },
  jobCompany: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  jobCompanyDetail: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  detailMeta: { flexDirection: "row", gap: 12, marginTop: 8 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  remoteBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  remoteBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  salaryRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  salaryChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  salaryText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  jobTypeChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  jobTypeChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  jobDesc: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, marginBottom: 14 },
  skillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  skillChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  skillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  applyNowBtnCard: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingVertical: 13, borderRadius: 12 },
  applyNowBtn: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12 },
  applyNowText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 },
  coverBtnSmall: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingVertical: 13, borderRadius: 12, paddingHorizontal: 14 },
  coverBtnSmallText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  applyRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  sourceLinkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  sourceLinkText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 16, marginTop: 8, letterSpacing: -0.5 },
  gapRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  gapIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  gapText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  coverBox: { borderRadius: 20, padding: 24, borderWidth: 1, marginBottom: 24 },
  coverText: { fontSize: 15, fontFamily: "Inter_500Medium", lineHeight: 26 },
  roadmapBtn: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", paddingVertical: 16, borderRadius: 16, borderWidth: 1 },
  roadmapBtnText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  emptyState: { borderRadius: 20, padding: 32, borderWidth: 1, alignItems: "center", marginTop: 16 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 18, marginBottom: 8 },
  emptySub: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center", lineHeight: 22 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 20, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 19, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  filterLabel: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 10 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  linkAction: { fontSize: 13, fontFamily: "Inter_700Bold" },
  platformCategoryLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  platformRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  platformName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, padding: 2, justifyContent: "center" },
  toggleThumb: { width: 18, height: 18, borderRadius: 9 },
  resetBtn: { alignItems: "center", paddingVertical: 14, borderRadius: 14, borderWidth: 1, marginTop: 8 },
  resetBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  applyFiltersBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 16, borderRadius: 16, marginTop: 12 },
});
