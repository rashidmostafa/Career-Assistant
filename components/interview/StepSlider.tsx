/**
 * StepSlider — a slider over a small set of named steps.
 *
 * Used for difficulty (Junior → Mid → Senior) and the confidence check (1-5).
 * Built from a track and an animated thumb rather than pulling in a native
 * slider: the values are discrete and few, so a continuous control would only
 * offer positions that snap away, and a tap target per step is easier to hit
 * accurately than a 3-pixel drag on a phone.
 */
import React, { useEffect, useRef } from "react";
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";

interface Props {
  steps: string[];
  /** Index into `steps`. */
  value: number;
  onChange: (index: number) => void;
  accent: string;
  colors: any;
  /** Small caption under each step, e.g. the seconds a difficulty allows. */
  captions?: string[];
  disabled?: boolean;
}

export function StepSlider({ steps, value, onChange, accent, colors, captions, disabled }: Props) {
  const [trackWidth, setTrackWidth] = React.useState(0);
  const thumbX = useRef(new Animated.Value(0)).current;

  const segment = steps.length > 1 ? trackWidth / steps.length : trackWidth;

  useEffect(() => {
    Animated.spring(thumbX, {
      toValue: segment * value,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  }, [value, segment, thumbX]);

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View>
      <View
        style={[styles.track, { backgroundColor: colors.secondary, borderColor: colors.border }]}
        onLayout={onLayout}
      >
        {trackWidth > 0 && (
          <Animated.View
            style={[
              styles.thumb,
              {
                width: segment,
                backgroundColor: accent,
                transform: [{ translateX: thumbX }],
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          />
        )}

        <View style={styles.labelRow} pointerEvents={disabled ? "none" : "auto"}>
          {steps.map((label, i) => (
            <Pressable
              key={label}
              style={styles.step}
              onPress={() => onChange(i)}
              accessibilityRole="radio"
              accessibilityState={{ selected: i === value, disabled: !!disabled }}
              accessibilityLabel={label}
            >
              <Text
                style={[
                  styles.stepText,
                  // The thumb sits behind the selected label, so that one label
                  // is read against the accent and the rest against the track.
                  { color: i === value ? "#fff" : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {captions && (
        <View style={styles.captionRow}>
          {captions.map((c, i) => (
            <Text
              key={`${c}-${i}`}
              style={[
                styles.caption,
                { color: i === value ? accent : colors.mutedForeground, flex: 1 },
              ]}
              numberOfLines={1}
            >
              {c}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    justifyContent: "center",
    overflow: "hidden",
  },
  thumb: { position: "absolute", left: 3, top: 3, bottom: 3, borderRadius: 9 },
  labelRow: { flexDirection: "row", alignItems: "center" },
  step: { flex: 1, alignItems: "center", justifyContent: "center", height: 38 },
  stepText: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },
  captionRow: { flexDirection: "row", marginTop: 6, paddingHorizontal: 3 },
  caption: { fontFamily: "Inter_500Medium", fontSize: 11, textAlign: "center" },
});
