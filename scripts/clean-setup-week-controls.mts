/**
 * Clears the control flags left over from the week the system was set up.
 *
 * WHAT IT DOES: signs off the oversells recorded while the shop was finding its
 * feet. Each one is a real `inventory_movements` row that took real tires off a
 * rack, so nothing is deleted — deleting them would move the stock count and
 * invent a discrepancy far worse than the flag being cleared. They are reviewed
 * through the same path a manager uses, which leaves the record that the size
 * went negative and stops the flag asking about something already looked at.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: touch the register logs.
 *
 * The reports panel said twenty-four of them had not balanced, which turned out
 * to be a bug in the report rather than a fact about the shop — the query was
 * missing `deleted = 0`, so it counted the twenty-one somebody had already
 * removed by hand. Eight are live, five of those balanced, and the three that
 * did not are each followed within minutes by a balanced recount.
 *
 * That pattern reads like counting again until it came right, and it also reads
 * like a genuine shortfall that was then found — and there is no way to tell
 * from here which it was. A register check exists to preserve exactly that kind
 * of evidence, so a script is the wrong instrument for removing one. They are
 * listed below and removed one at a time from the screen by somebody who
 * remembers the afternoon.
 *
 *   npx --yes tsx scripts/clean-setup-week-controls.mts [--apply]
 *
 * Prints what it would do and changes nothing without `--apply`.
 */

import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db.ts";
import { reviewOversell } from "../src/lib/inventory.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const APPLY = process.argv.includes("--apply");
const db = getDb();
const money = (c: number) => `${c < 0 ? "-" : "+"}$${(Math.abs(c) / 100).toFixed(2)}`;

// The audit rows name a person, so this has to be a real one.
const owner = db
  .prepare(
    "SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id LIMIT 1",
  )
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute this to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };
console.log(`acting as ${owner.name} (owner)\n`);

// ── What is being changed ──────────────────────────────────────────────────
const oversells = db
  .prepare(
    `SELECT m.id, m.business_date, m.qty_delta, p.name, s.sale_no
       FROM inventory_movements m
  LEFT JOIN products p ON p.id = m.product_id
  LEFT JOIN sales s ON s.id = m.sale_id
      WHERE m.oversold = 1 AND m.reviewed_at IS NULL
   ORDER BY m.id`,
  )
  .all() as {
  id: number;
  business_date: string;
  qty_delta: number;
  name: string | null;
  sale_no: string | null;
}[];

console.log(`OVERSELLS TO SIGN OFF — ${oversells.length}`);
console.log("  the movements stay exactly as they are; only the flag clears\n");
for (const o of oversells) {
  console.log(
    `  #${String(o.id).padStart(4)}  ${o.business_date}  ${String(o.qty_delta).padStart(3)}  ` +
      `${(o.sale_no ?? "-").padEnd(14)} ${o.name ?? ""}`,
  );
}

// ── What is being left alone, and why ──────────────────────────────────────
const live = db
  .prepare(
    `SELECT rc.id, rc.business_date, rc.checked_at, e.name AS by
       FROM register_checks rc
  LEFT JOIN employees e ON e.id = rc.checked_by
      WHERE rc.deleted = 0
   ORDER BY rc.id`,
  )
  .all() as { id: number; business_date: string; checked_at: string; by: string | null }[];
const alreadyGone = db
  .prepare("SELECT COUNT(*) AS n FROM register_checks WHERE deleted = 1")
  .get() as { n: number };

console.log(
  `\nREGISTER LOGS — ${live.length} live, ${alreadyGone.n} already removed by hand. NOT TOUCHED.`,
);
for (const c of live) {
  const off = db
    .prepare(
      `SELECT m.label, c.counted_cents - c.expected_cents AS d
         FROM register_check_counts c
         JOIN payment_methods m ON m.id = c.method_id
        WHERE c.check_id = ? AND c.counted_cents <> c.expected_cents`,
    )
    .all(c.id) as { label: string; d: number }[];
  console.log(
    `  #${String(c.id).padStart(3)}  ${c.business_date} ${c.checked_at.slice(11, 16)}  ` +
      `${(c.by ?? "?").padEnd(9)} ` +
      (off.length
        ? `OUT: ${off.map((l) => `${l.label} ${money(l.d)}`).join(", ")}`
        : "balanced"),
  );
}

if (!APPLY) {
  console.log("\nDry run. Nothing changed. Re-run with --apply.");
  process.exit(0);
}

// A copy before anything moves, via VACUUM INTO rather than a file copy: the
// database is in WAL mode and copying the .db alone can miss hours of it.
const now = (db.prepare("SELECT datetime('now','localtime') AS t").get() as { t: string }).t;
const dest = path.resolve(`backups/before-oversell-signoff-${now.replace(/[: ]/g, "-")}.db`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
db.prepare("VACUUM INTO ?").run(dest);
console.log(`\nbacked up to ${dest} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);

let reviewed = 0;
for (const o of oversells) {
  const r = reviewOversell(user, o.id, "Setup week — counted and signed off");
  if (r.ok) reviewed++;
  else console.log(`  ! movement #${o.id}: ${r.error}`);
}

// Read back rather than assume.
const flags = db
  .prepare(
    "SELECT COUNT(*) AS n FROM inventory_movements WHERE oversold = 1 AND reviewed_at IS NULL",
  )
  .get() as { n: number };
const movements = db.prepare("SELECT COUNT(*) AS n FROM inventory_movements").get() as { n: number };

console.log(`\nsigned off ${reviewed} oversells`);
console.log(`unreviewed oversells now: ${flags.n}`);
console.log(`inventory movements: ${movements.n} — unchanged, nothing was deleted`);
