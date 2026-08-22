/**
 * AI routes — /api/ai/*
 *
 * Every model call the app makes goes through here. Before this existed the
 * mobile client talked to Gemini directly with EXPO_PUBLIC_OPENAI_API_KEY,
 * which Expo inlines into the JS bundle at build time — meaning the key
 * shipped inside the APK and could be extracted by anyone who unzipped it.
 * The key now lives only in this process's environment.
 *
 * Two upstreams, deliberately kept separate:
 *
 *   POST /api/ai/chat        general-purpose LLM (OpenAI wire format, so
 *                            OpenAI / Gemini / Groq are all drop-in)
 *   POST /api/ai/hawk/:task  the self-hosted fine-tuned Hawk model
 *   GET  /api/ai/status      what is configured and reachable
 *
 * Both return HTTP 200 with `data: null` when the upstream is unconfigured,
 * unreachable, or produced unusable output. That is not laziness — every
 * caller in the app already treats null as "use the local deterministic
 * fallback", so a model outage degrades a feature instead of erroring a
 * screen. Non-2xx is reserved for problems with the *request* (bad input,
 * no auth, rate limited), which the client genuinely should not retry.
 */
const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/authMiddleware");
const { aiLimiter }    = require("../middleware/rateLimiter");

// ── General LLM ───────────────────────────────────────────────────────────────
const AI_API_KEY   = process.env.AI_API_KEY ?? "";
const AI_BASE_URL  = (process.env.AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "");
const AI_MODEL     = process.env.AI_MODEL ?? "gemini-3.6-flash";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30000);

// ── Hawk ──────────────────────────────────────────────────────────────────────
const HAWK_URL        = (process.env.HAWK_URL ?? "").replace(/\/$/, "");
const HAWK_SECRET     = process.env.HAWK_SECRET ?? "";
const HAWK_TIMEOUT_MS = Number(process.env.HAWK_TIMEOUT_MS ?? 60000);

// The adapter was fine-tuned on exactly these six tasks. Validating against
// the set also stops `:task` being used to reach an arbitrary path on the
// Hawk host, which matters once Hawk is behind a tunnel.
const HAWK_TASKS = new Set([
  "nlp_analyzer",
  "skill_extractor",
  "job_matcher",
  "ats_scorer",
  "roadmap_generator",
  "interview_bank",
]);

// Roughly 6k tokens. Hawk's own window is 1536 and it clips server-side; this
// cap is about not paying to send a runaway payload upstream at all.
const MAX_INPUT_CHARS = 24000;

/** fetch with an AbortController timeout — Node 18+ has both built in. */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
// Hawk health is cached briefly: the app asks on screen focus, and an
// unreachable host costs a full connect timeout to discover.
let hawkHealthCache = { at: 0, ok: false };
const HAWK_HEALTH_TTL_MS = 30000;

async function hawkReachable() {
  if (!HAWK_URL) return false;
  if (Date.now() - hawkHealthCache.at < HAWK_HEALTH_TTL_MS) return hawkHealthCache.ok;
  let ok = false;
  try {
    // serve_hawk.py gates /health on the shared secret too — its response
    // names the adapter path and device, which is exactly what an
    // unauthenticated prober would want. Omitting the header here made this
    // report Hawk unreachable while task calls were succeeding.
    const headers = HAWK_SECRET ? { "X-Hawk-Secret": HAWK_SECRET } : {};
    const res = await fetchWithTimeout(`${HAWK_URL}/health`, { headers }, 5000);
    ok = res.ok && (await res.json())?.status === "ok";
  } catch (_) {
    ok = false;
  }
  hawkHealthCache = { at: Date.now(), ok };
  return ok;
}

router.get("/status", authenticate, async (_req, res) => {
  res.json({
    general: { configured: AI_API_KEY.length > 0, model: AI_MODEL },
    hawk:    { configured: HAWK_URL.length > 0, reachable: await hawkReachable() },
  });
});

// ─── General LLM ──────────────────────────────────────────────────────────────
router.post("/chat", authenticate, aiLimiter, async (req, res) => {
  // `json: false` returns the model's prose instead of forcing a JSON object.
  // The roadmap's per-milestone chat needs an answer a person reads; every
  // other caller wants a parseable object, so JSON stays the default.
  const { prompt, json = true, system } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ message: "A non-empty `prompt` string is required." });
  }
  if (prompt.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `Prompt exceeds ${MAX_INPUT_CHARS} characters.` });
  }
  if (typeof system === "string" && system.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `System prompt exceeds ${MAX_INPUT_CHARS} characters.` });
  }
  if (!AI_API_KEY) {
    return res.json({ data: null, reason: "not_configured" });
  }

  const retries = 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const upstream = await fetchWithTimeout(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            ...(typeof system === "string" && system.trim()
              ? [{ role: "system", content: system }]
              : []),
            { role: "user", content: prompt },
          ],
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      }, AI_TIMEOUT_MS);

      // 429 and 503 are transient on free tiers — back off and retry before
      // handing the caller a null it would turn into a heuristic fallback.
      if ((upstream.status === 429 || upstream.status === 503) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }

      if (!upstream.ok) {
        // The upstream body can echo request details; log it here, never
        // forward it to a mobile client.
        console.warn(`[AI] ${AI_MODEL} responded HTTP ${upstream.status}`);
        return res.json({ data: null, reason: `upstream_${upstream.status}` });
      }

      const json = await upstream.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        // Some models spend their whole budget on internal reasoning and
        // return an empty message; a retry usually produces a usable reply.
        if (attempt < retries) continue;
        return res.json({ data: null, reason: "empty_completion" });
      }

      if (!json) return res.json({ data: content });

      try {
        return res.json({ data: JSON.parse(content) });
      } catch (_) {
        return res.json({ data: null, reason: "unparseable_json" });
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      if (attempt < retries) continue;
      console.warn(`[AI] request ${aborted ? `timed out after ${AI_TIMEOUT_MS}ms` : "failed"}:`, e.message);
      return res.json({ data: null, reason: aborted ? "timeout" : "network_error" });
    }
  }
  return res.json({ data: null, reason: "exhausted_retries" });
});

