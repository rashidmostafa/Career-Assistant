/**
 * Jest global setup — mocks for React Native / Expo modules that are
 * not available in a plain Node.js test environment.
 */

// AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () => ({
  setItem:    jest.fn().mockResolvedValue(null),
  getItem:    jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
  multiGet:   jest.fn().mockResolvedValue([]),
  multiSet:   jest.fn().mockResolvedValue(null),
  clear:      jest.fn().mockResolvedValue(null),
}));

// expo-secure-store
jest.mock("expo-secure-store", () => ({
  setItemAsync:    jest.fn().mockResolvedValue(null),
  getItemAsync:    jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(null),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

// expo-local-authentication
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync:  jest.fn().mockResolvedValue(true),
  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([1, 2]),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
  AuthenticationType: { FACIAL_RECOGNITION: 2, FINGERPRINT: 1 },
}));

// expo-notifications
jest.mock("expo-notifications", () => ({
  setNotificationHandler:                    jest.fn(),
  setNotificationChannelAsync:               jest.fn().mockResolvedValue(null),
  getPermissionsAsync:                       jest.fn().mockResolvedValue({ status: "granted" }),
  requestPermissionsAsync:                   jest.fn().mockResolvedValue({ status: "granted" }),
  getExpoPushTokenAsync:                     jest.fn().mockResolvedValue({ data: "ExponentPushToken[test]" }),
  scheduleNotificationAsync:                 jest.fn().mockResolvedValue("notif-id-1"),
  cancelScheduledNotificationAsync:          jest.fn().mockResolvedValue(null),
  AndroidImportance: { HIGH: 4 },
}));

// expo-constants
jest.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { eas: { projectId: "test-project-id" } } } },
}));

// react-native (minimal stub)
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
