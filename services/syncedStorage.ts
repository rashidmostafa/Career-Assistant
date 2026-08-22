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
 * MongoDB Atlas is the source of truth. `hydrate()` runs at sign-in and
 * overwrites the device copy with what the server holds, so the local layer is
 * a cache of the account rather than an independent store that happens to be
 * backed up. Reads stay local afterwards because, post-hydrate, local *is* the
 * server state — which keeps every screen off the network and keeps the app
 * usable when Render is cold, spun down, or unreachable.
 *
 * `clearLocal()` runs at sign-out so the cache never outlives the session that
 * created it, and a second account on the same device cannot read the first
 * one's CV.
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
function encode(key: string, value: string): unknown {
  // The original key travels with the payload so hydrate() can restore each
  // namespace to the exact key its context reads. namespaceFor() lowercases and
  // rewrites illegal characters, so the mapping cannot be reversed.
  try {
    return { key, json: JSON.parse(value) };
  } catch {
    return { key, raw: value };
  }
}

function decode(payload: any): string | null {
  if (payload == null) return null;
  if (typeof payload?.raw === "string") return payload.raw;
  if ("json" in (payload ?? {})) return JSON.stringify(payload.json);
  return null;
}

// ── Managed-key index ─────────────────────────────────────────────────────────
// AsyncStorage has no prefix query, and clearing it wholesale would take the
// auth tokens and theme with it, so the keys this module owns are tracked
// explicitly.
const KEY_INDEX = "__synced_keys";

async function rememberKey(key: string) {
  try {
    const raw = await AsyncStorage.getItem(KEY_INDEX);
    const keys: string[] = raw ? JSON.parse(raw) : [];
    if (!keys.includes(key)) {
      keys.push(key);
      await AsyncStorage.setItem(KEY_INDEX, JSON.stringify(keys));
    }
  } catch {
    // A missing index costs a less complete sign-out wipe, never a failed write.
  }
}

// ── Debounced push queue ──────────────────────────────────────────────────────
const pending = new Map<string, string>();
const timers  = new Map<string, ReturnType<typeof setTimeout>>();

async function push(key: string, value: string): Promise<void> {
  if (!(await canSync())) return;
  try {
    await apiFetch(
      `/api/data/${namespaceFor(key)}`,
      { method: "PUT", body: JSON.stringify({ payload: encode(key, value) }), timeoutMs: SYNC_TIMEOUT_MS },
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
    await rememberKey(key);
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
   * Replaces the device cache with what the account holds on the server.
   *
   * This is what makes Atlas authoritative rather than merely a backup: without
   * it, a device that already had local data would keep serving that data
   * forever and never see writes made from another phone. Called at sign-in and
   * after the OAuth callback.
   *
   * Returns how many namespaces were restored. A failure here is not fatal —
   * the app carries on with whatever cache it has, which is the correct
   * behaviour when the user is offline or Render is still waking up.
   */
  async hydrate(): Promise<{ pulled: number; failed: boolean }> {
    if (!(await canSync())) return { pulled: 0, failed: false };
    try {
      const manifest = await apiFetch<{ namespaces: { namespace: string }[] }>(
        "/api/data",
        { timeoutMs: SYNC_TIMEOUT_MS },
        true,
      );

      let pulled = 0;
      for (const entry of manifest?.namespaces ?? []) {
        try {
          const res = await apiFetch<{ payload: any }>(
            `/api/data/${entry.namespace}`,
            { timeoutMs: SYNC_TIMEOUT_MS },
            true,
          );
          const key = res?.payload?.key;
          const value = decode(res?.payload);
          if (typeof key === "string" && value !== null) {
            await AsyncStorage.setItem(key, value);
            await rememberKey(key);
            pulled++;
          }
        } catch {
          // One unreadable namespace must not abandon the rest.
        }
      }
      return { pulled, failed: false };
    } catch (e: any) {
      console.warn("[sync] hydrate failed:", e?.message ?? e);
      return { pulled: 0, failed: true };
    }
  },

  /**
   * Drops every cached namespace from the device. Called at sign-out: the data
   * lives in Atlas, so nothing is lost, and leaving it behind would show the
   * next account on this device the previous one's CV and roadmap.
   */
  async clearLocal(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(KEY_INDEX);
      const keys: string[] = raw ? JSON.parse(raw) : [];
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
      await Promise.all(keys.map((k) => AsyncStorage.removeItem(k)));
      await AsyncStorage.removeItem(KEY_INDEX);
    } catch (e: any) {
      console.warn("[sync] clearLocal failed:", e?.message ?? e);
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
