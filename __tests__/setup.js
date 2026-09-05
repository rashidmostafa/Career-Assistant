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

// expo-crypto
//
// Mocked from SDK 57 onwards: expo-crypto now imports the `expo` package root,
// whose app-entry side effect throws AppEntryNotFound under Jest. The digest is
// Node's real SHA-256 rather than a fixed string, so tests that rely on the same
// input hashing the same way — and different inputs differing — still mean
// something.
jest.mock("expo-crypto", () => ({
  digestStringAsync: jest.fn(async (_algorithm, data) =>
    require("crypto").createHash("sha256").update(String(data)).digest("hex"),
  ),
  CryptoDigestAlgorithm: { SHA256: "SHA-256", SHA512: "SHA-512" },
  randomUUID: jest.fn(() => require("crypto").randomUUID()),
  getRandomBytesAsync: jest.fn(async (n) => new Uint8Array(require("crypto").randomBytes(n))),
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
