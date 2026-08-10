/**
 * Put S-2026-000060 back to open, so the shop can see what a draft looks like
 * in the Outstanding panel.
 *
 * This ticket was voided earlier the same night as scratch left from building
 * the register. Nothing was ever paid against it and nothing ever moved off the
 * rack for it, so its void was a bare status flip and reversing it is exact.
 *
 * There is deliberately no `unvoidSale` in `src/lib`. Un-voiding is not a thing
 * a register should be able to do: on a ticket that took money, the void wrote
 * reversal payments and void_return movements, and flipping the status back
 * would leave every one of those in place -- a ticket reading open and owing
 * while its ledger says the money already went back out. The guards below are
 * what make this one safe rather than the general case being safe, which is why
 * this lives in scripts/ under the number of the single ticket it is for.
 *
 * DRY RUN unless given --commit.
 */

import { getDb } from "../src/lib/db.ts";
import { inTx } from "../src/lib/tx.ts";
import { recalcMoney } from "../src/lib/sales.ts";
import { logActorAudit } from "../src/lib/audit.ts";
import { nowLocalIso } from "../src/lib/time.ts";

const commit = process.argv.includes("--commit");

const OWNER_ID = 4;
const SALE_NO = "S-2026-000060";
const REASON = "Reopened at the owner's request to show a draft in the Outstanding panel";

const db = getDb();

const owner = db
  .prepare("SELECT id, name, pos_role FROM employees WHERE id = ? AND active = 1")
  .get(OWNER_ID) as { id: number; name: string; pos_role: string } | undefined;

if (!owner) throw new Error(`No active employee ${OWNER_ID} to attribute this to.`);
if (owner.pos_role !== "owner") throw new Error(`Employee ${OWNER_ID} is not the owner.`);

const sale = db
  .prepare(
    `SELECT s.id, s.sale_no, s.status, s.total_cents, s.balance_cents, s.void_reason,
            (SELECT COUNT(*) FROM payments            WHERE sale_id = s.id) AS payments,
            (SELECT COUNT(*) FROM inventory_movements WHERE sale_id = s.id) AS movements,
            (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id AND voided = 0) AS lines
       FROM sales s WHERE s.sale_no = ?`,
  )
  .get(SALE_NO) as
  | {
      id: number;
      sale_no: string;
      status: string;
      total_cents: number;
      balance_cents: number;
      void_reason: string | null;
      payments: number;
      movements: number;
      lines: number;
    }
  | undefined;

if (!sale) throw new Error(`${SALE_NO} not found.`);
if (sale.status !== "voided") throw new Error(`${SALE_NO} is ${sale.status}, not voided. Nothing to do.`);

// The two guards that matter. Either one being non-zero means the void did more
// than flip a status, and undoing it needs those rows unwound too -- which this
// script does not do and should not learn to.
if (sale.payments > 0)
  throw new Error(`${SALE_NO} has ${sale.payments} payment rows. Its void moved money. Stopping.`);
if (sale.movements > 0)
  throw new Error(`${SALE_NO} has ${sale.movements} stock movements. Its void moved tires. Stopping.`);
if (sale.lines === 0)
  throw new Error(`${SALE_NO} has no live lines, so it would owe nothing and show nowhere. Stopping.`);

console.log(commit ? "=== COMMIT ===" : "=== DRY RUN (pass --commit to apply) ===");
console.log(`Acting as ${owner.name} (#${owner.id}, ${owner.pos_role})\n`);
console.log(`${sale.sale_no}: ${sale.status}, ${sale.lines} line(s), ${sale.total_cents}c total`);
console.log(`  voided because: ${sale.void_reason}`);
console.log(`  -> open, balance back to ${sale.total_cents}c, shows as a Draft`);

if (!commit) {
  console.log("\nNothing written.");
  process.exit(0);
}

inTx(() => {
  db.prepare(
    `UPDATE sales SET status = 'open', voided_by = NULL, voided_at = NULL,
                      void_reason = NULL, updated_at = ?
      WHERE id = ?`,
  ).run(nowLocalIso(), sale.id);
  // After the status, never before: this is what reads it to decide the balance
  // is owed again rather than zeroed.
  recalcMoney(sale.id);

  logActorAudit(
    { type: "employee", employeeId: owner.id, name: owner.name, role: "owner" },
    {
      action: "sale.update",
      targetType: "sale",
      targetId: sale.id,
      details: { sale_no: sale.sale_no, change: "unvoid", reason: REASON },
      before: { status: "voided", balance_cents: 0, void_reason: sale.void_reason },
      after: { status: "open", balance_cents: sale.total_cents, void_reason: null },
    },
  );
});

const after = db
  .prepare("SELECT status, balance_cents FROM sales WHERE id = ?")
  .get(sale.id) as { status: string; balance_cents: number };

console.log(`\nDone. ${sale.sale_no} is now ${after.status}, ${after.balance_cents}c owing.`);
