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

  it("does not let a shared job-title noun qualify a different discipline", () => {
    // Measured against real Careerjet results: a Software Engineer search was
    // returning Junior Structural Engineer, because both contain "engineer".
    expect(isRelevantToRole(job("Junior Structural Engineer"), "Software Engineer")).toBe(false);
    expect(isRelevantToRole(job("Sales Manager"), "Product Manager")).toBe(false);
    expect(isRelevantToRole(job("Laboratory Technician"), "Network Technician")).toBe(false);
  });

  it("separates specialisms that share a discipline", () => {
    expect(isRelevantToRole(job("Software Engineer (Frontend)"), "Backend Engineer")).toBe(false);
    expect(isRelevantToRole(job("Backend Engineer"), "Backend Engineer")).toBe(true);
    expect(isRelevantToRole(job("Senior Backend Developer"), "Backend Engineer")).toBe(true);
  });

  it("still matches when the target is only a generic word", () => {
    // "Engineer" alone has nothing to discriminate on; showing nothing would be
    // worse than showing engineering roles.
    expect(isRelevantToRole(job("Structural Engineer"), "Engineer")).toBe(true);
  });

  it("relaxed mode accepts the broader discipline", () => {
    // Used only when strict matching empties the list, so the user sees
    // adjacent software roles rather than a blank screen.
    expect(isRelevantToRole(job("Software Engineer (Frontend)"), "Backend Engineer", { relaxed: true })).toBe(true);
    expect(isRelevantToRole(job("Software QA Engineer"), "Backend Engineer", { relaxed: true })).toBe(true);
    // Still not a free-for-all: an unrelated discipline stays out.
    expect(isRelevantToRole(job("Registered Nurse"), "Backend Engineer", { relaxed: true })).toBe(false);
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

/**
 * Feed sources vs. link-out sites.
 *
 * These were once one list, so the feed filtered its own results against a set
 * of ids that contained neither Remotive nor Arbeitnow. Both boards were
 * dropped in full and never reached the user.
 */
describe("feed sources are separate from link-out sites", () => {
  const fs = require("fs");
  const path = require("path");
  const { FEED_SOURCES, JOB_PLATFORMS } = require("../constants/jobPlatforms");

  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  // Every platformId any source can actually emit, taken from the code itself
  // so a new board added later cannot quietly bypass this check.
  const emitted = [
    ...read("services/jobFeedService.ts").matchAll(/platformId:\s*"([^"]+)"/g),
    ...read("server/services/careerjetService.js").matchAll(/platformId:\s*"([^"]+)"/g),
  ].map((m) => m[1]);

  it("emits only ids the feed knows about", () => {
    expect(new Set(emitted)).toEqual(new Set(["careerjet"]));
  });

  it("passes every emitted id through the default filter", () => {
    const enabledByDefault = FEED_SOURCES.map((s) => s.id);
    for (const id of emitted) expect(enabledByDefault).toContain(id);
  });

  it("does not offer Careerjet as a link-out, since its jobs are in the feed", () => {
    expect(JOB_PLATFORMS.map((p) => p.id)).not.toContain("careerjet");
  });

  it("keeps link-out sites out of the feed filter", () => {
    // bdjobs, LinkedIn and the rest have no API here; listing them as feed
    // sources would show toggles that can never produce a job.
    for (const p of JOB_PLATFORMS) {
      expect(FEED_SOURCES.map((s) => s.id)).not.toContain(p.id);
    }
  });
});

/**
 * Titles punctuate the same word every possible way.
 *
 * Taken from a live Arbeitnow pull: of 179 listings, "Back End Engineer" was
 * rejected for a Backend Engineer target purely because of the space.
 */
describe("rule 1 — spelling variants of the same role", () => {
  const job = (title) => ({ title, category: "Mid" });

  it("treats a space or hyphen as part of the word", () => {
    for (const t of ["Back End Engineer", "Back-End Engineer", "Backend Engineer"]) {
      expect(isRelevantToRole(job(t), "Backend Engineer")).toBe(true);
    }
    expect(isRelevantToRole(job("Front-End Developer"), "Frontend Developer")).toBe(true);
    expect(isRelevantToRole(job("Full Stack Engineer"), "Fullstack Engineer")).toBe(true);
  });

  it("accepts the industry's other name for the same role", () => {
    expect(isRelevantToRole(job("Site Reliability Engineer"), "DevOps Engineer")).toBe(true);
    expect(isRelevantToRole(job("Machine Learning Engineer"), "ML Engineer")).toBe(true);
    expect(isRelevantToRole(job("QA Automation Engineer"), "Quality Assurance Engineer")).toBe(true);
  });

  it("still rejects the roles that shipped the strict filter", () => {
    expect(isRelevantToRole(job("Junior Structural Engineer"), "Software Engineer")).toBe(false);
    expect(isRelevantToRole(job("Frontend Developer"), "Backend Engineer")).toBe(false);
    expect(isRelevantToRole(job("Content Reviewer - English US"), "Backend Engineer")).toBe(false);
  });

  it("does not let a short term match inside a longer word", () => {
    // Joining words to compare them must not make "ai" appear inside "retail".
    expect(isRelevantToRole(job("Retail Assistant"), "AI Engineer")).toBe(false);
    expect(isRelevantToRole(job("Data Entry Clerk"), "QA Engineer")).toBe(false);
  });

  it("does not treat a role's technologies as the role", () => {
    // Mapping "backend" onto every server language would match any listing
    // that names one, including frontend roles that mention the stack.
    expect(isRelevantToRole(job("React Developer (Java backend team)"), "Backend Engineer")).toBe(true);
    expect(isRelevantToRole(job("Senior Golang Developer"), "Backend Engineer")).toBe(false);
  });
});

