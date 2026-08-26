/**
 * Roadmap step 1 — the three rules that define how generation behaves.
 */
const mockChatJSON = jest.fn();
let mockConfigured = true;
jest.mock("@/services/aiClient", () => ({
  get isAIConfigured() { return mockConfigured; },
  chatJSON: (...a) => mockChatJSON(...a),
}));

const { generateRoadmap, validateRoadmap } = require("../services/roadmapAI");

const ms = (over = {}) => ({
  id: "m1", title: "Learn Docker", why: "every posting lists it",
  skills: ["Docker"], actions: ["Containerise an app"], resources: ["Docker docs"],
  success_criteria: "You can ship a container", estimate: "~1 week", ...over,
});

const reply = (milestones) => ({
  profile_summary: "Mid-level backend dev",
  gap_analysis: "No containerisation or cloud work",
  milestones,
});

const input = {
  targetRole: "Backend Engineer",
  cvText: "Rashid Mostafa. Built REST APIs in Node.js and MongoDB.",
  cvSkills: ["Node.js", "MongoDB"],
  experienceLevel: "Intermediate",
};

beforeEach(() => { mockChatJSON.mockReset(); mockConfigured = true; });

describe("rule 2 — generated from CV gaps against the target role", () => {
  it("sends the target role, detected skills and CV text", async () => {
    mockChatJSON.mockResolvedValue(reply([ms()]));
    await generateRoadmap(input);
    const prompt = mockChatJSON.mock.calls[0][0];
    expect(prompt).toContain("Backend Engineer");
    expect(prompt).toContain("Node.js");
    expect(prompt).toContain("Built REST APIs");
  });

  it("instructs the model to skip what the CV already shows", async () => {
    mockChatJSON.mockResolvedValue(reply([ms()]));
    await generateRoadmap(input);
    expect(mockChatJSON.mock.calls[0][0]).toMatch(/Skip anything the CV already demonstrates/i);
  });
});

describe("rule 3 — time is per skill, never a fixed schedule", () => {
  it("asks for per-milestone estimates that differ from each other", async () => {
    mockChatJSON.mockResolvedValue(reply([ms()]));
    await generateRoadmap(input);
    const prompt = mockChatJSON.mock.calls[0][0];
    expect(prompt).toMatch(/its own honest time estimate/i);
    expect(prompt).toMatch(/Estimates must differ from each other/i);
    expect(prompt).toMatch(/never round them to fit a tidy total/i);
  });

  it("forbids an overall timeline or deadline", async () => {
    mockChatJSON.mockResolvedValue(reply([ms()]));
    await generateRoadmap(input);
    expect(mockChatJSON.mock.calls[0][0]).toMatch(/Do not give an overall timeline, a deadline/i);
  });

  it("does not impose a milestone count", async () => {
    mockChatJSON.mockResolvedValueOnce(reply([ms({ id: "a" }), ms({ id: "b" }), ms({ id: "c" })]));
    const three = await generateRoadmap(input);
    expect(three.roadmap.milestones).toHaveLength(3);

    mockChatJSON.mockResolvedValueOnce(reply(Array.from({ length: 11 }, (_, i) => ms({ id: `m${i}` }))));
    const eleven = await generateRoadmap(input);
    expect(eleven.roadmap.milestones).toHaveLength(11);
  });

  it("keeps each milestone's own estimate", async () => {
    mockChatJSON.mockResolvedValue(reply([
      ms({ id: "a", estimate: "~3 days" }),
      ms({ id: "b", estimate: "~6 weeks" }),
    ]));
    const r = await generateRoadmap(input);
    expect(r.roadmap.milestones.map((m) => m.estimate)).toEqual(["~3 days", "~6 weeks"]);
  });
});

describe("validation and failure reporting", () => {
  it("rejects milestones with no title rather than drawing a blank card", () => {
    const r = validateRoadmap({ milestones: [ms(), { id: "x" }, ms({ id: "c" })] }, "X");
    expect(r.milestones).toHaveLength(2);
  });

  it("makes duplicate ids unique", () => {
    const r = validateRoadmap({ milestones: [ms({ id: "dup" }), ms({ id: "dup" })] }, "X");
    expect(r.milestones[0].id).not.toBe(r.milestones[1].id);
  });

  it("returns null when there is nothing usable", () => {
    expect(validateRoadmap(null, "X")).toBeNull();
    expect(validateRoadmap({ milestones: [] }, "X")).toBeNull();
    expect(validateRoadmap({ milestones: "nope" }, "X")).toBeNull();
  });

  it("retries once, then reports bad_output", async () => {
    mockChatJSON.mockResolvedValue({ nonsense: true });
    const r = await generateRoadmap(input);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: false, reason: "bad_output" });
  });

  it("distinguishes an unreachable AI from a bad reply", async () => {
    mockChatJSON.mockResolvedValue(null);
    expect(await generateRoadmap(input)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("reports no_ai without calling out at all", async () => {
    mockConfigured = false;
    expect(await generateRoadmap(input)).toEqual({ ok: false, reason: "no_ai" });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});
