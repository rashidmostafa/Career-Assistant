/**
 * BiometricButton — prompts native biometric, shows availability state.
 */
import React, { useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { BiometricType } from "@/services/biometricService";

interface Props {
  type: BiometricType;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}

export function BiometricButton({ type, onPress, loading = false, disabled = false, label }: Props) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;

  if (type === "None") return null;

  const emoji = type === "FaceID" ? "😶" : "👆";
  const title = label ?? (type === "FaceID" ? "Sign in with Face ID" : "Sign in with Fingerprint");

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.93, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: loading, disabled }}
    >
      <Animated.View
        style={[
          styles.btn,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : 1,
            transform: [{ scale }],
          },
        ]}
      >
        {loading ? (
          <Text style={styles.emoji}>⏳</Text>
        ) : (
          <Text style={styles.emoji}>{emoji}</Text>
        )}
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>Quick and secure</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  emoji: { fontSize: 32 },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  sub:   { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
});
