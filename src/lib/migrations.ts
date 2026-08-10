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

    /*
      Rebuilding a table needs foreign keys off, and they cannot be turned off
      inside a transaction.

      SQLite ignores `PRAGMA foreign_keys` while one is open — silently, which is
      the unpleasant part. A migration that drops and recreates a table to widen
      a CHECK constraint (the only way SQLite allows one to be changed) therefore
      fails on the DROP, because every row in every child table momentarily
      points at nothing. `defer_foreign_keys` does not save it either: the drop
      marks those rows as violations and recreating the table does not clear the
      count, so the COMMIT fails instead.

      So a file may ask for the pragma to be turned off around it, and says so on
      its first line. It still runs in a transaction and is still all-or-nothing;
      the only difference is that the constraint check happens once at the end,
      by `foreign_key_check`, rather than row by row on the way through. That
      check is not optional — a rebuild that silently orphaned the payments
      ledger is the worst outcome available here, and it is the reason this is a
      marker on a file rather than a pragma somebody can leave switched off.
    */
    const rebuildsTables = /^--\s*@foreign-keys-off\b/m.test(sql);
    if (rebuildsTables) db.pragma("foreign_keys = OFF");

    db.exec("BEGIN");
    try {
      db.exec(sql);
      if (rebuildsTables) {
        const orphans = db.pragma("foreign_key_check") as unknown[];
        if (orphans.length > 0)
          throw new Error(
            `${file} left ${orphans.length} orphaned row(s) behind — rolled back.`,
          );
      }
      db.prepare(
        "INSERT INTO _migrations (filename, applied_at) VALUES (?, datetime('now', 'localtime'))",
      ).run(file);
      db.exec("COMMIT");
      newlyApplied.push(file);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      // Back on whatever happened, including the throw. A connection left with
      // foreign keys off would go on serving the rest of the night with no
      // referential integrity at all.
      if (rebuildsTables) db.pragma("foreign_keys = ON");
    }
  }
  return { applied: newlyApplied };
}
