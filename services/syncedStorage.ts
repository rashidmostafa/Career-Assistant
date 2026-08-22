/**
 * syncedStorage — AsyncStorage's API, backed by the account as well as the device.
 *
 * Every feature context (CV, roadmap, interview, jobs, portfolio) persisted its
 * state to AsyncStorage under keys like `cv_${user.id}` and
 * `rm_weeks_${user.id}_${roleKey}`. That data existed on exactly one device: a
 * reinstall or a new phone lost all of it permanently, and nothing about it was
 * attached to the account the user signs into.
 *
 * This module exposes the same `getItem` / `setItem` / `removeItem` surface, so
 * a context adopts it by changing its import and nothing else. Underneath:
 *
 *   setItem     writes to the device immediately, then pushes to the backend on
 *               a short debounce (task toggles and progress updates fire in
 *               bursts; one write per burst is enough).
 *   getItem     reads the device first. On a miss — a fresh install signed into
 *               an existing account — it pulls from the backend and rehydrates
 *               local storage, which is what makes a new phone come back with
 *               the user's data.
 *   removeItem  clears both.
 *
 * The device copy stays authoritative for reads, so the app is fully usable
 * offline and a backend outage costs nothing but sync. Failed pushes are logged
 * and retried on the next write rather than surfaced to the user.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "./authApiService";
import { SessionManager } from "./sessionManager";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";
const DEBOUNCE_MS = Number(process.env.EXPO_PUBLIC_SYNC_DEBOUNCE_MS ?? 1500);
const SYNC_TIMEOUT_MS = 20000;

/**
 * Storage keys embed a Mongo ObjectId and sometimes a role label, which can
 * contain spaces or capitals. The server constrains namespaces to a
 * conservative character set, so anything outside it collapses to a dash. The
 * mapping is deterministic, so the same key always reaches the same namespace.
 */
function namespaceFor(key: string): string {
  const ns = key.toLowerCase().replace(/[^a-z0-9:_-]/g, "-").slice(0, 128);
  return /^[a-z0-9]/.test(ns) ? ns : `k-${ns}`.slice(0, 128);
}

/** Sync is pointless without a backend to sync to, or before the user signs in. */
async function canSync(): Promise<boolean> {
  if (!API_URL) return false;
  try {
    return Boolean(await SessionManager.getAccessToken());
  } catch {
    return false;
  }
}

/**
 * Contexts store JSON strings, with one exception: RoadmapContext writes a bare
 * role name. Wrapping non-JSON values keeps the round trip exact instead of
 * throwing on parse, while genuine JSON is stored structured so it stays
 * readable in the GDPR export.
 */
function encode(value: string): unknown {
  try {
    return { json: JSON.parse(value) };
  } catch {
    return { raw: value };
  }
}

function decode(payload: any): string | null {
  if (payload == null) return null;
  if (typeof payload?.raw === "string") return payload.raw;
  if ("json" in (payload ?? {})) return JSON.stringify(payload.json);
  return null;
}

// ── Debounced push queue ──────────────────────────────────────────────────────
const pending = new Map<string, string>();
const timers  = new Map<string, ReturnType<typeof setTimeout>>();

async function push(key: string, value: string): Promise<void> {
  if (!(await canSync())) return;
  try {
    await apiFetch(
      `/api/data/${namespaceFor(key)}`,
      { method: "PUT", body: JSON.stringify({ payload: encode(value) }), timeoutMs: SYNC_TIMEOUT_MS },
      true,
    );
    pending.delete(key);
  } catch (e: any) {
    // Kept in `pending` so the next write for this key retries it.
    console.warn(`[sync] push failed for ${key}:`, e?.message ?? e);
  }
}

function schedulePush(key: string, value: string) {
  pending.set(key, value);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    const latest = pending.get(key);
    if (latest !== undefined) void push(key, latest);
  }, DEBOUNCE_MS));
}

async function pull(key: string): Promise<string | null> {
  if (!(await canSync())) return null;
  try {
    const res = await apiFetch<{ payload: any }>(
      `/api/data/${namespaceFor(key)}`,
      { timeoutMs: SYNC_TIMEOUT_MS },
      true,
    );
    return decode(res?.payload);
  } catch (e: any) {
    console.warn(`[sync] pull failed for ${key}:`, e?.message ?? e);
    return null;
  }
}

// ── AsyncStorage-compatible surface ───────────────────────────────────────────
const syncedStorage = {
  async getItem(key: string): Promise<string | null> {
    const local = await AsyncStorage.getItem(key);
    if (local !== null) return local;

    // Local miss. On a fresh install of an existing account this is where the
    // user's data comes back.
    const remote = await pull(key);
    if (remote !== null) {
      await AsyncStorage.setItem(key, remote);
      return remote;
    }
    return null;
  },

  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
    schedulePush(key, value);
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    const timer = timers.get(key);
    if (timer) { clearTimeout(timer); timers.delete(key); }
    pending.delete(key);
    if (!(await canSync())) return;
    try {
      await apiFetch(`/api/data/${namespaceFor(key)}`, { method: "DELETE", timeoutMs: SYNC_TIMEOUT_MS }, true);
    } catch (e: any) {
      console.warn(`[sync] delete failed for ${key}:`, e?.message ?? e);
    }
  },

  /**
   * Writes every queued change immediately instead of waiting out its debounce.
   * Worth calling before sign-out, which otherwise discards the last edit.
   */
  async flush(): Promise<void> {
    const entries = [...pending.entries()];
    for (const [key, timer] of timers) { clearTimeout(timer); timers.delete(key); }
    await Promise.all(entries.map(([key, value]) => push(key, value)));
  },
};

export default syncedStorage;
export { namespaceFor };
