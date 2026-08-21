/**
 * RoleSwitcher — moves the app between the user's target roles.
 *
 * Each role owns its own roadmap, CV analysis, job matches and interview
 * history; nothing is shared and nothing is merged. Switching is therefore a
 * change of context rather than a filter, which is why this reads as a
 * segmented control over the whole screen rather than a dropdown buried in
 * settings.
 *
 * Renders nothing when the user has a single role — a switcher with one option
 * is noise on every screen for the majority of users.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  /** Tint for the current screen, so the control belongs to its tab. */
  accent?: string;
  /** Shown when the user has only one role, e.g. on the profile screen. */
  alwaysShow?: boolean;
  onManage?: () => void;
}

export function RoleSwitcher({ accent, alwaysShow = false, onManage }: Props) {
  const colors = useColors() as any;
  const { user, setActiveRole } = useAuth();

  const roles = user?.targetRoles ?? [];
  if (roles.length <= 1 && !alwaysShow) return null;
  if (roles.length === 0) return null;

  const tint = accent ?? colors.primary;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {roles.map((role) => {
          const active = role.id === user?.activeRoleId;
          return (
            <Pressable
              key={role.id}
              onPress={() => !active && setActiveRole(role.id)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? tint : colors.card,
                  borderColor: active ? tint : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${role.title}${active ? ", showing" : ""}`}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? "#fff" : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {role.title}
              </Text>
            </Pressable>
          );
        })}

        {!!onManage && (
          <Pressable
            onPress={onManage}
            style={({ pressed }) => [
              styles.manage,
              { borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Manage target roles"
          >
            <Feather name="plus" size={15} color={colors.mutedForeground} />
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  chip: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999, borderWidth: 1, maxWidth: 220 },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 13.5 },
  manage: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
