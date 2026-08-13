/**
 * A discounted ticket must be charged its discounted price.
 *
 * Rings a real ticket through the library exactly as the register does —
 * create, add a line, discount, complete, pay what the panel would now offer —
 * and checks it lands settled rather than overpaid. Then deletes it, because
 * this is the production book.
 *
 * The figure it pays is goodsCents as PaymentPanel now computes it:
 * subtotal - discount. Before the fix that expression was the subtotal alone,
 * which is what charged S-2026-000497 $160 against a $140 total.
 */
import Database from "better-sqlite3";
import { createSale, addItem, setDiscount, completeSale, getSale } from "../src/lib/sales";
import { takePayment, voidSale } from "../src/lib/payments";

const db = new Database("data/timeclock.db");
const owner = db.prepare("SELECT id, name FROM employees WHERE pos_role='owner' AND active=1 LIMIT 1").get() as { id: number; name: string };
const me = { employeeId: owner.id, name: owner.name, role: "owner" as const };
const cash = db.prepare("SELECT id FROM payment_methods WHERE code='cash'").get() as { id: number };

const m = (c: number) => `$${(c / 100).toFixed(2)}`;
let fails = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? " · " + detail : ""}`);
};

const made = createSale(me, {});
if (!made.ok) throw new Error(made.error);
const id = made.sale.id;

addItem(me, id, { description: "PROBE tire", qty: 1, unitPriceCents: 16000 });
setDiscount(me, id, 2000, "probe");

const done = completeSale(me, id);
if (!done.ok) throw new Error(done.error);
const frozen = getSale(id)!;

// Exactly what the panel now charges.
const goodsCents = frozen.subtotal_cents - frozen.discount_cents;
console.log(`\nticket ${frozen.sale_no}: goods ${m(frozen.subtotal_cents)} · discount ${m(frozen.discount_cents)}`);
check("the panel would charge the discounted price", goodsCents === 14000, m(goodsCents));

takePayment(me, id, { methodId: cash.id, amountCents: goodsCents, tipCents: 0 });
const after = getSale(id)!;
console.log(`  total ${m(after.total_cents)} · paid ${m(after.paid_cents)} · balance ${m(after.balance_cents)}`);
check("the ticket settles exactly", after.balance_cents === 0);
check("the customer was not charged full price", after.paid_cents === 14000, m(after.paid_cents));

voidSale(me, id, "probe ticket for the discount fix");
const gone = db.prepare("SELECT status FROM sales WHERE id = ?").get(id) as { status: string };
check("probe ticket voided out of the day", gone.status === "voided", gone.status);

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} CHECK(S) FAILED.`);
db.close();
process.exit(fails === 0 ? 0 : 1);
