/**
 * Interview — practice sessions against the question bank for the user's role.
 *
 * One screen with four modes rather than four routes: a session is a single
 * task the user is in the middle of, and pushing routes for each question would
 * put the system back button between them and their own answer.
 */
import {
  Award, Check, ChevronRight, Clock, Flame, Layers, Play, RotateCcw,
  Sparkles, Target, TrendingUp, X, Zap,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, useWindowDimensions, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MasteryRadar } from "@/components/interview/MasteryRadar";
import { ScoreTrend } from "@/components/interview/ScoreTrend";
import { StepSlider } from "@/components/interview/StepSlider";
import { KeywordAnswer } from "@/components/interview/KeywordAnswer";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { useAuth } from "@/context/AuthContext";
import {
  SESSION_LENGTHS, TIME_LIMITS, confidenceGap, useInterview,
  type AnswerRecord, type StoredSession, type WeakQuestion,
} from "@/context/InterviewContext";
import { useColors } from "@/hooks/useColors";
import { DIFFICULTIES, type Difficulty } from "@/services/interviewApi";
import { blankIdealAnswer, scoreTier, segmentIdealAnswer } from "@/services/interviewScoring";

type Mode = "hub" | "session" | "feedback" | "summary" | "flashcards";

const CONFIDENCE_STEPS = ["1", "2", "3", "4", "5"];
const CONFIDENCE_CAPTIONS = ["No idea", "Shaky", "Maybe", "Fairly sure", "Certain"];

