/**
 * BiometricButton — prompts native biometric, shows availability state.
 */
import React, { useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Fingerprint } from "lucide-react-native";
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

  // One wording for every sensor: naming the hardware told the user which chip
  // their phone has, not what the button does.
  const title = label ?? "Sign in with biometrics";

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
          <ActivityIndicator size="small" color={colors.foreground} style={styles.icon} />
        ) : (
          <Fingerprint size={26} color={colors.foreground} style={styles.icon} />
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
  icon: { width: 30, alignItems: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 15 },
  sub:   { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 2 },
});
