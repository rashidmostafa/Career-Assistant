/**
 * Build CV from scratch.
 *
 * Reached from the Job Engine, because the CV it produces is aimed at the role
 * the user is applying for: the coverage bar compares what they have written so
 * far against the skills that role actually asks for.
 *
 * One question at a time rather than a single long form. A CV is a lot to ask
 * for in one screen, and the people this exists for — students who have never
 * written one — are exactly the ones a wall of empty boxes turns away.
 *
 * The draft autosaves. Someone filling this in on a phone will be interrupted,
 * and losing twenty minutes of typing to a phone call would mean they never
 * come back.
 */
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Download, FileText, Plus,
  Sparkles, Trash2, X,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AsyncStorage from "@/services/syncedStorage";
import { useAuth } from "@/context/AuthContext";
import { CV_FORMATS, useCV } from "@/context/CVContext";
import { useJobs } from "@/context/JobsContext";
import { useColors } from "@/hooks/useColors";
import { exportAsPdf, exportAsWord } from "@/services/cvExport";
import { rewriteBullet, suggestSummary } from "@/services/cvBuilderAI";
import { showAlert } from "@/utils/alert";
import {
  EMPTY_DRAFT, canSave, composeCV, coverageAgainst, draftCompleteness, draftIssues,
  emptyEducation, emptyExperience, emptyProject,
  type CVDraft, type EducationEntry, type ExperienceEntry, type ProjectEntry,
} from "@/services/cvBuilder";

const STEPS = ["You", "Summary", "Education", "Experience", "Projects", "Skills", "Finish"] as const;

