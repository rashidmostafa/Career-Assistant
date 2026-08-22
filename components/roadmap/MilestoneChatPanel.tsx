/**
 * Slide-in chat scoped to a single milestone.
 *
 * The model is given that milestone, where it sits in the wider roadmap, and
 * the conversation so far — so "what should I do first?" is answerable without
 * the user restating any of it.
 *
 * The answer streams in. On a slow connection a complete reply can take ten
 * seconds, and a panel that shows nothing for ten seconds reads as broken even
 * when it is working.
 *
 * History lives in the parent, keyed by milestone id, so switching cards and
 * coming back keeps the thread for the session.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { askAboutMilestone, type ChatTurn, type Milestone, type MilestoneRoadmap } from "@/services/roadmapAI";

const { width: SCREEN_W } = Dimensions.get("window");
const PANEL_W = Math.min(420, SCREEN_W * 0.92);

interface Props {
  visible: boolean;
  milestone: Milestone | null;
  roadmap: MilestoneRoadmap | null;
  history: ChatTurn[];
  onHistoryChange: (milestoneId: string, turns: ChatTurn[]) => void;
  onClose: () => void;
}

export function MilestoneChatPanel({
  visible, milestone, roadmap, history, onHistoryChange, onClose,
}: Props) {
  const colors = useColors() as any;
  const slide = useRef(new Animated.Value(PANEL_W)).current;
  const scrollRef = useRef<ScrollView>(null);

  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : PANEL_W,
      duration: 220,
      useNativeDriver: true,
    }).start();
    if (!visible) {
      // Stop paying for tokens nobody will read.
      abortRef.current.aborted = true;
      setPartial("");
      setStreaming(false);
    }
  }, [visible, slide]);

  const send = async () => {
    const q = question.trim();
    if (!q || !milestone || !roadmap || streaming) return;

    const asked: ChatTurn[] = [...history, { role: "user", content: q }];
    onHistoryChange(milestone.id, asked);
    setQuestion("");
    setStreaming(true);
    setPartial("");

    abortRef.current = { aborted: false };
    const signal = abortRef.current;

    const answer = await askAboutMilestone(
      milestone,
      roadmap,
      history,
      q,
      (_chunk, full) => {
        if (signal.aborted) return;
        setPartial(full);
        scrollRef.current?.scrollToEnd({ animated: true });
      },
      signal,
    );

    if (!signal.aborted) {
      onHistoryChange(milestone.id, [
        ...asked,
        {
          role: "assistant",
          content: answer ?? "I couldn't reach the AI just now. Try again in a moment.",
        },
      ]);
      setPartial("");
      setStreaming(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close chat" />

        <Animated.View
          style={[
            styles.panel,
            {
              width: PANEL_W,
              backgroundColor: colors.background,
              borderLeftColor: colors.border,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerLabel, { color: colors.mutedForeground }]}>ASKING ABOUT</Text>
              <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={2}>
                {milestone?.title ?? ""}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          >
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.thread}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {history.length === 0 && !streaming && (
                <View style={styles.empty}>
                  <Feather name="message-circle" size={26} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    Ask anything about this milestone — where to start, what good looks like,
                    or how to tell you're finished.
                  </Text>
                </View>
              )}

              {history.map((turn, i) => (
                <View
                  key={i}
                  style={[
                    styles.bubble,
                    turn.role === "user"
                      ? { alignSelf: "flex-end", backgroundColor: colors.primary }
                      : { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.bubbleText,
                      { color: turn.role === "user" ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {turn.content}
                  </Text>
                </View>
              ))}

              {streaming && (
                <View
                  style={[
                    styles.bubble,
                    { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  {partial ? (
                    <Text style={[styles.bubbleText, { color: colors.foreground }]}>{partial}</Text>
                  ) : (
                    <ActivityIndicator size="small" color={colors.mutedForeground} />
                  )}
                </View>
              )}
            </ScrollView>

            <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Ask about this milestone…"
                placeholderTextColor={colors.mutedForeground}
                value={question}
                onChangeText={setQuestion}
                multiline
                editable={!streaming}
                onSubmitEditing={send}
              />
              <Pressable
                onPress={send}
                disabled={streaming || !question.trim()}
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: streaming || !question.trim() ? 0.45 : pressed ? 0.8 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send question"
              >
                <Feather name="arrow-up" size={18} color={colors.primaryForeground} />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: { borderLeftWidth: 1, paddingTop: Platform.OS === "web" ? 20 : 48 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderBottomWidth: 1 },
  headerLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.9 },
  headerTitle: { fontSize: 15, fontWeight: "700", marginTop: 3, lineHeight: 20 },
  thread: { padding: 16, gap: 10 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 40, paddingHorizontal: 12 },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  bubble: { maxWidth: "88%", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1 },
  input: { flex: 1, maxHeight: 110, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
