/**
 * Verifies MONGODB_URI in server/.env points at a reachable Atlas cluster
 * and that the app's models can create their indexes.
 *
 * Usage: cd server && node check-atlas.js
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const mongoose = require("mongoose");

const uri = process.env.MONGODB_URI || "";
const masked = uri.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@");

(async () => {
  if (!uri) {
    console.error("✗ MONGODB_URI is not set in server/.env");
    process.exit(1);
  }
  console.log(`URI      : ${masked}`);

  if (!uri.startsWith("mongodb+srv://") && !/mongodb\.net/.test(uri)) {
    console.warn("⚠ This does not look like an Atlas URI (expected mongodb+srv://…mongodb.net)");
  }

  // Atlas' copy button omits the database name, which silently routes to "test".
  const dbInPath = uri.split("/")[3]?.split("?")[0];
  if (!dbInPath) {
    console.error("✗ No database name in the URI path. Add /career-assistant before the '?'.");
    process.exit(1);
  }
  console.log(`Database : ${dbInPath}`);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log("✓ Connected to Atlas");

    const { version } = await mongoose.connection.db.admin().serverInfo();
    console.log(`✓ MongoDB server version ${version}`);

    const cols = await mongoose.connection.db.listCollections().toArray();
    console.log(`Collections: ${cols.length ? cols.map((c) => c.name).join(", ") : "(none yet — expected on a fresh cluster)"}`);

    // Load the real models so Mongoose builds the same indexes the app relies on.
    require("./models/User");
    require("./models/Session");
    require("./models/AuditLog");
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
    console.log(`✓ Indexes ensured for: ${mongoose.modelNames().join(", ")}`);

    await mongoose.disconnect();
    console.log("\nAtlas is ready.");
  } catch (err) {
    console.error(`✗ ${err.message}`);
    if (/IP that isn't whitelisted|ETIMEDOUT|ENOTFOUND|querySrv/i.test(err.message)) {
      console.error("  → Atlas → Network Access → add 0.0.0.0/0 (Render has no static IP).");
    }
    if (/Authentication failed|bad auth/i.test(err.message)) {
      console.error("  → Atlas → Database Access → check the user, and URL-encode any @ : / ? # in the password.");
    }
    process.exit(1);
  }
})();