export default function CVBuilderScreen() {
  const colors = useColors() as any;
  const accent = colors.cv || "#0891b2";
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { saveBuiltCV } = useCV();
  const { jobs } = useJobs();
  const params = useLocalSearchParams<{ jobId?: string }>();

  const [draft, setDraft] = useState<CVDraft>(EMPTY_DRAFT);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const draftKey = user ? `cv_draft_${user.id}` : null;

  // The job this CV is being aimed at, when the builder was opened from one.
  const targetJob = useMemo(
    () => (params.jobId ? jobs.find((j) => j.id === params.jobId) ?? null : null),
    [params.jobId, jobs],
  );
  const targetSkills = useMemo(
    () => targetJob?.requiredSkills ?? [],
    [targetJob],
  );
  const coverage = useMemo(
    () => coverageAgainst(draft, targetSkills),
    [draft, targetSkills],
  );

  // ── Load and autosave ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!draftKey) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw);
          // Merged onto EMPTY_DRAFT so a draft written before a field existed
          // loads with that field present rather than undefined.
          if (parsed && typeof parsed === "object") setDraft({ ...EMPTY_DRAFT, ...parsed });
        }
      } catch { /* a corrupt draft is not worth blocking the screen for */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [draftKey]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || !draftKey) return;
    // Debounced: this fires on every keystroke otherwise, and each write goes
    // to the account as well as the device.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void AsyncStorage.setItem(draftKey, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [draft, loaded, draftKey]);

  const patch = useCallback((p: Partial<CVDraft>) => setDraft((d) => ({ ...d, ...p })), []);

  // ── AI helpers ──────────────────────────────────────────────────────────────
  const improve = useCallback(async (key: string, line: string, context: string, apply: (t: string) => void) => {
    if (!line.trim() || busy) return;
    setBusy(key);
    setNote(null);
    try {
      const r = await rewriteBullet(line, context);
      if (r.changed) { apply(r.text); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
      // A rejection is worth saying out loud: it is the honesty rule working,
      // and silence would read as the button being broken.
      else if (r.rejected) setNote(r.rejected);
      else setNote("No clearer wording found — yours is fine.");
    } finally { setBusy(null); }
  }, [busy]);

  const writeSummary = useCallback(async () => {
    if (busy) return;
    setBusy("summary");
    setNote(null);
    try {
      const text = await suggestSummary({
        role: user?.targetRole ?? "",
        education: draft.education.map((e) => `${e.qualification} ${e.institution}`).join("; "),
        skills: draft.skills,
        projects: draft.projects.map((p) => `${p.name} (${p.tech})`),
      });
      if (text) patch({ summary: text });
      else setNote("Couldn't write one just now — type a line yourself and I can improve it.");
    } finally { setBusy(null); }
  }, [busy, draft, user?.targetRole, patch]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const finish = useCallback(async () => {
    const issues = draftIssues(draft);
    if (issues.length) { setNote(issues[0]); return; }
    setSaving(true);
    try {
      await saveBuiltCV(composeCV(draft), draft.format, draft.contact.fullName);
      if (draftKey) await AsyncStorage.removeItem(draftKey);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showAlert("CV saved", "It's now your active CV, so your roadmap and job matches will use it.");
      router.replace("/(tabs)/cv");
    } catch (e: any) {
      showAlert("Couldn't save", e?.message ?? "Try again.");
    } finally { setSaving(false); }
  }, [draft, saveBuiltCV, draftKey, router]);

  const download = useCallback(async (kind: "pdf" | "word") => {
    if (busy) return;
    setBusy(kind);
    try {
      const name = `${(draft.contact.fullName || "cv").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-cv`;
      const r = kind === "pdf" ? await exportAsPdf(composeCV(draft), name) : await exportAsWord(composeCV(draft), name);
      if (!r.ok) showAlert("Couldn't save the file", r.message);
    } finally { setBusy(null); }
  }, [busy, draft]);

  if (!loaded) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  const pct = draftCompleteness(draft);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Build CV from scratch</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {STEPS[step]} · step {step + 1} of {STEPS.length}
          </Text>
        </View>
        <Text style={[styles.pct, { color: accent }]}>{pct}%</Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: accent }]} />
      </View>

      {/* ── Coverage against the job, when there is one ── */}
      {targetJob && targetSkills.length > 0 && (
        <View style={[styles.coverage, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Text style={[styles.coverageTitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            AIMING AT: {targetJob.title.toUpperCase()}
          </Text>
          <View style={styles.chipWrap}>
            {coverage.covered.slice(0, 6).map((s) => (
              <View key={s} style={[styles.chip, { backgroundColor: colors.success + "1e" }]}>
                <Check size={11} color={colors.success} />
                <Text style={[styles.chipText, { color: colors.success }]}>{s}</Text>
              </View>
            ))}
            {coverage.missing.slice(0, 6).map((s) => (
              <View key={s} style={[styles.chip, { backgroundColor: colors.warning + "1e" }]}>
                <Text style={[styles.chipText, { color: colors.warning }]}>{s}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.coverageHint, { color: colors.mutedForeground }]}>
            {coverage.percent}% of what this job asks for. Amber terms aren't in your CV yet — add them only if you genuinely have them.
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {note && (
          <View style={[styles.note, { backgroundColor: colors.accent, borderColor: colors.primary + "33" }]}>
            <Text style={[styles.noteText, { color: colors.primary }]}>{note}</Text>
            <Pressable onPress={() => setNote(null)} hitSlop={8}><X size={15} color={colors.primary} /></Pressable>
          </View>
        )}

        {step === 0 && (
          <Card colors={colors} title="How can employers reach you?">
            <Field label="Full name" value={draft.contact.fullName} colors={colors}
              onChange={(t) => patch({ contact: { ...draft.contact, fullName: t } })} />
            <Field label="Email" value={draft.contact.email} colors={colors} keyboardType="email-address"
              onChange={(t) => patch({ contact: { ...draft.contact, email: t } })} />
            <Field label="Phone" value={draft.contact.phone} colors={colors} keyboardType="phone-pad"
              onChange={(t) => patch({ contact: { ...draft.contact, phone: t } })} />
            <Field label="City" value={draft.contact.location} colors={colors}
              onChange={(t) => patch({ contact: { ...draft.contact, location: t } })} />
            <Field label="LinkedIn / GitHub / portfolio" value={draft.contact.links.join(", ")} colors={colors}
              onChange={(t) => patch({ contact: { ...draft.contact, links: t.split(",").map((x) => x.trim()).filter(Boolean) } })}
              hint="Separate several with commas" />
          </Card>
        )}

        {step === 1 && (
          <Card colors={colors} title="A line or two about you"
            hint="Written last by most people — fill in the rest first and let this be written from it.">
            <Field label="Professional summary" value={draft.summary} colors={colors} multiline
              onChange={(t) => patch({ summary: t })} />
            <AIButton
              label={draft.summary ? "Rewrite from what I've entered" : "Write one for me"}
              loading={busy === "summary"} accent={accent} colors={colors} onPress={writeSummary}
            />
          </Card>
        )}

        {step === 2 && (
          <Repeatable
            colors={colors} accent={accent}
            title="Education" addLabel="Add education"
            items={draft.education}
            onAdd={() => patch({ education: [...draft.education, emptyEducation()] })}
            onRemove={(id) => patch({ education: draft.education.filter((e) => e.id !== id) })}
            render={(e: EducationEntry) => (
              <>
                <Field label="Qualification" value={e.qualification} colors={colors}
                  onChange={(t) => patch({ education: draft.education.map((x) => x.id === e.id ? { ...x, qualification: t } : x) })} />
                <Field label="Institution" value={e.institution} colors={colors}
                  onChange={(t) => patch({ education: draft.education.map((x) => x.id === e.id ? { ...x, institution: t } : x) })} />
                <Field label="Year" value={e.year} colors={colors} hint="e.g. 2026, or 2022 - 2026"
                  onChange={(t) => patch({ education: draft.education.map((x) => x.id === e.id ? { ...x, year: t } : x) })} />
                <Field label="CGPA or honours (optional)" value={e.detail} colors={colors}
                  onChange={(t) => patch({ education: draft.education.map((x) => x.id === e.id ? { ...x, detail: t } : x) })} />
              </>
            )}
          />
        )}

        {step === 3 && (
          <Repeatable
            colors={colors} accent={accent}
            title="Work experience"
            hint="No jobs yet? Skip this — your projects go next, and they count."
            addLabel="Add a job"
            items={draft.experience}
            onAdd={() => patch({ experience: [...draft.experience, emptyExperience()] })}
            onRemove={(id) => patch({ experience: draft.experience.filter((e) => e.id !== id) })}
            render={(e: ExperienceEntry) => (
              <>
                <Field label="Job title" value={e.title} colors={colors}
                  onChange={(t) => patch({ experience: draft.experience.map((x) => x.id === e.id ? { ...x, title: t } : x) })} />
                <Field label="Organisation" value={e.organisation} colors={colors}
                  onChange={(t) => patch({ experience: draft.experience.map((x) => x.id === e.id ? { ...x, organisation: t } : x) })} />
                <Field label="Period" value={e.period} colors={colors} hint="e.g. Jun 2025 - Aug 2025"
                  onChange={(t) => patch({ experience: draft.experience.map((x) => x.id === e.id ? { ...x, period: t } : x) })} />
                <Bullets
                  colors={colors} accent={accent} bullets={e.bullets} busy={busy}
                  keyFor={(i) => `exp_${e.id}_${i}`}
                  onChange={(bs) => patch({ experience: draft.experience.map((x) => x.id === e.id ? { ...x, bullets: bs } : x) })}
                  onImprove={(i, line, apply) => improve(`exp_${e.id}_${i}`, line, `the role ${e.title || "a job"}`, apply)}
                />
              </>
            )}
          />
        )}

        {step === 4 && (
          <Repeatable
            colors={colors} accent={accent}
            title="Projects"
            hint="With no work history, this is your evidence. University work counts."
            addLabel="Add a project"
            items={draft.projects}
            onAdd={() => patch({ projects: [...draft.projects, emptyProject()] })}
            onRemove={(id) => patch({ projects: draft.projects.filter((p) => p.id !== id) })}
            render={(p: ProjectEntry) => (
              <>
                <Field label="Project name" value={p.name} colors={colors}
                  onChange={(t) => patch({ projects: draft.projects.map((x) => x.id === p.id ? { ...x, name: t } : x) })} />
                <Field label="Built with" value={p.tech} colors={colors} hint="e.g. Java, MySQL"
                  onChange={(t) => patch({ projects: draft.projects.map((x) => x.id === p.id ? { ...x, tech: t } : x) })} />
                <Bullets
                  colors={colors} accent={accent} bullets={p.bullets} busy={busy}
                  keyFor={(i) => `proj_${p.id}_${i}`}
                  onChange={(bs) => patch({ projects: draft.projects.map((x) => x.id === p.id ? { ...x, bullets: bs } : x) })}
                  onImprove={(i, line, apply) => improve(`proj_${p.id}_${i}`, line, `the project ${p.name || "a project"}`, apply)}
                />
              </>
            )}
          />
        )}

        {step === 5 && (
          <Card colors={colors} title="What can you do?"
            hint="List what you could answer questions about. Everything here is checked against the job above.">
            <Field label="Skills" value={draft.skills.join(", ")} colors={colors} multiline
              onChange={(t) => patch({ skills: t.split(",").map((x) => x.trim()).filter(Boolean) })}
              hint="Separate with commas" />
            <Field label="Certifications (optional)" value={draft.certifications.join(", ")} colors={colors}
              onChange={(t) => patch({ certifications: t.split(",").map((x) => x.trim()).filter(Boolean) })} />
            <Field label="Languages (optional)" value={draft.languages.join(", ")} colors={colors}
              onChange={(t) => patch({ languages: t.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </Card>
        )}

        {step === 6 && (
          <>
            <Card colors={colors} title="Which layout?"
              hint="They order the sections differently, and your CV is scored against the one you pick.">
              <View style={styles.formatRow}>
                {[...CV_FORMATS, "Other"].map((f) => {
                  const on = draft.format === f;
                  return (
                    <Pressable key={f} onPress={() => patch({ format: f })}
                      style={[styles.format, { borderColor: on ? accent : colors.border, backgroundColor: on ? accent + "14" : "transparent" }]}>
                      <Text style={[styles.formatText, { color: on ? accent : colors.foreground }]}>{f}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Card colors={colors} title="Preview">
              <Text style={[styles.preview, { color: colors.foreground, borderColor: colors.border }]} selectable>
                {composeCV(draft)}
              </Text>
            </Card>

            {draftIssues(draft).length > 0 && (
              <Card colors={colors} title="Before you save">
                {draftIssues(draft).map((i) => (
                  <Text key={i} style={[styles.issue, { color: colors.warning }]}>• {i}</Text>
                ))}
              </Card>
            )}

            <View style={styles.downloadRow}>
              <Pressable style={[styles.secondary, { borderColor: colors.border }]} onPress={() => download("pdf")} disabled={!!busy}>
                {busy === "pdf" ? <ActivityIndicator size="small" color={accent} /> : <Download size={16} color={colors.foreground} />}
                <Text style={[styles.secondaryText, { color: colors.foreground }]}>PDF</Text>
              </Pressable>
              <Pressable style={[styles.secondary, { borderColor: colors.border }]} onPress={() => download("word")} disabled={!!busy}>
                {busy === "word" ? <ActivityIndicator size="small" color={accent} /> : <FileText size={16} color={colors.foreground} />}
                <Text style={[styles.secondaryText, { color: colors.foreground }]}>Word</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Step controls ── */}
      <View style={[styles.footer, { paddingBottom: bottomPad + 12, borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable
          style={[styles.navBtn, { borderColor: colors.border, opacity: step === 0 ? 0.4 : 1 }]}
          onPress={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ChevronLeft size={18} color={colors.foreground} />
        </Pressable>

        {step < STEPS.length - 1 ? (
          <Pressable style={[styles.primary, { backgroundColor: accent }]} onPress={() => setStep((s) => s + 1)}>
            <Text style={styles.primaryText}>Next: {STEPS[step + 1]}</Text>
            <ChevronRight size={17} color="#fff" />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primary, { backgroundColor: canSave(draft) ? accent : colors.border, opacity: saving ? 0.7 : 1 }]}
            onPress={finish}
            disabled={saving}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Check size={17} color="#fff" />}
            <Text style={styles.primaryText}>{saving ? "Saving…" : "Save as my CV"}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────
interface CardProps { colors: any; title: string; hint?: string; children?: React.ReactNode }
function Card({ colors, title, hint, children }: CardProps) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
      {hint ? <Text style={[styles.cardHint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
      {children}
    </View>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  colors: any;
  multiline?: boolean;
  hint?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
}
function Field({ label, value, onChange, colors, multiline, hint, keyboardType }: FieldProps) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          multiline && { minHeight: 88, textAlignVertical: "top" },
          { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
        ]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        accessibilityLabel={label}
      />
      {hint ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
    </View>
  );
}

interface AIButtonProps { label: string; loading: boolean; accent: string; colors: any; onPress: () => void }
function AIButton({ label, loading, accent, colors, onPress }: AIButtonProps) {
  return (
    <Pressable style={[styles.ai, { borderColor: accent + "44", backgroundColor: accent + "10" }]} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator size="small" color={accent} /> : <Sparkles size={14} color={accent} />}
      <Text style={[styles.aiText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

/** A list of entries the user can add to and remove from. */
interface RepeatableProps<T extends { id: string }> {
  colors: any; accent: string; title: string; hint?: string; addLabel: string;
  items: T[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  render: (item: T) => React.ReactNode;
}
function Repeatable<T extends { id: string }>(
  { colors, accent, title, hint, addLabel, items, onAdd, onRemove, render }: RepeatableProps<T>,
) {
  return (
    <>
      <Card colors={colors} title={title} hint={hint}>
        {items.length === 0 && (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>Nothing added yet.</Text>
        )}
      </Card>
      {items.map((item, i) => (
        <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.entryHead}>
            <Text style={[styles.entryNum, { color: colors.mutedForeground }]}>#{i + 1}</Text>
            <Pressable onPress={() => onRemove(item.id)} hitSlop={8} accessibilityLabel={`Remove ${title} ${i + 1}`}>
              <Trash2 size={16} color={colors.destructive} />
            </Pressable>
          </View>
          {render(item)}
        </View>
      ))}
      <Pressable style={[styles.add, { borderColor: accent + "55" }]} onPress={onAdd}>
        <Plus size={16} color={accent} />
        <Text style={[styles.addText, { color: accent }]}>{addLabel}</Text>
      </Pressable>
    </>
  );
}

/** Bullet lines, each with its own rewrite button. */
interface BulletsProps {
  colors: any; accent: string; bullets: string[];
  onChange: (bullets: string[]) => void;
  onImprove: (index: number, line: string, apply: (t: string) => void) => void;
  busy: string | null;
  keyFor: (index: number) => string;
}
function Bullets({ colors, accent, bullets, onChange, onImprove, busy, keyFor }: BulletsProps) {
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>What did you do?</Text>
      {bullets.map((b, i) => (
        <View key={i} style={styles.bulletRow}>
          <TextInput
            style={[styles.input, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            value={b}
            onChangeText={(t) => onChange(bullets.map((x, j) => (j === i ? t : x)))}
            placeholder="One thing you did"
            placeholderTextColor={colors.mutedForeground}
            multiline
            accessibilityLabel={`Bullet ${i + 1}`}
          />
          <Pressable
            onPress={() => onImprove(i, b, (t: string) => onChange(bullets.map((x, j) => (j === i ? t : x))))}
            style={[styles.sparkle, { borderColor: accent + "44" }]}
            disabled={!!busy}
            accessibilityLabel="Improve this line"
          >
            {busy === keyFor(i) ? <ActivityIndicator size="small" color={accent} /> : <Sparkles size={15} color={accent} />}
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => onChange([...bullets, ""])} style={styles.addBullet}>
        <Plus size={13} color={accent} />
        <Text style={[styles.addBulletText, { color: accent }]}>Add another line</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 17, letterSpacing: -0.3 },
  sub: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
  pct: { fontFamily: "Inter_700Bold", fontSize: 15 },
  track: { height: 3 },
  fill: { height: 3 },

  coverage: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  coverageTitle: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, letterSpacing: 0.5, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 11.5 },
  coverageHint: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 15, marginTop: 8 },

  note: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  noteText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12.5, lineHeight: 18 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 15.5, marginBottom: 4 },
  cardHint: { fontFamily: "Inter_500Medium", fontSize: 12.5, lineHeight: 18, marginBottom: 14 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 11.5, letterSpacing: 0.3, marginBottom: 6, textTransform: "uppercase" },
  input: {
    borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11,
    fontFamily: "Inter_500Medium", fontSize: 14.5,
  },
  hint: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 5 },
  empty: { fontFamily: "Inter_500Medium", fontSize: 13 },

  entryHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  entryNum: { fontFamily: "Inter_700Bold", fontSize: 12 },

  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  sparkle: { width: 42, height: 42, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addBullet: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  addBulletText: { fontFamily: "Inter_600SemiBold", fontSize: 12.5 },

  ai: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 11, borderRadius: 11, borderWidth: 1 },
  aiText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  add: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", marginBottom: 14,
  },
  addText: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },

  formatRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  format: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  formatText: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },

  preview: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11.5, lineHeight: 17, borderWidth: 1, borderRadius: 10, padding: 12,
  },
  issue: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 19, marginBottom: 4 },

  downloadRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  secondary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12, borderWidth: 1,
  },
  secondaryText: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },

  footer: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  primary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 12 },
  primaryText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14.5 },
});
