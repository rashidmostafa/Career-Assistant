/**
 * Roadmap — placeholder.
 *
 * The previous implementation was removed wholesale so this can be rebuilt from
 * a clean base. Nothing here reads state, calls a model, or persists anything
 * yet; it exists so the tab and its route stay valid while the real screen is
 * built back up step by step.
 */
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export default function RoadmapScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Roadmap</Text>
      </View>

      <View style={styles.body}>
        <Feather name="map" size={30} color={colors.mutedForeground} />
        <Text style={[styles.headline, { color: colors.foreground }]}>Being rebuilt</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          This section is being built again from scratch.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  title: { fontSize: 24, fontWeight: "800" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  headline: { fontSize: 17, fontWeight: "700" },
  sub: { fontSize: 14, lineHeight: 20, textAlign: "center" },
});
