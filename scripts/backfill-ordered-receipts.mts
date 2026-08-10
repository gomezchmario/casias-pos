/**
 * Book in the tires on orders that were delivered before the fulfilment fix.
 *
 * Until `receiveOrderedStock` landed, walking a special order to Delivered
 * booked the sale and nothing else, so every ordered tire drove its size
 * negative on the way out -- the shop had the tire, it just came off the van and
 * went onto the car without anybody stopping to receive it. Two orders went
 * through that path on 6 August while today's sheet was being imported, and left
 * two sizes sitting at -2 with a pair of false oversells behind them.
 *
 * This does for them what the fixed code now does at the moment of delivery: a
 * receipt for exactly what the ticket ordered, which takes each size back to
 * where it started rather than to some number picked to make the report look
 * right. Then the two oversell flags are marked reviewed rather than erased,
 * because they are not wrong about what happened -- at the moment they were
 * written the ledger really did think the shop had none -- and the note says why
 * they were cleared.
 *
 * Finds its own work rather than naming sale numbers: a completed order sitting
 * at Fitted or Gone whose lines have a sale movement and no receipt. That is the
 * exact shape the old code left behind, and if there are none it does nothing
 * and says so.
 *
 * The stage test is load-bearing, not decoration. An order at 'ordered' whose
 * stock has already moved is a DIFFERENT fault -- un-marking a ticket as an
 * order books its tires out, and marking it back does not put them back, so a
 * tire still on a truck can end up sold. Receiving against one of those would
 * say a tire arrived that nobody has seen. Those want the movement reversed
 * instead, and they are deliberately left alone here.
 *
 * DRY RUN unless given --commit.
 */

import { getDb } from "../src/lib/db.ts";
import { receiveOrderedStock, reviewOversell, stockOnHand } from "../src/lib/inventory.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const commit = process.argv.includes("--commit");
const NOTE = "Ordered tire, received retroactively — it arrived and went straight on the car";

const db = getDb();

const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute this to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };

// Sold but never received: the fingerprint of the old fulfilment path.
const affected = db
  .prepare(
    `SELECT DISTINCT s.id, s.sale_no, s.po, s.fulfillment_status, c.name AS customer
       FROM sales s
       JOIN sale_items i ON i.sale_id = s.id AND i.voided = 0
       JOIN products p ON p.id = i.product_id AND p.track_inventory = 1 AND p.condition <> 'used'
  LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.deleted = 0
        AND s.is_special_order = 1
        AND s.status = 'completed'
        AND s.fulfillment_status IN ('installed', 'delivered')
        AND EXISTS (SELECT 1 FROM inventory_movements m
                     WHERE m.sale_item_id = i.id AND m.reason = 'sale')
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                         WHERE m.sale_item_id = i.id AND m.reason = 'receive')
      ORDER BY s.id`,
  )
  .all() as {
  id: number;
  sale_no: string;
  po: string | null;
  fulfillment_status: string;
  customer: string | null;
}[];

console.log(commit ? "=== COMMIT ===" : "=== DRY RUN (pass --commit to apply) ===");
console.log(`Acting as ${owner.name} (owner)\n`);

if (affected.length === 0) {
  console.log("No delivered orders are missing their receipt. Nothing to do.");
  process.exit(0);
}

for (const s of affected) {
  console.log(`${s.sale_no}  PO ${s.po ?? "—"}  ${s.customer ?? "—"}  (${s.fulfillment_status})`);
  const lines = db
    .prepare(
      `SELECT i.qty, p.id AS pid, p.name
         FROM sale_items i JOIN products p ON p.id = i.product_id
        WHERE i.sale_id = ? AND i.voided = 0 AND p.track_inventory = 1 AND p.condition <> 'used'`,
    )
    .all(s.id) as { qty: number; pid: number; name: string }[];
  for (const l of lines)
    console.log(`   ${l.name.padEnd(34)} on hand ${String(stockOnHand(l.pid)).padStart(3)} -> ${stockOnHand(l.pid) + l.qty}`);
}

const flags = db
  .prepare(
    `SELECT m.id, m.qty_delta, p.name, s.sale_no
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       JOIN sales s ON s.id = m.sale_id
      WHERE m.oversold = 1 AND m.reviewed_at IS NULL
        AND m.sale_id IN (${affected.map((a) => a.id).join(",")})`,
  )
  .all() as { id: number; qty_delta: number; name: string; sale_no: string }[];

console.log(`\noversell flags to clear: ${flags.length}`);
for (const f of flags) console.log(`   #${f.id}  ${f.sale_no}  ${f.name}  ${f.qty_delta}`);

if (!commit) {
  console.log("\nNothing written.");
  process.exit(0);
}

for (const s of affected) {
  const r = receiveOrderedStock(user, s.id, s.po);
  if (!r.ok) throw new Error(`${s.sale_no}: ${r.error}`);
  for (const got of r.received) console.log(`  received ${got.qty}x ${got.name} for ${s.sale_no}`);
}

for (const f of flags) {
  const r = reviewOversell(user, f.id, NOTE);
  if (!r.ok) throw new Error(`movement ${f.id}: ${r.error}`);
  console.log(`  cleared oversell #${f.id}`);
}

console.log("\n--- verifying ---");
let bad = 0;
for (const s of affected) {
  const lines = db
    .prepare(
      `SELECT p.id AS pid, p.name FROM sale_items i JOIN products p ON p.id = i.product_id
        WHERE i.sale_id = ? AND i.voided = 0 AND p.track_inventory = 1 AND p.condition <> 'used'`,
    )
    .all(s.id) as { pid: number; name: string }[];
  for (const l of lines) {
    const on = stockOnHand(l.pid);
    console.log(`  ${l.name.padEnd(34)} now ${on}`);
    if (on < 0) bad++;
  }
}

const drift = db
  .prepare(
    `SELECT COUNT(*) n FROM inventory_lots l
      WHERE l.qty_remaining <> COALESCE(
              (SELECT SUM(m.qty_delta) FROM inventory_movements m WHERE m.lot_id = l.id), 0)`,
  )
  .get() as { n: number };

console.log(`  lots whose cached stock disagrees with the ledger: ${drift.n}`);
console.log(bad === 0 ? "\nDone. Nothing left negative on these orders." : `\n!! ${bad} still negative.`);
