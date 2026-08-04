/**
 * NotificationService — local + remote push notification management.
 * Schedules session-expiry reminders aligned with the 8-week rolling window:
 *   Day 50 → weekly reminder
 *   Day 54 → daily reminder
 *   Day 56 → hourly reminder
 *   Grace (12 h after Day 56) → urgent banner
 *
 * Uses expo-notifications for local scheduling. For Firebase Cloud Messaging
 * (FCM) push tokens, the token is obtained here and can be sent to the server.
 */
import * as Notifications from "expo-notifications";
import * as Device from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReauthUrgency } from "./sessionManager";

const PUSH_TOKEN_KEY = "auth_push_token";
const NOTIF_IDS_KEY  = "auth_scheduled_notif_ids";

// Configure foreground presentation
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge:  false,
  }),
});

// ─── Channel setup (Android) ──────────────────────────────────────────────────
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("security-reminders", {
    name: "Security Reminders",
    description: "Reminders to re-authenticate before your session expires.",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: null,
  });
}

// ─── Permission ───────────────────────────────────────────────────────────────
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannel();
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

// ─── Push token (for FCM / APNs) ──────────────────────────────────────────────
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return null;

    // projectId is required for production EAS builds; for Expo Go it is optional
    const projectId =
      (Device.default?.expoConfig?.extra as any)?.eas?.projectId ?? undefined;

    const { data: token } = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch {
    return null;
  }
}

export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

// ─── Cancel all scheduled reminders ───────────────────────────────────────────
async function cancelScheduledReminders(): Promise<void> {
  const raw = await AsyncStorage.getItem(NOTIF_IDS_KEY);
  if (!raw) return;
  const ids: string[] = JSON.parse(raw);
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  await AsyncStorage.removeItem(NOTIF_IDS_KEY);
}

// ─── Schedule all session reminders at once ───────────────────────────────────
export async function scheduleSessionReminders(sessionStartMs: number): Promise<void> {
  await cancelScheduledReminders();
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const day = (d: number) => new Date(sessionStartMs + d * 24 * 60 * 60 * 1000);
  const ids: string[] = [];

  // Day 50 — weekly reminder
  const day50 = day(50);
  if (day50 > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "🔒 Session expiring in 6 days",
        body:  "Your Career Assistant session will expire in 6 days. Tap to re-authenticate and stay signed in.",
        data:  { type: "reauth_reminder", urgency: "weekly" },
        categoryIdentifier: "security-reminders",
      },
      trigger: { date: day50, channelId: "security-reminders" } as any,
    });
    ids.push(id);
  }

  // Day 54 — daily reminder
  const day54 = day(54);
  if (day54 > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Session expiring in 2 days",
        body:  "Re-authenticate now to keep your data safe and avoid interruption.",
        data:  { type: "reauth_reminder", urgency: "daily" },
        categoryIdentifier: "security-reminders",
      },
      trigger: { date: day54, channelId: "security-reminders" } as any,
    });
    ids.push(id);
  }

  // Day 56 — hourly reminder (first hourly push)
  const day56 = day(56);
  if (day56 > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "🚨 Session expiring today",
        body:  "Your session expires in 24 hours. Please re-authenticate immediately.",
        data:  { type: "reauth_reminder", urgency: "hourly" },
        categoryIdentifier: "security-reminders",
      },
      trigger: { date: day56, channelId: "security-reminders" } as any,
    });
    ids.push(id);
  }

  // Grace period end — final urgent notification
  const gracePeriodEnd = new Date(sessionStartMs + (56 * 24 + 12) * 60 * 60 * 1000);
  if (gracePeriodEnd > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "🔴 You have been signed out",
        body:  "Your session has fully expired. Please sign in again to continue.",
        data:  { type: "reauth_reminder", urgency: "expired" },
        categoryIdentifier: "security-reminders",
      },
      trigger: { date: gracePeriodEnd, channelId: "security-reminders" } as any,
    });
    ids.push(id);
  }

  await AsyncStorage.setItem(NOTIF_IDS_KEY, JSON.stringify(ids));
}

// ─── Trigger an immediate local notification ──────────────────────────────────
export async function sendImmediateReminder(urgency: ReauthUrgency): Promise<void> {
  const messages: Record<string, { title: string; body: string }> = {
    weekly: {
      title: "🔒 Session expiring in 6 days",
      body:  "Tap to re-authenticate and stay signed in.",
    },
    daily: {
      title: "⚠️ Session expiring in 2 days",
      body:  "Re-authenticate now to keep your data safe.",
    },
    hourly: {
      title: "🚨 Session expiring soon",
      body:  "Please re-authenticate immediately.",
    },
    grace: {
      title: "🔴 Grace period — sign in required",
      body:  "Your session has expired. You have 12 hours before being fully signed out.",
    },
    expired: {
      title: "🔴 Session expired",
      body:  "Please sign in again to continue.",
    },
  };

  const msg = messages[urgency];
  if (!msg) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: msg.title,
      body:  msg.body,
      data:  { type: "reauth_reminder", urgency },
      categoryIdentifier: "security-reminders",
    },
    trigger: null, // immediate
  });
}

export const NotificationService = {
  requestPermission:         requestNotificationPermission,
  registerForPush:           registerForPushNotifications,
  getStoredPushToken,
  scheduleSessionReminders,
  cancelScheduledReminders,
  sendImmediateReminder,
};
