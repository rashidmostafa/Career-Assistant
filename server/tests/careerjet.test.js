/**
 * Careerjet proxy. No key is needed: these pin the contract and the failure
 * modes, which is what will actually break when a key does arrive.
 */
require("dotenv").config();
process.env.NODE_ENV = "test";

const fs = require("fs");
const src = fs.readFileSync(require.resolve("../services/careerjetService.js"), "utf8");

describe("v4 contract", () => {
  it("uses the v4 endpoint, not the retired legacy one", () => {
    expect(src).toContain("https://search.api.careerjet.net/v4/query");
    // The legacy host stopped serving non-legacy users in 2026.
    expect(src).not.toContain("public.api.careerjet.net");
  });

  it("authenticates with basic auth: key as user, empty password", () => {
    expect(src).toMatch(/Buffer\.from\(`\$\{API_KEY\}:`\)\.toString\("base64"\)/);
    expect(src).toMatch(/Authorization/);
  });

  it("always sends user_ip and user_agent, which Careerjet requires", () => {
    // Omitting either returns 403, which would otherwise look like "no jobs".
    expect(src).toMatch(/user_ip/);
    expect(src).toMatch(/user_agent/);
  });

  it("keeps the locale configurable rather than hardcoding a guess", () => {
    // An unsupported locale_code returns 400, and the supported list is behind
    // Careerjet's partner login.
    expect(src).toMatch(/process\.env\.CAREERJET_LOCALE/);
  });

  it("respects the documented page_size ceiling of 100", () => {
    expect(src).toMatch(/Math\.min\(Math\.max\(pageSize, 1\), 100\)/);
  });

  it("handles LOCATIONS mode, where no search actually happened", () => {
    expect(src).toMatch(/type === "LOCATIONS"/);
    expect(src).toMatch(/ambiguous_location/);
  });

  it("names configuration faults instead of reporting them as empty results", () => {
    expect(src).toMatch(/bad_locale/);
    expect(src).toMatch(/missing_user_context/);
  });
});

describe("proxy behaviour", () => {
  const routeSrc = fs.readFileSync(require.resolve("../routes/jobs.js"), "utf8");

  it("requires authentication", () => {
    expect(routeSrc).toMatch(/router\.get\("\/search", authenticate/);
  });

  it("forwards the real user's IP and agent, as the terms require", () => {
    expect(routeSrc).toMatch(/userIp: req\.ip/);
    expect(routeSrc).toMatch(/req\.headers\["user-agent"\]/);
  });

  it("degrades to an empty list rather than failing the whole feed", () => {
    expect(routeSrc).toMatch(/jobs: result\.jobs/);
    expect(routeSrc).toMatch(/available: result\.ok/);
  });
});

describe("unconfigured", () => {
  it("reports not_configured without calling out", async () => {
    jest.resetModules();
    delete process.env.CAREERJET_API_KEY;
    const { searchCareerjet, isConfigured } = require("../services/careerjetService");
    expect(isConfigured()).toBe(false);
    expect(await searchCareerjet({ keywords: "x" })).toEqual({ ok: false, reason: "not_configured", jobs: [] });
  });
});
