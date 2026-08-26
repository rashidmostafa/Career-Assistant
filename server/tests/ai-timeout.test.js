/**
 * The server's own upstream budget.
 *
 * This was 30s while CV scoring and roadmap generation measured 24-26 seconds
 * warm — about four seconds of margin. Any variance aborted the call, the
 * server returned data:null with reason "timeout", and the app told the user
 * "couldn't reach the AI", which pointed at their network rather than at a
 * number in this file.
 */
require("dotenv").config();
process.env.NODE_ENV = "test";

describe("AI upstream timeout", () => {
  const MEASURED_SLOWEST_MS = 26_000;   // observed against the live provider
  const COLD_START_MS = 22_000;         // Render free tier waking from idle

  it("leaves real headroom over the slowest measured generation", () => {
    jest.resetModules();
    delete process.env.AI_TIMEOUT_MS;
    const src = require("fs").readFileSync(require.resolve("../routes/ai.js"), "utf8");
    const match = src.match(/AI_TIMEOUT_MS\s*=\s*Number\(process\.env\.AI_TIMEOUT_MS\s*\?\?\s*(\d+)\)/);

    expect(match).not.toBeNull();
    const fallback = Number(match[1]);

    // Must survive a slow generation on a server that has just woken up.
    expect(fallback).toBeGreaterThanOrEqual(MEASURED_SLOWEST_MS + COLD_START_MS);
  });

  it("is declared in render.yaml with the same reasoning", () => {
    const yaml = require("fs").readFileSync(require.resolve("../../render.yaml"), "utf8");
    const m = yaml.match(/- key: AI_TIMEOUT_MS\s*\n\s*value: "(\d+)"/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(MEASURED_SLOWEST_MS + COLD_START_MS);
  });
});
