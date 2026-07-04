import { Mic, X, ArrowRight, CheckCircle, AlertCircle, BookOpen } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScoreRing } from "@/components/ScoreRing";
import { useInterview } from "@/context/InterviewContext";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const TYPE_COLORS: Record<string, string> = {
  Technical: "#3b82f6",
  Behavioral: "#8b5cf6",
  "System Design": "#f59e0b",
};

export default function InterviewScreen() {
  const colors = useColors() as any;
  const intColor = colors.interview || colors.primary;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { sessions, currentSession, isGenerating, startSession, submitAnswer, finishSession } = useInterview();
  const [phase, setPhase] = useState<"home" | "active" | "results">("home");
  const [currentQIdx, setCurrentQIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<{ score: number; feedback: string; correctAnswer: string } | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const targetRole = user?.targetRole || "Software Engineer";

  const handleStart = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await startSession(targetRole);
    setCurrentQIdx(0);
    setLastFeedback(null);
    setPhase("active");
  };

  const handleSubmitAnswer = async () => {
    if (!answer.trim() || !currentSession) return;
    setIsSubmitting(true);
    try {
      const q = currentSession.questions[currentQIdx];
      const result = await submitAnswer(q.id, answer.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLastFeedback({ score: result.score, feedback: result.feedback, correctAnswer: result.correctAnswer });
      setAnswer("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    if (!currentSession) return;
    if (currentQIdx < currentSession.questions.length - 1) {
      setCurrentQIdx(currentQIdx + 1);
      setLastFeedback(null);
    } else {
      finishSession();
      setPhase("results");
    }
  };

  const lastSession = sessions[sessions.length - 1];

  // ── HOME ──────────────────────────────────────────────────────────────
  if (phase === "home") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Mock Interview</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Real questions · AI feedback · Precise scoring</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: bottomPad + 100 }}>
          <TouchableOpacity style={[styles.startCard, { backgroundColor: intColor }]} onPress={handleStart} activeOpacity={0.9} disabled={isGenerating}>
            <View style={styles.micCircle}>
              <Mic size={40} color={intColor} strokeWidth={2.5} />
            </View>
            {isGenerating ? <ActivityIndicator color="#fff" size="large" style={{ marginVertical: 8 }} /> : (
              <>
                <Text style={styles.startTitle}>Start Interview Session</Text>
                <View style={[styles.roleChip, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                  <Text style={styles.roleChipText}>{targetRole}</Text>
                </View>
                <Text style={styles.startSub}>5 randomised questions for your role · Instant AI grading</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={[styles.infoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[{ num: "5", label: "Questions" }, { num: "AI", label: "Graded" }, { num: "4", label: "Criteria" }].map((item, i) => (
              <React.Fragment key={item.label}>
                {i > 0 && <View style={[styles.infoDivider, { backgroundColor: colors.border }]} />}
                <View style={styles.infoItem}>
                  <Text style={[styles.infoNum, { color: intColor }]}>{item.num}</Text>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          <View style={[styles.criteriaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.criteriaTitle, { color: colors.foreground }]}>Scoring Criteria</Text>
            {[
              { label: "Relevance to question", pct: "40%" },
              { label: "Accuracy / correctness", pct: "30%" },
              { label: "Completeness", pct: "20%" },
              { label: "Language / grammar", pct: "10%" },
            ].map((c) => (
              <View key={c.label} style={styles.criteriaRow}>
                <Text style={[styles.criteriaLabel, { color: colors.mutedForeground }]}>{c.label}</Text>
                <Text style={[styles.criteriaPct, { color: intColor }]}>{c.pct}</Text>
              </View>
            ))}
          </View>

          {sessions.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Past Sessions</Text>
              {[...sessions].reverse().map((s) => (
                <View key={s.id} style={[styles.sessionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sessionRole, { color: colors.foreground }]}>{s.jobRole}</Text>
                    <Text style={[styles.sessionDate, { color: colors.mutedForeground }]}>{new Date(s.createdAt).toLocaleDateString()} · {s.questions.length} questions</Text>
                  </View>
                  {s.overallScore !== null && <ScoreRing score={s.overallScore} size={64} label="Score" />}
                </View>
              ))}
            </>
          )}

          {sessions.length === 0 && (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Mic size={32} color={colors.mutedForeground} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No sessions yet</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Start your first interview to receive AI feedback and track your progress.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── ACTIVE ────────────────────────────────────────────────────────────
  if (phase === "active" && currentSession) {
    const q = currentSession.questions[currentQIdx];
    const progress = ((currentQIdx + 1) / currentSession.questions.length) * 100;
    const typeColor = TYPE_COLORS[q?.type] || intColor;
    const answered = currentSession.answers.find((a) => a.questionId === q?.id);

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity onPress={() => Alert.alert("Exit", "End this session?", [
            { text: "Cancel", style: "cancel" },
            { text: "Exit", style: "destructive", onPress: () => { setPhase("home"); setLastFeedback(null); } },
          ])}>
            <X size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground, textAlign: "center", flex: 1, marginRight: 24 }]}>
            Q {currentQIdx + 1} / {currentSession.questions.length}
          </Text>
        </View>

        <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: intColor }]} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: bottomPad + 40 }} keyboardShouldPersistTaps="handled">
          {/* Question */}
          <View style={[styles.questionBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.questionMeta}>
              <View style={[styles.qBadge, { backgroundColor: typeColor + "20" }]}>
                <Text style={[styles.qBadgeText, { color: typeColor }]}>{q.type}</Text>
              </View>
              <View style={[styles.qBadge, { backgroundColor: colors.muted }]}>
                <Text style={[styles.qBadgeText, { color: colors.mutedForeground }]}>{q.category}</Text>
              </View>
            </View>
            <Text style={[styles.questionText, { color: colors.foreground }]}>{q.question}</Text>
            {q.source && (
              <View style={[styles.sourceRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.sourceText, { color: colors.mutedForeground }]}>Asked at: {q.source}</Text>
              </View>
            )}
          </View>

          {/* Answer area (only if no feedback yet) */}
          {!lastFeedback && (
            <>
              <TextInput
                style={[styles.answerInput, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Type your answer here… Use the STAR method for behavioral questions."
                placeholderTextColor={colors.mutedForeground}
                multiline
                value={answer}
                onChangeText={setAnswer}
              />
              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: intColor, opacity: (isSubmitting || !answer.trim()) ? 0.6 : 1 }]}
                onPress={handleSubmitAnswer}
                disabled={isSubmitting || !answer.trim()}
              >
                {isSubmitting ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <CheckCircle size={18} color="#fff" />
                    <Text style={styles.submitBtnText}>Submit Answer</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* Feedback + Correct Answer */}
          {lastFeedback && (
            <View style={[styles.feedbackBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {/* Score */}
              <View style={styles.feedbackTop}>
                <ScoreRing score={lastFeedback.score} size={80} label="Score" />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={[styles.feedbackTitle, { color: colors.foreground }]}>
                    {lastFeedback.score >= 80 ? "Excellent answer!" : lastFeedback.score >= 55 ? "Good attempt" : lastFeedback.score > 0 ? "Needs improvement" : "No valid answer"}
                  </Text>
                  <Text style={[styles.feedbackText, { color: colors.mutedForeground }]}>{lastFeedback.feedback}</Text>
                </View>
              </View>

              {/* Your Answer */}
              <View style={[styles.answerCompareBubble, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={styles.compareHeader}>
                  <AlertCircle size={14} color={colors.mutedForeground} />
                  <Text style={[styles.compareLabel, { color: colors.mutedForeground }]}>Your Answer</Text>
                </View>
                <Text style={[styles.compareText, { color: colors.foreground }]}>
                  {currentSession.answers.find((a) => a.questionId === q.id)?.transcript || answer || "—"}
                </Text>
              </View>

              {/* Correct Answer */}
              <View style={[styles.answerCompareBubble, { backgroundColor: intColor + "10", borderColor: intColor + "30" }]}>
                <View style={styles.compareHeader}>
                  <BookOpen size={14} color={intColor} />
                  <Text style={[styles.compareLabel, { color: intColor }]}>Model Answer</Text>
                </View>
                <Text style={[styles.compareText, { color: colors.foreground }]}>{lastFeedback.correctAnswer}</Text>
              </View>

              <TouchableOpacity style={[styles.nextBtn, { backgroundColor: intColor }]} onPress={handleNext}>
                <Text style={styles.nextBtnText}>
                  {currentQIdx < currentSession.questions.length - 1 ? "Next Question" : "See Results"}
                </Text>
                <ArrowRight size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── RESULTS ────────────────────────────────────────────────────────────
  if (phase === "results") {
    const last = sessions[sessions.length - 1];
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity onPress={() => setPhase("home")}><X size={24} color={colors.foreground} /></TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground, flex: 1, textAlign: "center", marginRight: 24 }]}>Session Results</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: bottomPad + 100 }}>
          <View style={[styles.resultsCard, { backgroundColor: intColor }]}>
            <ScoreRing score={last?.overallScore ?? 0} size={120} label="Final Score" />
            <Text style={styles.resultsTitle}>{last?.jobRole}</Text>
            <Text style={styles.resultsFeedback}>{last?.feedback}</Text>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Question Breakdown</Text>
          {last?.questions.map((q, i) => {
            const ans = last.answers.find((a) => a.questionId === q.id);
            return (
              <View key={q.id} style={[styles.breakdownCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.breakdownTop}>
                  <Text style={[styles.breakdownQ, { color: colors.foreground, flex: 1, marginRight: 12 }]}>Q{i + 1}: {q.question}</Text>
                  {ans && <ScoreRing score={ans.score} size={56} label="" />}
                </View>
                {ans && (
                  <>
                    <Text style={[styles.breakdownFeedback, { color: colors.mutedForeground }]}>{ans.feedback}</Text>
                    <View style={[styles.answerCompareBubble, { backgroundColor: intColor + "10", borderColor: intColor + "30", marginTop: 10 }]}>
                      <View style={styles.compareHeader}>
                        <BookOpen size={12} color={intColor} />
                        <Text style={[styles.compareLabel, { color: intColor }]}>Model Answer</Text>
                      </View>
                      <Text style={[styles.compareText, { color: colors.foreground }]}>{ans.correctAnswer}</Text>
                    </View>
                  </>
                )}
              </View>
            );
          })}

          <TouchableOpacity style={[styles.nextBtn, { backgroundColor: intColor, marginTop: 8 }]} onPress={() => setPhase("home")}>
            <Text style={styles.nextBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSub: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  startCard: { borderRadius: 28, padding: 32, alignItems: "center", marginBottom: 20, gap: 12 },
  micCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  startTitle: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  roleChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  roleChipText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 13 },
  startSub: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  infoRow: { flexDirection: "row", borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 20, justifyContent: "space-around" },
  infoItem: { alignItems: "center", gap: 4 },
  infoDivider: { width: 1, height: "100%" },
  infoNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  criteriaCard: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 24 },
  criteriaTitle: { fontFamily: "Inter_700Bold", fontSize: 15, marginBottom: 12 },
  criteriaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.05)" },
  criteriaLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  criteriaPct: { fontFamily: "Inter_700Bold", fontSize: 14 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 14, letterSpacing: -0.3 },
  sessionCard: { flexDirection: "row", alignItems: "center", borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  sessionRole: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sessionDate: { fontSize: 13, fontFamily: "Inter_500Medium" },
  emptyState: { borderRadius: 20, padding: 32, borderWidth: 1, alignItems: "center", gap: 12 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  emptySub: { fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center", lineHeight: 22 },
  progressBar: { height: 4 },
  progressFill: { height: 4 },
  questionBubble: { borderRadius: 24, padding: 24, borderWidth: 1, marginBottom: 24 },
  questionMeta: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  qBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  qBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  questionText: { fontSize: 19, fontFamily: "Inter_700Bold", lineHeight: 27, letterSpacing: -0.3 },
  sourceRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 16 },
  sourceText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  answerInput: { borderRadius: 20, padding: 20, fontSize: 15, fontFamily: "Inter_500Medium", minHeight: 180, borderWidth: 1, marginBottom: 16, lineHeight: 24 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 18, borderRadius: 16 },
  submitBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  feedbackBox: { borderRadius: 24, padding: 24, borderWidth: 1 },
  feedbackTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 20 },
  feedbackTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 8 },
  feedbackText: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22 },
  answerCompareBubble: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  compareHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  compareLabel: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  compareText: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22 },
  nextBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 16, marginTop: 4 },
  nextBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  resultsCard: { borderRadius: 24, padding: 32, alignItems: "center", marginBottom: 32, gap: 12 },
  resultsTitle: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  resultsFeedback: { color: "rgba(255,255,255,0.9)", fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 8, lineHeight: 22 },
  breakdownCard: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  breakdownTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  breakdownQ: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 22 },
  breakdownFeedback: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 20 },
});
