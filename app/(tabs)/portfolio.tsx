/**
 * Portfolio — the links a candidate wants an employer to see, as cards.
 *
 * The screen is a collection the user builds: paste any URL and it becomes a
 * card carrying its platform's colour, icon and account name. Raw links are
 * shown nowhere, because a wall of URLs is unreadable and ugly; the card is
 * the readable form of the link. GitHub and Codeforces additionally carry live
 * public stats, since those exist and make the card worth more than a shortcut.
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePortfolio, type PortfolioLink } from "@/context/PortfolioContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/utils/alert";
import {
  detectPlatform,
  isValidUrl,
  normalizeUrl,
  PORTFOLIO_PLATFORMS,
  WEBSITE_PLATFORM,
} from "@/constants/portfolioPlatforms";

const platformById = (id: string) =>
  PORTFOLIO_PLATFORMS.find((p) => p.id === id) ?? WEBSITE_PLATFORM;

export default function PortfolioScreen() {
  const colors = useColors() as any;
  const insets = useSafeAreaInsets();
  const { portfolio, isSyncing, addLink, removeLink } = usePortfolio();

  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const links = portfolio?.links ?? [];

  // Live preview while typing: the card updates as the URL is recognised, so
  // the user sees what they are about to get before committing.
  const previewPlatform = url.trim() ? detectPlatform(url) : null;

  const openAdd = () => {
    setUrl("");
    setLabel("");
    setAdding(true);
  };

  const submit = async () => {
    const value = url.trim();
    if (!isValidUrl(value)) {
      showAlert("Check the link", "That doesn't look like a web address. Try something like github.com/yourname.");
      return;
    }
    if (links.some((l) => l.url === normalizeUrl(value))) {
      showAlert("Already added", "That link is already on your portfolio.");
      return;
    }
    setSaving(true);
    try {
      await addLink(value, label);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAdding(false);
    } catch (e: any) {
      showAlert("Couldn't add link", e?.message ?? "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const open = async (link: PortfolioLink) => {
    try {
      await Linking.openURL(link.url);
    } catch {
      showAlert("Couldn't open link", link.url);
    }
  };

  const confirmRemove = (link: PortfolioLink) => {
    showAlert("Remove link", `Remove ${link.label} from your portfolio?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeLink(link.id) },
    ]);
  };

  /** Live stats, where the platform publishes them. */
  const statsFor = (link: PortfolioLink): string | null => {
    if (link.platformId === "github" && portfolio?.github) {
      const g = portfolio.github;
      return `${g.repos} repos · ${g.stars} stars`;
    }
    if (link.platformId === "codeforces" && portfolio?.codeforces) {
      const c = portfolio.codeforces;
      return `${c.rating} rating · ${c.solved} solved`;
    }
    return null;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 16, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Portfolio</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {links.length ? `${links.length} link${links.length === 1 ? "" : "s"}` : "Your work, in one place"}
          </Text>
        </View>
        {links.length > 0 && (
          <Pressable
            onPress={openAdd}
            style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Add link"
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {links.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
              <Feather name="link" size={30} color={colors.accentForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Add your first link</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Your portfolio site, GitHub, LinkedIn, Codeforces — anything you want an employer to see.
              Each link becomes a card.
            </Text>

            {/* Naming real platforms beats an abstract prompt: it tells the
                user what counts as a valid answer. */}
            <View style={styles.chips}>
              {["GitHub", "LinkedIn", "Codeforces", "Your website"].map((name) => (
                <View key={name} style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{name}</Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={openAdd}
              style={({ pressed }) => [styles.cta, { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 }]}
              accessibilityRole="button"
            >
              <Feather name="plus" size={18} color={colors.primaryForeground} />
              <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>Add a link</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {links.map((link) => {
              const p = platformById(link.platformId);
              const stats = statsFor(link);
              return (
                <Pressable
                  key={link.id}
                  onPress={() => open(link)}
                  onLongPress={() => confirmRemove(link)}
                  style={({ pressed }) => [
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      transform: [{ scale: pressed ? 0.99 : 1 }],
                    },
                  ]}
                  accessibilityRole="link"
                  accessibilityLabel={`${p.name}, ${link.label}`}
                  accessibilityHint="Opens in your browser. Long press to remove."
                >
                  {/* Brand colour as a spine rather than a fill — recognisable
                      at a glance without fighting the app's own palette. */}
                  <View style={[styles.spine, { backgroundColor: p.color }]} />

                  <View style={[styles.cardIcon, { backgroundColor: p.color + "1A" }]}>
                    <Feather name={p.icon} size={20} color={p.color} />
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.cardPlatform, { color: colors.mutedForeground }]}>
                      {p.name.toUpperCase()}
                    </Text>
                    <Text style={[styles.cardLabel, { color: colors.foreground }]} numberOfLines={1}>
                      {link.label}
                    </Text>
                    {!!stats && (
                      <Text style={[styles.cardStats, { color: p.color }]} numberOfLines={1}>
                        {stats}
                      </Text>
                    )}
                  </View>

                  <Feather name="arrow-up-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              );
            })}

            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Tap to open · Long press to remove
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Add-link sheet */}
      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAdding(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {}}
          >
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add a link</Text>

            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="github.com/yourname"
              placeholderTextColor={colors.mutedForeground}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
            />

            {!!previewPlatform && (
              <View style={styles.preview}>
                <View style={[styles.cardIcon, { backgroundColor: previewPlatform.color + "1A" }]}>
                  <Feather name={previewPlatform.icon} size={18} color={previewPlatform.color} />
                </View>
                <Text style={[styles.previewText, { color: colors.mutedForeground }]}>
                  Recognised as {previewPlatform.name}
                </Text>
              </View>
            )}

            <TextInput
              style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
              placeholder="Name (optional)"
              placeholderTextColor={colors.mutedForeground}
              value={label}
              onChangeText={setLabel}
              autoCapitalize="words"
            />

            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => setAdding(false)}
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: colors.secondary, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[styles.sheetBtnText, { color: colors.secondaryForeground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={saving || isSyncing}
                style={({ pressed }) => [
                  styles.sheetBtn,
                  { backgroundColor: colors.primary, opacity: pressed || saving ? 0.85 : 1 },
                ]}
              >
                {saving || isSyncing ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.sheetBtnText, { color: colors.primaryForeground }]}>Add</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", gap: 12, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.5 },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 2 },
  addBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },

  empty: { alignItems: "center", paddingTop: 56, paddingHorizontal: 8 },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 21, marginBottom: 8 },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 14.5, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 22 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14, marginTop: 28 },
  ctaText: { fontFamily: "Inter_700Bold", fontSize: 15.5 },

  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, paddingLeft: 20, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  spine: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardPlatform: { fontFamily: "Inter_600SemiBold", fontSize: 10.5, letterSpacing: 0.8 },
  cardLabel: { fontFamily: "Inter_700Bold", fontSize: 16.5, marginTop: 2 },
  cardStats: { fontFamily: "Inter_500Medium", fontSize: 12.5, marginTop: 3 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12.5, textAlign: "center", marginTop: 10 },

  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 420, borderRadius: 20, borderWidth: 1, padding: 22, gap: 12 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 19, marginBottom: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 15 },
  preview: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  sheetBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetBtnText: { fontFamily: "Inter_700Bold", fontSize: 15 },
});
