import { Edit2, X, LogOut, Check, Camera, Trash2, AlertTriangle, ChevronDown, ShieldCheck, ChevronRight, Briefcase, FileText, Map } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  FlatList,
  Image,
  Modal,
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
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/alert";

const BACKGROUND_OPTIONS = [
  "Computer Science / IT",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Business / Marketing",
  "Chartered Accountancy / Finance",
  "Other",
];

const EXPERIENCE_OPTIONS = ["Student", "Entry Level", "Mid Level", "Senior", "Lead"];

const CS_IT_ROLES = [
  "Android Developer","Associate Software Engineer","Backend Developer",
  "Cloud Architect","Cloud Engineer","Data Analyst","Data Engineer",
  "Data Scientist","DevOps Engineer","Frontend Developer","Full Stack Developer",
  "Full Stack Engineer","Go Developer","Infrastructure Engineer","IoT Developer",
  "IT Support Specialist","iOS Developer","Java Developer","Junior Python Developer",
  "Junior React Developer","Lead Software Engineer","Machine Learning Engineer",
  "Mobile Developer","Node.js Developer","Platform Engineer","Principal Engineer",
  "Product Manager","Python Developer","QA Engineer","QA Tester","React Developer",
  "React Native Developer","Rust Developer","Security Engineer","Senior Data Scientist",
  "Senior DevOps Engineer","Senior Full Stack Engineer","Senior React Developer",
  "Senior Software Engineer","Site Reliability Engineer","Software Engineer",
  "Software Trainee","Solutions Architect","Technical Architect","TypeScript Developer",
  "UI/UX Designer","VP of Engineering",
].sort();

const EE_ROLES = [
  "Electrical Engineer","Power Systems Engineer","Control Systems Engineer",
  "Electronics Engineer","Automation Engineer","Embedded Systems Engineer",
  "Firmware Engineer","PCB Design Engineer",
].sort();

const ME_ROLES = [
  "Mechanical Engineer","CAD Designer","CAD Engineer","HVAC Engineer",
  "Manufacturing Engineer","Robotics Engineer","Automotive Engineer",
  "Mechanical Design Engineer",
].sort();

const CE_ROLES = [
  "Civil Engineer","Structural Engineer","Senior Structural Engineer",
  "Project Manager","Project Engineer","Site Engineer",
  "Transportation Engineer","Quantity Surveyor",
].sort();

const BIZ_ROLES = [
  "Marketing Manager","Digital Marketing Specialist","Business Analyst",
  "Sales Manager","Brand Strategist","SEO Specialist","Content Marketing Manager",
  "Digital Marketing Lead","Growth Manager","Head of Marketing","HR Manager",
  "Product Marketing Manager","Social Media Manager","VP of Marketing",
].sort();

const FINANCE_ROLES = [
  "Accountant","Financial Analyst","Auditor","Tax Consultant",
  "Investment Banking Analyst","Risk Manager","Audit Associate",
  "CFO / Finance Director","Finance Manager","Financial Controller",
  "Investment Analyst","Senior Accountant","Senior Finance Manager",
].sort();

const ALL_TARGET_ROLES = Array.from(
  new Set([...CS_IT_ROLES, ...EE_ROLES, ...ME_ROLES, ...CE_ROLES, ...BIZ_ROLES, ...FINANCE_ROLES])
).sort();

const BACKGROUND_TO_ROLES: Record<string, string[]> = {
  "Computer Science / IT": CS_IT_ROLES,
  "Electrical Engineering": EE_ROLES,
  "Mechanical Engineering": ME_ROLES,
  "Civil Engineering": CE_ROLES,
  "Business / Marketing": BIZ_ROLES,
  "Chartered Accountancy / Finance": FINANCE_ROLES,
  "Other": ALL_TARGET_ROLES,
};

function getRolesForBackground(background: string): string[] {
  return BACKGROUND_TO_ROLES[background] || ALL_TARGET_ROLES;
}

type PickerModalProps = {
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (item: string) => void;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
};

