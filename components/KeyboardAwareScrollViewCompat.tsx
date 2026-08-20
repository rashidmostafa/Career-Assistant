import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
} from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import type { KeyboardAwareScrollViewProps } from "react-native-keyboard-controller";

/**
 * react-native-keyboard-controller is a third-party native module, so it is
 * NOT bundled into Expo Go. Requiring it there throws while resolving its
 * TurboModule, which crashes the app on launch. Resolve it defensively and
 * fall back to React Native's built-in keyboard avoidance when it is missing,
 * so the same source runs in Expo Go and in a native/EAS build.
 */
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let keyboardController: typeof import("react-native-keyboard-controller") | null =
  null;

if (!isExpoGo && Platform.OS !== "web") {
  try {
    keyboardController = require("react-native-keyboard-controller");
  } catch {
    keyboardController = null;
  }
}

export const isKeyboardControllerAvailable = keyboardController !== null;

/**
 * Drop-in for KeyboardProvider that becomes a passthrough when the native
 * module is unavailable.
 */
export function KeyboardProviderCompat({
  children,
}: {
  children: React.ReactNode;
}) {
  const Provider = keyboardController?.KeyboardProvider;
  if (!Provider) return <>{children}</>;
  return <Provider>{children}</Provider>;
}

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  const NativeScrollView = keyboardController?.KeyboardAwareScrollView;

  if (NativeScrollView) {
    return (
      <NativeScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </NativeScrollView>
    );
  }

  // Web has no keyboard to avoid; render a plain scroll view.
  if (Platform.OS === "web") {
    return (
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }

  // Expo Go fallback: RN's built-in avoidance keeps forms usable.
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
