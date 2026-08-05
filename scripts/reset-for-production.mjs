/**
 * Empty the shop's database of everything that happened, keeping only who
 * works here and how the shop is configured.
 *
 * This is the line between "we have been testing" and "this is the till now".
 * Run once, before the first real ticket.
 *
 * WHY A SCRIPT AND NOT A HANDFUL OF DELETEs
 *
 * Because the order matters and the omissions are invisible. Miss
 * `inventory_movements` and stock stays haunted by tires that were sold in
 * testing and never left the rack. Miss `counters` and the shop's first real
 * ticket is S-2026-000132, which looks like 131 missing sales to anybody
 * auditing it later. Neither mistake announces itself.
 *
 * Everything runs in one transaction with foreign keys ON, so it either all
 * applies or the database is untouched. Dry run unless given --commit.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "timeclock.db");
const uploads = path.join(root, "uploads");
const commit = process.argv.includes("--commit");

/**
 * Emptied. Ordered children-before-parents so foreign keys stay satisfied at
 * every step rather than only at the end.
 */
const CLEAR = [
  // --- the POS ledgers, deepest first -----------------------------------
  "payments", //             money in and out, per tender
  "sale_items", //           the lines
  "sales", //                the tickets
  "drawer_movements", //     cash moved that was not a sale
  "register_check_counts", // the denominations of a midday count
  "register_checks", //      the counts themselves
  "shift_counts", //         end-of-shift drawer counts
  "shifts", //               who had the drawer, when
  "payroll_lines", //        frozen payout rows
  "payroll_periods", //      the weeks they were frozen for
  // --- inventory ---------------------------------------------------------
  // Movements before lots before products: stock is DERIVED from movements,
  // so clearing them is what actually takes every count to zero. Leaving them
  // while clearing sales would leave counts reflecting tires that were sold in
  // testing and never physically left.
  "inventory_movements",
  "inventory_lots",
  "products",
  "product_searches", //     what people looked for and we did not have
  // --- people the shop sold to (not people who work here) ----------------
  "vehicles",
  "customers",
  // --- the time clock ----------------------------------------------------
  "time_entries",
  // --- sessions and history ----------------------------------------------
  "pos_sessions", //         everyone gets signed out; they PIN back in
  "audit_log", //            985 rows of us testing. After this, it is evidence.
];

/**
 * Untouched, and why each one is configuration rather than history.
 *
 *   employees          who works here — the whole point of the exercise
 *   admin_users        the time-clock login
 *   settings           tax rate, tip rule, business day start, shop address
 *   payment_methods    Cash/CC/SNAP/... — a lookup payments point at
 *   service_categories the same, for lines
 *   quick_buttons      the register grid, built by hand
 *   _migrations        WHICH SCHEMA THIS IS. Clearing it makes the next
 *                      `npm run setup` replay all sixteen migrations against a
 *                      database that already has them.
 */
const KEEP = [
  "employees",
  "admin_users",
  "settings",
  "payment_methods",
  "service_categories",
  "quick_buttons",
  "_migrations",
];

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name);

// A table in neither list is a table nobody decided about — almost certainly a
// new one added since this was written. Stop rather than guess: silently
// keeping a ledger is how a "clean" install goes live still holding test money.
const unaccounted = tables.filter((t) => !CLEAR.includes(t) && !KEEP.includes(t) && t !== "counters");
if (unaccounted.length) {
  console.error("Tables not listed in CLEAR or KEEP:", unaccounted.join(", "));
  console.error("Add them to one list or the other, then re-run.");
  process.exit(1);
}

const count = (t) => db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;

console.log(commit ? "APPLYING\n" : "DRY RUN — nothing will change. Add --commit to apply.\n");
console.log("Clearing:");
let total = 0;
for (const t of CLEAR) {
  if (!tables.includes(t)) continue;
  const n = count(t);
  total += n;
  if (n) console.log(`  ${String(n).padStart(5)}  ${t}`);
}
console.log(`  ${String(total).padStart(5)}  rows in total\n`);

console.log("Keeping:");
for (const t of KEEP) {
  if (tables.includes(t)) console.log(`  ${String(count(t)).padStart(5)}  ${t}`);
}

// Photos belong to time entries. With the entries gone they are orphans no
// screen can reach — and they are pictures of employees, which is not a thing
// to leave lying in a folder for no reason.
const photos = fs.existsSync(uploads) ? fs.readdirSync(uploads).filter((f) => f !== ".gitkeep") : [];
console.log(`\nPhotos in uploads/: ${photos.length} (orphaned once time_entries is empty)`);

console.log("\nCounters reset to 1: sale_no, customer_no, lot_no, shift_no");

if (!commit) {
  db.close();
  process.exit(0);
}

db.transaction(() => {
  // The reversal rows are the problem this solves. `payments.reverses_payment_id`
  // points at `payments(id)` and `drawer_movements.reverses_id` at itself, and
  // SQLite checks foreign keys ROW BY ROW -- so deleting an original that a
  // not-yet-deleted reversal still points at fails, no matter what order the
  // tables are cleared in. There is no ordering that fixes a self-reference.
  //
  // Deferring moves the check to COMMIT, by which point every row on both sides
  // is gone and the constraint is satisfied. This weakens nothing: the check
  // still happens, and a genuine orphan would still roll the whole thing back.
  // The pragma is scoped to this transaction and resets on commit.
  db.pragma("defer_foreign_keys = ON");
  for (const t of CLEAR) {
    if (tables.includes(t)) db.prepare(`DELETE FROM "${t}"`).run();
  }
  // AUTOINCREMENT keeps a high-water mark here, so ids would otherwise carry on
  // from the test data and the first real sale would be id 132.
  db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('employees', 'admin_users')").run();
  db.prepare("UPDATE counters SET next_value = 1").run();
})();

for (const f of photos) fs.unlinkSync(path.join(uploads, f));

// Outside the transaction: VACUUM cannot run inside one. Reclaims the space and
// leaves no deleted rows recoverable from the file's free pages.
db.exec("VACUUM");

const integrity = db.pragma("integrity_check", { simple: true });
console.log(`\nDone. integrity_check: ${integrity}`);
console.log(`Employees kept: ${count("employees")}`);
db.close();
