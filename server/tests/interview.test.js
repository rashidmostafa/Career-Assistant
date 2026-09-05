/**
 * The question bank.
 *
 * Generation is exercised against a mocked upstream: it writes into a bank that
 * every user of a role shares, so the validation that decides what gets stored
 * is the part worth pinning.
 */
process.env.AI_API_KEY = "test-key";

const { roleKeyOf } = require("../models/InterviewQuestion");

describe("role keys", () => {
  it("collapses the spellings a free-text role arrives in", () => {
    const k = roleKeyOf("Backend Engineer");
    expect(roleKeyOf("backend engineer")).toBe(k);
    expect(roleKeyOf("  Backend   Engineer ")).toBe(k);
    expect(roleKeyOf("Backend-Engineer")).toBe(k);
  });

  it("keeps characters that carry meaning in a role name", () => {
    expect(roleKeyOf("C# Developer")).toContain("c#");
    expect(roleKeyOf("C++ Engineer")).toContain("c++");
    expect(roleKeyOf(".NET Developer")).toContain(".net");
  });

  it("does not collapse two different roles onto one key", () => {
    expect(roleKeyOf("Data Scientist")).not.toBe(roleKeyOf("Data Engineer"));
  });

  it("survives nothing at all", () => {
    expect(roleKeyOf(undefined)).toBe("");
    expect(roleKeyOf("")).toBe("");
  });
});

describe("the seeded bank", () => {
  const { seedDocuments } = require("../data/interviewSeed");
  const docs = seedDocuments();

  it("ships questions for the roles this deployment already has", () => {
    const roles = new Set(docs.map((d) => d.role));
    for (const r of ["Backend Engineer", "Frontend Developer", "Software Engineer"]) {
      expect(roles).toContain(r);
    }
  });

  it("tags every question by role, competency and difficulty", () => {
    // The radar chart groups by competency and the slider filters by
    // difficulty, so an untagged question breaks both features silently.
    for (const d of docs) {
      expect(d.role).toBeTruthy();
      expect(d.competency).toBeTruthy();
      expect(["Junior", "Mid", "Senior"]).toContain(d.difficulty);
      expect(["Technical", "Behavioral", "System Design"]).toContain(d.type);
    }
  });

  it("gives every question keywords to score against", () => {
    // The score IS keyword overlap, so a question without them can only ever
    // score zero.
    for (const d of docs) {
      expect(d.keywords.length).toBeGreaterThanOrEqual(3);
      expect(new Set(d.keywords).size).toBe(d.keywords.length);
      for (const k of d.keywords) expect(k).toBe(k.toLowerCase());
    }
  });

  it("has no duplicate question within a role", () => {
    const seen = new Set();
    for (const d of docs) {
      const key = `${d.role}::${d.question}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("covers every difficulty for each role, so the slider always has questions", () => {
    const byRole = {};
    for (const d of docs) (byRole[d.role] ??= new Set()).add(d.difficulty);
    for (const [role, levels] of Object.entries(byRole)) {
      expect({ role, levels: [...levels].sort() }).toEqual({ role, levels: ["Junior", "Mid", "Senior"] });
    }
  });
});

describe("generation writes only usable questions into the shared bank", () => {
  let generateInto, bulkWritten;

  beforeEach(() => {
    jest.resetModules();
    bulkWritten = null;
    jest.doMock("../models/InterviewQuestion", () => {
      const model = {
        find: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }),
        bulkWrite: async (ops) => { bulkWritten = ops; return { upsertedCount: ops.length }; },
      };
      model.roleKeyOf = roleKeyOf;
      return model;
    });
    ({ generateInto } = require("../routes/interview").__internals);
  });

  const reply = (payload, status = 200) => {
    global.fetch = jest.fn(async () => ({
      ok: status === 200,
      status,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      text: async () => "",
    }));
  };

  const good = {
    competency: "Circuit Analysis",
    type: "Technical",
    question: "Explain Ohm's law.",
    idealAnswer: "Current equals voltage divided by resistance, which relates the three quantities in a conductor.",
    keywords: ["voltage", "current", "resistance"],
  };

  it("stores a well-formed question", async () => {
    reply({ questions: [good] });
    const r = await generateInto("Electrical Engineering Intern", "Junior");
    expect(r.inserted).toBe(1);
    expect(bulkWritten[0].updateOne.update.$setOnInsert.source).toBe("ai");
  });

  it("drops a question whose ideal answer is too thin to score against", async () => {
    reply({ questions: [{ ...good, idealAnswer: "Yes." }] });
    expect((await generateInto("X", "Junior")).inserted).toBe(0);
  });

  it("drops a question with too few keywords", async () => {
    reply({ questions: [{ ...good, keywords: ["voltage"] }] });
    expect((await generateInto("X", "Junior")).inserted).toBe(0);
  });

  it("drops an untagged question rather than breaking the radar chart", async () => {
    reply({ questions: [{ ...good, competency: "" }] });
    expect((await generateInto("X", "Junior")).inserted).toBe(0);
  });

  it("corrects an invalid type instead of rejecting the question", async () => {
    reply({ questions: [{ ...good, type: "Trick Question" }] });
    const r = await generateInto("X", "Junior");
    expect(r.inserted).toBe(1);
    expect(bulkWritten[0].updateOne.update.$setOnInsert.type).toBe("Technical");
  });

  it("lowercases and de-duplicates keywords, since scoring compares them", async () => {
    reply({ questions: [{ ...good, keywords: ["Voltage", "voltage", "CURRENT", "resistance"] }] });
    await generateInto("X", "Junior");
    expect(bulkWritten[0].updateOne.update.$setOnInsert.keywords).toEqual(["voltage", "current", "resistance"]);
  });

  it("survives a model that returns no questions at all", async () => {
    reply({});
    expect((await generateInto("X", "Junior")).reason).toBe("no_valid_questions");
  });

  it("reports a rate limit instead of retrying into a deeper block", async () => {
    // Retrying a 429 spends the same quota and lengthens the block; ai.js
    // learned this the hard way and this path must not relearn it.
    global.fetch = jest.fn(async () => ({
      ok: false, status: 429, text: async () => "retry in 25.0s", json: async () => ({}),
    }));
    const r = await generateInto("X", "Junior");
    expect(r.reason).toBe("rate_limited");
    expect(r.retryAfterSec).toBe(25);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 503, which is the model being momentarily busy", async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      if (n === 1) return { ok: false, status: 503, text: async () => "", json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ questions: [good] }) } }] }), text: async () => "" };
    });
    const r = await generateInto("X", "Junior");
    expect(r.inserted).toBe(1);
    expect(n).toBe(2);
  });

  it("names the failure rather than reporting an empty role", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => "", json: async () => ({}) }));
    expect((await generateInto("X", "Junior")).reason).toBe("upstream_500");
  });
});
