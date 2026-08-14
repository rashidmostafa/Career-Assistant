/**
 * SecurityQuestionsForm — Set / answer security questions.
 */
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { useColors } from "@/hooks/useColors";

export const PRESET_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the name of your primary school?",
  "What was your childhood nickname?",
  "What is the name of your favourite teacher?",
  "What was the make of your first car?",
  "What is the name of the street you grew up on?",
];

interface QAPair {
  question: string;
  answer: string;
}

interface Props {
  onSubmit: (questions: QAPair[]) => void;
  submitLabel?: string;
  loading?: boolean;
  count?: number;
  /**
   * When set, renders in "verify" mode: the questions shown are exactly
   * these (read-only, no picker) and the user only fills in answers.
   * Without this, the form is in "setup" mode — pick any questions from
   * the preset list and answer them for the first time.
   */
  fixedQuestions?: string[];
}

export function SecurityQuestionsForm({ onSubmit, submitLabel = "Save Questions", loading = false, count = 3, fixedQuestions }: Props) {
  const colors = useColors();
  const isVerifyMode = !!fixedQuestions?.length;
  const [pairs, setPairs] = useState<QAPair[]>(
    isVerifyMode
      ? fixedQuestions!.map((q) => ({ question: q, answer: "" }))
      : Array.from({ length: count }, () => ({ question: PRESET_QUESTIONS[0], answer: "" }))
  );
  const [openPicker, setOpenPicker] = useState<number | null>(null);

  const setQuestion = (idx: number, q: string) => {
    const next = [...pairs];
    next[idx] = { ...next[idx], question: q };
    setPairs(next);
    setOpenPicker(null);
  };

  const setAnswer = (idx: number, a: string) => {
    const next = [...pairs];
    next[idx] = { ...next[idx], answer: a };
    setPairs(next);
  };

  const canSubmit = pairs.every((p) => p.answer.trim().length >= 3);

  return (
    <View>
      {pairs.map((pair, idx) => (
        <View key={idx} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Question {idx + 1}</Text>

          {isVerifyMode ? (
            /* Verify mode — show the actual saved question, no picker */
            <View style={[styles.picker, { borderColor: colors.border }]}>
              <Text style={[styles.pickerText, { color: colors.foreground }]} numberOfLines={2}>{pair.question}</Text>
            </View>
          ) : (
            <>
              {/* Question picker (setup mode only) */}
              <TouchableOpacity
                style={[styles.picker, { borderColor: colors.border }]}
                onPress={() => setOpenPicker(openPicker === idx ? null : idx)}
                accessibilityRole="combobox"
                accessibilityLabel={`Select question ${idx + 1}`}
                accessibilityState={{ expanded: openPicker === idx }}
              >
                <Text style={[styles.pickerText, { color: colors.foreground }]} numberOfLines={2}>{pair.question}</Text>
                <ChevronDown size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              {openPicker === idx && (
                <ScrollView style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]} nestedScrollEnabled>
                  {PRESET_QUESTIONS.map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={[styles.option, { borderBottomColor: colors.border }]}
                      onPress={() => setQuestion(idx, q)}
                      accessibilityRole="menuitem"
                    >
                      <Text style={[styles.optionText, { color: q === pair.question ? colors.primary : colors.foreground }]}>
                        {q}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {/* Answer */}
          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 10 }]}>Your Answer</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            value={pair.answer}
            onChangeText={(t) => setAnswer(idx, t)}
            placeholder="Enter your answer"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            accessibilityLabel={`Answer for question ${idx + 1}`}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: canSubmit && !loading ? 1 : 0.5 }]}
        onPress={() => canSubmit && onSubmit(pairs)}
        disabled={!canSubmit || loading}
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: !canSubmit || loading, busy: loading }}
      >
        <Text style={styles.submitText}>{loading ? "Saving…" : submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 },
  picker: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  pickerText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  dropdown: { borderWidth: 1, borderRadius: 10, maxHeight: 180, marginTop: 4 },
  option: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  optionText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontFamily: "Inter_500Medium", fontSize: 15, marginTop: 2 },
  submitBtn: { borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  submitText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
});
