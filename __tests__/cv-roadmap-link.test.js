/**
 * The CV engine feeds the roadmap and job matching.
 *
 * Both were stubbed out when the CV engine was removed, and both silently
 * degraded: the roadmap stayed permanently on its "upload your CV" gate, and
 * matches scored against an empty skill set. This checks the seam is closed.
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

const mockUser = { id: "user123", name: "Rashid", targetRole: "Backend Engineer" };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class { async base64() { return ""; } } }));
jest.mock("@/services/cvApi", () => ({ extractCV: jest.fn() }));
jest.mock("@/services/cvAI", () => ({ scoreCV: jest.fn() }));

const mockGenerate = jest.fn();
jest.mock("@/services/roadmapAI", () => ({ generateRoadmap: (...a) => mockGenerate(...a) }));

const { CVProvider } = require("../context/CVContext");
const { RoadmapProvider, useRoadmap } = require("../context/RoadmapContext");

let roadmap;
function Probe() { roadmap = useRoadmap(); return null; }

const CV_TEXT = "RASHID MOSTAFA\nBackend developer. Built REST APIs with Node.js, Express and MongoDB. Used Git and Jest.";

const mountWith = async (cvDoc) => {
  mockStore.clear();
  if (cvDoc) mockStore.set("cv_user123", JSON.stringify(cvDoc));
  await renderer.act(async () => {
    renderer.create(
      React.createElement(CVProvider, null,
        React.createElement(RoadmapProvider, null, React.createElement(Probe))));
  });
};

const validCV = {
  fileName: "cv.pdf", kind: "pdf", rawText: CV_TEXT, chars: CV_TEXT.length,
  sourceFormat: "Harvard", uploadedAt: "2026-08-26T00:00:00.000Z",
};

beforeEach(() => { mockGenerate.mockReset(); roadmap = undefined; });

it("gates the roadmap when no CV has been uploaded", async () => {
  await mountWith(null);
  expect(roadmap.blocker).toBe("no_cv");
});

it("opens the roadmap once a CV exists", async () => {
  await mountWith(validCV);
  expect(roadmap.blocker).toBeNull();
});

it("passes the CV's text and detected skills into generation", async () => {
  mockGenerate.mockResolvedValue({ ok: true, roadmap: { targetRole: "Backend Engineer", milestones: [], profileSummary: "", gapAnalysis: "", generatedAt: "" } });
  await mountWith(validCV);
  await renderer.act(async () => { await roadmap.build(); });

  expect(mockGenerate).toHaveBeenCalledTimes(1);
  const arg = mockGenerate.mock.calls[0][0];
  expect(arg.cvText).toBe(CV_TEXT);
  expect(arg.targetRole).toBe("Backend Engineer");
  // Skills come from the CV, not from an empty stub.
  expect(arg.cvSkills.length).toBeGreaterThan(0);
});

it("does not generate while the CV gate is closed", async () => {
  await mountWith(null);
  await renderer.act(async () => { await roadmap.build(); });
  expect(mockGenerate).not.toHaveBeenCalled();
});
