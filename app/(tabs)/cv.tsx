/**
 * CV Engine — slices 1 and 2: upload, extract, and record the source format.
 *
 * Upload deliberately does not commit the CV. The file is extracted, then the
 * user is asked which format it was written in, and only then is it saved:
 * scoring depends on the format, so committing first would mean scoring against
 * an assumption.
 *
 * Re-uploading is available from every state, not just the empty one.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useCV, CV_FORMATS } from "@/context/CVContext";

export default function CVScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const {
    cv, pending, isLoading, isUploading, error,
    pickAndExtract, confirmFormat, discardPending, clearError,
  } = useCV();

  const accent = colors.cv || colors.primary;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [choice, setChoice] = useState<string | null>(null);
  const [otherFormat, setOtherFormat] = useState("");

  const upload = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setChoice(null);
    setOtherFormat("");
    await pickAndExtract();
  };

  const confirm = async () => {
    const format = choice === "Other" ? otherFormat.trim() : (choice ?? "");
    if (!format) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await confirmFormat(format);
    setChoice(null);
    setOtherFormat("");
  };

  const canConfirm = choice === "Other" ? otherFormat.trim().length > 0 : !!choice;

  const UploadButton = ({ label }: { label: string }) => (
    <Pressable
      onPress={upload}
      disabled={isUploading}
      style={({ pressed }) => [styles.cta, { backgroundColor: accent, opacity: pressed || isUploading ? 0.8 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {isUploading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <>
          <Feather name="upload" size={16} color="#fff" />
          <Text style={styles.ctaText}>{label}</Text>
        </>
      )}
    </Pressable>
  );

  const body = () => {
    if (isLoading) {
      return <View style={styles.centred}><ActivityIndicator size="large" color={accent} /></View>;
    }

    // Step 2 — the format question, shown once a file has been read.
    if (pending) {
      return (
        <View style={{ gap: 14 }}>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.fileRow}>
              <Feather name={pending.kind === "pdf" ? "file-text" : "file"} size={18} color={accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{pending.fileName}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {(pending.chars ?? 0).toLocaleString()} characters read
                </Text>
              </View>
              <Feather name="check-circle" size={18} color={colors.success || "#16a34a"} />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
            <View style={{ gap: 4 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Which format is this CV written in?</Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                Scoring differs by format, so this is scored against the right standard rather than a guess.
              </Text>
            </View>

            {[...CV_FORMATS, "Other"].map((f) => {
              const selected = choice === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => { setChoice(f); Haptics.selectionAsync().catch(() => {}); }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      borderColor: selected ? accent : colors.border,
                      backgroundColor: selected ? accent + "12" : colors.background,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Feather
                    name={selected ? "check-circle" : "circle"}
                    size={17}
                    color={selected ? accent : colors.mutedForeground}
                  />
                  <Text style={[styles.optionText, { color: selected ? accent : colors.foreground }]}>
                    {f === "Other" ? "Other / not sure" : `${f} format`}
                  </Text>
                </Pressable>
              );
            })}

            {choice === "Other" && (
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Name the format (e.g. Europass, or leave your own note)"
                placeholderTextColor={colors.mutedForeground}
                value={otherFormat}
                onChangeText={setOtherFormat}
                autoFocus
              />
            )}

            <View style={styles.row}>
              <Pressable
                onPress={discardPending}
                style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirm}
                disabled={!canConfirm}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: accent, opacity: !canConfirm ? 0.45 : pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    // Step 1 — nothing uploaded yet.
    if (!cv) {
      return (
        <View style={[styles.card, styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="upload-cloud" size={30} color={accent} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upload your CV</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
            PDF or Word (.docx). It's read on our server, so scanned images and
            unreadable exports are caught before anything is scored.
          </Text>
          <UploadButton label="Choose file" />
        </View>
      );
    }

    // A CV exists. Re-uploading stays available from here (step 8).
    return (
      <View style={{ gap: 14 }}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 14 }]}>
          <View style={styles.fileRow}>
            <Feather name={cv.kind === "pdf" ? "file-text" : "file"} size={18} color={accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{cv.fileName}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {cv.sourceFormat} format · {(cv.chars ?? 0).toLocaleString()} characters
              </Text>
            </View>
          </View>
          <UploadButton label="Upload a different CV" />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 8 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What we read</Text>
          <Text style={[styles.extract, { color: colors.mutedForeground }]} numberOfLines={14}>
            {cv.rawText}
          </Text>
        </View>

        <View style={[styles.next, { borderColor: colors.border }]}>
          <Feather name="clock" size={15} color={colors.mutedForeground} />
          <Text style={[styles.sub, { color: colors.mutedForeground, flex: 1 }]}>
            ATS scoring comes next.
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>CV Engine</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 100, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {!!error && (
          <Pressable
            onPress={clearError}
            style={[styles.error, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "40" }]}
            accessibilityRole="button"
            accessibilityLabel={`${error}. Dismiss.`}
          >
            <Feather name="alert-circle" size={15} color={colors.destructive} />
            <Text style={[styles.sub, { color: colors.foreground, flex: 1 }]}>{error}</Text>
            <Feather name="x" size={15} color={colors.mutedForeground} />
          </Pressable>
        )}
        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title: { fontSize: 24, fontWeight: "800" },
  centred: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  card: { padding: 16, borderRadius: 16, borderWidth: 1 },
  empty: { alignItems: "center", gap: 12, paddingVertical: 28 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  sub: { fontSize: 13, lineHeight: 19 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  fileName: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderRadius: 12, borderWidth: 1 },
  optionText: { fontSize: 14, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  row: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 2 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  primaryBtn: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 10 },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  secondaryBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10, borderWidth: 1 },
  secondaryText: { fontSize: 14, fontWeight: "600" },
  extract: { fontSize: 12, lineHeight: 18 },
  next: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed" },
  error: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
});
