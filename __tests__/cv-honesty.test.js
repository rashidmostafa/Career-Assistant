/**
 * The optimised CV must not claim anything the candidate cannot defend.
 *
 * Asking a model to "improve a CV" is asking it to embellish, so the output is
 * checked rather than trusted: a fabricated skill is only discovered in an
 * interview, which is the worst possible place.
 */
const mockChatJSON = jest.fn();
let mockConfigured = true;
let mockRateLimitSec = null;
jest.mock("@/services/aiClient", () => ({
  get isAIConfigured() { return mockConfigured; },
  chatJSON: (...a) => mockChatJSON(...a),
  get lastRateLimitSeconds() { return mockRateLimitSec; },
}));

const { generateOptimisedCV, findUnsupportedSkills } = require("../services/cvAI");

const CV_TEXT = `RASHID MOSTAFA
Backend developer. Built REST APIs with Node.js and Express, backed by MongoDB.
Introduced Jest unit tests. Uses Git.`;

const input = {
  cvText: CV_TEXT,
  targetFormat: "Corporate",
  targetRole: "Backend Engineer",
  cvSkills: ["Node.js", "Express", "MongoDB", "Jest", "Git"],
};

beforeEach(() => { mockChatJSON.mockReset(); mockConfigured = true; mockRateLimitSec = null; });

describe("detecting invented skills", () => {
  it("flags a skill that appears nowhere in the source", () => {
    const rewritten = CV_TEXT + "\nAlso experienced with Docker and Kubernetes.";
    const flagged = findUnsupportedSkills(rewritten, input);
    expect(flagged.join(" ").toLowerCase()).toMatch(/docker|kubernetes/);
  });

  it("accepts skills the source CV already shows", () => {
    expect(findUnsupportedSkills(CV_TEXT, input)).toEqual([]);
  });

  it("accepts anything written in the source even if not in the skill list", () => {
    // The extractor does not name every skill; text in the CV is evidence too.
    const withSourceTerm = "Rewritten. Built REST APIs with Node.js and Express.";
    expect(findUnsupportedSkills(withSourceTerm, { ...input, cvSkills: [] })).toEqual([]);
  });

  it("accepts skills genuinely gained since, e.g. from the roadmap", () => {
    const rewritten = CV_TEXT + "\nDocker containerisation.";
    expect(findUnsupportedSkills(rewritten, { ...input, gainedSkills: ["Docker"] })).toEqual([]);
  });
});

describe("generation", () => {
  const clean = { cv: CV_TEXT + "\n\nPROFESSIONAL SUMMARY\nBackend engineer." };

  it("forbids invention in the prompt, in absolute terms", async () => {
    mockChatJSON.mockResolvedValue(clean);
    await generateOptimisedCV(input);
    const p = mockChatJSON.mock.calls[0][0];
    expect(p).toMatch(/Never add a skill to raise the score/i);
    expect(p).toMatch(/Never invent a metric, a percentage, an employer, a date or a certification/i);
    expect(p).toMatch(/If the CV is weak in an area, leave it weak/i);
  });

  it("passes the permitted skills and the target format", async () => {
    mockChatJSON.mockResolvedValue(clean);
    await generateOptimisedCV(input);
    const p = mockChatJSON.mock.calls[0][0];
    expect(p).toContain("Node.js, Express, MongoDB, Jest, Git");
    expect(p).toContain("WRITE IT IN THIS FORMAT: Corporate");
  });

  it("asks again, naming the offenders, when it invents something", async () => {
    mockChatJSON
      .mockResolvedValueOnce({ cv: CV_TEXT + "\nExpert in Docker, Kubernetes and AWS across many projects." })
      .mockResolvedValueOnce(clean);

    const r = await generateOptimisedCV(input);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);

    const retry = mockChatJSON.mock.calls[1][0];
    expect(retry).toMatch(/previous attempt introduced these/i);
    expect(retry.toLowerCase()).toMatch(/docker/);
    expect(r.ok).toBe(true);
    expect(r.cv.flagged).toEqual([]);
  });

  it("surfaces what it could not remove rather than shipping it silently", async () => {
    // Stubborn model: invents on both attempts.
    const dishonest = { cv: CV_TEXT + "\nExtensive Docker and Kubernetes experience." };
    mockChatJSON.mockResolvedValue(dishonest);

    const r = await generateOptimisedCV(input);
    expect(r.ok).toBe(true);
    // Returned to the user as a warning — not stripped, not hidden.
    expect(r.cv.flagged.length).toBeGreaterThan(0);
  });

  it("rejects an empty or truncated rewrite", async () => {
    mockChatJSON.mockResolvedValue({ cv: "too short" });
    expect((await generateOptimisedCV(input)).ok).toBe(false);
  });

  it("reports rate limits and outages distinctly", async () => {
    mockChatJSON.mockResolvedValue(null);
    mockRateLimitSec = 25;
    expect(await generateOptimisedCV(input)).toEqual({ ok: false, reason: "rate_limited", retryAfterSec: 25 });

    mockRateLimitSec = null;
    expect(await generateOptimisedCV(input)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("does not call out when AI is unconfigured", async () => {
    mockConfigured = false;
    expect(await generateOptimisedCV(input)).toEqual({ ok: false, reason: "no_ai" });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});
