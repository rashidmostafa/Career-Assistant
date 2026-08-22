/**
 * Milestone roadmap: validation, status invariants, retry, and the change diff.
 */
const mockChatJSON = jest.fn();
jest.mock("@/services/aiClient", () => ({
  isAIConfigured: true,
  chatJSON: (...a) => mockChatJSON(...a),
  chatText: jest.fn(),
  streamChat: jest.fn(),
}));
jest.mock("@/services/hawkClient", () => ({
  isHawkConfigured: false,
  generateRoadmap: jest.fn(),
}));

const {
  validateRoadmap, enforceStatuses, diffRoadmaps, describeDiff,
  generateMilestoneRoadmap, updateRoadmapAfterCompletion,
} = require("../services/roadmapAI");

const milestone = (id, over = {}) => ({
  id, title: `Title ${id}`, description: "d", why: "w",
  skills_addressed: ["s"], actions: ["a"], resources: ["r"],
  success_criteria: "c", status: "locked", ...over,
});

const roadmap = (ms) => ({
  profile_summary: "p", gap_analysis: "g", milestones: ms,
  next_focus: "n", targetRole: "Backend Engineer", updatedAt: "2026-08-23T00:00:00.000Z",
});

beforeEach(() => mockChatJSON.mockReset());

describe("validateRoadmap", () => {
  it("accepts a well-formed roadmap", () => {
    const r = validateRoadmap(
      { profile_summary: "p", gap_analysis: "g", next_focus: "n", milestones: [milestone("m1"), milestone("m2")] },
      "Backend Engineer",
    );
    expect(r).not.toBeNull();
    expect(r.milestones).toHaveLength(2);
    expect(r.targetRole).toBe("Backend Engineer");
  });

  it("rejects output with no milestones", () => {
    expect(validateRoadmap({ milestones: [] }, "X")).toBeNull();
    expect(validateRoadmap({}, "X")).toBeNull();
    expect(validateRoadmap(null, "X")).toBeNull();
    expect(validateRoadmap("not json", "X")).toBeNull();
  });

  it("drops milestones with no title rather than rendering a blank card", () => {
    const r = validateRoadmap({ milestones: [milestone("m1"), { id: "m2" }, milestone("m3")] }, "X");
    expect(r.milestones).toHaveLength(2);
  });

  it("defaults malformed fields instead of failing", () => {
    const r = validateRoadmap(
      { milestones: [{ title: "T", actions: "not an array", skills_addressed: [1, "ok"], status: "bogus" }] },
      "X",
    );
    expect(r.milestones[0].actions).toEqual([]);
    expect(r.milestones[0].skills_addressed).toEqual(["ok"]);
    expect(r.milestones[0].status).toBe("in_progress");   // first, after enforcement
  });

  it("makes duplicate ids unique so cards and chat threads cannot collide", () => {
    const r = validateRoadmap({ milestones: [milestone("dup"), milestone("dup")] }, "X");
    expect(r.milestones[0].id).not.toBe(r.milestones[1].id);
  });
});

describe("enforceStatuses", () => {
  it("puts exactly one milestone in progress", () => {
    const out = enforceStatuses([milestone("m1"), milestone("m2"), milestone("m3")]);
    expect(out.filter((m) => m.status === "in_progress")).toHaveLength(1);
    expect(out[0].status).toBe("in_progress");
  });

  it("activates the first unfinished milestone, not the first overall", () => {
    const out = enforceStatuses([
      milestone("m1", { status: "completed" }),
      milestone("m2", { status: "completed" }),
      milestone("m3"),
      milestone("m4"),
    ]);
    expect(out[2].status).toBe("in_progress");
    expect(out[3].status).toBe("locked");
  });

  it("never contradicts the model by unlocking two at once", () => {
    const out = enforceStatuses([
      milestone("m1", { status: "in_progress" }),
      milestone("m2", { status: "in_progress" }),
    ]);
    expect(out.filter((m) => m.status === "in_progress")).toHaveLength(1);
  });
});

describe("generation", () => {
  it("retries once when the first reply is unusable", async () => {
    mockChatJSON
      .mockResolvedValueOnce({ garbage: true })
      .mockResolvedValueOnce({ milestones: [milestone("m1")] });

    const r = await generateMilestoneRoadmap({ cvText: "cv", cvSkills: ["Node"], targetRole: "Backend Engineer" });
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(r).not.toBeNull();
  });

  it("gives up after the retry rather than looping", async () => {
    mockChatJSON.mockResolvedValue(null);
    const r = await generateMilestoneRoadmap({ cvText: "cv", cvSkills: [], targetRole: "X" });
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(r).toBeNull();
  });

  it("sends the CV, skills and role, and forbids time estimates", async () => {
    mockChatJSON.mockResolvedValue({ milestones: [milestone("m1")] });
    await generateMilestoneRoadmap({
      cvText: "Built APIs in Django", cvSkills: ["Python"], targetRole: "Backend Engineer",
    });
    const prompt = mockChatJSON.mock.calls[0][0];
    expect(prompt).toContain("Backend Engineer");
    expect(prompt).toContain("Python");
    expect(prompt).toContain("Built APIs in Django");
    expect(prompt).toContain("NO time estimates");
  });

  it("preserves completions even if the model drops them", async () => {
    const before = roadmap([milestone("m1", { status: "completed" }), milestone("m2", { status: "in_progress" })]);
    // Model wrongly returns m1 as locked.
    mockChatJSON.mockResolvedValue({ milestones: [milestone("m1", { status: "locked" }), milestone("m2")] });

    const after = await updateRoadmapAfterCompletion(before, ["m1"]);
    expect(after.milestones.find((m) => m.id === "m1").status).toBe("completed");
    expect(after.milestones.find((m) => m.id === "m2").status).toBe("in_progress");
  });
});

describe("diff", () => {
  it("reports unlocked, added and removed milestones", () => {
    const before = roadmap([
      milestone("m1", { status: "in_progress" }),
      milestone("m2", { status: "locked" }),
      milestone("m3", { status: "locked" }),
    ]);
    const after = roadmap([
      milestone("m1", { status: "completed" }),
      milestone("m2", { status: "in_progress" }),
      milestone("m4", { status: "locked" }),
    ]);

    const d = diffRoadmaps(before, after);
    expect(d.completed).toEqual(["Title m1"]);
    expect(d.unlocked).toEqual(["Title m2"]);
    expect(d.added).toEqual(["Title m4"]);
    expect(d.removed).toEqual(["Title m3"]);
    console.log("  summary:", describeDiff(d));
  });

  it("counts a reordered survivor as reprioritized", () => {
    const before = roadmap([milestone("a"), milestone("b"), milestone("c")]);
    const after = roadmap([milestone("c"), milestone("a"), milestone("b")]);
    expect(diffRoadmaps(before, after).reprioritized).toBeGreaterThan(0);
  });

  it("does not count additions as reprioritisations", () => {
    const before = roadmap([milestone("a"), milestone("b")]);
    const after = roadmap([milestone("a"), milestone("b"), milestone("new")]);
    const d = diffRoadmaps(before, after);
    expect(d.reprioritized).toBe(0);
    expect(d.added).toEqual(["Title new"]);
  });

  it("says so plainly when nothing changed", () => {
    const r = roadmap([milestone("a"), milestone("b")]);
    expect(describeDiff(diffRoadmaps(r, r))).toBe("No changes to your plan");
  });
});
