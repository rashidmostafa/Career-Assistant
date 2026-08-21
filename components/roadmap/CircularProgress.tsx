import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from "react-native-reanimated";
import Svg, { Circle, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import type { SkillStatus } from "@/context/RoadmapContext";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const SKILL_STATUS_COLORS: Record<SkillStatus, string> = {
  Pending: "#94a3b8",
  Learning: "#f59e0b",
  Mastered: "#3b82f6",
  Expert: "#10b981",
};

export type ProgressLevel = "macro" | "micro" | "individual";

interface Props {
  progress: number;
  size?: number;
  strokeWidth?: number;
  level: ProgressLevel;
  label?: string;
  sublabel?: string;
  status?: SkillStatus;
  animate?: boolean;
  highContrast?: boolean;
}

const LEVEL_SIZES: Record<ProgressLevel, number> = { macro: 108, micro: 72, individual: 44 };
const LEVEL_STROKE: Record<ProgressLevel, number> = { macro: 10, micro: 7, individual: 5 };
const LEVEL_FONT: Record<ProgressLevel, number> = { macro: 24, micro: 17, individual: 12 };

export function CircularProgress({ progress, size: sizeProp, strokeWidth: swProp, level, label, sublabel, status, animate = true, highContrast = false }: Props) {
  const colors = useColors();
  const size = sizeProp ?? LEVEL_SIZES[level];
  const strokeWidth = swProp ?? LEVEL_STROKE[level];
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const prog = useSharedValue(0);

  useEffect(() => {
    const target = Math.min(100, Math.max(0, progress)) / 100;
    prog.value = animate
      ? withTiming(target, { duration: 900, easing: Easing.out(Easing.cubic) })
      : target;
  }, [progress, animate]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - prog.value),
  }));

  let activeColor = colors.primary;
  if (status) {
    activeColor = SKILL_STATUS_COLORS[status];
  } else {
    if (progress >= 80) activeColor = colors.success;
    else if (progress >= 50) activeColor = colors.warning;
    else if (progress >= 20) activeColor = colors.primary;
    else activeColor = colors.mutedForeground;
  }
  if (highContrast) activeColor = progress >= 50 ? "#000" : "#555";

  const fontSize = LEVEL_FONT[level];

  return (
    <View
      style={[styles.wrap, { width: size }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: progress }}
      accessibilityLabel={`${label ?? "Progress"}: ${progress}%`}
    >
      <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <G>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={highContrast ? "#ccc" : colors.border} strokeWidth={strokeWidth} fill="transparent" />
          <AnimatedCircle cx={size / 2} cy={size / 2} r={radius} stroke={activeColor} strokeWidth={strokeWidth} fill="transparent" strokeDasharray={`${circumference} ${circumference}`} animatedProps={animatedProps} strokeLinecap="round" />
        </G>
      </Svg>
      <View style={[styles.inner, { width: size, height: size }]}>
        {level === "individual" ? (
          <View style={[styles.statusDot, { backgroundColor: activeColor }]} />
        ) : (
          <>
            <Text style={[styles.score, { color: activeColor, fontSize }]} allowFontScaling={false}>
              {Math.round(progress)}%
            </Text>
            {label && level === "macro" && (
              <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1} allowFontScaling={false}>
                {label}
              </Text>
            )}
          </>
        )}
      </View>
      </View>
      {sublabel && level !== "individual" && (
        <Text style={[styles.sublabel, { color: colors.mutedForeground }]} numberOfLines={1} allowFontScaling={false}>
          {sublabel}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "flex-start" },
  inner: { position: "absolute", top: 0, left: 0, alignItems: "center", justifyContent: "center" },
  score: { fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  label: { fontFamily: "Inter_500Medium", fontSize: 12.5, marginTop: 2, textAlign: "center" },
  sublabel: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 6, textAlign: "center" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
});
