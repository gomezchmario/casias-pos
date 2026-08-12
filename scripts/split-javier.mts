/**
 * Two men named Javier, told apart.
 *
 * THE IMPORT MATCHED TECHNICIANS BY FIRST NAME, which is the only thing the old
 * workbook recorded, and it worked for everybody except this one: the tire
 * technician who left is not the service writer who works here now. They shared
 * a name, so two and a half years of the departed man's work — 3,782 credited
 * lines and 3,312 tip attributions — landed on the current employee's record
 * the day the history was imported.
 *
 * Left alone it corrupts every report that measures a person: the performance
 * board would credit the service writer with a technician's whole career, the
 * leaderboard would rank him against people who were actually here, and the
 * crew figures on Trends would count one man as two.
 *
 * THE BOUNDARY IS EXACT AND WAS CHECKED BEFORE THIS WAS WRITTEN. Every one of
 * the credited lines sits on an imported ticket (`H-` prefix, last one
 * 2026-03-19); the service writer's record has not a single line from a ticket
 * rung on the register. So "imported" is not a heuristic here — it is the
 * dividing line itself, and the split cannot take work from the wrong man.
 *
 * The audit log is deliberately NOT moved. Those twenty rows are the current
 * Javier using the program since it went live, which is exactly what an audit
 * trail is for and the one thing here that genuinely belongs to him.
 *
 *   npx tsx scripts/split-javier.mts          (dry run)
 *   npx tsx scripts/split-javier.mts --apply
 */
import fs from "node:fs";
import { getDb } from "../src/lib/db";
import { nowLocalIso } from "../src/lib/time";

const APPLY = process.argv.includes("--apply");
const db = getDb();

const CURRENT = "Javier";
/** The departed man, named so a report can never read as the other one. */
const HISTORIC = "Javier (tires)";

const current = db
  .prepare("SELECT id, name, pos_role, active FROM employees WHERE name = ?")
  .get(CURRENT) as { id: number; name: string; pos_role: string; active: number } | undefined;
if (!current) throw new Error(`No employee named ${CURRENT}`);
if (db.prepare("SELECT id FROM employees WHERE name = ?").get(HISTORIC))
  throw new Error(`${HISTORIC} already exists — the split has already been run`);

const lines = db
  .prepare(
    `SELECT COUNT(*) n, MIN(s.business_date) lo, MAX(s.business_date) hi
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE i.mechanic_id = ? AND s.sale_no LIKE 'H-%'`,
  )
  .get(current.id) as { n: number; lo: string; hi: string };
const pays = db
  .prepare(
    `SELECT COUNT(*) n FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.mechanic_id = ? AND s.sale_no LIKE 'H-%'`,
  )
  .get(current.id) as { n: number };

// The guard that makes this safe to run: if the current employee has ANY credit
// on a ticket the register itself wrote, the boundary is not clean and this
// script must not guess where to cut.
const live = db
  .prepare(
    `SELECT COUNT(*) n FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE i.mechanic_id = ? AND s.sale_no NOT LIKE 'H-%'`,
  )
  .get(current.id) as { n: number };

console.log(`${CURRENT} (#${current.id}, ${current.pos_role})`);
console.log(`  imported lines : ${lines.n}  ${lines.lo} → ${lines.hi}`);
console.log(`  imported tips  : ${pays.n}`);
console.log(`  POS lines      : ${live.n}   ← must be 0 for the split to be safe`);

if (live.n > 0)
  throw new Error(
    "The current Javier has credit on register-written tickets. The two men cannot be told apart by source; do not run this.",
  );
if (lines.n === 0 && pays.n === 0) {
  console.log("\nNothing imported to move.");
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nWould move ${lines.n} lines and ${pays.n} tip credits to "${HISTORIC}".`);
  console.log("Dry run — re-run with --apply.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
fs.mkdirSync("backups", { recursive: true });
fs.copyFileSync("data/timeclock.db", `backups/before-javier-split-${stamp}.db`);
console.log(`\nbacked up to backups/before-javier-split-${stamp}.db`);

db.transaction(() => {
  const now = nowLocalIso();
  // Inactive, technician, no PIN — the same shape the import gives every other
  // departed technician it had to invent a record for.
  const id = Number(
    db
      .prepare(
        `INSERT INTO employees (name, pin_hash, active, pos_role, created_at, updated_at)
         VALUES (?, '', 0, 'technician', ?, ?)`,
      )
      .run(HISTORIC, now, now).lastInsertRowid,
  );

  db.prepare(
    `UPDATE sale_items SET mechanic_id = ?
      WHERE mechanic_id = ?
        AND sale_id IN (SELECT id FROM sales WHERE sale_no LIKE 'H-%')`,
  ).run(id, current.id);

  db.prepare(
    `UPDATE sale_items SET mount_mechanic_id = ?
      WHERE mount_mechanic_id = ?
        AND sale_id IN (SELECT id FROM sales WHERE sale_no LIKE 'H-%')`,
  ).run(id, current.id);

  db.prepare(
    `UPDATE payments SET mechanic_id = ?
      WHERE mechanic_id = ?
        AND sale_id IN (SELECT id FROM sales WHERE sale_no LIKE 'H-%')`,
  ).run(id, current.id);

  db.prepare(
    `INSERT INTO audit_log
       (actor_type, employee_id, employee_name, employee_role, action, target_type,
        target_id, details, timestamp)
     VALUES ('system', NULL, NULL, NULL, 'employee.update', 'employee', ?, ?, ?)`,
  ).run(
    String(id),
    JSON.stringify({
      split_from: current.id,
      reason:
        "Imported history matched technicians by first name; the departed tire technician Javier was merged onto the current service writer Javier. Imported credits moved to a separate record.",
      lines: lines.n,
      payments: pays.n,
    }),
    now,
  );

  console.log(`created "${HISTORIC}" as #${id}`);
})();

for (const e of db
  .prepare("SELECT id, name, pos_role, active FROM employees WHERE name LIKE 'Javier%' ORDER BY id")
  .all() as { id: number; name: string; pos_role: string; active: number }[]) {
  const l = db
    .prepare(
      `SELECT COUNT(*) n, MIN(s.business_date) lo, MAX(s.business_date) hi
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE i.mechanic_id = ? AND s.deleted = 0`,
    )
    .get(e.id) as { n: number; lo: string | null; hi: string | null };
  console.log(
    `  #${e.id} ${e.name.padEnd(16)} ${e.pos_role.padEnd(11)} ${e.active ? "active " : "gone   "} lines ${String(l.n).padStart(5)}  ${l.lo ?? "—"} → ${l.hi ?? "—"}`,
  );
}
