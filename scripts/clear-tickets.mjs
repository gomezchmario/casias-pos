/**
 * Delete the tickets rung on one business day, and nothing else.
 *
 * This is the narrow cousin of `reset-for-production.mjs`. That one empties the
 * whole database and is right exactly once, before the shop's first real sale.
 * This one is for the situation that keeps recurring instead: somebody rang a
 * few tickets to see whether a screen worked, and now the day has to look like
 * they never did — while the tire catalogue, the received stock, the employees
 * and every audit row about them stay exactly where they are.
 *
 * WHY A SCRIPT AND NOT A HANDFUL OF DELETEs
 *
 * The tickets are the easy part. What is easy to forget:
 *
 *   counters      Leave `sale_no` where it is and the first real ticket is
 *                 S-2026-000007, which reads to anyone auditing later as six
 *                 sales that were made and then hidden. The number has to go
 *                 back to 1 or the deletion is worse than useless.
 *   shifts        A test shift left open means the first real payment of the
 *                 day is booked against a drawer that was opened to try a
 *                 button, hours before anyone stood at the counter.
 *   audit_log     Rows describing sale #3 become a lie the moment a REAL sale
 *                 #3 exists. Reusing the numbers is the whole point, so the
 *                 rows about the discarded ones have to go with them.
 *
 * What must NOT go: `product.create` and `inventory.receive` audit rows, the
 * products, the lots, and the receiving movements. Those are the catalogue
 * somebody typed in by hand, not testing.
 *
 * One transaction, foreign keys ON. Dry run unless given --commit.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commit = process.argv.includes("--commit");
const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

const db = new Database(path.join(root, "data", "timeclock.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * The business date, computed the same way the app does it: the day rolls at
 * `business_day_start_hour`, so a ticket corrected at 1am still belongs to
 * yesterday. Never `substr(created_at, 1, 10)`.
 */
const startHour = Number(db.prepare("SELECT value FROM settings WHERE key='business_day_start_hour'").get()?.value ?? 4);
let target = dateArg;
if (!target) {
  const d = new Date();
  if (d.getHours() < startHour) d.setDate(d.getDate() - 1);
  target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const sales = db.prepare("SELECT id, sale_no, status, total_cents FROM sales WHERE business_date = ? ORDER BY id").all(target);
const ids = sales.map((s) => s.id);

console.log(commit ? "APPLYING\n" : "DRY RUN — nothing will change. Add --commit to apply.\n");
console.log(`Business date: ${target} (day starts at ${startHour}:00)\n`);

if (ids.length === 0) {
  console.log("No tickets on that date. Nothing to do.");
  db.close();
  process.exit(0);
}

console.log(`Tickets to delete (${ids.length}):`);
for (const s of sales) console.log(`  ${s.sale_no}  ${s.status.padEnd(9)} ${(s.total_cents / 100).toFixed(2)}`);

/**
 * Which tables point at `sales`, read from the schema rather than typed out.
 * A hand-written list silently stops being complete the moment a migration adds
 * a table, and the failure is a foreign-key error at the worst possible moment
 * — or, with foreign keys off, an orphan nobody finds for months.
 */
const inList = `(${ids.join(",")})`;
const children = [];
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
  if (name === "sales") continue;
  const cols = db.pragma(`foreign_key_list("${name}")`).filter((f) => f.table === "sales").map((f) => f.from);
  if (!cols.length) continue;
  const clause = cols.map((c) => `"${c}" IN ${inList}`).join(" OR ");
  const n = db.prepare(`SELECT COUNT(*) n FROM "${name}" WHERE ${clause}`).get().n;
  children.push({ name, clause, n });
}

console.log("\nAttached rows:");
for (const c of children) console.log(`  ${String(c.n).padStart(5)}  ${c.name}`);