export default function InterviewScreen() {
  const colors = useColors() as any;
  const accent = colors.interview || "#4f46e5";
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const {
    ready, role, config, setConfig, sessions, progress, mastery, flashcards,
    active, isStarting, isSubmitting, startError,
    startSession, submitAnswer, finishSession, abandonSession, practiseFlashcard,
  } = useInterview();

  const [mode, setMode] = useState<Mode>("hub");
  const [draft, setDraft] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [lastAnswer, setLastAnswer] = useState<AnswerRecord | null>(null);
  const [summary, setSummary] = useState<StoredSession | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const question = active?.questions[active.index] ?? null;
  const limit = active?.config.timed ? TIME_LIMITS[active.config.difficulty] : null;

  // The timestamp the current question started, so the recorded duration is not
  // affected by a re-render or by the app being backgrounded mid-answer.
  const startedAt = useRef<number>(Date.now());

  // ── Timer ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "session" || !question || !limit) { setSecondsLeft(null); return; }
    startedAt.current = Date.now();
    setSecondsLeft(limit);
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSecondsLeft(Math.max(limit - elapsed, 0));
    }, 250);
    return () => clearInterval(id);
  }, [mode, question?.id, limit]);

  const endSession = useCallback(async () => {
    const s = await finishSession();
    setSummary(s);
    setMode("summary");
  }, [finishSession]);

  const handleSubmit = useCallback(async () => {
    if (!active || isSubmitting) return;
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    const record = await submitAnswer(draft, confidence, seconds);
    if (!record) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft("");
    setConfidence(null);

    const wasLast = active.index + 1 >= active.questions.length;
    // Quick Fire withholds every answer's feedback until the end, which is what
    // makes it quick — stopping to read after each one is the other preset.
    if (active.config.preset === "quickfire") {
      if (wasLast) void endSession();
      return;
    }
    setLastAnswer(record);
    setMode("feedback");
    if (wasLast) { /* the feedback screen offers Finish rather than Next */ }
  }, [active, draft, confidence, isSubmitting, submitAnswer]);

  // Time up submits whatever is written, which is what a real interview does.
  useEffect(() => {
    if (secondsLeft === 0 && mode === "session") void handleSubmit();
  }, [secondsLeft, mode, handleSubmit]);

  const begin = useCallback(async () => {
    const ok = await startSession();
    if (!ok) return;
    setDraft("");
    setConfidence(null);
    setLastAnswer(null);
    startedAt.current = Date.now();
    setMode("session");
  }, [startSession]);

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  if (!role) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header {...{ topPad, accent, colors }} title="Interview" subtitle="Practice for your target role" />
        <View style={styles.gate}>
          <View style={[styles.gateIcon, { backgroundColor: accent + "18", borderColor: accent + "35" }]}>
            <Target size={26} color={accent} />
          </View>
          <Text style={[styles.gateTitle, { color: colors.foreground }]}>Set a target role first</Text>
          <Text style={[styles.gateBody, { color: colors.mutedForeground }]}>
            Questions are drawn for the role you're aiming at, so the interview section needs one before it can ask anything.
          </Text>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: accent }]}
            onPress={() => router.push("/(tabs)/profile")}
          >
            <Text style={styles.primaryBtnText}>Choose a role</Text>
            <ChevronRight size={17} color="#fff" />
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Session ─────────────────────────────────────────────────────────────────
  if (mode === "session" && active && question) {
    const n = active.index + 1;
    const total = active.questions.length;
    const urgent = secondsLeft != null && secondsLeft <= 15;

    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.sessionBar, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => { abandonSession(); setMode("hub"); }} hitSlop={10} accessibilityLabel="Leave session">
            <X size={22} color={colors.mutedForeground} />
          </Pressable>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(active.index / total) * 100}%`, backgroundColor: accent }]} />
          </View>
          <Text style={[styles.counter, { color: colors.mutedForeground }]}>{n}/{total}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 22, paddingBottom: bottomPad + 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.tagRow}>
            <Tag label={question.competency} tint={accent} colors={colors} />
            <Tag label={question.type} tint={colors.mutedForeground} colors={colors} muted />
            {question.isComeback && <Tag label="Comeback" tint={colors.warning} colors={colors} />}
            {secondsLeft != null && (
              <View style={[styles.timer, { backgroundColor: (urgent ? colors.destructive : accent) + "18" }]}>
                <Clock size={12} color={urgent ? colors.destructive : accent} />
                <Text style={[styles.timerText, { color: urgent ? colors.destructive : accent }]}>
                  {formatClock(secondsLeft)}
                </Text>
              </View>
            )}
          </View>

          <Text style={[styles.question, { color: colors.foreground }]}>{question.question}</Text>

          {question.isComeback && (
            <Text style={[styles.comebackNote, { color: colors.warning }]}>
              You scored below 70% on this one before.
            </Text>
          )}

          <TextInput
            style={[styles.answerInput, {
              backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground,
            }]}
            value={draft}
            onChangeText={setDraft}
            placeholder="Type your answer as you'd say it out loud…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
          />

          <View style={[styles.confidenceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.confidenceLabel, { color: colors.foreground }]}>
              How confident are you?
            </Text>
            <Text style={[styles.confidenceHint, { color: colors.mutedForeground }]}>
              Asked before you see the answer, so it measures what you believed — not what you wish you'd said.
            </Text>
            <StepSlider
              steps={CONFIDENCE_STEPS}
              captions={CONFIDENCE_CAPTIONS}
              value={confidence == null ? 2 : confidence - 1}
              onChange={(i) => setConfidence(i + 1)}
              accent={accent}
              colors={colors}
            />
            {confidence == null && (
              <Text style={[styles.confidenceHint, { color: colors.mutedForeground, marginTop: 8 }]}>
                Optional — submitting without choosing just skips the calibration check.
              </Text>
            )}
          </View>

          <Pressable
            style={[styles.primaryBtn, {
              backgroundColor: accent, opacity: isSubmitting ? 0.6 : 1, marginTop: 18,
            }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Text style={styles.primaryBtnText}>
                    {n === total ? "Submit and finish" : "Submit answer"}
                  </Text>
                  <ChevronRight size={17} color="#fff" />
                </>}
          </Pressable>
          {active.config.preset === "quickfire" && (
            <Text style={[styles.quickfireNote, { color: colors.mutedForeground }]}>
              Quick Fire — all feedback comes at the end.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Feedback ────────────────────────────────────────────────────────────────
  if (mode === "feedback" && lastAnswer && active) {
    const tier = scoreTier(lastAnswer.score);
    const tint = tier === "strong" ? colors.success : tier === "fair" ? colors.warning : colors.destructive;
    const isLast = active.index >= active.questions.length;
    const segments = segmentIdealAnswer(lastAnswer.idealAnswer, lastAnswer.keywords, lastAnswer.matched);

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.sessionBar, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
          <Text style={[styles.counter, { color: colors.mutedForeground }]}>
            {active.index}/{active.questions.length} answered
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: bottomPad + 40 }}>
          <View style={[styles.scoreCard, { backgroundColor: tint + "14", borderColor: tint + "3a" }]}>
            <Text style={[styles.scoreValue, { color: tint }]}>{lastAnswer.score}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.scoreTier, { color: tint }]}>
                {tier === "strong" ? "Strong answer" : tier === "fair" ? "Partly there" : "Needs work"}
              </Text>
              <Text style={[styles.scoreSub, { color: colors.mutedForeground }]}>
                {lastAnswer.reviewedByAI
                  ? "Marked on substance, not just wording."
                  : "Scored on the terms your answer covered."}
              </Text>
            </View>
            {lastAnswer.confidence != null && (
              <ConfidenceChip answer={lastAnswer} colors={colors} />
            )}
          </View>

          <Section title="Your answer" colors={colors}>
            <Text style={[styles.bodyText, { color: lastAnswer.userAnswer ? colors.foreground : colors.mutedForeground }]}>
              {lastAnswer.userAnswer || "You didn't answer this one."}
            </Text>
          </Section>

          <Section title="Ideal answer" colors={colors}>
            <KeywordAnswer
              segments={segments}
              colors={colors}
              matchedCount={lastAnswer.matched.length}
              missedCount={lastAnswer.missed.length}
            />
          </Section>

          <Section title="Key takeaway" colors={colors}>
            {lastAnswer.takeaways.map((t, i) => (
              <View key={i} style={styles.bullet}>
                <View style={[styles.bulletDot, { backgroundColor: accent }]} />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>{t}</Text>
              </View>
            ))}
          </Section>

          <Pressable
            style={[styles.primaryBtn, { backgroundColor: accent, marginTop: 8 }]}
            onPress={() => { if (isLast) void endSession(); else { setLastAnswer(null); setMode("session"); } }}
          >
            <Text style={styles.primaryBtnText}>{isLast ? "See results" : "Next question"}</Text>
            <ChevronRight size={17} color="#fff" />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  if (mode === "summary") {
    const weakest = summary
      ? [...summary.answers].sort((a, b) => a.score - b.score).slice(0, 3)
      : [];
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header {...{ topPad, accent, colors }} title="Session complete" subtitle={role} />
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: bottomPad + 40 }}>
          {summary ? (
            <>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center" }]}>
                <Text style={[styles.bigScore, { color: accent }]}>{summary.overallScore}%</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                  across {summary.answers.length} question{summary.answers.length === 1 ? "" : "s"}
                </Text>
                <View style={styles.summaryStats}>
                  <Stat icon={<Zap size={14} color={accent} />} label="XP" value={`+${summary.xpEarned}`} colors={colors} />
                  <Stat icon={<Flame size={14} color={colors.warning} />} label="Streak" value={`${progress.streakCount}d`} colors={colors} />
                  <Stat icon={<Layers size={14} color={colors.mutedForeground} />} label="To revise" value={String(flashcards.length)} colors={colors} />
                </View>
              </View>

              {weakest.length > 0 && (
                <Section title="Worth revisiting" colors={colors}>
                  {weakest.map((a) => (
                    <View key={a.questionId} style={styles.weakRow}>
                      <Text style={[styles.weakScore, { color: scoreTier(a.score) === "weak" ? colors.destructive : colors.warning }]}>
                        {a.score}
                      </Text>
                      <Text style={[styles.weakText, { color: colors.foreground }]} numberOfLines={2}>
                        {a.question}
                      </Text>
                    </View>
                  ))}
                  <Text style={[styles.cardSub, { color: colors.mutedForeground, marginTop: 8 }]}>
                    Anything under 70% becomes a flashcard and comes back at the start of a later session.
                  </Text>
                </Section>
              )}

              {progress.badges.length > 0 && (
                <Section title="Badges" colors={colors}>
                  <View style={styles.badgeWrap}>
                    {progress.badges.map((b) => (
                      <View key={b} style={[styles.badge, { backgroundColor: accent + "14", borderColor: accent + "38" }]}>
                        <Award size={12} color={accent} />
                        <Text style={[styles.badgeText, { color: accent }]}>{b}</Text>
                      </View>
                    ))}
                  </View>
                </Section>
              )}
            </>
          ) : (
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
              That session ended before any answer was recorded.
            </Text>
          )}

          <Pressable style={[styles.primaryBtn, { backgroundColor: accent, marginTop: 8 }]} onPress={() => setMode("hub")}>
            <Text style={styles.primaryBtnText}>Back to overview</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Flashcards ──────────────────────────────────────────────────────────────
  if (mode === "flashcards") {
    return (
      <Flashcards
        cards={flashcards}
        colors={colors}
        accent={accent}
        topPad={topPad}
        bottomPad={bottomPad}
        onClose={() => setMode("hub")}
        onResult={practiseFlashcard}
      />
    );
  }

  // ── Hub ─────────────────────────────────────────────────────────────────────
  const calibration = confidenceGap(sessions);
  const lengthIndex = Math.max(SESSION_LENGTHS.indexOf(config.length as any), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header {...{ topPad, accent, colors }} title="Interview" subtitle={`Practising for ${role}`} />

      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: bottomPad + 100 }} showsVerticalScrollIndicator={false}>
        <View style={{ marginHorizontal: -20, marginBottom: 6 }}>
          <RoleSwitcher accent={accent} />
        </View>

        <View style={styles.statRow}>
          <HeroStat icon={<Zap size={15} color={accent} />} value={String(progress.xp)} label="XP" colors={colors} />
          <HeroStat icon={<Flame size={15} color={colors.warning} />} value={`${progress.streakCount}`} label="day streak" colors={colors} />
          <HeroStat icon={<Award size={15} color={colors.success} />} value={String(progress.badges.length)} label="badges" colors={colors} />
        </View>

        {/* ── Start a session ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>New session</Text>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Difficulty</Text>
          <StepSlider
            steps={DIFFICULTIES}
            captions={DIFFICULTIES.map((d) => `${TIME_LIMITS[d]}s each`)}
            value={Math.max(DIFFICULTIES.indexOf(config.difficulty), 0)}
            onChange={(i) => setConfig({ difficulty: DIFFICULTIES[i] as Difficulty })}
            accent={accent}
            colors={colors}
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground, marginTop: 18 }]}>Questions</Text>
          <StepSlider
            steps={SESSION_LENGTHS.map(String)}
            value={lengthIndex}
            onChange={(i) => setConfig({ length: SESSION_LENGTHS[i], preset: "standard" })}
            accent={accent}
            colors={colors}
            disabled={config.preset === "quickfire"}
          />

          <View style={[styles.switchRow, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: colors.foreground }]}>Timed</Text>
              <Text style={[styles.switchSub, { color: colors.mutedForeground }]}>
                {TIME_LIMITS[config.difficulty]}s per question, submitted automatically when it runs out
              </Text>
            </View>
            <Switch
              value={config.timed}
              onValueChange={(v) => setConfig({ timed: v, preset: v ? config.preset : "standard" })}
              trackColor={{ true: accent, false: colors.border }}
              thumbColor="#fff"
              disabled={config.preset === "quickfire"}
            />
          </View>

          <Pressable
            style={[styles.presetRow, {
              backgroundColor: config.preset === "quickfire" ? accent + "14" : "transparent",
              borderColor: config.preset === "quickfire" ? accent + "44" : colors.border,
            }]}
            onPress={() => setConfig({ preset: config.preset === "quickfire" ? "standard" : "quickfire" })}
          >
            <Sparkles size={16} color={config.preset === "quickfire" ? accent : colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.switchLabel, { color: config.preset === "quickfire" ? accent : colors.foreground }]}>
                Quick Fire
              </Text>
              <Text style={[styles.switchSub, { color: colors.mutedForeground }]}>
                5 questions, timed, no feedback until the end
              </Text>
            </View>
            {config.preset === "quickfire" && <Check size={17} color={accent} />}
          </Pressable>

          {startError !== "" && (
            <Text style={[styles.error, { color: colors.destructive }]}>{startError}</Text>
          )}

          <Pressable
            style={[styles.primaryBtn, { backgroundColor: accent, marginTop: 16, opacity: isStarting ? 0.7 : 1 }]}
            onPress={begin}
            disabled={isStarting}
          >
            {isStarting
              ? <><ActivityIndicator color="#fff" size="small" /><Text style={styles.primaryBtnText}>Preparing questions…</Text></>
              : <><Play size={16} color="#fff" /><Text style={styles.primaryBtnText}>Start session</Text></>}
          </Pressable>
          {isStarting && (
            <Text style={[styles.switchSub, { color: colors.mutedForeground, textAlign: "center", marginTop: 8 }]}>
              The first session for a new role takes about half a minute to write. After that it's instant.
            </Text>
          )}
        </View>

        {/* ── Flashcards ── */}
        {flashcards.length > 0 && (
          <Pressable
            style={[styles.card, styles.rowCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setMode("flashcards")}
          >
            <View style={[styles.rowIcon, { backgroundColor: accent + "16" }]}>
              <Layers size={18} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 2 }]}>
                {flashcards.length} flashcard{flashcards.length === 1 ? "" : "s"}
              </Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Questions you scored under 70% on, with the key terms hidden
              </Text>
            </View>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </Pressable>
        )}

        {/* ── Mastery ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <Target size={15} color={accent} />
            <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 0 }]}>Mastery</Text>
          </View>
          <Text style={[styles.cardSub, { color: colors.mutedForeground, marginBottom: 14 }]}>
            Average score per competency for {role}
          </Text>
          <MasteryRadar data={mastery} accent={accent} colors={colors} size={Math.min(width - 100, 260)} />
        </View>

        {/* ── Trend ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <TrendingUp size={15} color={accent} />
            <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 0 }]}>Session history</Text>
          </View>
          <ScoreTrend sessions={sessions} accent={accent} colors={colors} width={width - 44 - 40} />

          {calibration.samples >= 3 && (
            <View style={[styles.calibration, { borderTopColor: colors.border }]}>
              <Text style={[styles.switchLabel, { color: colors.foreground }]}>
                {calibration.gap > 12
                  ? "You rate yourself higher than you score"
                  : calibration.gap < -12
                    ? "You're better than you think"
                    : "Your confidence tracks your results"}
              </Text>
              <Text style={[styles.switchSub, { color: colors.mutedForeground }]}>
                {calibration.gap > 12
                  ? `Confidence runs ${calibration.gap} points ahead of your actual score — that gap is where surprises in a real interview come from.`
                  : calibration.gap < -12
                    ? `You score ${Math.abs(calibration.gap)} points above how sure you felt. Trust yourself a little more.`
                    : `Within ${Math.abs(calibration.gap)} points across ${calibration.samples} answers — well calibrated.`}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────
function Header({ topPad, accent, colors, title, subtitle }: any) {
  return (
    <View style={[styles.headerWrap, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
      <LinearGradient
        colors={[accent + "1f", colors.background, colors.card]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.blob, { backgroundColor: accent + "22", right: -34, top: 10 }]} />
      <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>{subtitle}</Text>
    </View>
  );
}

function Section({ title, colors, children }: any) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
      {children}
    </View>
  );
}

function Tag({ label, tint, colors, muted }: any) {
  return (
    <View style={[styles.tag, { backgroundColor: muted ? colors.secondary : tint + "18" }]}>
      <Text style={[styles.tagText, { color: muted ? colors.mutedForeground : tint }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Stat({ icon, label, value, colors }: any) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function HeroStat({ icon, value, label, colors }: any) {
  return (
    <View style={[styles.heroStat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {icon}
      <Text style={[styles.heroValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.heroLabel, { color: colors.mutedForeground }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Confidence against the score, which is the blind-spot signal. */
function ConfidenceChip({ answer, colors }: { answer: AnswerRecord; colors: any }) {
  const felt = ((answer.confidence! - 1) / 4) * 100;
  const gap = felt - answer.score;
  const overconfident = gap > 20;
  const tint = overconfident ? colors.warning : colors.mutedForeground;
  return (
    <View style={[styles.confChip, { borderColor: tint + "55" }]}>
      <Text style={[styles.confChipTop, { color: tint }]}>{answer.confidence}/5</Text>
      <Text style={[styles.confChipSub, { color: tint }]}>
        {overconfident ? "over" : gap < -20 ? "under" : "on"}
      </Text>
    </View>
  );
}

/** Fill-in-the-blank recall over the questions scored below mastery. */
function Flashcards({ cards, colors, accent, topPad, bottomPad, onClose, onResult }: {
  cards: WeakQuestion[]; colors: any; accent: string; topPad: number; bottomPad: number;
  onClose: () => void; onResult: (id: string, recalled: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const card = cards[index];

  useEffect(() => { if (index >= cards.length) onClose(); }, [index, cards.length, onClose]);
  if (!card) return null;

  const segments = revealed
    ? segmentIdealAnswer(card.idealAnswer, card.keywords, card.keywords)
    : blankIdealAnswer(card.idealAnswer, card.keywords);

  const answer = (recalled: boolean) => {
    onResult(card.questionId, recalled);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.sessionBar, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close flashcards">
          <X size={22} color={colors.mutedForeground} />
        </Pressable>
        <Text style={[styles.counter, { color: colors.mutedForeground }]}>
          {index + 1} of {cards.length}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: bottomPad + 40 }}>
        <View style={styles.tagRow}>
          <Tag label={card.competency} tint={accent} colors={colors} />
          <Tag label={`Last scored ${card.lastScore}%`} tint={colors.destructive} colors={colors} />
        </View>

        <Text style={[styles.question, { color: colors.foreground }]}>{card.question}</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
            {revealed ? "The full answer" : "Fill the gaps from memory"}
          </Text>
          <KeywordAnswer segments={segments} colors={colors} />
        </View>

        {!revealed ? (
          <Pressable style={[styles.primaryBtn, { backgroundColor: accent }]} onPress={() => setRevealed(true)}>
            <Text style={styles.primaryBtnText}>Reveal</Text>
          </Pressable>
        ) : (
          <View style={styles.recallRow}>
            <Pressable
              style={[styles.recallBtn, { borderColor: colors.destructive + "55", backgroundColor: colors.destructive + "12" }]}
              onPress={() => answer(false)}
            >
              <RotateCcw size={16} color={colors.destructive} />
              <Text style={[styles.recallText, { color: colors.destructive }]}>Missed it</Text>
            </Pressable>
            <Pressable
              style={[styles.recallBtn, { borderColor: colors.success + "55", backgroundColor: colors.success + "12" }]}
              onPress={() => answer(true)}
            >
              <Check size={16} color={colors.success} />
              <Text style={[styles.recallText, { color: colors.success }]}>Recalled</Text>
            </Pressable>
          </View>
        )}
        <Text style={[styles.switchSub, { color: colors.mutedForeground, textAlign: "center", marginTop: 12 }]}>
          Two clean recalls retire a card. One only proves you just read it.
        </Text>
      </ScrollView>
    </View>
  );
}

function formatClock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },

  headerWrap: {
    paddingHorizontal: 24, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, position: "relative", overflow: "hidden",
  },
  blob: { position: "absolute", width: 150, height: 150, borderRadius: 999 },
  headerTitle: { fontSize: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSub: { fontSize: 12.5, fontFamily: "Inter_500Medium", marginTop: 2 },

  sessionBar: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "rgba(127,127,127,0.22)", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  counter: { fontFamily: "Inter_600SemiBold", fontSize: 12.5 },

  card: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 15.5, marginBottom: 10, letterSpacing: -0.2 },
  cardSub: { fontFamily: "Inter_500Medium", fontSize: 12.5, lineHeight: 18 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11.5, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" },

  statRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  heroStat: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: "center", gap: 4 },
  heroValue: { fontFamily: "Inter_700Bold", fontSize: 19, letterSpacing: -0.5 },
  heroLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },

  switchRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  switchSub: { fontFamily: "Inter_500Medium", fontSize: 11.5, lineHeight: 16, marginTop: 2 },

  presetRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1,
  },

  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 15, borderRadius: 14,
  },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },
  error: { fontFamily: "Inter_500Medium", fontSize: 12.5, marginTop: 12, lineHeight: 18 },

  tagRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, maxWidth: 190 },
  tagText: { fontFamily: "Inter_600SemiBold", fontSize: 11.5 },
  timer: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, marginLeft: "auto" },
  timerText: { fontFamily: "Inter_700Bold", fontSize: 12.5, fontVariant: ["tabular-nums"] },

  question: { fontFamily: "Inter_700Bold", fontSize: 19, lineHeight: 27, letterSpacing: -0.3, marginBottom: 8 },
  comebackNote: { fontFamily: "Inter_600SemiBold", fontSize: 12.5, marginBottom: 12 },
  answerInput: {
    minHeight: 160, borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 8,
    fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22,
  },
  confidenceCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 16 },
  confidenceLabel: { fontFamily: "Inter_700Bold", fontSize: 14, marginBottom: 4 },
  confidenceHint: { fontFamily: "Inter_500Medium", fontSize: 11.5, lineHeight: 16, marginBottom: 12 },
  quickfireNote: { fontFamily: "Inter_500Medium", fontSize: 12, textAlign: "center", marginTop: 10 },

  scoreCard: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 18, borderWidth: 1, padding: 18, marginBottom: 16 },
  scoreValue: { fontFamily: "Inter_700Bold", fontSize: 38, letterSpacing: -1.5 },
  scoreTier: { fontFamily: "Inter_700Bold", fontSize: 15 },
  scoreSub: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2, lineHeight: 17 },
  confChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" },
  confChipTop: { fontFamily: "Inter_700Bold", fontSize: 13 },
  confChipSub: { fontFamily: "Inter_500Medium", fontSize: 10 },

  bodyText: { fontFamily: "Inter_400Regular", fontSize: 14.5, lineHeight: 22 },
  bullet: { flexDirection: "row", gap: 10, marginBottom: 9, alignItems: "flex-start" },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  bulletText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 21 },

  bigScore: { fontFamily: "Inter_700Bold", fontSize: 48, letterSpacing: -2 },
  summaryStats: { flexDirection: "row", gap: 26, marginTop: 16 },
  stat: { alignItems: "center", gap: 3 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 16 },
  statLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },

  weakRow: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 10 },
  weakScore: { fontFamily: "Inter_700Bold", fontSize: 15, width: 30 },
  weakText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13.5, lineHeight: 19 },

  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  calibration: { marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },

  recallRow: { flexDirection: "row", gap: 12 },
  recallBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1,
  },
  recallText: { fontFamily: "Inter_700Bold", fontSize: 14 },

  gate: { padding: 32, alignItems: "center", gap: 12 },
  gateIcon: { width: 62, height: 62, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, marginBottom: 6 },
  gateTitle: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.3 },
  gateBody: { fontFamily: "Inter_500Medium", fontSize: 13.5, lineHeight: 20, textAlign: "center", marginBottom: 10 },
});
