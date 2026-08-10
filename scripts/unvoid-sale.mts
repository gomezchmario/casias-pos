/**
 * Put a voided ticket back the way it was.
 *
 * There is no un-void in the app and that is deliberate — voiding is meant to be
 * a decision somebody stands behind, not a toggle. But a ticket voided by
 * mistake is its own kind of wrong record, and correcting it by hand in the
 * database would lose the trail. So: a script, append-only like everything else.
 *
 * WHAT IT DOES
 *   - Writes a positive row against every reversal the void created, pointing at
 *     it. The original payment, the void's reversal and this row all survive, so
 *     the ledger reads: paid, un-paid, paid again. That is what happened.
 *   - Puts the sale back to `completed` and clears the void fields.
 *   - Recomputes paid/balance from the ledger via `recalcMoney`, so the header
 *     can never disagree with the rows under it.
 *   - Writes an audit row naming the ticket and what was restored.
 *
 * WHAT IT REFUSES
 *   A ticket whose void put stock back on the rack. Reversing that correctly
 *   means re-allocating the same lots at the same costs, and getting it wrong
 *   moves real tires; it wants the proper `applySaleMovements` path rather than
 *   a script written for one flat repair. It stops and says so rather than
 *   half-restoring a ticket.
 *
 * DRY RUN unless given --commit.
 */

import { getDb } from "../src/lib/db.ts";
import { inTx } from "../src/lib/tx.ts";
import { nowLocalIso } from "../src/lib/time.ts";
import { getSale, recalcMoney } from "../src/lib/sales.ts";
import { logActorAudit, type Actor } from "../src/lib/audit.ts";

const commit = process.argv.includes("--commit");
const wanted = process.argv.find((a) => a.startsWith("S-"));
const db = getDb();
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute this to");
const actor: Actor = {
  type: "employee",
  employeeId: owner.id,
  name: owner.name,
  role: "owner",
};

/** The most recently voided ticket, unless one was named. */
const target = (
  wanted
    ? db.prepare("SELECT id FROM sales WHERE sale_no = ? AND deleted = 0").get(wanted)
    : db
        .prepare(
          `SELECT id FROM sales
            WHERE status = 'voided' AND deleted = 0
         ORDER BY voided_at DESC, id DESC LIMIT 1`,
        )
        .get()
) as { id: number } | undefined;

if (!target) throw new Error(wanted ? `${wanted} not found` : "Nothing is voided");

const sale = getSale(target.id)!;
console.log(commit ? "=== COMMIT ===" : "=== DRY RUN (pass --commit to apply) ===");
console.log(`${sale.sale_no} · ${sale.business_date} · ${money(sale.total_cents)}`);
console.log(`  voided ${sale.voided_at} — ${sale.void_reason}\n`);

if (sale.status !== "voided") {
  console.log("Not voided. Nothing to do.");
  process.exit(0);
}

// Stock is the line this script will not cross.
const returns = db
  .prepare(
    `SELECT COUNT(*) AS n FROM inventory_movements
      WHERE sale_id = ? AND reason = 'void_return'`,
  )
  .get(sale.id) as { n: number };
if (returns.n > 0) {
  console.log(
    `REFUSING: this void put ${returns.n} stock movement(s) back on the rack.\n` +
      "Restoring those wants the proper allocation path, not this script.",
  );
  process.exit(1);
}

/** The void's reversals, and only those that nothing has already undone. */
const reversals = db
  .prepare(
    `SELECT p.* FROM payments p
      WHERE p.sale_id = ? AND p.kind = 'reversal'
        AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.reverses_payment_id = p.id)`,
  )
  .all(sale.id) as {
  id: number;
  method_id: number;
  amount_cents: number;
  tip_cents: number;
  comm_cents: number;
  mechanic_id: number | null;
  taken_by: number;
  business_date: string;
  shift_id: number | null;
  seq: string | null;
}[];

console.log("Payments to restore:");
if (reversals.length === 0) console.log("  none");
for (const r of reversals)
  console.log(`  reversal #${r.id} ${money(r.amount_cents)} -> putting ${money(-r.amount_cents)} back`);

if (!commit) {
  console.log("\nNothing written. Re-run with --commit.");
  process.exit(0);
}

inTx(() => {
  const now = nowLocalIso();
  for (const r of reversals) {
    db.prepare(
      `INSERT INTO payments
         (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents,
          mechanic_id, reverses_payment_id, taken_by, business_date, shift_id, note, created_at)
       VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sale.id,
      r.method_id,
      -r.amount_cents,
      -r.tip_cents,
      -r.comm_cents,
      r.mechanic_id,
      r.id,
      owner.id,
      // The original day and shift, not today. The customer paid when they
      // paid; un-voting the ticket does not move money in the till now, and
      // landing it in tonight's shift would make tonight's drawer read over.
      r.business_date,
      r.shift_id,
      "Un-voided: the void was a mistake",
      now,
    );
  }

  db.prepare(
    `UPDATE sales
        SET status = 'completed', voided_by = NULL, voided_at = NULL,
            void_reason = NULL, updated_at = ?
      WHERE id = ?`,
  ).run(now, sale.id);
  recalcMoney(sale.id);

  logActorAudit(actor, {
    action: "sale.update",
    targetType: "sale",
    targetId: sale.id,
    details: {
      sale_no: sale.sale_no,
      change: "un-voided",
      restored_payments: reversals.length,
      original_void_reason: sale.void_reason,
    },
    before: { status: "voided", void_reason: sale.void_reason },
    after: { status: "completed" },
  });
});

const after = getSale(sale.id)!;
console.log(
  `\n${after.sale_no} is ${after.status} · total ${money(after.total_cents)} · paid ${money(
    after.paid_cents,
  )} · balance ${money(after.balance_cents)}`,
);
