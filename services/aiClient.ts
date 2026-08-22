/**
 * aiClient — single entry point for the app's general-purpose LLM calls.
 *
 * These calls used to go straight from the phone to Gemini using
 * EXPO_PUBLIC_OPENAI_API_KEY. Expo inlines every EXPO_PUBLIC_* variable into
 * the JS bundle at build time, which meant the API key shipped inside the APK
 * and could be recovered by anyone who unzipped it. The key now lives only in
 * the backend's environment and the app calls `/api/ai/chat` instead.
 *
 * Three things came along with the move, all of which used to be impossible
 * from the client: the provider and model can change without shipping a new
 * build, requests are rate limited per account rather than per API key, and
 * retry policy is applied server-side where it can be tuned.
 *
 * Configure on the SERVER (not here): AI_API_KEY, AI_BASE_URL, AI_MODEL.
 * The only thing the app needs is EXPO_PUBLIC_API_URL.
 */
import { apiFetch } from "./authApiService";
import { SessionManager } from "./sessionManager";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

// Generous by design: the request may wake a spun-down instance before the
// model is even called. Still finite, because every caller has a deterministic
// fallback that is better than an indefinitely blocked screen.
const TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_AI_TIMEOUT_MS ?? 45000);

/**
 * True when the app knows where its backend is. Whether a model is actually
 * configured behind it is the server's business — a request made when none is
 * returns null, which is the same thing callers already handle.
 */
export const isAIConfigured = API_URL.length > 0;

/**
 * Sends a prompt and returns the parsed JSON object the model replied with.
 * Returns null when the backend is unreachable, no model is configured, or the
 * reply was not usable JSON — callers treat null as "use the local fallback".
 * Retries and back-off now happen server-side in routes/ai.js.
 */
export async function chatJSON(prompt: string): Promise<any | null> {
  if (!isAIConfigured) return null;

  try {
    const res = await apiFetch<{ data: any | null; reason?: string }>(
      "/api/ai/chat",
      { method: "POST", body: JSON.stringify({ prompt }), timeoutMs: TIMEOUT_MS },
      true,
    );
    if (res?.data == null) {
      console.warn(`[aiClient] no usable result (${res?.reason ?? "unknown"})`);
      return null;
    }
    return res.data;
  } catch (e: any) {
    console.warn("[aiClient] request failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Asks for prose rather than JSON. Used by the roadmap's per-milestone chat,
 * where the answer is read by a person.
 */
export async function chatText(prompt: string, system?: string): Promise<string | null> {
  if (!isAIConfigured) return null;
  try {
    const res = await apiFetch<{ data: string | null; reason?: string }>(
      "/api/ai/chat",
      {
        method: "POST",
        body: JSON.stringify({ prompt, system, json: false }),
        timeoutMs: TIMEOUT_MS,
      },
      true,
    );
    return typeof res?.data === "string" ? res.data : null;
  } catch (e: any) {
    console.warn("[aiClient] chatText failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Streams an answer token by token, calling `onToken` as text arrives.
 *
 * Built on XMLHttpRequest rather than fetch: React Native's fetch resolves only
 * once the whole body has arrived and exposes no ReadableStream, so a streaming
 * response would sit invisible until it completed — the exact wait streaming is
 * meant to remove. XHR's `onprogress` fires with the response so far, which is
 * the one progressive-read primitive the platform actually provides.
 *
 * Returns the complete text, or null if the stream failed before producing any.
 */
export function streamChat(
  prompt: string,
  opts: {
    system?: string;
    onToken: (chunk: string, full: string) => void;
    signal?: { aborted: boolean };
  },
): Promise<string | null> {
  if (!isAIConfigured) return Promise.resolve(null);

  return new Promise(async (resolve) => {
    let token: string | null = null;
    try {
      token = await SessionManager.getAccessToken();
    } catch {
      /* handled below */
    }
    if (!token) return resolve(null);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/ai/chat/stream`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Accept", "text/event-stream");

    let consumed = 0;   // how much of responseText has already been parsed
    let full = "";
    let failed = false;

    const drain = () => {
      const text = xhr.responseText ?? "";
      if (text.length <= consumed) return;
      const fresh = text.slice(consumed);
      consumed = text.length;

      // Frames arrive whole or split; only complete ones are parsed, and the
      // remainder is left for the next progress event by rewinding `consumed`.
      const lastBreak = fresh.lastIndexOf("\n\n");
      if (lastBreak === -1) {
        consumed -= fresh.length;
        return;
      }
      const ready = fresh.slice(0, lastBreak);
      consumed -= fresh.length - (lastBreak + 2);

      for (const frame of ready.split("\n\n")) {
        const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const event = eventLine?.slice(6).trim();
        try {
          const payload = JSON.parse(dataLine.slice(5).trim());
          if (event === "token" && typeof payload.text === "string") {
            full += payload.text;
            opts.onToken(payload.text, full);
          } else if (event === "error") {
            failed = true;
          }
        } catch (_) {
          /* skip an unparseable frame */
        }
      }
    };

    xhr.onprogress = () => {
      if (opts.signal?.aborted) { xhr.abort(); return; }
      drain();
    };
    xhr.onload = () => { drain(); resolve(failed && !full ? null : full || null); };
    xhr.onerror = () => resolve(full || null);
    xhr.onabort = () => resolve(full || null);
    xhr.ontimeout = () => resolve(full || null);
    xhr.timeout = TIMEOUT_MS;

    xhr.send(JSON.stringify({ prompt, system: opts.system }));
  });
}
