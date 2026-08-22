/**
 * OAuth landing route — /oauth/callback
 *
 * Only the web build actually renders this. On native the OS hands the deep
 * link straight to the app and openAuthSessionAsync resolves with it, so no
 * screen is involved. On web the browser genuinely navigates here, and without
 * a route at this path expo-router rendered "not found" over a sign-in that had
 * in fact succeeded.
 *
 * The tokens in the query string are read by OAuthDeepLinkHandler in
 * app/_layout.tsx via Linking.getInitialURL(); this screen only needs to show
 * that something is happening while that runs and the navigation lands.
 */
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export default function OAuthCallback() {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.text, { color: colors.mutedForeground }]}>
        Completing sign-in…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  text: { fontSize: 15 },
});
