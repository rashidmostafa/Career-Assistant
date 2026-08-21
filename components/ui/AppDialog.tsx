/**
 * AppDialog — in-app replacement for OS/browser alert dialogs.
 *
 * Alert.alert renders nothing at all on react-native-web (which is what made
 * the sign-out button look dead in the browser), and on Android it renders a
 * system dialog that ignores the app's theme. This provider renders a themed
 * dialog inside the app on every platform, so confirmations look like part of
 * the product and behave identically everywhere.
 *
 * Call sites keep using showAlert() from utils/alert — this only changes what
 * appears on screen.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AlertButton,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { registerDialogHandler } from "@/utils/alert";

type DialogRequest = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

const DialogContext = createContext<((req: DialogRequest) => void) | null>(null);

export function useDialog() {
  const show = useContext(DialogContext);
  if (!show) throw new Error("useDialog must be used inside <DialogProvider>");
  return show;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors() as any;
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const show = useCallback((req: DialogRequest) => setRequest(req), []);

  // Route the imperative showAlert() helper into this provider. Registering in
  // render (not an effect) means dialogs raised during the very first paint —
  // a session-expiry warning, for example — are not dropped on the floor.
  useMemo(() => registerDialogHandler(show), [show]);

  const dismiss = useCallback(
    (button?: AlertButton) => {
      setRequest(null);
      // Fire after the modal is torn down so a callback that navigates or
      // opens another dialog is not racing this one's exit animation.
      if (button?.onPress) setTimeout(() => button.onPress?.(), 0);
    },
    [],
  );

  const buttons = request?.buttons ?? [];
  // Cancel sits on the left, matching the platform conventions users expect.
  const ordered = [...buttons].sort((a, b) =>
    a.style === "cancel" ? -1 : b.style === "cancel" ? 1 : 0,
  );

  return (
    <DialogContext.Provider value={show}>
      {children}
      <Modal
        visible={!!request}
        transparent
        animationType="fade"
        // Android's hardware back button should read as "cancel", never as
        // silent confirmation of a destructive action.
        onRequestClose={() => dismiss(buttons.find((b) => b.style === "cancel"))}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            // Tapping outside cancels — but only when a cancel button exists.
            // A single-button alert is informational and stays put.
            const cancel = buttons.find((b) => b.style === "cancel");
            if (cancel || buttons.length > 1) dismiss(cancel);
          }}
        >
          {/* Stop taps inside the card from reaching the backdrop. */}
          <Pressable
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <Text style={[styles.title, { color: colors.foreground }]}>{request?.title}</Text>
            {!!request?.message && (
              <Text style={[styles.message, { color: colors.mutedForeground }]}>
                {request.message}
              </Text>
            )}

            <View style={[styles.actions, ordered.length > 2 && styles.actionsStacked]}>
              {ordered.map((b, i) => {
                const destructive = b.style === "destructive";
                const cancel = b.style === "cancel";
                return (
                  <Pressable
                    key={`${b.text}-${i}`}
                    onPress={() => dismiss(b)}
                    style={({ pressed }) => [
                      styles.button,
                      ordered.length > 2 && styles.buttonFull,
                      {
                        backgroundColor: cancel
                          ? colors.secondary
                          : destructive
                            ? colors.destructive
                            : colors.primary,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        {
                          color: cancel
                            ? colors.secondaryForeground
                            : destructive
                              ? colors.destructiveForeground
                              : colors.primaryForeground,
                        },
                      ]}
                    >
                      {b.text ?? "OK"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24 },
  message: { fontFamily: "Inter_400Regular", fontSize: 14.5, lineHeight: 21 },
  actions: { flexDirection: "row", gap: 10, marginTop: 14, justifyContent: "flex-end" },
  actionsStacked: { flexDirection: "column-reverse" },
  button: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, minWidth: 92, alignItems: "center" },
  buttonFull: { width: "100%" },
  buttonText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
