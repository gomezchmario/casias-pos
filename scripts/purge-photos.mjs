// Manually purge photos older than the configured retention window
// AND clear the photo_path on their corresponding time entries.
// Run with: npm run purge-photos

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const DB_FILE = path.join(ROOT, "data", "timeclock.db");
const UPLOADS_DIR = path.join(ROOT, "uploads");

if (!fs.existsSync(DB_FILE)) {
  console.error("Database not found. Run `npm run setup` first.");
  process.exit(1);
}

const db = new Database(DB_FILE);
const setting = db.prepare("SELECT value FROM settings WHERE key = ?").get(
  "photo_retention_days",
);
const days = parseInt(setting?.value ?? "90", 10) || 90;
const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

console.log(`Purging photos older than ${days} days (before ${new Date(cutoffMs).toISOString()})...`);

const entries = db
  .prepare("SELECT id, photo_path FROM time_entries WHERE photo_path IS NOT NULL")
  .all();

let removed = 0;
let cleared = 0;
const clearStmt = db.prepare("UPDATE time_entries SET photo_path = NULL WHERE id = ?");

for (const e of entries) {
  const fullPath = path.join(UPLOADS_DIR, e.photo_path);
  let shouldClear = false;
  if (fs.existsSync(fullPath)) {
    const st = fs.statSync(fullPath);
    if (st.mtimeMs < cutoffMs) {
      fs.unlinkSync(fullPath);
      removed++;
      shouldClear = true;
    }
  } else {
    // Reference is dangling — clear it.
    shouldClear = true;
  }
  if (shouldClear) {
    clearStmt.run(e.id);
    cleared++;
  }
}

db.close();
console.log(`Removed ${removed} photo files, cleared ${cleared} DB references.`);
