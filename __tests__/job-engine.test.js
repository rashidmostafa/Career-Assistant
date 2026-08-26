/**
 * Job engine rules 1, 4 and 5.
 */
jest.mock("@/services/syncedStorage", () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/context/CVContext", () => ({ useCV: () => ({ cv: null, skills: [] }) }));
jest.mock("@/services/aiClient", () => ({ isAIConfigured: true, chatJSON: jest.fn() }));

const { isRelevantToRole } = require("../context/JobsContext");
const { computeJobMatch, matchTier } = require("../utils/jobMatch");

describe("rule 1 — only jobs for the target role", () => {
  const job = (title, category = "Mid") => ({ title, category });

  it("keeps roles matching the target", () => {
    expect(isRelevantToRole(job("Senior Backend Engineer"), "Backend Engineer")).toBe(true);
    expect(isRelevantToRole(job("Backend Developer (Remote)"), "Backend Engineer")).toBe(true);
  });

  it("drops unrelated roles", () => {
    expect(isRelevantToRole(job("Content Reviewer - English US"), "Backend Engineer")).toBe(false);
    expect(isRelevantToRole(job("Customer Success Manager"), "Backend Engineer")).toBe(false);
    expect(isRelevantToRole(job("Registered Nurse"), "Data Scientist")).toBe(false);
  });

  it("ignores seniority words, which say nothing about the discipline", () => {
    // "Senior" alone must not make a nursing role match an engineering target.
    expect(isRelevantToRole(job("Senior Nurse Practitioner"), "Senior Backend Engineer")).toBe(false);
  });

  it("shows everything when no target role is set", () => {
    expect(isRelevantToRole(job("Anything At All"), "")).toBe(true);
  });
});

describe("rule 5 — match comes from the CV's skills", () => {
  it("scores the proportion of required skills the CV covers", () => {
    const r = computeJobMatch(["Node.js", "AWS", "Docker", "React"], ["Node.js", "React"]);
    expect(r.score).toBe(50);
    expect(r.matched.sort()).toEqual(["Node.js", "React"]);
    expect(r.gapAnalysis.sort()).toEqual(["AWS", "Docker"]);
  });

  it("treats differently written names as the same skill", () => {
    // A candidate must not be marked down for how a posting spells a thing.
    expect(computeJobMatch(["Node"], ["Node.js"]).score).toBe(100);
    expect(computeJobMatch(["React.js"], ["React"]).score).toBe(100);
  });

  it("returns zero, and says why, when there is nothing to compare", () => {
    const noCv = computeJobMatch(["Node.js"], []);
    expect(noCv.score).toBe(0);
    expect(noCv.rationale).toMatch(/upload a cv/i);

    const noSkills = computeJobMatch([], ["Node.js"]);
    expect(noSkills.score).toBe(0);
    expect(noSkills.rationale).toMatch(/doesn't list specific skills/i);
  });

  it("never invents a score when a posting lists no requirements", () => {
    expect(computeJobMatch([], []).score).toBe(0);
  });

  it("bands scores sensibly", () => {
    expect(matchTier(85)).toBe("high");
    expect(matchTier(55)).toBe("medium");
    expect(matchTier(20)).toBe("low");
  });
});
