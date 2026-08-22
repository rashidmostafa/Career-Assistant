/**
 * The roadmap must follow the candidate's CV and target role, not a template.
 *
 * Every plan used to be six template weeks plus two career extras — exactly
 * eight, for everyone, with the skill gaps passed in and discarded.
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

const mockUser = { id: "user123", name: "Rashid", targetRole: "Data Scientist" };
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const mockCv = {
  skills: ["Python", "SQL"],
  rawText: "Rashid Mostafa. Python and SQL. Built dashboards.",
};
jest.mock("@/context/CVContext", () => ({ useCV: () => ({ cvProfile: mockCv }) }));

const mockChatJSON = jest.fn();
jest.mock("@/services/aiClient", () => ({
  isAIConfigured: true,
  chatJSON: (...a) => mockChatJSON(...a),
}));

const { RoadmapProvider, useRoadmap } = require("../context/RoadmapContext");

let api;
function Probe() { api = useRoadmap(); return null; }

const mount = async () => {
  await renderer.act(async () => {
    renderer.create(React.createElement(RoadmapProvider, null, React.createElement(Probe)));
  });
};

beforeEach(() => { mockStore.clear(); mockChatJSON.mockReset(); api = undefined; });

const aiPlan = (n) => ({
  weeks: Array.from({ length: n }, (_, i) => ({
    topic: `AI Topic ${i + 1}`,
    description: "Generated for this CV",
    level: "Intermediate",
    tasks: ["Task A", "Task B", "Task C"],
    resources: [{ title: "Docs", url: "https://example.com", type: "article" }],
  })),
});

test("uses the AI plan and its length, not a fixed eight weeks", async () => {
  mockChatJSON.mockResolvedValue(aiPlan(4));
  await mount();
  await renderer.act(async () => {
    await api.generateRoadmap(["Machine Learning", "Statistics"], "Data Scientist", "Beginner");
  });

  const jobWeeks = api.weeks.filter((w) => w.track === "job");
  console.log("  job-track weeks:", jobWeeks.length, "| topics:", jobWeeks.map((w) => w.topic).join(", "));
  expect(jobWeeks).toHaveLength(4);
  expect(jobWeeks[0].topic).toBe("AI Topic 1");
});

test("a bigger gap produces a longer plan", async () => {
  mockChatJSON.mockResolvedValue(aiPlan(11));
  await mount();
  await renderer.act(async () => {
    await api.generateRoadmap(["everything"], "Data Scientist", "Beginner");
  });
  const jobWeeks = api.weeks.filter((w) => w.track === "job");
  console.log("  job-track weeks:", jobWeeks.length);
  expect(jobWeeks).toHaveLength(11);
});

test("sends the CV skills and target role to the model", async () => {
  mockChatJSON.mockResolvedValue(aiPlan(3));
  await mount();
  await renderer.act(async () => {
    await api.generateRoadmap(["Machine Learning"], "Data Scientist", "Beginner");
  });
  const prompt = mockChatJSON.mock.calls[0][0];
  expect(prompt).toContain("Data Scientist");
  expect(prompt).toContain("Python");            // from the CV
  expect(prompt).toContain("Machine Learning");  // the gap that used to be ignored
});

test("falls back to templates when the model is unavailable", async () => {
  mockChatJSON.mockResolvedValue(null);
  await mount();
  await renderer.act(async () => {
    await api.generateRoadmap([], "Data Scientist", "Beginner");
  });
  const jobWeeks = api.weeks.filter((w) => w.track === "job");
  console.log("  fallback job weeks:", jobWeeks.length);
  expect(jobWeeks.length).toBeGreaterThan(0);
});
