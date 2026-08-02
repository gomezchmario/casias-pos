/**
 * Take a consistent, verified snapshot of the database.
 *
 * Deliberately NOT a file copy. The database runs in WAL mode, so at any moment
 * a large part of the committed data may still be sitting in timeclock.db-wal --
 * copying just the .db file can silently produce a backup that is missing the
 * last few hours of sales. `VACUUM INTO` asks SQLite itself for a single-file
 * snapshot with everything folded in, and the result is checked before this
 * script reports success.
 *
 *   node scripts/backup-db.mjs              -> data/backups/timeclock-<stamp>.db
 *   node scripts/backup-db.mjs D:/usb       -> writes there instead
 *
 * One SQLite file on one PC is one dead drive away from gone. Point this at a
 * USB stick or a synced folder and run it on a schedule.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "data", "timeclock.db");

if (!fs.existsSync(source)) {
  console.error(`no database at ${source}`);
  process.exit(1);
}

const destDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "data", "backups");
fs.mkdirSync(destDir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 15);
const dest = path.join(destDir, `timeclock-${stamp}.db`);

const db = new Database(source, { readonly: true });
// VACUUM INTO wants forward slashes in the string literal even on Windows.
db.exec(`VACUUM INTO '${dest.replace(/\\/g, "/").replace(/'/g, "''")}'`);
db.close();

// A backup nobody has verified is a guess. Open it and count the rows that
// matter, so a corrupt or truncated file fails here rather than on the day it
// is needed.
const check = new Database(dest, { readonly: true });
const integrity = check.pragma("integrity_check")[0].integrity_check;
if (integrity !== "ok") {
  console.error(`backup failed integrity check: ${integrity}`);
  process.exit(1);
}

const counts = [];
for (const t of ["employees", "time_entries", "sales", "payments", "shifts"]) {
  try {
    counts.push(`${t} ${check.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`);
  } catch {
    /* table not present in older schemas */
  }
}
check.close();

const kb = Math.round(fs.statSync(dest).size / 1024);
console.log(`${dest}\n  ${kb} KB, integrity ok\n  ${counts.join(", ")}`);