// ─── Streaming chat ───────────────────────────────────────────────────────────
/**
 * Server-sent events passthrough for the roadmap's per-milestone chat.
 *
 * The non-streaming /chat is right for structured output — there is nothing to
 * show until the JSON is complete. A chat answer is different: waiting ten
 * seconds for a wall of text reads as broken, so the tokens are forwarded as
 * they arrive.
 *
 * Upstream is asked for `stream: true` in the OpenAI wire format and its SSE
 * frames are re-emitted as our own, rather than proxying the body verbatim, so
 * the client never sees provider-shaped payloads and a mid-stream upstream
 * error can still be delivered as a clean event.
 */
router.post("/chat/stream", authenticate, aiLimiter, async (req, res) => {
  const { prompt, system } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ message: "A non-empty `prompt` string is required." });
  }
  if (prompt.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `Prompt exceeds ${MAX_INPUT_CHARS} characters.` });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // stop proxies buffering the stream
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!AI_API_KEY) {
    send("error", { reason: "not_configured" });
    return res.end();
  }

  try {
    const upstream = await fetchWithTimeout(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          ...(typeof system === "string" && system.trim() ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
        stream: true,
      }),
    }, AI_TIMEOUT_MS);

    if (!upstream.ok || !upstream.body) {
      console.warn(`[AI] stream responded HTTP ${upstream.status}`);
      send("error", { reason: `upstream_${upstream.status}` });
      return res.end();
    }

    // If the client navigates away, stop pulling tokens we are still paying for.
    let aborted = false;
    req.on("close", () => { aborted = true; });

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of upstream.body) {
      if (aborted) break;
      buffer += decoder.decode(chunk, { stream: true });

      // SSE frames are separated by a blank line; a chunk can split one.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) send("token", { text: delta });
        } catch (_) {
          // A frame we cannot parse is not worth killing the stream over.
        }
      }
    }

    send("done", {});
    res.end();
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.warn(`[AI] stream ${aborted ? "timed out" : "failed"}:`, e.message);
    send("error", { reason: aborted ? "timeout" : "network_error" });
    res.end();
  }
});

// ─── Hawk ─────────────────────────────────────────────────────────────────────
router.post("/hawk/:task", authenticate, aiLimiter, async (req, res) => {
  const { task } = req.params;
  const { input } = req.body ?? {};

  if (!HAWK_TASKS.has(task)) {
    return res.status(404).json({ message: `Unknown Hawk task '${task}'.` });
  }
  if (typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ message: "A non-empty `input` string is required." });
  }
  if (input.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ message: `Input exceeds ${MAX_INPUT_CHARS} characters.` });
  }
  if (!HAWK_URL) {
    return res.json({ ok: false, data: null, reason: "not_configured" });
  }

  try {
    const headers = { "Content-Type": "application/json" };
    // serve_hawk.py ships with no authentication of its own. Once it is
    // reachable off the LAN this header is the only thing standing between
    // the model and the open internet, so it is sent whenever it is set.
    if (HAWK_SECRET) headers["X-Hawk-Secret"] = HAWK_SECRET;

    const upstream = await fetchWithTimeout(`${HAWK_URL}/v1/hawk/${task}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input }),
    }, HAWK_TIMEOUT_MS);

    if (!upstream.ok) {
      console.warn(`[Hawk] ${task} responded HTTP ${upstream.status}`);
      return res.json({ ok: false, data: null, reason: `upstream_${upstream.status}` });
    }

    // Forwarded verbatim: the envelope's `ok`, `data` and `meta` are exactly
    // what services/hawkClient.ts already knows how to read, so putting this
    // proxy in front of Hawk required no change to how callers interpret it.
    return res.json(await upstream.json());
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.warn(`[Hawk] ${task} ${aborted ? `timed out after ${HAWK_TIMEOUT_MS}ms` : "request failed"}`);
    return res.json({ ok: false, data: null, reason: aborted ? "timeout" : "network_error" });
  }
});

module.exports = router;
