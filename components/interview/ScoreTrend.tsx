/**
 * ScoreTrend — session scores over time.
 *
 * Fixed to a 0-100 y-axis rather than scaling to the data. An auto-scaled axis
 * makes a run of 61, 63, 62 look like dramatic movement, which is the opposite
 * of what someone tracking progress needs to see.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import type { StoredSession } from "@/context/InterviewContext";

interface Props {
  sessions: StoredSession[];
  accent: string;
  colors: any;
  width: number;
  height?: number;
}

/** Beyond this the points collide; the chart shows the most recent. */
const MAX_POINTS = 20;
const GRID = [0, 25, 50, 75, 100];

export function ScoreTrend({ sessions, accent, colors, width, height = 168 }: Props) {
  // Stored newest-first; a time axis reads oldest-to-newest.
  const points = [...sessions].slice(0, MAX_POINTS).reverse();

  if (points.length === 0) {
    return (
      <View style={[styles.empty, { borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Your session scores will chart here.
        </Text>
      </View>
    );
  }

  const padLeft = 30, padRight = 10, padTop = 12, padBottom = 22;
  const plotW = Math.max(width - padLeft - padRight, 10);
  const plotH = height - padTop - padBottom;

  // A single session has no line to draw, so it is centred as one point rather
  // than pinned to the left edge where it reads as a truncated chart.
  const xAt = (i: number) =>
    points.length === 1 ? padLeft + plotW / 2 : padLeft + (plotW * i) / (points.length - 1);
  const yAt = (score: number) => padTop + plotH * (1 - score / 100);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.overallScore)}`)
    .join(" ");

  const latest = points[points.length - 1];
  const first = points[0];
  const delta = points.length > 1 ? latest.overallScore - first.overallScore : 0;

  return (
    <View>
      <Svg width={width} height={height}>
        {GRID.map((g) => (
          <React.Fragment key={g}>
            <Line
              x1={padLeft} y1={yAt(g)} x2={width - padRight} y2={yAt(g)}
              stroke={colors.border} strokeWidth={1}
            />
            <SvgText
              x={padLeft - 6} y={yAt(g) + 3.5}
              fontSize={9} fill={colors.mutedForeground} textAnchor="end"
            >
              {String(g)}
            </SvgText>
          </React.Fragment>
        ))}

        {points.length > 1 && (
          <Path d={path} stroke={accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {points.map((p, i) => (
          <Circle
            key={p.id}
            cx={xAt(i)}
            cy={yAt(p.overallScore)}
            r={i === points.length - 1 ? 5 : 3.2}
            fill={i === points.length - 1 ? accent : colors.card}
            stroke={accent}
            strokeWidth={2}
          />
        ))}

        <SvgText x={padLeft} y={height - 6} fontSize={9} fill={colors.mutedForeground} textAnchor="start">
          {shortDate(first.completedAt)}
        </SvgText>
        {points.length > 1 && (
          <SvgText x={width - padRight} y={height - 6} fontSize={9} fill={colors.mutedForeground} textAnchor="end">
            {shortDate(latest.completedAt)}
          </SvgText>
        )}
      </Svg>

      <View style={styles.summary}>
        <Text style={[styles.summaryValue, { color: colors.foreground }]}>{latest.overallScore}%</Text>
        <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>latest</Text>
        {points.length > 1 && (
          <Text style={[styles.delta, { color: delta >= 0 ? colors.success : colors.destructive }]}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts since {shortDate(first.completedAt)}
          </Text>
        )}
      </View>
    </View>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  empty: { borderWidth: 1, borderRadius: 14, borderStyle: "dashed", padding: 22, alignItems: "center" },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 13, textAlign: "center" },
  summary: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 8 },
  summaryValue: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.4 },
  summaryLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  delta: { fontFamily: "Inter_600SemiBold", fontSize: 11.5, marginLeft: "auto" },
});