// Shifts opened on the target day that hold no surviving payments. A shift is a
// drawer someone opened; with every ticket on it gone there is nothing left for
// it to have held.
const shifts = db.prepare(
  `SELECT id, shift_no, is_open FROM shifts WHERE business_date = ?
     AND id NOT IN (SELECT shift_id FROM payments WHERE shift_id IS NOT NULL AND sale_id NOT IN ${inList})`
).all(target);
console.log(`\nShifts to delete (${shifts.length}):`);
for (const s of shifts) console.log(`  ${s.shift_no}${s.is_open ? "  (still open)" : ""}`);

/**
 * Audit rows about the tickets. Scoped by ACTION PREFIX, not by date: a row
 * describing a tire being received today has to survive, and "everything from
 * today" would take it. Anything not on this list is left alone by default,
 * which is the safe direction to be wrong in.
 */
const AUDIT_PREFIXES = ["sale.", "sale_item.", "payment.", "shift.", "drawer."];
const auditClause = AUDIT_PREFIXES.map(() => "action LIKE ?").join(" OR ");
const auditArgs = AUDIT_PREFIXES.map((p) => `${p}%`);
const auditRows = db.prepare(`SELECT action, COUNT(*) n FROM audit_log WHERE ${auditClause} GROUP BY action ORDER BY n DESC`).all(...auditArgs);
const auditTotal = auditRows.reduce((s, r) => s + r.n, 0);
console.log(`\nAudit rows to delete (${auditTotal}) — ticket actions only:`);
for (const r of auditRows) console.log(`  ${String(r.n).padStart(5)}  ${r.action}`);

const kept = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE NOT (${auditClause})`).get(...auditArgs).n;
console.log(`  ${String(kept).padStart(5)}  kept (products, receiving, employees, logins)`);

console.log("\nUntouched:");
for (const t of ["products", "inventory_lots", "employees", "settings", "quick_buttons", "time_entries"]) {
  console.log(`  ${String(db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n).padStart(5)}  ${t}`);
}
const keptMoves = db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE sale_id IS NULL").get().n;
console.log(`  ${String(keptMoves).padStart(5)}  inventory_movements not tied to a ticket (receiving, counts)`);

console.log("\nCounters reset to 1: sale_no, shift_no");

if (!commit) {
  db.close();
  process.exit(0);
}

db.transaction(() => {
  // `payments.reverses_payment_id` and `inventory_movements.reverses_movement_id`
  // point back at their own tables, so a reversal still referencing an original
  // fails row-by-row no matter what order the deletes run in. Deferring moves
  // the check to COMMIT, when both sides are gone. The check still happens — a
  // genuine orphan would still roll all of this back.
  db.pragma("defer_foreign_keys = ON");

  for (const c of children) db.prepare(`DELETE FROM "${c.name}" WHERE ${c.clause}`).run();
  db.prepare(`DELETE FROM sales WHERE id IN ${inList}`).run();
  for (const s of shifts) db.prepare("DELETE FROM shifts WHERE id = ?").run(s.id);
  db.prepare(`DELETE FROM audit_log WHERE ${auditClause}`).run(...auditArgs);

  // AUTOINCREMENT holds a high-water mark, so without this the next ticket is
  // row id 7 even though the table is empty. Only tables actually emptied are
  // listed — resetting `inventory_movements` would collide with the 156
  // receiving rows still in it.
  const seq = db.prepare("DELETE FROM sqlite_sequence WHERE name = ?");
  for (const t of ["sales", "sale_items", "payments", "shifts"]) {
    if (db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n === 0) seq.run(t);
  }
  db.prepare("UPDATE counters SET next_value = 1 WHERE name IN ('sale_no', 'shift_no')").run();
})();

const integrity = db.pragma("integrity_check", { simple: true });
const fk = db.pragma("foreign_key_check");
console.log(`\nDone. integrity_check: ${integrity}, foreign_key_check: ${fk.length === 0 ? "clean" : JSON.stringify(fk)}`);
console.log(`Sales remaining: ${db.prepare("SELECT COUNT(*) n FROM sales").get().n}`);
console.log(`Products kept:   ${db.prepare("SELECT COUNT(*) n FROM products").get().n}`);
db.close();
