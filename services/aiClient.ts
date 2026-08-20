/**
 * aiClient — single entry point for the app's LLM calls.
 *
 * Every provider used here speaks the OpenAI chat-completions wire format, so
 * switching providers is a matter of changing the base URL and model rather
 * than the calling code. Configure via .env:
 *
 *   OpenAI (default, paid)
 *     EXPO_PUBLIC_OPENAI_API_KEY=sk-...
 *
 *   Google Gemini (free tier, no card — key from aistudio.google.com/apikey)
 *     EXPO_PUBLIC_OPENAI_API_KEY=AIza...
 *     EXPO_PUBLIC_AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *     EXPO_PUBLIC_AI_MODEL=gemini-2.0-flash
 *
 *   Groq (free tier, no card — key from console.groq.com)
 *     EXPO_PUBLIC_OPENAI_API_KEY=gsk_...
 *     EXPO_PUBLIC_AI_BASE_URL=https://api.groq.com/openai/v1
 *     EXPO_PUBLIC_AI_MODEL=llama-3.3-70b-versatile
 *
 * When no key is set, chatJSON returns null and each caller keeps its existing
 * heuristic fallback, so the app stays fully functional without any provider.
 */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

export const AI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? "";

const BASE_URL = (process.env.EXPO_PUBLIC_AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const MODEL = process.env.EXPO_PUBLIC_AI_MODEL ?? DEFAULT_MODEL;

export const isAIConfigured = AI_API_KEY.length > 0;

/**
 * Sends a prompt and returns the parsed JSON object the model replied with.
 * Returns null when no key is configured, the request fails, or the reply is
 * not valid JSON — callers treat null as "use the local fallback".
 */
export async function chatJSON(prompt: string, retries = 2): Promise<any | null> {
  if (!AI_API_KEY) return null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });

      // 503 "model overloaded" and 429 "rate limited" are transient on free
      // tiers — back off briefly and try again before giving up to the caller's
      // heuristic fallback.
      if ((res.status === 503 || res.status === 429) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }

      if (!res.ok) {
        console.warn(`[aiClient] ${MODEL} request failed: HTTP ${res.status}`);
        return null;
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        // Some models return an empty message when they spend their budget on
        // internal reasoning; retrying usually produces a usable reply.
        if (attempt < retries) continue;
        return null;
      }
      return JSON.parse(content);
    } catch (e) {
      if (attempt < retries) continue;
      console.warn("[aiClient] request error:", e);
      return null;
    }
  }
  return null;
}
