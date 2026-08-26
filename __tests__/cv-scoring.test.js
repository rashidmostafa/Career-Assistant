/**
 * ATS scoring: the rubric, format awareness, and what the report guarantees.
 */
const mockChatJSON = jest.fn();
let mockConfigured = true;
jest.mock("@/services/aiClient", () => ({
  get isAIConfigured() { return mockConfigured; },
  chatJSON: (...a) => mockChatJSON(...a),
}));

const { scoreCV, validateReport } = require("../services/cvAI");

const input = { cvText: "RASHID MOSTAFA\nBackend dev, Node.js", sourceFormat: "Harvard", targetRole: "Backend Engineer" };

const fullReply = {
  score: 62,
  verdict: "Readable but thin on backend infrastructure.",
  dimensions: [
    { key: "parseability", score: 95, note: "single column" },
    { key: "format", score: 60, note: "Experience before Education" },
    { key: "keywords", score: 50, note: "missing SQL" },
    { key: "achievements", score: 78, note: "quantified" },
    { key: "completeness", score: 45, note: "no Projects" },
    { key: "clarity", score: 85, note: "consistent" },
  ],
  formatting_issues: [{ severity: "high", title: "Section order", detail: "d", fix: "f" }],
  essentials: [{ severity: "medium", title: "Location missing", detail: "d", fix: "f" }],
  skill_gaps: [{ skill: "Docker", why: "screened for" }],
};

beforeEach(() => { mockChatJSON.mockReset(); mockConfigured = true; });

describe("the rubric", () => {
  it("scores against the format the candidate declared", async () => {
    mockChatJSON.mockResolvedValue(fullReply);
    await scoreCV(input);
    const p = mockChatJSON.mock.calls[0][0];
    expect(p).toContain("FORMAT THE CANDIDATE SAYS THEY USED: Harvard");
    expect(p).toMatch(/Judge it by that format's rules, not another's/i);
  });

  it("refuses to award marks for what is absent, and demands specifics", async () => {
    mockChatJSON.mockResolvedValue(fullReply);
    await scoreCV(input);
    const p = mockChatJSON.mock.calls[0][0];
    expect(p).toMatch(/Do not award marks for things that are absent/i);
    expect(p).toMatch(/Never give advice that would fit any CV/i);
  });

  it("passes the target role through for keyword scoring", async () => {
    mockChatJSON.mockResolvedValue(fullReply);
    await scoreCV(input);
    expect(mockChatJSON.mock.calls[0][0]).toContain("TARGET ROLE: Backend Engineer");
  });
});

describe("the report", () => {
  it("always returns all six dimensions, even if the model omits one", () => {
    const partial = { ...fullReply, dimensions: [{ key: "parseability", score: 90, note: "n" }] };
    const r = validateReport(partial, input);
    expect(r.dimensions).toHaveLength(6);
    // A dropped dimension shows as unscored rather than silently disappearing
    // and making the report look complete.
    expect(r.dimensions.find((d) => d.key === "format").score).toBe(0);
    expect(r.dimensions.map((d) => d.key)).toEqual(
      ["parseability", "format", "keywords", "achievements", "completeness", "clarity"]);
  });

  it("clamps scores into 0-100", () => {
    const r = validateReport({ ...fullReply, score: 250,
      dimensions: [{ key: "parseability", score: -10, note: "" }] }, input);
    expect(r.score).toBe(100);
    expect(r.dimensions[0].score).toBe(0);
  });

  it("defaults an unknown severity rather than dropping the issue", () => {
    const r = validateReport({ ...fullReply,
      formatting_issues: [{ severity: "catastrophic", title: "T", detail: "d", fix: "f" }] }, input);
    expect(r.formattingIssues[0].severity).toBe("medium");
  });

  it("drops issues with no title", () => {
    const r = validateReport({ ...fullReply,
      formatting_issues: [{ severity: "high", detail: "d" }, { severity: "low", title: "Real" }] }, input);
    expect(r.formattingIssues).toHaveLength(1);
  });

  it("omits skill gaps when there is no target role to be a gap from", () => {
    const r = validateReport(fullReply, { ...input, targetRole: "" });
    expect(r.skillGaps).toEqual([]);
    expect(r.formattingIssues.length).toBeGreaterThan(0);   // the rest still stands
  });

  it("keeps skill gaps when a target role is set", () => {
    expect(validateReport(fullReply, input).skillGaps).toEqual([{ skill: "Docker", why: "screened for" }]);
  });
});

describe("failure reporting", () => {
  it("retries once, then reports bad_output", async () => {
    mockChatJSON.mockResolvedValue({ nope: true });
    expect(await scoreCV(input)).toEqual({ ok: false, reason: "bad_output" });
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unreachable from a bad reply", async () => {
    mockChatJSON.mockResolvedValue(null);
    expect(await scoreCV(input)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("does not retry an unreachable server", async () => {
    // Retrying a timeout makes the user wait the whole budget twice to be told
    // the same thing. Only a real but unusable answer is worth asking again for.
    mockChatJSON.mockResolvedValue(null);
    await scoreCV(input);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("gives scoring a budget that survives a cold server", async () => {
    mockChatJSON.mockResolvedValue(fullReply);
    await scoreCV(input);
    // ~25s of generation plus ~22s of Render cold start must fit.
    expect(mockChatJSON.mock.calls[0][1]?.timeoutMs).toBeGreaterThanOrEqual(90_000);
  });

  it("reports no_ai without calling out", async () => {
    mockConfigured = false;
    expect(await scoreCV(input)).toEqual({ ok: false, reason: "no_ai" });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});
