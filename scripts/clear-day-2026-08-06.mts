/**
 * Clear everything the register recorded on 2026-08-06 after 07:00.
 *
 * The shop tried the POS for real for the first time on this day, could not get
 * it to behave, and went back to the Excel sheet by mid-afternoon. What is in
 * the database for that window is people learning the buttons -- twelve tickets
 * with tires sold that were never sold, an oversell that put a lot to -3, a
 * drawer withdrawal called "cajua fuette", and six register checks counting
 * money against totals that were never real. The day's actual trade is being
 * re-entered from the sheet afterwards, so none of this is the record of
 * anything and all of it would otherwise poison every report that reads the day.
 *
 * This is a HARD DELETE, and it is the one place in this system that does one.
 * Everywhere else the rule is soft-delete and reversing rows, for a good reason:
 * a voided ticket is a thing that happened and the books have to be able to say
 * so. This is the opposite case. These rows are not a mistake the shop made
 * while trading, they are the noise of learning the tool, and a `deleted` flag
 * would leave every one of them in the tables for some later query to forget to
 * filter out. The audit trail that would normally justify keeping them is being
 * cleared with them, on the owner's instruction, for the same reason.
 *
 * The cut is 07:00 wall-clock, which was checked against `business_date` before
 * this was written: both select exactly the same rows, so there is no ticket
 * straddling the boundary and no argument about which day anything belongs to.
 *
 * Deliberately NOT cleared:
 *
 *   product 563   Landsail 245-70-19.5 -- added during the mess, but it is a
 *                 real tire and the catalogue is better off keeping it.
 *   sale 26       an old ticket whose mount mechanic was set and then unset
 *                 again the same afternoon. It is already back to its original
 *                 values, so there is nothing to undo.
 *
 * Lots cache `qty_remaining` rather than deriving it, so deleting movements does
 * not by itself put the stock back. It is recomputed at the end from the ledger
 * that survives -- `SUM(qty_delta)`, which was verified to hold across all 155
 * lots before this ran.
 *
 * DRY RUN unless given --commit.
 */

import { getDb } from "../src/lib/db.ts";
import { inTx } from "../src/lib/tx.ts";

const commit = process.argv.includes("--commit");

const CUT = "2026-08-06T07:00:00";
const BUSINESS_DATE = "2026-08-06";
const KEEP_PRODUCT = 563; // Landsail 245-70-19.5
const DROP_CUSTOMER = 9; // "Fualanito", phone "210"

const db = getDb();

/** Counter rollbacks, so the re-entered day starts where the cleared one did. */
const COUNTERS: Record<string, number> = {
  sale_no: 61,
  customer_no: 9,
  lot_no: 155,
  shift_no: 2,
};

// Children before parents. Nothing here relies on ON DELETE CASCADE being on --
// it may not be, and a half-cleared day is worse than an uncleared one.
const DELETES: { label: string; sql: string }[] = [
  {
    label: "register_check_counts",
    sql: `DELETE FROM register_check_counts
           WHERE check_id IN (SELECT id FROM register_checks WHERE business_date = '${BUSINESS_DATE}')`,
  },
  { label: "register_checks", sql: `DELETE FROM register_checks WHERE business_date = '${BUSINESS_DATE}'` },
  { label: "drawer_movements", sql: `DELETE FROM drawer_movements WHERE created_at >= '${CUT}'` },
  { label: "inventory_movements", sql: `DELETE FROM inventory_movements WHERE created_at >= '${CUT}'` },
  { label: "inventory_lots", sql: `DELETE FROM inventory_lots WHERE created_at >= '${CUT}'` },
  { label: "payments", sql: `DELETE FROM payments WHERE created_at >= '${CUT}'` },
  { label: "sale_items", sql: `DELETE FROM sale_items WHERE created_at >= '${CUT}'` },
  { label: "sales", sql: `DELETE FROM sales WHERE created_at >= '${CUT}'` },
  { label: "shifts", sql: `DELETE FROM shifts WHERE created_at >= '${CUT}'` },
  { label: "shift_counts", sql: `DELETE FROM shift_counts WHERE created_at >= '${CUT}'` },
  { label: "product_searches", sql: `DELETE FROM product_searches WHERE created_at >= '${CUT}'` },
  { label: "pos_sessions", sql: `DELETE FROM pos_sessions WHERE created_at >= '${CUT}'` },
  { label: "customers", sql: `DELETE FROM customers WHERE id = ${DROP_CUSTOMER}` },
  { label: "time_entries", sql: `DELETE FROM time_entries WHERE created_at >= '${CUT}'` },
  { label: "audit_log", sql: `DELETE FROM audit_log WHERE timestamp >= '${CUT}'` },
];

const countOf = (sql: string) =>
  (db.prepare(sql.replace(/^DELETE FROM (\w+)/, "SELECT COUNT(*) n FROM $1")).get() as { n: number }).n;

