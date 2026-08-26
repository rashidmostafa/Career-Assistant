/**
 * Provider rate limits must be reported, not retried.
 *
 * Gemini's free tier allows 20 requests a minute and states how long to wait —
 * about 25 seconds. The old code retried a 429 after 800ms and 1600ms, so one
 * user action became three failed calls, each counting against the same quota
 * and extending the block. It then surfaced as "check your connection".
 */
const fs = require("fs");
const src = fs.readFileSync(require.resolve("../routes/ai.js"), "utf8");

describe("429 handling", () => {
  it("returns rate_limited instead of retrying", () => {
    expect(src).toMatch(/reason:\s*"rate_limited"/);
    // The 429 branch must return before reaching any retry.
    const branch = src.slice(src.indexOf("if (upstream.status === 429)"));
    const untilReturn = branch.slice(0, branch.indexOf("return res.json"));
    expect(untilReturn).not.toMatch(/continue;/);
  });

  it("passes the provider's own wait time through", () => {
    expect(src).toMatch(/retryAfterSec/);
    expect(src).toMatch(/retry in \(\[\\d\.\]\+\)s/i);
  });

  it("still retries a 503, which genuinely is transient", () => {
    expect(src).toMatch(/upstream\.status === 503 && attempt < retries/);
  });

  it("no longer treats 429 as transient alongside 503", () => {
    expect(src).not.toMatch(/upstream\.status === 429 \|\| upstream\.status === 503/);
  });
});
