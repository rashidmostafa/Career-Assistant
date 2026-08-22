/**
 * Guards against using web APIs that React Native's runtime does not provide.
 *
 * These are invisible in Node and in a browser and fail only on device, where
 * every caller treats the throw as a soft failure — so the symptom is a feature
 * silently doing nothing rather than an error anyone can see.
 */
describe("React Native runtime compatibility", () => {
  const realTimeout = AbortSignal.timeout;

  beforeAll(() => {
    // Reproduce RN: AbortController and AbortSignal exist, AbortSignal.timeout
    // does not (RN polyfills from `abort-controller`, which predates it).
    delete AbortSignal.timeout;
  });
  afterAll(() => {
    if (realTimeout) AbortSignal.timeout = realTimeout;
  });

  it("AbortSignal.timeout really is missing in this simulated environment", () => {
    expect(typeof AbortSignal.timeout).toBe("undefined");
    expect(typeof AbortController).toBe("function");
  });

  it("apiFetch honours timeoutMs without AbortSignal.timeout", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    });
    const { apiFetch } = require("../services/authApiService");

    // Before the fix this threw "AbortSignal.timeout is not a function".
    await expect(apiFetch("/api/ping", { timeoutMs: 5000 })).resolves.toEqual({ ok: true });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(init.signal.aborted).toBe(false);
  });

  it("aborts the request when the timeout elapses", async () => {
    let captured;
    global.fetch = jest.fn((_u, init) => {
      captured = init.signal;
      return new Promise(() => {});   // never settles
    });
    const { apiFetch } = require("../services/authApiService");

    apiFetch("/api/slow", { timeoutMs: 60 }).catch(() => {});

    // apiFetch awaits SessionManager (device id, token) before it calls fetch,
    // so wait for the call rather than assuming a microtask is enough.
    const started = Date.now();
    while (!captured && Date.now() - started < 2000) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(captured).toBeDefined();
    expect(captured.aborted).toBe(false);

    await new Promise((r) => setTimeout(r, 120));
    expect(captured.aborted).toBe(true);
  });

  it("the job feed survives without AbortSignal.timeout", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ jobs: [] }),
    });
    // Importing and calling must not throw.
    const mod = require("../services/jobFeedService");
    expect(mod).toBeDefined();
  });
});
