/**
 * OtpInput — 6-digit OTP entry with auto-focus, auto-submit, and paste support.
 */
import React, { useRef, useState } from "react";
import {
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

const DIGITS = 6;

interface Props {
  onComplete: (code: string) => void;
  onReset?: () => void;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({ onComplete, disabled = false, hasError = false, autoFocus = true }: Props) {
  const colors = useColors();
  const [values, setValues] = useState<string[]>(Array(DIGITS).fill(""));
  const refs = useRef<Array<TextInput | null>>(Array(DIGITS).fill(null));

  const handleChange = (text: string, idx: number) => {
    // Handle paste — strip non-digits, fill from current position
    const digits = text.replace(/\D/g, "").slice(0, DIGITS - idx);
    if (digits.length > 1) {
      const next = [...values];
      for (let i = 0; i < digits.length && idx + i < DIGITS; i++) {
        next[idx + i] = digits[i];
      }
      setValues(next);
      const nextIdx = Math.min(idx + digits.length, DIGITS - 1);
      refs.current[nextIdx]?.focus();
      if (next.every((v) => v !== "")) onComplete(next.join(""));
      return;
    }

    const single = text.replace(/\D/g, "").slice(-1);
    const next = [...values];
    next[idx] = single;
    setValues(next);

    if (single && idx < DIGITS - 1) refs.current[idx + 1]?.focus();
    if (next.every((v) => v !== "")) onComplete(next.join(""));
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, idx: number) => {
    if (e.nativeEvent.key === "Backspace" && !values[idx] && idx > 0) {
      const next = [...values];
      next[idx - 1] = "";
      setValues(next);
      refs.current[idx - 1]?.focus();
    }
  };

  const cellStyle = (idx: number) => [
    styles.cell,
    {
      backgroundColor: colors.card,
      borderColor: hasError
        ? "#ef4444"
        : values[idx]
        ? colors.primary
        : colors.border,
      color: colors.foreground,
    },
  ];

  return (
    <View style={styles.row} accessibilityRole="none" accessibilityLabel="Enter 6-digit verification code">
      {values.map((val, idx) => (
        <TextInput
          key={idx}
          ref={(r) => { refs.current[idx] = r; }}
          style={cellStyle(idx)}
          value={val}
          onChangeText={(t) => handleChange(t, idx)}
          onKeyPress={(e) => handleKeyPress(e, idx)}
          keyboardType="number-pad"
          maxLength={DIGITS} // allow paste
          selectTextOnFocus
          editable={!disabled}
          autoFocus={autoFocus && idx === 0}
          textContentType="oneTimeCode"
          accessibilityLabel={`Digit ${idx + 1}`}
          accessibilityValue={{ text: val || "empty" }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, justifyContent: "center" },
  cell: {
    width: 46,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    textAlign: "center",
    fontFamily: "Inter_700Bold",
    fontSize: 22,
  },
});
