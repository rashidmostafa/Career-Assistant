/**
 * UserData — server-side persistence for the app's feature state.
 *
 * Everything outside authentication (CV, roadmap, interview history, job
 * matches, portfolio) previously lived only in the device's AsyncStorage
 * under keys like `cv_${user.id}` and `rm_weeks_${user.id}_${roleKey}`. That
 * meant a reinstall or a new phone silently lost all of it, and nothing was
 * recoverable from the account.
 *
 * The shape here deliberately mirrors those AsyncStorage keys: one JSON
 * document per (user, namespace). It is a document store rather than five
 * hand-modelled schemas because the client already produces exactly these
 * blobs, so syncing needed no reshaping on either side and no migration of
 * existing on-device data.
 *
 * The trade-off, stated plainly: the server cannot query *inside* a payload.
 * Nothing needs that yet. The day something does — cross-user job matching,
 * analytics over roadmap completion — those collections get real schemas, and
 * this stays for the rest.
 */
const mongoose = require("mongoose");

const UserDataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  // e.g. "cv", "portfolio", "roadmap:frontend-engineer", "jobs:matches:qa"
  // The role-scoped suffix keeps the client's existing per-role separation.
  namespace: { type: String, required: true, trim: true, maxlength: 128 },

  payload: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Incremented server-side on every write. The client sends back the
  // revision it last saw so a stale device cannot clobber a newer write from
  // another device without knowing it is doing so.
  revision: { type: Number, default: 1 },
}, { timestamps: true });

// One document per namespace per user; the upsert in routes/data.js relies on
// this being unique.
UserDataSchema.index({ userId: 1, namespace: 1 }, { unique: true });

module.exports = mongoose.model("UserData", UserDataSchema);
