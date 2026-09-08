/**
 * Composing a CV from answers.
 *
 * The output is the same plain text an uploaded CV produces, because everything
 * downstream — the roadmap gate, job matching, the ATS scorer — reads exactly
 * that. A built CV that composed differently would work in the builder and
 * nowhere else.
 */
jest.mock("@/services/syncedStorage", () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));

const {
  composeCV, coverageAgainst, draftIssues, canSave, draftCompleteness,
  EMPTY_DRAFT, emptyEducation, emptyProject,
} = require("../services/cvBuilder");

const student = () => ({
  ...EMPTY_DRAFT,
  contact: { fullName: "Rahim Uddin", email: "rahim@example.com", phone: "+880 1700 000000", location: "Dhaka", links: ["github.com/rahim"] },
  summary: "Final-year computer science student focused on backend development.",
  education: [{ id: "e1", qualification: "BSc in Computer Science", institution: "University of Dhaka", year: "2026", detail: "CGPA 3.7" }],
  experience: [],
  projects: [{ id: "p1", name: "Library Management System", tech: "Java, MySQL", bullets: ["Built a REST API handling 500 book records", ""] }],
  skills: ["Java", "MySQL", "Git"],
  format: "Harvard",
});

describe("what a CV must contain before it can be saved", () => {
  it("accepts a student with no work experience at all", () => {
    // The people this feature exists for have none; refusing them would lock
    // out exactly the users it was added for.
    const d = student();
    expect(d.experience).toHaveLength(0);
    expect(canSave(d)).toBe(true);
  });

  it("insists on a name and a reachable email", () => {
    expect(draftIssues({ ...student(), contact: { ...student().contact, fullName: "" } })).toContainEqual(expect.stringMatching(/name/i));
    expect(draftIssues({ ...student(), contact: { ...student().contact, email: "" } })).toContainEqual(expect.stringMatching(/email/i));
  });

  it("rejects an email that could never receive a reply", () => {
    const d = { ...student(), contact: { ...student().contact, email: "rahim.example.com" } };
    expect(draftIssues(d)).toContainEqual(expect.stringMatching(/doesn't look right/i));
  });

  it("requires something to show: education, a job, or a project", () => {
    const bare = { ...EMPTY_DRAFT, contact: student().contact, skills: ["Java"] };
    expect(canSave(bare)).toBe(false);
  });

  it("scores completeness so the bar can move as the user types", () => {
    expect(draftCompleteness(EMPTY_DRAFT)).toBe(0);
    expect(draftCompleteness(student())).toBeGreaterThan(60);
    expect(draftCompleteness(student())).toBeLessThanOrEqual(100);
  });
});

describe("composing the document", () => {
  it("puts everything the user entered into the text", () => {
    const t = composeCV(student());
    for (const probe of ["RAHIM UDDIN", "rahim@example.com", "University of Dhaka", "Library Management System", "Java, MySQL, Git"]) {
      expect(t).toContain(probe);
    }
  });

  it("drops an empty section instead of printing a bare heading", () => {
    // An EXPERIENCE heading with nothing under it advertises the gap.
    expect(composeCV(student())).not.toContain("EXPERIENCE");
  });

  it("orders sections by the chosen format, which is what the scorer expects", () => {
    const harvard = composeCV({ ...student(), format: "Harvard" });
    const corporate = composeCV({ ...student(), format: "Corporate" });
    // Harvard leads with Education; a corporate CV opens with the summary.
    expect(harvard.indexOf("EDUCATION")).toBeLessThan(harvard.indexOf("SKILLS"));
    expect(corporate.indexOf("PROFESSIONAL SUMMARY")).toBeLessThan(corporate.indexOf("EDUCATION"));
  });

  it("names the skills block the way each format does", () => {
    expect(composeCV({ ...student(), format: "MIT" })).toContain("TECHNICAL SKILLS");
    expect(composeCV({ ...student(), format: "Corporate" })).toContain("CORE COMPETENCIES");
    expect(composeCV({ ...student(), format: "Harvard" })).toContain("SKILLS");
  });

  it("gives an unfamiliar format a conventional order rather than guessing", () => {
    const own = composeCV({ ...student(), format: "My university's own template" });
    expect(own).toContain("RAHIM UDDIN");
    expect(own.indexOf("PROFESSIONAL SUMMARY")).toBeLessThan(own.indexOf("EDUCATION"));
  });

  it("ignores blank bullets the user left behind", () => {
    expect(composeCV(student())).not.toMatch(/•\s*\n/);
  });

  it("never runs three blank lines together", () => {
    expect(composeCV(student())).not.toMatch(/\n{3}/);
  });

  it("produces something for an almost-empty draft without throwing", () => {
    expect(() => composeCV(EMPTY_DRAFT)).not.toThrow();
    expect(composeCV({ ...EMPTY_DRAFT, education: [emptyEducation()], projects: [emptyProject()] })).toBeDefined();
  });
});

describe("coverage against the job being targeted", () => {
  it("credits a skill evidenced in a project description, not just the skills box", () => {
    // "Built a REST API" evidences it whether or not the user typed it in.
    const c = coverageAgainst(student(), ["java", "rest api", "docker"]);
    expect(c.covered).toEqual(expect.arrayContaining(["java", "rest api"]));
    expect(c.missing).toContain("docker");
  });

  it("reports a percentage the bar can show", () => {
    expect(coverageAgainst(student(), ["java", "docker"]).percent).toBe(50);
  });

  it("says nothing rather than inventing a score with no target", () => {
    expect(coverageAgainst(student(), [])).toEqual({ covered: [], missing: [], percent: 0 });
  });

  it("is not confused by case or duplicates in the target list", () => {
    const c = coverageAgainst(student(), ["Java", "java", "JAVA"]);
    expect(c.covered).toEqual(["java"]);
    expect(c.percent).toBe(100);
  });
});

/**
 * The rewrite must not invent.
 *
 * The whole CV engine rests on not putting anything on a CV the candidate
 * cannot defend in an interview, and a half-finished bullet is where a model is
 * most tempted to embellish. The prompt forbids it; this checks the output
 * rather than trusting it.
 */
describe("bullet rewriting refuses invented facts", () => {
  const { addedFacts } = require("../services/cvBuilderAI");

  it("catches an invented metric", () => {
    expect(addedFacts("Built a library system", "Built a library system, cutting search time by 40%"))
      .toContain("40%");
  });

  it("catches an invented technology", () => {
    expect(addedFacts("Made a website", "Built a responsive website using React and Node.js"))
      .toEqual(expect.arrayContaining(["react"]));
  });

  it("allows a rewrite that only rephrases", () => {
    expect(addedFacts("made a website", "Built and deployed a website")).toEqual([]);
  });

  it("does not treat capitalising the first word as invention", () => {
    // Rewriting "made a website" to "Made a website" is grammar, not a claim.
    expect(addedFacts("made a website", "Made a website")).toEqual([]);
  });

  it("keeps a number the user already gave", () => {
    expect(addedFacts("Handled 500 book records", "Built a system handling 500 book records")).toEqual([]);
  });

  it("catches a number added alongside one already there", () => {
    const added = addedFacts("Handled 500 records", "Handled 500 records across 3 teams");
    expect(added).toContain("3");
  });

  it("allows a technology the user already named", () => {
    expect(addedFacts("Used MySQL for storage", "Designed the MySQL schema for storage")).toEqual([]);
  });
});

describe("where the builder is reached from", () => {
  const fs = require("fs");
  const path = require("path");
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  it("is offered on the CV page, in both its states", () => {
    // Someone with no CV cannot follow an instruction to upload one; someone
    // who has one may still want a second for a different role.
    const cv = read("app/(tabs)/cv.tsx");
    expect(cv).toMatch(/Build CV from scratch/);
    expect(cv).toMatch(/No CV yet\? Answer a few questions/);
    expect(cv).toMatch(/Write another one, aimed at a different role/);
    expect((cv.match(/<BuildFromScratch/g) ?? []).length).toBe(2);
  });

  it("is no longer in the Job Engine", () => {
    const jobs = read("app/(tabs)/jobs.tsx");
    expect(jobs).not.toMatch(/Build CV from scratch/);
    expect(jobs).not.toMatch(/cv-builder/);
  });

  it("left no dead styles or icons behind in the Job Engine", () => {
    const jobs = read("app/(tabs)/jobs.tsx");
    expect(jobs).not.toMatch(/buildCard|buildIcon|buildTitle|buildSub|FilePlus2/);
  });

  it("restored the upload prompt's own wording", () => {
    // It read "Already have one? Upload it instead", which only made sense
    // sitting beneath the build card that is no longer there.
    expect(read("app/(tabs)/jobs.tsx")).toMatch(/Upload your CV to see how well you match each job/);
  });

  it("still measures coverage without a specific job to aim at", () => {
    // Entered from the CV tab there is no jobId, and the bar would otherwise
    // never appear.
    const b = read("app/cv-builder.tsx");
    expect(b).toMatch(/if \(targetJob\) return targetJob\.requiredSkills/);
    expect(b).toMatch(/MOST ASKED FOR IN YOUR/);
  });
});
