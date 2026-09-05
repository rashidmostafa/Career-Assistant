/**
 * Streaks, XP, mastery and calibration.
 *
 * These decide what the dashboard claims about the user, so a quiet arithmetic
 * fault here would misreport their progress rather than crash anything.
 */
jest.mock("@/services/syncedStorage", () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/services/aiClient", () => ({ isAIConfigured: false, chatJSON: jest.fn() }));

const {
  nextStreak, xpForAnswer, masteryFrom, confidenceGap, badgeNameFor, earnedBadges,
} = require("../context/InterviewContext");

const answer = (over = {}) => ({
  questionId: "q", question: "", idealAnswer: "", keywords: [], competency: "Databases",
  difficulty: "Mid", type: "Technical", userAnswer: "", score: 50, takeaways: [],
  matched: [], missed: [], confidence: null, secondsTaken: 10, reviewedByAI: false,
  isComeback: false, ...over,
});
const session = (answers, over = {}) => ({
  id: `s${Math.random()}`, role: "Backend Engineer", difficulty: "Mid", preset: "standard",
  timed: false, startedAt: "", completedAt: "2026-09-05T10:00:00.000Z",
  overallScore: Math.round(answers.reduce((s, a) => s + a.score, 0) / answers.length),
  xpEarned: 0, answers, ...over,
});

describe("practice streak", () => {
  it("starts at one on the first ever session", () => {
    expect(nextStreak(null, "2026-09-05", 0)).toBe(1);
  });

  it("advances on a consecutive day", () => {
    expect(nextStreak("2026-09-04", "2026-09-05", 3)).toBe(4);
  });

  it("does not advance twice in the same day", () => {
    expect(nextStreak("2026-09-05", "2026-09-05", 3)).toBe(3);
  });

  it("resets to one after a missed day, not to zero", () => {
    // Returning after a gap should feel like day one, not like nothing.
    expect(nextStreak("2026-09-03", "2026-09-05", 9)).toBe(1);
  });

  it("crosses a month boundary", () => {
    expect(nextStreak("2026-08-31", "2026-09-01", 5)).toBe(6);
  });

  it("crosses a year boundary", () => {
    expect(nextStreak("2026-12-31", "2027-01-01", 2)).toBe(3);
  });

  it("does not advance for a day in the past", () => {
    expect(nextStreak("2026-09-05", "2026-09-04", 4)).toBe(1);
  });
});

describe("XP", () => {
  it("pays something for attempting, even at zero", () => {
    expect(xpForAnswer(0, "Mid")).toBeGreaterThan(0);
  });

  it("pays more for a better answer", () => {
    expect(xpForAnswer(100, "Mid")).toBeGreaterThan(xpForAnswer(50, "Mid"));
  });

  it("pays more at harder levels for the same score", () => {
    expect(xpForAnswer(80, "Senior")).toBeGreaterThan(xpForAnswer(80, "Junior"));
  });

  it("always returns a whole number", () => {
    for (const d of ["Junior", "Mid", "Senior"]) {
      for (const s of [0, 33, 67, 100]) expect(Number.isInteger(xpForAnswer(s, d))).toBe(true);
    }
  });
});

describe("competency mastery", () => {
  it("averages every answer in a competency across sessions", () => {
    const m = masteryFrom([
      session([answer({ competency: "Databases", score: 80 })]),
      session([answer({ competency: "Databases", score: 60 })]),
    ]);
    expect(m).toEqual([{ competency: "Databases", score: 70, answered: 2 }]);
  });

  it("separates competencies", () => {
    const m = masteryFrom([session([
      answer({ competency: "Databases", score: 90 }),
      answer({ competency: "Security", score: 30 }),
    ])]);
    expect(m.find((x) => x.competency === "Databases").score).toBe(90);
    expect(m.find((x) => x.competency === "Security").score).toBe(30);
  });

  it("orders by how much the user has actually practised", () => {
    const m = masteryFrom([session([
      answer({ competency: "Rare", score: 100 }),
      answer({ competency: "Common", score: 10 }),
      answer({ competency: "Common", score: 20 }),
    ])]);
    expect(m[0].competency).toBe("Common");
  });

  it("buckets an untagged answer rather than dropping it", () => {
    const m = masteryFrom([session([answer({ competency: "" })])]);
    expect(m[0].competency).toBe("General");
  });

  it("is empty before any session", () => {
    expect(masteryFrom([])).toEqual([]);
  });
});

describe("confidence calibration", () => {
  it("reports a positive gap when the user overrates themselves", () => {
    // Confidence 5 of 5 is 100 on the score scale; scoring 40 is a 60 gap.
    const r = confidenceGap([session([answer({ confidence: 5, score: 40 })])]);
    expect(r.gap).toBe(60);
    expect(r.samples).toBe(1);
  });

  it("reports a negative gap when the user underrates themselves", () => {
    expect(confidenceGap([session([answer({ confidence: 1, score: 80 })])]).gap).toBe(-80);
  });

  it("reports no gap when confidence tracks the score", () => {
    expect(confidenceGap([session([answer({ confidence: 3, score: 50 })])]).gap).toBe(0);
  });

  it("ignores answers where confidence was skipped", () => {
    const r = confidenceGap([session([answer({ confidence: null, score: 10 }), answer({ confidence: 3, score: 50 })])]);
    expect(r.samples).toBe(1);
    expect(r.gap).toBe(0);
  });

  it("returns nothing to report when nothing was rated", () => {
    expect(confidenceGap([session([answer({ confidence: null })])])).toEqual({ gap: 0, samples: 0 });
  });
});

describe("badges", () => {
  it("names known competencies evocatively", () => {
    expect(badgeNameFor("System Design")).toBe("Design Guru");
    expect(badgeNameFor("algorithms")).toBe("Algorithm Ace");
  });

  it("falls back to a sensible name for a generated competency", () => {
    expect(badgeNameFor("Circuit Analysis")).toBe("Circuit Analysis Ace");
  });

  it("awards a competency badge only with enough answers behind it", () => {
    const few = earnedBadges([{ competency: "Databases", score: 95, answered: 4 }], [session([answer()])], 1);
    expect(few).not.toContain("Query Master");
    const enough = earnedBadges([{ competency: "Databases", score: 95, answered: 5 }], [session([answer()])], 1);
    expect(enough).toContain("Query Master");
  });

  it("does not award a competency badge for mediocre scores", () => {
    const b = earnedBadges([{ competency: "Databases", score: 79, answered: 20 }], [session([answer()])], 1);
    expect(b).not.toContain("Query Master");
  });

  it("awards streak and milestone badges", () => {
    const b = earnedBadges([], Array.from({ length: 10 }, () => session([answer()])), 7);
    expect(b).toEqual(expect.arrayContaining(["First Session", "Ten Sessions", "3-Day Streak", "7-Day Streak"]));
    expect(b).not.toContain("Fifty Sessions");
    expect(b).not.toContain("30-Day Streak");
  });

  it("awards Flawless only for a perfect session", () => {
    expect(earnedBadges([], [session([answer({ score: 100 })])], 1)).toContain("Flawless");
    expect(earnedBadges([], [session([answer({ score: 99 })])], 1)).not.toContain("Flawless");
  });

  it("never returns a duplicate", () => {
    const b = earnedBadges(
      [{ competency: "Databases", score: 95, answered: 9 }, { competency: "databases", score: 95, answered: 9 }],
      [session([answer()])], 3,
    );
    expect(new Set(b).size).toBe(b.length);
  });
});
