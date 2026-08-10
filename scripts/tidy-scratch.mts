/**
 * Clear the scratch left behind by building the thing.
 *
 * Three items, all of them made by us while testing rather than by the shop
 * while trading, all agreed with the owner before this was written:
 *
 *   S-2026-000060   an open $20 ticket with one FLAT line, never paid
 *   product 558     USED-55516,  a used size typed without separators
 *   product 559     USED-215516, the same slip again
 *
 * Product 557 (USED-215-55-16) is the real one and is deliberately untouched --
 * it is the same tire the other two were failed attempts at typing, and it is
 * the row the shop will actually sell against.
 *
 * It goes through voidSale and deleteProduct rather than UPDATE, which matters
 * more than it looks. Both write a before/after audit row inside the same
 * transaction as the change, so the log can answer "who removed this and why"
 * a year from now; a hand-written UPDATE would leave three rows that changed
 * themselves. Nothing is dropped either -- the ticket is voided and the
 * products are soft-deleted, because sale_items and movements point at them.
 *
 * Attributed to the owner because he is the one who authorised it, by name, on
 * 2026-08-06. Not to "system": no system decided this.
 *
 * DRY RUN unless given --commit.
 */

import { getDb } from "../src/lib/db.ts";
import { voidSale } from "../src/lib/payments.ts";
import { deleteProduct } from "../src/lib/products.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const commit = process.argv.includes("--commit");

const OWNER_ID = 4;
const SALE_NO = "S-2026-000060";
const JUNK_PRODUCT_IDS = [558, 559];
const REASON = "Scratch left from building the register, cleared before the shop went live";

const db = getDb();

const owner = db
  .prepare("SELECT id, name, pos_role FROM employees WHERE id = ? AND active = 1")
  .get(OWNER_ID) as { id: number; name: string; pos_role: string } | undefined;

if (!owner) throw new Error(`No active employee ${OWNER_ID} to attribute this to.`);
if (owner.pos_role !== "owner") throw new Error(`Employee ${OWNER_ID} is not the owner.`);

const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };

const sale = db
  .prepare("SELECT id, sale_no, status, total_cents, paid_cents FROM sales WHERE sale_no = ?")
  .get(SALE_NO) as
  | { id: number; sale_no: string; status: string; total_cents: number; paid_cents: number }
  | undefined;

if (!sale) throw new Error(`${SALE_NO} not found.`);

// Refuse to touch anything that took money. An open unpaid ticket is scratch;
// one with a payment against it is somebody's afternoon, and the fact that this
// script expected otherwise would mean it is pointed at the wrong row.
if (sale.paid_cents !== 0)
  throw new Error(`${SALE_NO} has ${sale.paid_cents} cents paid against it — not scratch. Stopping.`);

const products = db
  .prepare(
    `SELECT p.id, p.sku, p.tire_size, p.deleted,
            (SELECT COUNT(*) FROM sale_items         WHERE product_id = p.id) AS soldOn,
            (SELECT COUNT(*) FROM inventory_movements WHERE product_id = p.id) AS movements
       FROM products p
      WHERE p.id IN (${JUNK_PRODUCT_IDS.join(",")})`,
  )
  .all() as {
  id: number;
  sku: string;
  tire_size: string;
  deleted: number;
  soldOn: number;
  movements: number;
}[];

// Same rule as the ticket: a used size that has ever been sold or received is
// not a typo somebody left behind, whatever its name looks like.
for (const p of products) {
  if (p.soldOn > 0 || p.movements > 0)
    throw new Error(
      `Product ${p.id} (${p.sku}) has ${p.soldOn} sale lines and ${p.movements} movements — not scratch. Stopping.`,
    );
}

console.log(commit ? "=== COMMIT ===" : "=== DRY RUN (pass --commit to apply) ===");
console.log(`Acting as ${owner.name} (#${owner.id}, ${owner.pos_role})\n`);

console.log(`Ticket ${sale.sale_no}: ${sale.status}, ${sale.total_cents}c total, ${sale.paid_cents}c paid`);
console.log("  -> void");
for (const p of products) {
  console.log(`Product #${p.id} ${p.sku} (${p.tire_size}): deleted=${p.deleted}, 0 sales, 0 movements`);
  console.log("  -> soft delete");
}

if (!commit) {
  console.log("\nNothing written.");
  process.exit(0);
}

const voided = voidSale(user, sale.id, REASON);
if (!voided.ok) throw new Error(`Void failed: ${voided.error}`);
console.log(`\nVoided ${sale.sale_no}`);

for (const p of products) {
  const res = deleteProduct(user, p.id, REASON);
  if (!res.ok) throw new Error(`Delete of ${p.id} failed: ${res.error}`);
  console.log(`Deleted #${p.id} ${p.sku}`);
}

console.log("\nDone.");
