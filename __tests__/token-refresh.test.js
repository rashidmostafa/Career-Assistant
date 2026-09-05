/**
 * Access-token refresh under concurrency.
 *
 * The server rotates refresh mockTokens — a successful refresh revokes the one it
 * was given — and the app fires several authenticated requests the moment it
 * opens. Without a shared refresh, each 401 spent the same refresh token, one
 * won, and the rest were told SESSION_REVOKED and reported the original
 * "Access token expired". That is how an expired session surfaced to the user
 * as "careerjet request failed".
 */
process.env.EXPO_PUBLIC_API_URL = "https://api.test";

let mockTokens;
jest.mock("@/services/sessionManager", () => ({
  SessionManager: {
    getAccessToken: jest.fn(async () => mockTokens.access),
    getRefreshToken: jest.fn(async () => mockTokens.refresh),
    saveTokens: jest.fn(async (t) => { mockTokens = { access: t.accessToken, refresh: t.refreshToken }; }),
    getOrCreateDeviceId: jest.fn(async () => "device-1"),
  },
}));

const { apiFetch } = require("../services/authApiService");

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTokens = { access: "expired-access", refresh: "refresh-1" };
});

describe("a single expired request", () => {
  it("refreshes and retries, returning the retried result", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(json(401, { message: "Access token expired.", code: "TOKEN_EXPIRED" }))
      .mockResolvedValueOnce(json(200, { accessToken: "new-access", refreshToken: "refresh-2" }))
      .mockResolvedValueOnce(json(200, { ok: true, data: "payload" }));

    await expect(apiFetch("/api/jobs/search", {}, true)).resolves.toEqual({ ok: true, data: "payload" });
    expect(mockTokens.access).toBe("new-access");
  });

  it("sends the NEW token on the retry, not the expired one", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(json(401, { message: "Access token expired." }))
      .mockResolvedValueOnce(json(200, { accessToken: "new-access", refreshToken: "refresh-2" }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    await apiFetch("/api/jobs/search", {}, true);
    const retryHeaders = global.fetch.mock.calls[2][1].headers;
    expect(retryHeaders.Authorization).toBe("Bearer new-access");
  });
});

describe("several requests expiring at once", () => {
  it("refreshes exactly once for all of them", async () => {
    // This is the bug. Three concurrent 401s previously produced three refresh
    // calls; the second and third were rejected because the first had already
    // revoked the token.
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).includes("/api/auth/refresh")) {
        const sent = JSON.parse(init.body).refreshToken;
        if (sent !== "refresh-1") return json(401, { message: "Session not found or revoked." });
        return json(200, { accessToken: "new-access", refreshToken: "refresh-2" });
      }
      const bearer = init.headers.Authorization;
      if (bearer === "Bearer expired-access") return json(401, { message: "Access token expired." });
      return json(200, { ok: true, url: String(url) });
    });

    const results = await Promise.all([
      apiFetch("/api/jobs/search", {}, true),
      apiFetch("/api/data", {}, true),
      apiFetch("/api/interview/questions", {}, true),
    ]);

    for (const r of results) expect(r.ok).toBe(true);

    const refreshCalls = global.fetch.mock.calls.filter((c) => String(c[0]).includes("/api/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("does not leave a dead promise behind for the next request", async () => {
    // The in-flight promise must be cleared whether the refresh worked or not,
    // or a later 401 would await a promise that already settled.
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).includes("/api/auth/refresh")) return json(200, { accessToken: "a2", refreshToken: "r2" });
      return init.headers.Authorization === "Bearer a2" ? json(200, { ok: true }) : json(401, { message: "Access token expired." });
    });

    await expect(apiFetch("/one", {}, true)).resolves.toEqual({ ok: true });
    mockTokens = { access: "expired-access", refresh: "r2" };
    await expect(apiFetch("/two", {}, true)).resolves.toEqual({ ok: true });
  });
});

describe("when the session really is over", () => {
  it("says the session expired rather than naming the feature that noticed", async () => {
    global.fetch = jest.fn(async (url) =>
      String(url).includes("/api/auth/refresh")
        ? json(401, { message: "8-week session expired. Please sign in again.", code: "ROLLING_SESSION_EXPIRED" })
        : json(401, { message: "Access token expired." }));

    await expect(apiFetch("/api/jobs/search", {}, true)).rejects.toMatchObject({
      status: 401,
      code: "SESSION_EXPIRED",
      message: expect.stringContaining("sign in again"),
    });
  });

  it("does the same when there is no refresh token at all", async () => {
    mockTokens = { access: "expired-access", refresh: null };
    global.fetch = jest.fn(async () => json(401, { message: "Access token expired." }));

    await expect(apiFetch("/api/jobs/search", {}, true)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    // No point calling refresh with nothing to send.
    expect(global.fetch.mock.calls.filter((c) => String(c[0]).includes("refresh"))).toHaveLength(0);
  });
});

describe("after a successful refresh", () => {
  it("reports the retry's own failure, not the stale 401", async () => {
    // Blaming an expired token for a 500 sends the user to re-authenticate over
    // a problem that has nothing to do with their session.
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).includes("/api/auth/refresh")) return json(200, { accessToken: "a2", refreshToken: "r2" });
      return init.headers.Authorization === "Bearer a2"
        ? json(500, { message: "Careerjet is unavailable.", code: "UPSTREAM" })
        : json(401, { message: "Access token expired." });
    });

    await expect(apiFetch("/api/jobs/search", {}, true)).rejects.toMatchObject({
      status: 500,
      message: "Careerjet is unavailable.",
    });
  });
});

describe("unauthenticated requests", () => {
  it("never tries to refresh", async () => {
    global.fetch = jest.fn(async () => json(401, { message: "Nope." }));
    await expect(apiFetch("/api/public", {}, false)).rejects.toMatchObject({ status: 401, message: "Nope." });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
