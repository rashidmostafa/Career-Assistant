/**
 * MongoDB connection via Mongoose.
 * Reads MONGODB_URI from environment; falls back to local dev URI.
 */
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/career-assistant";

let _isConnected = false;

async function connectDB() {
  if (_isConnected) return;
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    _isConnected = true;
    console.log(`[DB] Connected to MongoDB: ${MONGODB_URI.replace(/\/\/.*@/, "//<credentials>@")}`);
  } catch (err) {
    console.error("[DB] Connection failed:", err.message);
    process.exit(1);
  }
}

mongoose.connection.on("disconnected", () => {
  _isConnected = false;
  console.warn("[DB] Disconnected. Attempting reconnect…");
});

module.exports = { connectDB, mongoose };