/**
 * Rule 4, second half: unique ids, not just unique openings.
 *
 * Careerjet built ids from base64 of the url truncated to 24 characters, which
 * captured only the shared "https://www.career" prefix and gave every listing
 * the same id. Deduping by company and title alone let those through.
 */
describe("rule 4 — listings never share an id", () => {
  const { dedupe } = require("../services/jobFeedService");
  const job = (id, title, company) => ({
    id, title, company, description: "", requiredSkills: [], location: "Dhaka",
    type: "Full-time", salary: "", postedAt: "", remote: false, category: "Mid",
    originalUrl: "https://x", sourceLabel: "s", platformId: "careerjet", platformName: "Careerjet",
  });

  it("drops a second job carrying an id already used", () => {
    const out = dedupe([job("same", "Backend Engineer", "Acme"), job("same", "Frontend Engineer", "Globex")]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Backend Engineer");
  });

  it("keeps distinct openings that have distinct ids", () => {
    const out = dedupe([job("a", "Backend Engineer", "Acme"), job("b", "Frontend Engineer", "Globex")]);
    expect(out).toHaveLength(2);
  });

  it("never emits a repeated key for the list to render", () => {
    const out = dedupe([job("a", "A", "X"), job("a", "B", "Y"), job("b", "C", "Z"), job("", "D", "W")]);
    expect(new Set(out.map((j) => j.id)).size).toBe(out.length);
  });
});

/**
 * Applied ids outlive the board that issued them.
 *
 * "Jobs Applied" on the dashboard is the length of this list, so an id from a
 * removed source keeps counting forever against a job that can no longer appear.
 */
describe("applied jobs drop ids from boards no longer read", () => {
  const { FEED_SOURCES } = require("../constants/jobPlatforms");
  const live = (ids) => ids.filter((id) => FEED_SOURCES.some((f) => id.startsWith(`${f.id}_`)));

  it("keeps ids from a current source", () => {
    expect(live(["careerjet_455c01ad11e520170e43"])).toHaveLength(1);
  });

  it("drops ids from a removed source", () => {
    // The exact value found in the database, from a board the feed dropped.
    expect(live(["arbeitnow_senior-backend-engineer-subscriptions-london-346554"])).toHaveLength(0);
    expect(live(["remotive_12345"])).toHaveLength(0);
  });

  it("does not match a source name appearing without its separator", () => {
    expect(live(["careerjetsomething"])).toHaveLength(0);
  });
});

/**
 * The feed must not fetch for nobody.
 *
 * JobsProvider mounts outside AuthGate, so its mount effect runs on every cold
 * start — including one where no user is signed in. An unauthenticated request
 * to a protected endpoint can only 401, and after the token-refresh work that
 * 401 is reported as an expired session: a device that had never signed in was
 * told its session had expired, on every launch.
 */
describe("rule 2 — the feed waits for a signed-in user", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "context/JobsContext.tsx"), "utf8");

  it("guards the mount fetch on there being a user", () => {
    const effect = src.slice(src.indexOf("// Fetched once there is somebody"));
    expect(effect).toMatch(/if \(!user\) return;/);
  });

  it("guards refreshJobs itself, so pull-to-refresh cannot fire either", () => {
    const fn = src.slice(src.indexOf("const refreshJobs = useCallback"));
    expect(fn.slice(0, 400)).toMatch(/if \(!user\)/);
  });

  it("depends on user, so signing in triggers the first load", () => {
    // Without user in the dependency list the guard would latch: the effect
    // would never re-run after sign-in and the feed would stay empty.
    const effect = src.slice(src.indexOf("// Fetched once there is somebody"));
    expect(effect).toMatch(/\}, \[user, refreshJobs\]\);/);
  });
});