console.log(commit ? "=== COMMIT ===" : "=== DRY RUN (pass --commit to apply) ===");
console.log(`Cut: everything at or after ${CUT}\n`);

let total = 0;
for (const d of DELETES) {
  const n = countOf(d.sql);
  total += n;
  console.log(`  ${String(n).padStart(4)}  ${d.label}`);
}
console.log(`  ----\n  ${String(total).padStart(4)}  rows total`);

// The photos belong to the punches being deleted. Listed, not unlinked: files
// are outside the transaction, so a failed run would leave the rows pointing at
// nothing. Cleared by hand once this has been seen to work.
const photos = db
  .prepare(`SELECT photo_path FROM time_entries WHERE created_at >= ? AND photo_path IS NOT NULL`)
  .all(CUT) as { photo_path: string }[];
if (photos.length) {
  console.log(`\n  Orphaned photo files (NOT deleted by this script):`);
  for (const p of photos) console.log(`    ${p.photo_path}`);
}

const lotsToFix = db
  .prepare(
    `SELECT DISTINCT lot_id FROM inventory_movements
      WHERE created_at >= ? AND lot_id IS NOT NULL`,
  )
  .all(CUT) as { lot_id: number }[];

console.log(`\n  Stock going back on the rack:`);
for (const { lot_id } of lotsToFix) {
  const l = db
    .prepare(
      `SELECT l.lot_no, l.product_id, l.qty_remaining, l.created_at,
              COALESCE((SELECT SUM(m.qty_delta) FROM inventory_movements m
                         WHERE m.lot_id = l.id AND m.created_at < ?), 0) AS after
         FROM inventory_lots l WHERE l.id = ?`,
    )
    .get(CUT, lot_id) as
    | { lot_no: string; product_id: number; qty_remaining: number; created_at: string; after: number }
    | undefined;
  if (!l) continue;
  const gone = l.created_at >= CUT;
  console.log(
    `    ${l.lot_no} (product ${l.product_id}): ${l.qty_remaining} -> ${gone ? "lot deleted" : l.after}`,
  );
}

console.log(`\n  Counters rolled back:`);
for (const [name, next] of Object.entries(COUNTERS)) {
  const cur = db.prepare("SELECT next_value FROM counters WHERE name = ?").get(name) as
    | { next_value: number }
    | undefined;
  console.log(`    ${name}: ${cur?.next_value ?? "?"} -> ${next}`);
}

console.log(`\n  Kept on purpose: product ${KEEP_PRODUCT} (Landsail 245-70-19.5)`);

if (!commit) {
  console.log("\nNothing written.");
  process.exit(0);
}

inTx(() => {
  for (const d of DELETES) {
    const info = db.prepare(d.sql).run();
    console.log(`  deleted ${String(info.changes).padStart(4)}  ${d.label}`);
  }

  for (const [name, next] of Object.entries(COUNTERS)) {
    db.prepare("UPDATE counters SET next_value = ? WHERE name = ?").run(next, name);
  }

  // From the surviving ledger, not by adding back what was taken away. If the
  // two ever disagree the ledger is right, and this is the cheapest place to
  // make that true again.
  db.prepare(
    `UPDATE inventory_lots
        SET qty_remaining = COALESCE(
              (SELECT SUM(m.qty_delta) FROM inventory_movements m WHERE m.lot_id = inventory_lots.id), 0)
      WHERE id IN (${lotsToFix.map((l) => l.lot_id).join(",") || "-1"})`,
  ).run();
});

console.log("\n--- verifying ---");

const left = DELETES.map((d) => ({ label: d.label, n: countOf(d.sql) })).filter((x) => x.n > 0);
console.log(left.length === 0 ? "  nothing left in range" : `  STILL IN RANGE: ${JSON.stringify(left)}`);

const drift = db
  .prepare(
    `SELECT COUNT(*) n FROM inventory_lots l
      WHERE l.qty_remaining <> COALESCE(
              (SELECT SUM(m.qty_delta) FROM inventory_movements m WHERE m.lot_id = l.id), 0)`,
  )
  .get() as { n: number };
console.log(`  lots whose cached stock disagrees with the ledger: ${drift.n}`);

const negative = db
  .prepare("SELECT COUNT(*) n FROM inventory_lots WHERE qty_remaining < 0 AND deleted = 0")
  .get() as { n: number };
console.log(`  lots still showing negative stock: ${negative.n}`);

const kept = db.prepare("SELECT id, sku FROM products WHERE id = ?").get(KEEP_PRODUCT) as
  | { id: number; sku: string }
  | undefined;
console.log(`  product ${KEEP_PRODUCT} kept: ${kept ? kept.sku : "MISSING"}`);

console.log("\nDone.");
