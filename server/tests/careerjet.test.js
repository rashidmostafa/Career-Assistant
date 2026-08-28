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

  it("asks for a larger excerpt, while documenting that Careerjet ignores it", () => {
    expect(src).toMatch(/fragment_size/);
    const m = src.match(/CAREERJET_FRAGMENT_SIZE \?\? (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1000);
    // The comment must not claim an effect that measurement disproved.
    expect(src).toMatch(/measured not to be honoured/i);
  });

  it("respects the documented page_size ceiling of 100", () => {
    expect(src).toMatch(/Math\.min\(Math\.max\(pageSize, 1\), 100\)/);
  });

  it("sends a Referer, which Careerjet requires and does not document with the other params", () => {
    expect(src).toMatch(/Referer: REFERER/);
    expect(src).toMatch(/CAREERJET_REFERER/);
  });

  it("names a rejected referrer rather than blaming the user context", () => {
    expect(src).toMatch(/bad_referer/);
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
    expect(routeSrc).toMatch(/req\.ip/);
    expect(routeSrc).toMatch(/req\.headers\["user-agent"\]/);
  });

  it("refuses to send a private or malformed address as the user IP", () => {
    // Behind a proxy req.ip can be an internal address, which Careerjet rejects
    // — and a placeholder like 0.0.0.0 guarantees the same rejection.
    expect(routeSrc).toMatch(/isPublicIp/);
    expect(routeSrc).toMatch(/192\\.168\\./);
  });

  it("distinguishes an unwhitelisted IP from a missing user context", () => {
    // Careerjet returns 403 for both; collapsing them hides which is wrong.
    const svc = fs.readFileSync(require.resolve("../services/careerjetService.js"), "utf8");
    expect(svc).toMatch(/ip_not_whitelisted/);
    expect(svc).toMatch(/unauthorized access from ip/i);
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

/**
 * Job ids must be unique per posting.
 *
 * They were built as base64 of the url truncated to 24 characters. Base64
 * encodes three bytes per four characters, so that captured only the first 18
 * bytes — "https://www.career" — which every Careerjet url shares. Every
 * listing therefore carried an identical id: React saw duplicate keys, each
 * card read another job's match score, and marking one applied applied them all.
 */
describe("listing ids", () => {
  const { mapJob } = require("../services/careerjetService");

  const job = (url, title = "Backend Engineer") => ({ title, url, company: "Acme", locations: "Dhaka" });

  it("gives urls sharing a long prefix different ids", () => {
    const urls = [
      "https://www.careerjet.com.bd/jobad/bd0000000000000000001",
      "https://www.careerjet.com.bd/jobad/bd0000000000000000002",
      "https://www.careerjet.com.bd/jobad/bd0000000000000000003",
    ];
    const ids = urls.map((u) => mapJob(job(u)).id);
    expect(new Set(ids).size).toBe(urls.length);
  });

  it("is stable for the same url", () => {
    const u = "https://www.careerjet.com.bd/jobad/abc";
    expect(mapJob(job(u)).id).toBe(mapJob(job(u, "Different Title")).id);
  });

  it("differs when only the last character of the url differs", () => {
    const a = mapJob(job("https://www.careerjet.com.bd/jobad/aaaa")).id;
    const b = mapJob(job("https://www.careerjet.com.bd/jobad/aaab")).id;
    expect(a).not.toBe(b);
  });

  it("drops a listing with no url rather than giving it a shared id", () => {
    expect(mapJob({ title: "Backend Engineer", url: "" })).toBeNull();
  });
});
