import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const { width: SW, height: SH } = Dimensions.get("window");

interface Particle {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  emoji: string;
  size: number;
}

interface Props {
  visible: boolean;
  type: "week" | "milestone" | "graduation";
  title: string;
  subtitle?: string;
  onDismiss: () => void;
  reducedMotion?: boolean;
}

const EMOJIS = ["⭐", "🎉", "✨", "🌟", "🎊", "💫", "🏆", "🎯", "🚀"];
const CONFIGS = {
  week:       { bg: "rgba(16,185,129,0.95)",  emoji: "✅", count: 20 },
  milestone:  { bg: "rgba(99,102,241,0.95)",  emoji: "🏆", count: 35 },
  graduation: { bg: "rgba(245,158,11,0.97)",  emoji: "🎓", count: 60 },
};

function mkParticles(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    x: new Animated.Value(Math.random() * SW),
    y: new Animated.Value(-20),
    opacity: new Animated.Value(1),
    scale: new Animated.Value(0),
    emoji: EMOJIS[i % EMOJIS.length],
    size: 10 + Math.random() * 8,
  }));
}

export function CelebrationOverlay({ visible, type, title, subtitle, onDismiss, reducedMotion = false }: Props) {
  const cfg = CONFIGS[type];
  const particles = useRef<Particle[]>(mkParticles(60)).current;
  const backdropOp = useRef(new Animated.Value(0)).current;
  const cardScale  = useRef(new Animated.Value(0.8)).current;
  const cardOp     = useRef(new Animated.Value(0)).current;
  const pulse      = useRef(new Animated.Value(1)).current;
  const loopRef    = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!visible) {
      loopRef.current?.stop();
      Animated.parallel([
        Animated.timing(backdropOp, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(cardOp, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
      return;
    }

    if (reducedMotion) {
      backdropOp.setValue(1); cardScale.setValue(1); cardOp.setValue(1);
    } else {
      Animated.parallel([
        Animated.timing(backdropOp, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(cardScale, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
        Animated.timing(cardOp, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();

      loopRef.current = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ]));
      loopRef.current.start();

      const active = particles.slice(0, cfg.count);
      active.forEach((p, i) => {
        p.x.setValue(Math.random() * SW);
        p.y.setValue(-20);
        p.opacity.setValue(1);
        p.scale.setValue(0);
      });

      Animated.stagger(25, active.map((p) =>
        Animated.sequence([
          Animated.parallel([
            Animated.spring(p.scale, { toValue: 1, friction: 5, useNativeDriver: true }),
            Animated.timing(p.y, { toValue: SH * 0.6 + Math.random() * 200, duration: 2200 + Math.random() * 800, useNativeDriver: true }),
            Animated.timing(p.x, { toValue: (p.x as any)._value + (Math.random() - 0.5) * 140, duration: 2000 + Math.random() * 800, useNativeDriver: true }),
          ]),
          Animated.timing(p.opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      )).start();
    }

    const t = setTimeout(onDismiss, type === "graduation" ? 6000 : 4000);
    return () => { clearTimeout(t); loopRef.current?.stop(); };
  }, [visible, type, reducedMotion]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.backdrop, { opacity: backdropOp }]}
      pointerEvents="box-none"
      accessible
      accessibilityViewIsModal
      accessibilityLabel={title + (subtitle ? " " + subtitle : "")}
    >
      {!reducedMotion && particles.slice(0, cfg.count).map((p, i) => (
        <Animated.Text
          key={i}
          style={[styles.particle, { transform: [{ translateX: p.x }, { translateY: p.y }, { scale: p.scale }], opacity: p.opacity, fontSize: p.size + 4 }]}
          aria-hidden
        >
          {p.emoji}
        </Animated.Text>
      ))}

      <TouchableOpacity style={styles.tapArea} onPress={onDismiss} activeOpacity={1} accessibilityRole="button" accessibilityLabel="Dismiss celebration">
        <Animated.View style={[styles.card, { backgroundColor: cfg.bg, transform: [{ scale: cardScale }], opacity: cardOp }]}>
          <Animated.Text style={[styles.bigEmoji, { transform: [{ scale: pulse }] }]} aria-hidden>
            {cfg.emoji}
          </Animated.Text>
          <Text style={styles.cardTitle} allowFontScaling={false}>{title}</Text>
          {subtitle ? <Text style={styles.cardSub} allowFontScaling={false}>{subtitle}</Text> : null}
          <View style={styles.hint}>
            <Text style={styles.hintText}>Tap anywhere to continue</Text>
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", zIndex: 999, justifyContent: "center", alignItems: "center" },
  tapArea: { flex: 1, width: "100%", justifyContent: "center", alignItems: "center" },
  particle: { position: "absolute", left: 0, top: 0 },
  card: { borderRadius: 28, padding: 36, alignItems: "center", maxWidth: 320, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 24, elevation: 20 },
  bigEmoji: { fontSize: 72, marginBottom: 16 },
  cardTitle: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 24, textAlign: "center", marginBottom: 8, letterSpacing: -0.5 },
  cardSub: { color: "rgba(255,255,255,0.85)", fontFamily: "Inter_500Medium", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 4 },
  hint: { marginTop: 20, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  hintText: { color: "rgba(255,255,255,0.9)", fontFamily: "Inter_500Medium", fontSize: 12 },
});
