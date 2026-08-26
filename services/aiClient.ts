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
export async function chatJSON(
  prompt: string,
  opts?: { timeoutMs?: number },
): Promise<any | null> {
  if (!isAIConfigured) return null;

  try {
    const res = await apiFetch<{ data: any | null; reason?: string }>(
      "/api/ai/chat",
      { method: "POST", body: JSON.stringify({ prompt }), timeoutMs: opts?.timeoutMs ?? TIMEOUT_MS },
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
