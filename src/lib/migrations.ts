import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

export function runMigrations(): { applied: string[] } {
  const db = getDb();
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (db.prepare("SELECT filename FROM _migrations").all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );
  if (!fs.existsSync(MIGRATIONS_DIR)) return { applied: [] };
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO _migrations (filename, applied_at) VALUES (?, datetime('now', 'localtime'))",
      ).run(file);
      db.exec("COMMIT");
      newlyApplied.push(file);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { applied: newlyApplied };
}
