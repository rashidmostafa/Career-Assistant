/**
 * Hits the real job APIs. Skipped automatically when offline.
 */
const { fetchLiveJobs, dedupe, dedupeKey } = require("../services/jobFeedService");

jest.setTimeout(60000);

test("fetches real listings from live sources", async () => {
  const r = await fetchLiveJobs();
  console.log("  sources ok :", r.sources.join(", ") || "none");
  console.log("  sources bad:", r.failed.join(", ") || "none");
  console.log("  jobs after dedupe:", r.jobs.length);

  if (r.sources.length === 0) {
    console.log("  (offline — skipping assertions)");
    return;
  }

  expect(r.jobs.length).toBeGreaterThan(0);

  const sample = r.jobs[0];
  console.log("  sample:", sample.title, "@", sample.company);
  console.log("  url   :", sample.originalUrl);
  console.log("  skills:", sample.requiredSkills.slice(0, 8).join(", ") || "(none parsed)");

  // Every listing must point at a real posting — this is what Apply Now opens.
  for (const j of r.jobs.slice(0, 50)) {
    expect(j.originalUrl).toMatch(/^https?:\/\//);
    expect(j.title.length).toBeGreaterThan(0);
    expect(j.company.length).toBeGreaterThan(0);
  }

  const withSkills = r.jobs.filter((j) => j.requiredSkills.length > 0).length;
  console.log(`  listings with parsed skills: ${withSkills}/${r.jobs.length}`);
  expect(withSkills).toBeGreaterThan(0);

  // No duplicates survived.
  const keys = r.jobs.map(dedupeKey);
  expect(new Set(keys).size).toBe(keys.length);
});

describe("dedupe", () => {
  const j = (company, title, over = {}) => ({
    company, title, requiredSkills: [], description: "", ...over,
  });

  it("collapses the same role syndicated to two boards", () => {
    const out = dedupe([
      j("Acme", "Senior Backend Engineer", { requiredSkills: ["Node.js"], description: "short" }),
      j("acme", "senior backend engineer", { requiredSkills: ["Node.js", "AWS"], description: "much longer text" }),
    ]);
    expect(out).toHaveLength(1);
    // Keeps the richer copy, which gives a more accurate match score.
    expect(out[0].requiredSkills).toEqual(["Node.js", "AWS"]);
  });

  it("ignores the noise boards append to titles", () => {
    expect(dedupeKey(j("Acme", "Backend Engineer (m/f/d)")))
      .toBe(dedupeKey(j("Acme", "Backend Engineer")));
    expect(dedupeKey(j("Acme", "Backend Engineer (Remote)")))
      .toBe(dedupeKey(j("Acme", "Backend Engineer")));
  });

  it("keeps genuinely different roles at the same company", () => {
    expect(dedupe([
      j("Acme", "Backend Engineer"),
      j("Acme", "Frontend Engineer"),
    ])).toHaveLength(2);
  });

  it("keeps the same title at different companies", () => {
    expect(dedupe([
      j("Acme", "Backend Engineer"),
      j("Globex", "Backend Engineer"),
    ])).toHaveLength(2);
  });
});