function PickerModal({ visible, title, options, selected, onSelect, onClose, colors }: PickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <TouchableOpacity style={{ ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, maxHeight: "80%" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 16 }} />
          <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground, paddingHorizontal: 20, marginBottom: 12 }}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(item) => item}
            style={{ maxHeight: 380 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: item === selected ? colors.accent : "transparent" }}
                onPress={() => { onSelect(item); onClose(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <Text style={{ flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground }}>{item}</Text>
                {item === selected && <Check size={18} color={colors.primary} strokeWidth={3} />}
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity style={{ paddingVertical: 18, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 }} onPress={onClose}>
            <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function ProfileScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, updateUser, addTargetRole, removeTargetRole, setActiveRole } = useAuth();
  const { cvProfile, clearCV } = useCV();
  const { appliedJobIds } = useJobs();
  const { roadmap, clearRoadmap } = useRoadmap();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [targetRole, setTargetRole] = useState(user?.targetRole || "");
  const [expLevel, setExpLevel] = useState(user?.experienceLevel || "");
  const [background, setBackground] = useState(user?.background || "");
  const [activePicker, setActivePicker] = useState<"background" | "level" | "role" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ background?: boolean; targetRole?: boolean }>({});
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const completedModules = roadmap?.modules.filter((m) => m.completed).length ?? 0;
  const totalModules = roadmap?.modules.length ?? 0;

  const availableRoles = background ? getRolesForBackground(background) : [];

  const handleBackgroundSelect = (newBackground: string) => {
    if (newBackground === background) return;

    if (!background || !targetRole) {
      setBackground(newBackground);
      setTargetRole("");
      setFieldErrors({});
      return;
    }

    showAlert(
      "Change Background?",
      `Changing your background will reset your target role. You must select a new target role related to "${newBackground}".`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            setBackground(newBackground);
            setTargetRole("");
            setFieldErrors({});
          },
        },
      ]
    );
  };

  const handleOpenRolePicker = () => {
    if (!background) {
      showAlert("Select Background First", "Please select your background before choosing a target role.");
      return;
    }
    setActivePicker("role");
  };

  const handleSave = async () => {
    const errors: { background?: boolean; targetRole?: boolean } = {};
    if (!background) errors.background = true;
    if (!targetRole) errors.targetRole = true;

    if (!errors.background && !errors.targetRole && background !== "Other") {
      const allowedRoles = getRolesForBackground(background);
      if (!allowedRoles.includes(targetRole)) {
        errors.background = true;
        errors.targetRole = true;
      }
    }

    if (errors.background || errors.targetRole) {
      setFieldErrors(errors);
      showAlert("Cannot Save Profile", "Target role must be related to your selected background.");
      return;
    }
    setFieldErrors({});

    const roleChanged = targetRole !== user?.targetRole && targetRole.trim() !== "";
    if (roleChanged) {
      // Adding rather than replacing. Roadmaps, CV analyses and matches are
      // stored per role, so the previous role's work is untouched and is still
      // there when the user switches back — where this used to delete all of it.
      showAlert(
        "Add target role",
        `Add "${targetRole}" and switch to it?\n\nYour "${user?.targetRole}" roadmap, CV analysis and job matches are kept — switch back any time.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Add & switch",
            onPress: async () => {
              await updateUser({ name, experienceLevel: expLevel, background });
              await addTargetRole(targetRole);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setEditing(false);
            },
          },
        ]
      );
      return;
    }
    await updateUser({ name, targetRole, experienceLevel: expLevel, background });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditing(false);
  };

  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showAlert("Permission Required", "Please allow access to your photo library."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8, allowsMultipleSelection: false });
    if (!result.canceled && result.assets[0]) { await updateUser({ photoUri: result.assets[0].uri }); }
  };

  const handleSignOut = () => {
    showAlert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  };

  const cancelEdit = () => {
    setName(user?.name || "");
    setTargetRole(user?.targetRole || "");
    setExpLevel(user?.experienceLevel || "");
    setBackground(user?.background || "");
    setFieldErrors({});
    setEditing(false);
  };

  const initials = (user?.name || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const DropField = ({ label, value, placeholder, onPress, error }: any) => (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {editing ? (
        <TouchableOpacity
          style={[
            styles.dropdownBtn,
            { backgroundColor: colors.background, borderColor: error ? colors.destructive : colors.border },
            error && { borderWidth: 1.5 },
          ]}
          onPress={onPress}
        >
          <Text style={[styles.dropdownBtnText, { color: value ? colors.foreground : colors.mutedForeground }]}>{value || placeholder}</Text>
          <ChevronDown size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      ) : (
        <Text style={[styles.fieldValue, { color: colors.foreground }]}>{value || "—"}</Text>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <PickerModal visible={activePicker === "background"} title="Professional Background" options={BACKGROUND_OPTIONS} selected={background} onSelect={handleBackgroundSelect} onClose={() => setActivePicker(null)} colors={colors} />
      <PickerModal visible={activePicker === "level"} title="Experience Level" options={EXPERIENCE_OPTIONS} selected={expLevel} onSelect={setExpLevel} onClose={() => setActivePicker(null)} colors={colors} />
      <PickerModal
        visible={activePicker === "role"}
        title={background ? `Target Role for ${background}` : "Target Role"}
        options={availableRoles}
        selected={targetRole}
        onSelect={setTargetRole}
        onClose={() => setActivePicker(null)}
        colors={colors}
      />

      <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <LinearGradient
          colors={[(colors.primary || "#2563eb") + "18", colors.card, colors.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        />
        <View style={[styles.headerBlob, styles.headerBlobOne, { backgroundColor: (colors.primary || "#2563eb") + "18" }]} />
        <View style={[styles.headerBlob, styles.headerBlobTwo, { backgroundColor: colors.accent + "40" }]} />
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
        <TouchableOpacity style={[styles.editBtn, { backgroundColor: editing ? colors.muted : colors.accent }]} onPress={() => editing ? cancelEdit() : setEditing(true)}>
          {editing ? <X size={18} color={colors.destructive} /> : <Edit2 size={18} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: bottomPad + 100 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(500).springify().damping(14)} style={styles.avatarSection}>
          <LinearGradient
            colors={[colors.primary, (colors.jobs || "#7c3aed")]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          >
            {user?.photoUri
              ? <Image source={{ uri: user.photoUri }} style={styles.avatarImage} />
              : <View style={[styles.avatar, { backgroundColor: colors.card }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text></View>
            }
          </LinearGradient>
          {editing ? (
            <TouchableOpacity style={[styles.photoBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={handlePickPhoto}>
              <Camera size={16} color={colors.primary} />
              <Text style={[styles.photoBtnText, { color: colors.primary }]}>Change Photo</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={[styles.displayName, { color: colors.foreground }]}>{user?.name}</Text>
              <Text style={[styles.displayEmail, { color: colors.mutedForeground }]}>{user?.email}</Text>
            </>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(80).springify().damping(14)} style={styles.statsGrid}>
          {[
            { label: "Jobs Applied", value: String(appliedJobIds.length), color: colors.jobs || "#7c3aed", icon: Briefcase },
            { label: "CV Score", value: cvProfile ? `${cvProfile.atsScore}` : "—", color: colors.cv || "#0891b2", icon: FileText },
            { label: "Weeks Done", value: `${completedModules}/${totalModules || 12}`, color: colors.roadmap || "#059669", icon: Map },
          ].map((s) => (
            <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.statIconWrap, { backgroundColor: s.color + "15" }]}>
                <s.icon size={14} color={s.color} strokeWidth={2.5} />
              </View>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]} numberOfLines={1}>{s.label}</Text>
            </View>
          ))}
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(140).springify().damping(14)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Career Profile</Text>
          <DropField label="Background" value={background} placeholder="Select background" onPress={() => setActivePicker("background")} error={fieldErrors.background} />
          <DropField
            label="Experience Level"
            value={expLevel}
            placeholder="Select level"
            onPress={() => setActivePicker("level")}
          />
          <DropField
            label="Target Role"
            value={targetRole}
            placeholder={background ? `Select target role for ${background}` : "Select background first"}
            onPress={handleOpenRolePicker}
            error={fieldErrors.targetRole}
          />
          {editing && (
            <View style={[styles.warningBanner, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "30" }]}>
              <AlertTriangle size={14} color={colors.warning} />
              <Text style={[styles.warningText, { color: colors.warning }]}>
                {background
                  ? `Only ${background} roles are shown. Changing background resets target role.`
                  : "Select a background to see relevant target roles."}
              </Text>
            </View>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(200).springify().damping(14)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Account</Text>
          <View style={[styles.fieldRow, { marginBottom: 0 }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email</Text>
            <Text style={[styles.fieldValue, { color: colors.foreground }]}>{user?.email || "—"}</Text>
          </View>
        </Animated.View>

        {editing && (
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary, shadowColor: colors.primary }]} onPress={handleSave} activeOpacity={0.88}>
            <Check size={20} color="#fff" strokeWidth={3} />
            <Text style={styles.saveBtnText}>Save Changes</Text>
          </TouchableOpacity>
        )}

        <Animated.View entering={FadeInDown.duration(500).delay(260).springify().damping(14)}>
          <TouchableOpacity
            style={[styles.securityRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push("/auth-security")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Security & Privacy settings"
          >
            <View style={[styles.securityIcon, { backgroundColor: colors.primary + "18" }]}>
              <ShieldCheck size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.securityTitle, { color: colors.foreground }]}>Security & Privacy</Text>
              <Text style={[styles.securitySubtitle, { color: colors.mutedForeground }]}>
                2FA, biometrics, backup codes, data export
              </Text>
            </View>
            <ChevronRight size={20} color={colors.mutedForeground} />
          </TouchableOpacity>

          {(user?.targetRoles?.length ?? 0) > 0 && (
            <View style={[styles.rolesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.rolesTitle, { color: colors.foreground }]}>Target roles</Text>
              <Text style={[styles.rolesHint, { color: colors.mutedForeground }]}>
                Each role keeps its own roadmap, CV analysis and job matches.
              </Text>
              {user!.targetRoles.map((role) => {
                const active = role.id === user!.activeRoleId;
                return (
                  <View key={role.id} style={[styles.roleRow, { borderColor: colors.border }]}>
                    <TouchableOpacity
                      style={styles.roleRowMain}
                      onPress={() => !active && setActiveRole(role.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${role.title}${active ? ", showing" : ", switch to this role"}`}
                    >
                      <View style={[styles.roleDot, { backgroundColor: active ? colors.primary : colors.border }]} />
                      <Text style={[styles.roleTitle, { color: colors.foreground }]} numberOfLines={1}>{role.title}</Text>
                      {active && (
                        <Text style={[styles.roleActive, { color: colors.primary }]}>Showing</Text>
                      )}
                    </TouchableOpacity>
                    {user!.targetRoles.length > 1 && (
                      <TouchableOpacity
                        hitSlop={8}
                        onPress={() =>
                          showAlert(
                            "Remove role",
                            `Remove "${role.title}"? Its roadmap, CV analysis and job matches are deleted.`,
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Remove", style: "destructive", onPress: () => removeTargetRole(role.id) },
                            ],
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${role.title}`}
                      >
                        <X size={17} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <TouchableOpacity style={[styles.signOutBtn, { borderColor: colors.destructive, backgroundColor: colors.card }]} onPress={handleSignOut} activeOpacity={0.85}>
            <LogOut size={20} color={colors.destructive} />
            <Text style={[styles.signOutText, { color: colors.destructive }]}>Sign Out</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rolesCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  rolesTitle: { fontFamily: "Inter_700Bold", fontSize: 16 },
  rolesHint: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, marginTop: 3, marginBottom: 12 },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: 1 },
  roleRowMain: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  roleDot: { width: 9, height: 9, borderRadius: 5 },
  roleTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14.5, flex: 1 },
  roleActive: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, position: "relative", overflow: "hidden" },
  headerGradient: { ...StyleSheet.absoluteFillObject },
  headerBlob: { position: "absolute", borderRadius: 999 },
  headerBlobOne: { width: 140, height: 140, right: -30, top: 10 },
  headerBlobTwo: { width: 96, height: 96, left: -20, top: 54 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  editBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatarRing: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center", marginBottom: 12, padding: 3, shadowColor: "#2563eb", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
  avatar: { width: "100%", height: "100%", borderRadius: 47, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: "100%", height: "100%", borderRadius: 47 },
  avatarText: { fontSize: 36, fontFamily: "Inter_700Bold" },
  photoBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  photoBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  displayName: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  displayEmail: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 4 },
  statsGrid: { flexDirection: "row", gap: 10, marginBottom: 20 },
  statCard: { flex: 1, borderRadius: 16, padding: 12, borderWidth: 1, alignItems: "center", gap: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  statIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  card: { borderRadius: 24, padding: 24, borderWidth: 1, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  cardTitle: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 1, marginBottom: 20 },
  fieldRow: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  fieldValue: { fontSize: 16, fontFamily: "Inter_500Medium" },
  dropdownBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.04)" },
  dropdownBtnText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  warningBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 18 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.4 },
  statLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10, textAlign: "center", letterSpacing: 0.4, textTransform: "uppercase" },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", paddingVertical: 18, borderRadius: 16, marginBottom: 16, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 4 },
  saveBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 20, borderWidth: 1, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  securityIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  securityTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  securitySubtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  signOutBtn: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", paddingVertical: 16, borderRadius: 16, borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  signOutText: { fontFamily: "Inter_700Bold", fontSize: 16 },
});
