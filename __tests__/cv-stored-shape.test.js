/**
 * A stored CV from a previous version must never reach the screen.
 *
 * The old CV engine wrote a completely different object to this same key, and
 * trusting it crashed the CV tab on launch with "Cannot read property
 * 'toLocaleString' of undefined" — the field simply did not exist.
 */
const React = require("react");
const renderer = require("react-test-renderer");

const mockStore = new Map();
jest.mock("@/services/syncedStorage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
    setItem: jest.fn(async (k, v) => { mockStore.set(k, v); }),
    removeItem: jest.fn(async (k) => { mockStore.delete(k); }),
  },
}));

// Stable identity: the provider's effects key off `user`.
const mockUser = { id: "user123", name: "Rashid" };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class { async base64() { return ""; } } }));
jest.mock("@/services/cvApi", () => ({ extractCV: jest.fn() }));

const { CVProvider, useCV } = require("../context/CVContext");

let api;
function Probe() { api = useCV(); return null; }

const mount = async () => {
  await renderer.act(async () => {
    renderer.create(React.createElement(CVProvider, null, React.createElement(Probe)));
  });
};

beforeEach(() => { mockStore.clear(); api = undefined; });

const KEY = "cv_user123";

const validCV = {
  fileName: "cv.pdf", kind: "pdf", rawText: "RASHID MOSTAFA\nBackend developer",
  chars: 32, sourceFormat: "Harvard", uploadedAt: "2026-08-26T00:00:00.000Z",
};

it("loads a CV written by this version", async () => {
  mockStore.set(KEY, JSON.stringify(validCV));
  await mount();
  expect(api.cv).toEqual(validCV);
});

it("discards the previous engine's object instead of crashing on it", async () => {
  // Exactly what the old CVContext stored: no chars, no kind, different fields.
  mockStore.set(KEY, JSON.stringify({
    id: "cv_1", userId: "user123", rawText: "old text",
    fullOptimizedCV: "...", atsScore: 72, format: "Harvard",
    breakdown: {}, suggestions: [], skills: [],
  }));
  await mount();
  expect(api.cv).toBeNull();
  // And it is cleared, so it cannot fail the same way on every launch.
  expect(mockStore.has(KEY)).toBe(false);
});

it("rejects partial or corrupt records", async () => {
  for (const bad of [
    JSON.stringify({ fileName: "cv.pdf", kind: "pdf", sourceFormat: "Harvard" }), // no rawText/chars
    JSON.stringify({ ...validCV, chars: "32" }),                                   // wrong type
    JSON.stringify({ ...validCV, kind: "txt" }),                                   // unsupported kind
    JSON.stringify({ ...validCV, rawText: "" }),                                   // empty text
    "{not json",
  ]) {
    mockStore.clear();
    mockStore.set(KEY, bad);
    await mount();
    expect(api.cv).toBeNull();
  }
});

it("has no CV when nothing is stored", async () => {
  await mount();
  expect(api.cv).toBeNull();
  expect(api.pending).toBeNull();
});
