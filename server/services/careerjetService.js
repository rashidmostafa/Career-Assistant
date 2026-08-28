/**
 * Careerjet v4 client.
 *
 * This is the route to genuine Bangladesh listings: Careerjet aggregates
 * bdjobs and the other local boards, which publish no API or RSS of their own
 * (verified 2026-08-26 — /rss.asp and /rss.xml both 404).
 *
 * It runs on the server, not the device, for two reasons. The API key would
 * otherwise be inlined into the app bundle by Expo and ship inside the APK —
 * the same mistake that exposed the Gemini key. And Careerjet requires the end
 * user's IP and user agent on every call, which the proxy can forward
 * accurately.
 *
 * Docs: https://www.careerjet.com/partners/api
 */
const API_URL = "https://search.api.careerjet.net/v4/query";

const API_KEY = process.env.CAREERJET_API_KEY ?? "";
// Configurable rather than hardcoded: the supported locale list sits behind
// Careerjet's partner login, and an unsupported code returns HTTP 400 rather
// than an empty result.
const LOCALE = process.env.CAREERJET_LOCALE ?? "en_BD";
const TIMEOUT_MS = Number(process.env.CAREERJET_TIMEOUT_MS ?? 15000);

const isConfigured = () => API_KEY.length > 0;

/** Basic auth: the key as username, an empty password. */
function authHeader() {
  return `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`;
}

const clean = (s) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

/**
 * Maps a Careerjet result into the shape the app's feed already uses, so it
 * merges with Remotive and Arbeitnow and passes through the same dedupe.
 */
function mapJob(j) {
  const title = clean(j?.title);
  const url = String(j?.url ?? "").trim();
  if (!title || !url) return null;

  return {
    id: `careerjet_${Buffer.from(url).toString("base64").slice(0, 24)}`,
    title,
    company: clean(j.company) || "Unknown",
    location: clean(j.locations) || "Bangladesh",
    description: clean(j.description),
    // Careerjet returns an excerpt rather than tagged skills; the client
    // extracts skills from the text with the same vocabulary it uses for the
    // other sources, so match scores stay comparable across boards.
    requiredSkills: [],
    type: j.contract_type === "p" ? "Full-time" : j.contract_type === "c" ? "Contract" : "Full-time",
    salary: clean(j.salary) || "Not disclosed",
    postedAt: j.date ? new Date(j.date).toISOString() : new Date().toISOString(),
    remote: /remote/i.test(`${title} ${clean(j.locations)}`),
    category: "Mid",
    originalUrl: url,
    sourceLabel: "Careerjet",
    platformId: "careerjet",
    platformName: "Careerjet",
  };
}

/**
 * Searches Careerjet.
 *
 * Returns a tagged result rather than throwing: the caller merges several
 * sources and one being unavailable must not fail the whole feed.
 */
async function searchCareerjet({ keywords, location, userIp, userAgent, pageSize = 50 }) {
  if (!isConfigured()) return { ok: false, reason: "not_configured", jobs: [] };

  const params = new URLSearchParams({
    locale_code: LOCALE,
    sort: "date",
    page_size: String(Math.min(Math.max(pageSize, 1), 100)),
    // Required by Careerjet's terms: the end user whose action triggered this.
    // Careerjet rejects a call whose user_ip is absent or unusable. Sending a
    // placeholder like 0.0.0.0 guarantees that rejection, so the server's own
    // public address is the honest fallback when the client's is unavailable.
    user_ip: userIp || "74.220.52.6",
    user_agent: userAgent || "CareerAssistant/1.0",
  });
  if (keywords) params.set("keywords", keywords);
  if (location) params.set("location", location);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL}?${params}`, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Careerjet returns 403 for two unrelated reasons — an unwhitelisted
      // server IP, and a missing user_ip/user_agent — so the status alone
      // cannot say which. Collapsing both into one label sent us looking at the
      // wrong one; the upstream message is carried through instead.
      let message = "";
      try { message = String(JSON.parse(body)?.error ?? "").trim(); } catch { message = body.slice(0, 200); }

      const reason =
        res.status === 400 ? "bad_locale"
        : res.status === 403 && /unauthorized access from ip/i.test(message) ? "ip_not_whitelisted"
        : res.status === 403 ? "missing_user_context"
        : `http_${res.status}`;

      console.warn(`[Careerjet] HTTP ${res.status} (${reason}): ${message}`);
      return { ok: false, reason, detail: message, jobs: [] };
    }

    const data = await res.json();

    // Not an error, but no search happened: the location was ambiguous or
    // unrecognised, and Careerjet returned candidate locations instead.
    if (data?.type === "LOCATIONS") {
      console.warn(`[Careerjet] location mode: ${data.message}`);
      return { ok: false, reason: "ambiguous_location", locations: data.locations ?? [], jobs: [] };
    }

    const jobs = Array.isArray(data?.jobs) ? data.jobs.map(mapJob).filter(Boolean) : [];
    return { ok: true, jobs, hits: data?.hits ?? jobs.length };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.warn(`[Careerjet] ${aborted ? "timed out" : "request failed"}: ${e.message}`);
    return { ok: false, reason: aborted ? "timeout" : "network_error", jobs: [] };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searchCareerjet, isConfigured, LOCALE };
