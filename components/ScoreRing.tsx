import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  score: number;
  size?: number;
  label?: string;
}

export function ScoreRing({ score, size = 80, label }: Props) {
  const colors = useColors();
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(score / 100, { duration: 1200 });
  }, [score]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  const color =
    score >= 80 ? colors.success : score >= 60 ? colors.warning : colors.destructive;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={8}
          fill="transparent"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={8}
          fill="transparent"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          strokeLinecap="round"
        />
      </Svg>
      <View style={[styles.inner, { width: size, height: size }]}>
        <Text style={[styles.score, { color }]}>{score}</Text>
        {label ? <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  inner: { position: "absolute", alignItems: "center", justifyContent: "center" },
  score: { fontSize: 20, fontFamily: "Inter_700Bold" },
  label: { fontSize: 9, fontFamily: "Inter_400Regular", marginTop: 1 },
});
