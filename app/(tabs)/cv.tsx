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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useCV, CV_FORMATS } from "@/context/CVContext";
import type { CVIssue, CVReport } from "@/services/cvAI";

export default function CVScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    cv, report, isScoring, pending, isLoading, isUploading, error,
    optimised, isOptimising, optimise,
    pickAndExtract, confirmFormat, discardPending, clearError, rescore,
  } = useCV();

  const accent = colors.cv || colors.primary;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [choice, setChoice] = useState<string | null>(null);
  const [otherFormat, setOtherFormat] = useState("");
  // The output format is asked separately: a CV written in one convention is
  // often best rewritten into another for a given employer.
  const [outChoice, setOutChoice] = useState<string | null>(null);
  const [outOther, setOutOther] = useState("");

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

        {isScoring && !report && (
          <View style={[styles.card, styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="large" color={accent} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Scoring your CV…</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: "center" }]}>
              Checking it against how applicant tracking systems actually read a
              {" "}{cv.sourceFormat} CV.
            </Text>
            {/* A few seconds warm; longer only if the server has gone idle. */}
            <Text style={[styles.note, { color: colors.mutedForeground, textAlign: "center" }]}>
              Usually a few seconds.
            </Text>
          </View>
        )}

        {!isScoring && !report && (
          <View style={[styles.card, styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="bar-chart-2" size={26} color={accent} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Not scored yet</Text>
            <Pressable
              onPress={rescore}
              style={({ pressed }) => [styles.cta, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <Feather name="zap" size={16} color="#fff" />
              <Text style={styles.ctaText}>Score my CV</Text>
            </Pressable>
          </View>
        )}

        {!!report && (
          <>
            <Report report={report} accent={accent} colors={colors} isScoring={isScoring} onRescore={rescore} />

            {/* Step 5. A report that only names problems leaves the user with
                nowhere to go; the roadmap is where the gaps get closed. */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Want to raise this score?
              </Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                {report.skillGaps.length > 0
                  ? `Your roadmap turns these ${report.skillGaps.length} gaps into a plan built around what you already know.`
                  : "Your roadmap builds a plan from the gap between this CV and your target role."}
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/roadmap" as any)}
                style={({ pressed }) => [styles.cta, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Go to your roadmap to improve this score"
              >
                <Feather name="trending-up" size={16} color="#fff" />
                <Text style={styles.ctaText}>Upgrade my score</Text>
              </Pressable>
            </View>

            {/* Step 6 — the rewritten CV. */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
              <View style={{ gap: 4 }}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Optimised CV</Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                  Rewritten to score better using only what your CV already evidences.
                  Nothing is added that you can't defend in an interview.
                </Text>
              </View>

              {!optimised && !isOptimising && (
                <>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>WRITE IT IN</Text>
                  {[...CV_FORMATS, "Other"].map((f) => {
                    const selected = outChoice === f;
                    return (
                      <Pressable
                        key={f}
                        onPress={() => { setOutChoice(f); Haptics.selectionAsync().catch(() => {}); }}
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
                        <Feather name={selected ? "check-circle" : "circle"} size={17}
                          color={selected ? accent : colors.mutedForeground} />
                        <Text style={[styles.optionText, { color: selected ? accent : colors.foreground }]}>
                          {f === "Other" ? "Other / not sure" : `${f} format`}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {outChoice === "Other" && (
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                      placeholder="Name the format"
                      placeholderTextColor={colors.mutedForeground}
                      value={outOther}
                      onChangeText={setOutOther}
                    />
                  )}
                  <Pressable
                    onPress={() => {
                      const f = outChoice === "Other" ? outOther.trim() : (outChoice ?? "");
                      if (f) optimise(f);
                    }}
                    disabled={outChoice === "Other" ? !outOther.trim() : !outChoice}
                    style={({ pressed }) => [
                      styles.cta,
                      {
                        backgroundColor: accent,
                        opacity: (outChoice === "Other" ? !outOther.trim() : !outChoice) ? 0.45 : pressed ? 0.85 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                  >
                    <Feather name="edit-3" size={16} color="#fff" />
                    <Text style={styles.ctaText}>Write my optimised CV</Text>
                  </Pressable>
                </>
              )}

              {isOptimising && (
                <View style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}>
                  <ActivityIndicator size="large" color={accent} />
                  <Text style={[styles.sub, { color: colors.mutedForeground }]}>Rewriting your CV…</Text>
                </View>
              )}

              {!!optimised && (
                <>
                  {optimised.flagged.length > 0 && (
                    /* Surfaced, never silently kept: the candidate is the only
                       one who knows whether they can stand behind a claim. */
                    <View style={[styles.error, { backgroundColor: (colors.warning || "#d97706") + "14", borderColor: (colors.warning || "#d97706") + "40" }]}>
                      <Feather name="alert-triangle" size={15} color={colors.warning || "#d97706"} />
                      <Text style={[styles.sub, { color: colors.foreground, flex: 1 }]}>
                        Check these before sending — they appear in the rewrite but not in your
                        original CV: {optimised.flagged.join(", ")}
                      </Text>
                    </View>
                  )}
                  <View style={styles.fileRow}>
                    <Feather name="check-circle" size={16} color={colors.success || "#16a34a"} />
                    <Text style={[styles.meta, { color: colors.mutedForeground, flex: 1 }]}>
                      {optimised.targetFormat} format
                    </Text>
                    <Pressable
                      onPress={() => { setOutChoice(null); setOutOther(""); optimise(optimised.targetFormat); }}
                      disabled={isOptimising}
                      style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel="Rewrite again"
                    >
                      <Feather name="refresh-cw" size={15} color={colors.foreground} />
                    </Pressable>
                  </View>
                  <Text style={[styles.optimisedText, { color: colors.foreground }]} selectable>
                    {optimised.text}
                  </Text>
                  <View style={[styles.next, { borderColor: colors.border }]}>
                    <Feather name="download" size={15} color={colors.mutedForeground} />
                    <Text style={[styles.sub, { color: colors.mutedForeground, flex: 1 }]}>
                      PDF and Word download comes next.
                    </Text>
                  </View>
                </>
              )}
            </View>
          </>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 8 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What we read</Text>
          <Text style={[styles.extract, { color: colors.mutedForeground }]} numberOfLines={14}>
            {cv.rawText}
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

/** Colour by band: green is earned, not given. */
function scoreTone(score: number, colors: any) {
  if (score >= 80) return colors.success || "#16a34a";
  if (score >= 60) return colors.warning || "#d97706";
  return colors.destructive || "#dc2626";
}

const SEVERITY_TONE = (s: string, colors: any) =>
  s === "high" ? (colors.destructive || "#dc2626")
  : s === "medium" ? (colors.warning || "#d97706")
  : colors.mutedForeground;

function IssueList({ title, items, colors }: { title: string; items: CVIssue[]; colors: any }) {
  if (!items.length) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {items.map((i, idx) => {
        const tone = SEVERITY_TONE(i.severity, colors);
        return (
          <View key={`${i.title}-${idx}`} style={[styles.issue, { borderLeftColor: tone }]}>
            <View style={styles.issueHead}>
              <View style={[styles.sevPill, { backgroundColor: tone + "1A", borderColor: tone + "40" }]}>
                <Text style={[styles.sevText, { color: tone }]}>{i.severity.toUpperCase()}</Text>
              </View>
              <Text style={[styles.issueTitle, { color: colors.foreground }]}>{i.title}</Text>
            </View>
            {!!i.detail && <Text style={[styles.sub, { color: colors.mutedForeground }]}>{i.detail}</Text>}
            {!!i.fix && (
              <View style={styles.fixRow}>
                <Feather name="arrow-right" size={13} color={colors.success || "#16a34a"} />
                <Text style={[styles.sub, { color: colors.foreground, flex: 1 }]}>{i.fix}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Report({ report, accent, colors, isScoring, onRescore }: {
  report: CVReport; accent: string; colors: any; isScoring: boolean; onRescore: () => void;
}) {
  const tone = scoreTone(report.score, colors);
  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 14 }]}>
        <View style={styles.scoreRow}>
          <View style={[styles.scoreBadge, { borderColor: tone }]}>
            <Text style={[styles.scoreNum, { color: tone }]}>{report.score}</Text>
            <Text style={[styles.scoreMax, { color: colors.mutedForeground }]}>/100</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>ATS score</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {report.scoredFormat} format{report.targetRole ? ` · ${report.targetRole}` : ""}
            </Text>
          </View>
          <Pressable
            onPress={onRescore}
            disabled={isScoring}
            style={({ pressed }) => [styles.iconBtn, { borderColor: colors.border, opacity: pressed || isScoring ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Score again"
          >
            <Feather name="refresh-cw" size={15} color={colors.foreground} />
          </Pressable>
        </View>

        {!!report.verdict && (
          <Text style={[styles.sub, { color: colors.foreground }]}>{report.verdict}</Text>
        )}

        <View style={{ gap: 10 }}>
          {report.dimensions.map((d) => {
            const dTone = scoreTone(d.score, colors);
            return (
              <View key={d.key} style={{ gap: 5 }}>
                <View style={styles.dimHead}>
                  <Text style={[styles.dimLabel, { color: colors.foreground }]}>{d.label}</Text>
                  <Text style={[styles.dimScore, { color: dTone }]}>{d.score}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: colors.border }]}>
                  <View style={[styles.fill, { width: `${d.score}%`, backgroundColor: dTone }]} />
                </View>
                {!!d.note && <Text style={[styles.note, { color: colors.mutedForeground }]}>{d.note}</Text>}
              </View>
            );
          })}
        </View>
      </View>

      <IssueList title="Formatting problems" items={report.formattingIssues} colors={colors} />
      <IssueList title="Essentials to fix" items={report.essentials} colors={colors} />

      {report.skillGaps.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Skills this role screens for
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Not on your CV, and looked for in {report.targetRole} applications.
          </Text>
          {report.skillGaps.map((g, i) => (
            <View key={`${g.skill}-${i}`} style={{ gap: 3 }}>
              <Text style={[styles.gapSkill, { color: accent }]}>{g.skill}</Text>
              {!!g.why && <Text style={[styles.sub, { color: colors.mutedForeground }]}>{g.why}</Text>}
            </View>
          ))}
        </View>
      )}
    </>
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
  iconBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  scoreBadge: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  scoreNum: { fontSize: 22, fontWeight: "800" },
  scoreMax: { fontSize: 10, marginTop: -2 },
  dimHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dimLabel: { fontSize: 13, fontWeight: "600" },
  dimScore: { fontSize: 13, fontWeight: "800" },
  track: { height: 5, borderRadius: 3, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3 },
  note: { fontSize: 11, lineHeight: 16 },
  issue: { gap: 6, paddingLeft: 11, borderLeftWidth: 3 },
  issueHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sevPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  sevText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  issueTitle: { fontSize: 14, fontWeight: "700", flexShrink: 1 },
  fixRow: { flexDirection: "row", gap: 7, alignItems: "flex-start" },
  gapSkill: { fontSize: 14, fontWeight: "700" },
  optimisedText: { fontSize: 12, lineHeight: 19, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  label: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
});
