/**
 * Scoring and the Keyword Detective.
 *
 * These share one implementation on purpose: the score is the count of matched
 * keywords and the colouring is where those same matches fall in the ideal
 * answer, so a disagreement between them would be visible to the user as a
 * green word that earned no points.
 */
const {
  scoreAnswer, segmentIdealAnswer, blankIdealAnswer, scoreTier,
} = require("../services/interviewScoring");

describe("scoring an answer", () => {
  const kw = ["timeout", "retry", "circuit breaker"];

  it("scores the share of expected terms the answer used", () => {
    const r = scoreAnswer("I would set a timeout and add a retry.", kw);
    expect(r.score).toBe(67);
    expect(r.matched.sort()).toEqual(["retry", "timeout"]);
    expect(r.missed).toEqual(["circuit breaker"]);
  });

  it("gives full marks when everything is covered", () => {
    expect(scoreAnswer("timeout, retry, circuit breaker", kw).score).toBe(100);
  });

  it("scores an empty answer zero and counts everything as missed", () => {
    const r = scoreAnswer("", kw);
    expect(r.score).toBe(0);
    expect(r.missed).toHaveLength(3);
  });

  it("never scores a question that has nothing to compare against", () => {
    // The job matcher learned this: "no requirements listed" must not read as
    // a perfect match.
    expect(scoreAnswer("a confident-sounding answer", []).score).toBe(0);
  });

  it("matches multi-word terms, which a word-set intersection would miss", () => {
    expect(scoreAnswer("add a circuit breaker", ["circuit breaker"]).matched).toEqual(["circuit breaker"]);
    expect(scoreAnswer("a circuit  breaker trips", ["circuit breaker"]).score).toBe(100);
  });

  it("tolerates plurals and tenses", () => {
    expect(scoreAnswer("we add retries", ["retry"]).score).toBe(100);
    expect(scoreAnswer("indexes on the column", ["index"]).score).toBe(100);
    expect(scoreAnswer("sharding the table", ["shard"]).score).toBe(100);
    expect(scoreAnswer("we cached it", ["cache"]).score).toBe(100);
  });

  it("matches terms whose punctuation defeats a word boundary", () => {
    expect(scoreAnswer("I write C++ daily", ["c++"]).score).toBe(100);
    expect(scoreAnswer("using C# and .NET", ["c#", ".net"]).score).toBe(100);
    expect(scoreAnswer("by Ohm's law", ["ohm's law"]).score).toBe(100);
    expect(scoreAnswer("returns a 429", ["429"]).score).toBe(100);
  });

  it("does not count a term found inside an unrelated word", () => {
    expect(scoreAnswer("the application was retired", ["tire"]).score).toBe(0);
    expect(scoreAnswer("a scandal", ["scan"]).score).toBe(0);
    expect(scoreAnswer("indexing the cathedral", ["cat"]).score).toBe(0);
  });

  it("is case-insensitive and ignores duplicate keywords", () => {
    expect(scoreAnswer("TIMEOUT", ["timeout", "Timeout", "TIMEOUT"]).score).toBe(100);
  });

  it("bands scores for colour and wording", () => {
    expect(scoreTier(85)).toBe("strong");
    expect(scoreTier(70)).toBe("strong");
    expect(scoreTier(55)).toBe("fair");
    expect(scoreTier(39)).toBe("weak");
  });
});

describe("keyword detective colouring", () => {
  const ideal = "Set a timeout, then add a retry with a circuit breaker in front.";
  const kw = ["timeout", "retry", "circuit breaker"];

  it("marks what the user said green and what they missed red", () => {
    const { matched } = scoreAnswer("I would use a timeout", kw);
    const segs = segmentIdealAnswer(ideal, kw, matched);
    const hits = segs.filter((s) => s.status === "hit").map((s) => s.text.toLowerCase());
    const misses = segs.filter((s) => s.status === "miss").map((s) => s.text.toLowerCase());
    expect(hits).toEqual(["timeout"]);
    expect(misses.sort()).toEqual(["circuit breaker", "retry"]);
  });

  it("reassembles into exactly the original text", () => {
    // A colouring pass that drops or duplicates a character would rewrite the
    // ideal answer the user is reading.
    const segs = segmentIdealAnswer(ideal, kw, ["timeout"]);
    expect(segs.map((s) => s.text).join("")).toBe(ideal);
  });

  it("prefers the longer term when two overlap", () => {
    const segs = segmentIdealAnswer("use a circuit breaker", ["circuit", "circuit breaker"], ["circuit breaker"]);
    const marked = segs.filter((s) => s.status !== "plain").map((s) => s.text);
    expect(marked).toEqual(["circuit breaker"]);
  });

  it("colours every occurrence, not only the first", () => {
    const segs = segmentIdealAnswer("timeout, then another timeout", ["timeout"], ["timeout"]);
    expect(segs.filter((s) => s.status === "hit")).toHaveLength(2);
  });

  it("returns the text unmarked when there are no keywords", () => {
    const segs = segmentIdealAnswer(ideal, [], []);
    expect(segs).toEqual([{ text: ideal, status: "plain" }]);
  });

  it("handles an empty ideal answer", () => {
    expect(segmentIdealAnswer("", kw, [])).toEqual([]);
  });
});

describe("flashcard fill-in-the-blank", () => {
  const ideal = "Set a timeout and add a retry.";

  it("hides the keywords and keeps the sentence readable", () => {
    const segs = blankIdealAnswer(ideal, ["timeout", "retry"]);
    const rendered = segs.map((s) => s.text).join("");
    expect(rendered).not.toContain("timeout");
    expect(rendered).not.toContain("retry");
    expect(rendered).toContain("Set a ");
    expect(rendered).toContain(" and add a ");
  });

  it("sizes the blank to the hidden word so the shape survives", () => {
    const segs = blankIdealAnswer(ideal, ["timeout"]);
    const blank = segs.find((s) => s.status === "miss");
    expect(blank.text).toBe("_______");
  });

  it("blanks every keyword, since recall is the point", () => {
    const segs = blankIdealAnswer(ideal, ["timeout", "retry"]);
    expect(segs.filter((s) => s.status === "miss")).toHaveLength(2);
  });
});
