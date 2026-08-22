/**
 * Account deletion worker.
 *
 * POST /api/user/delete sets `deletionScheduledAt` 30 days out and revokes the
 * user's sessions, and POST /api/user/delete/cancel clears it. Until this
 * worker existed nothing ever acted on that date — the account, its sessions
 * and its feature data stayed in the database indefinitely while the app told
 * the user their data would be erased. This closes that gap.
 *
 * Runs in-process on an interval rather than as a separate scheduled service:
 * the deadline is 30 days away, so the precision of a cron is unnecessary and
 * a second deployable is not worth its own failure mode. A missed sweep
 * (restart, spun-down instance) simply happens on the next one.
 */
const User     = require("../models/User");
const Session  = require("../models/Session");
const UserData = require("../models/UserData");
const AuditLog = require("../models/AuditLog");

const SWEEP_INTERVAL_MS = Number(process.env.DELETION_SWEEP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);

/**
 * Erases every account whose grace period has elapsed.
 * Exported separately from the scheduler so it can be triggered and tested
 * directly without waiting for an interval to fire.
 */
async function purgeExpiredAccounts() {
  const due = await User.find({ deletionScheduledAt: { $lte: new Date() } })
    .select("_id email")
    .lean();

  if (due.length === 0) return { purged: 0 };

  for (const user of due) {
    try {
      // Order matters only in that the User document goes last: if the process
      // dies mid-purge, the account is still flagged for deletion and the next
      // sweep finishes the job. Removing the User first would strand the rest.
      await Promise.all([
        Session.deleteMany({ userId: user._id }),
        UserData.deleteMany({ userId: user._id }),
        AuditLog.deleteMany({ userId: user._id }),
      ]);
      await User.deleteOne({ _id: user._id });
      console.log(`[Deletion] Purged account ${user._id} after 30-day grace period.`);
    } catch (e) {
      // One bad account must not abort the sweep for the others.
      console.error(`[Deletion] Failed to purge ${user._id}:`, e.message);
    }
  }

  return { purged: due.length };
}

function startDeletionWorker() {
  const run = () =>
    purgeExpiredAccounts().catch((e) => console.error("[Deletion] Sweep failed:", e.message));

  // A first sweep shortly after boot catches anything that came due while the
  // instance was spun down, without delaying startup itself.
  setTimeout(run, 60_000);

  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  // Do not hold the event loop open on shutdown.
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[Deletion] Worker started (sweep every ${Math.round(SWEEP_INTERVAL_MS / 3600000)}h).`);
  return timer;
}

module.exports = { startDeletionWorker, purgeExpiredAccounts };
