/**
 * MasteryRadar — performance across the competencies of one role.
 *
 * A radar needs at least three axes to be a shape rather than a line, and the
 * number of competencies is not under our control: it comes from whatever the
 * bank holds for the user's role, and a first session might touch only two. So
 * this renders rings below three axes and a radar at or above it, which keeps
 * the panel meaningful from the very first session instead of showing a
 * degenerate chart or an empty state.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polygon, Text as SvgText } from "react-native-svg";
import type { CompetencyMastery } from "@/context/InterviewContext";

interface Props {
  data: CompetencyMastery[];
  accent: string;
  colors: any;
  size?: number;
}

/** Axes beyond this crowd the labels into each other; the weakest are dropped. */
const MAX_AXES = 7;
const RINGS = [0.25, 0.5, 0.75, 1];

export function MasteryRadar({ data, accent, colors, size = 240 }: Props) {
  // Most-practised first, so a competency answered once cannot displace one the
  // user has actually worked at.
  const axes = [...data].sort((a, b) => b.answered - a.answered).slice(0, MAX_AXES);

  if (axes.length === 0) {
    return (
      <View style={[styles.empty, { borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Finish a session to see where you're strong.
        </Text>
      </View>
    );
  }

  if (axes.length < 3) return <MasteryRings data={axes} accent={accent} colors={colors} />;

  const cx = size / 2;
  const cy = size / 2;
  // Room for the labels that sit outside the outermost ring.
  const r = size / 2 - 42;

  // Start at twelve o'clock and go clockwise, which is how these are read.
  const pointAt = (i: number, radius: number) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  };

  const ringPoints = (frac: number) =>
    axes.map((_, i) => { const p = pointAt(i, r * frac); return `${p.x},${p.y}`; }).join(" ");

  const dataPoints = axes
    .map((a, i) => { const p = pointAt(i, r * Math.max(a.score, 2) / 100); return `${p.x},${p.y}`; })
    .join(" ");

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={size} height={size}>
        {RINGS.map((frac) => (
          <Polygon
            key={frac}
            points={ringPoints(frac)}
            fill="none"
            stroke={colors.border}
            strokeWidth={1}
          />
        ))}

        {axes.map((_, i) => {
          const p = pointAt(i, r);
          return <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={colors.border} strokeWidth={1} />;
        })}

        <Polygon points={dataPoints} fill={accent} fillOpacity={0.22} stroke={accent} strokeWidth={2} />

        {axes.map((a, i) => {
          const p = pointAt(i, r * Math.max(a.score, 2) / 100);
          return <Circle key={a.competency} cx={p.x} cy={p.y} r={3.5} fill={accent} />;
        })}

        {axes.map((a, i) => {
          const p = pointAt(i, r + 16);
          // Anchor by which side of the centre the label falls on, so long
          // competency names grow outwards instead of across the chart.
          const anchor = p.x > cx + 4 ? "start" : p.x < cx - 4 ? "end" : "middle";
          return (
            <SvgText
              key={a.competency}
              x={p.x}
              y={p.y + 3}
              fontSize={9.5}
              fontWeight="600"
              fill={colors.mutedForeground}
              textAnchor={anchor}
            >
              {a.competency.length > 16 ? `${a.competency.slice(0, 15)}…` : a.competency}
            </SvgText>
          );
        })}
      </Svg>

      <View style={styles.legend}>
        {axes.map((a) => (
          <View key={a.competency} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: accent }]} />
            <Text style={[styles.legendLabel, { color: colors.foreground }]} numberOfLines={1}>
              {a.competency}
            </Text>
            <Text style={[styles.legendValue, { color: colors.mutedForeground }]}>
              {a.score}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The under-three-axes form: one ring per competency. */
function MasteryRings({ data, accent, colors }: { data: CompetencyMastery[]; accent: string; colors: any }) {
  const size = 96;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <View style={styles.ringRow}>
      {data.map((d) => (
        <View key={d.competency} style={styles.ring}>
          <Svg width={size} height={size}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={accent}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference}`}
              strokeDashoffset={circumference * (1 - d.score / 100)}
              // Start the arc at twelve o'clock rather than three.
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <SvgText
              x={size / 2}
              y={size / 2 + 5}
              fontSize={16}
              fontWeight="700"
              fill={colors.foreground}
              textAnchor="middle"
            >
              {`${d.score}`}
            </SvgText>
          </Svg>
          <Text style={[styles.ringLabel, { color: colors.foreground }]} numberOfLines={2}>
            {d.competency}
          </Text>
          <Text style={[styles.ringSub, { color: colors.mutedForeground }]}>
            {d.answered} answered
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderWidth: 1, borderRadius: 14, borderStyle: "dashed", padding: 22, alignItems: "center" },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 13, textAlign: "center" },
  legend: { alignSelf: "stretch", marginTop: 12, gap: 7 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 12.5 },
  legendValue: { fontFamily: "Inter_700Bold", fontSize: 12.5 },
  ringRow: { flexDirection: "row", justifyContent: "center", gap: 22, flexWrap: "wrap" },
  ring: { alignItems: "center", width: 110 },
  ringLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12.5, textAlign: "center", marginTop: 8 },
  ringSub: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 2 },
});
