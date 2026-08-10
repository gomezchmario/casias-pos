/**
 * The 6 August 2026 sales sheet, rung into the POS.
 *
 * The shop tried to work the register live on this day, could not get it to
 * behave, and went back to the Excel sheet by mid-afternoon. Everything they
 * entered was cleared first (see `clear-day-2026-08-06.mts`); this is the day as
 * the sheet actually recorded it.
 *
 * Same shape as the 5 August import, and for the same reason: it goes through
 * createSale/addItem/takePayment/completeSale rather than INSERTing rows, so the
 * day arrives with real audit rows, real inventory movements, real oversell
 * flags and a frozen total, and reads from every screen like a day somebody rang
 * at the counter.
 *
 * FOUR THINGS ARE NOT COPIED LITERALLY, all agreed with the owner first:
 *
 *   1. The 12:03 VANTAGE and the 1:20 FORTUNE are not sales. They carry "po
 *      8431" and "po 8430", and yesterday's board has orders 88431 (Sebastian,
 *      2x 245/40/20 VANTAGE) and 88430 (Homer, 2x 255/55/20 FORTUNE) sitting at
 *      exactly 140.00 and 180.00 owing -- the same tire, the same size, the same
 *      brand, and the same amount to the cent. They are the second halves of
 *      yesterday's deposits. Rung as new sales they would book 320.00 of tires
 *      that were sold yesterday, and leave two customers on the pending board
 *      owing money they have already handed over. They are taken as payments
 *      against the original tickets instead, and both orders are then marked
 *      delivered: paid in full and collected.
 *
 *      The leading 8 is yesterday's transcription, not the shop's: today's other
 *      references run 8439-8445, straight on from yesterday's 8428-8438.
 *
 *   2. The 9:35 Landsail is a 280.00 order with 50.00 taken, not a 50.00 sale.
 *      The sheet could only record money received, so the note carries the rest
 *      -- "owes 230 ordered outstanding". Rung from the money column alone it
 *      would go live owed nothing and appear on no board. It is sold above the
 *      catalogue's 250.00; that price was set during yesterday's mess and is
 *      left alone here rather than quietly rewritten from one ticket.
 *
 *   3. The 1:45pm line has "-" where a description belongs. Four at 25.00, with
 *      four disposal fees rung a minute later, which the owner reads as four
 *      mount and balances.
 *
 *   4. The last two lines are filed under "Other Service" on the sheet and are
 *      plainly tires -- a 215-55-17 VANTAGE A/S 94V and a 245-45-20 VANTAGE UHP
 *      103W, both by name and size. Rung as new tires so the rack is right and
 *      270.00 of tire sales do not report as labour.
 *
 * Where the sheet named no brand, the size and price left two or three
 * candidates and stock settled it: 245/45/20 at 150.00 is #406 VANTAGE UHP 103W
 * (three on hand, three sold today) and 205/55/R16 at 110.00 is #79 VANTAGE A/S
 * 91V (four on hand, three sold). The alternatives at those sizes carry the same
 * price and no stock.
 *
 * Four lines name "Other" as the technician. Nobody on staff is called Other, so
 * they are rung with no mechanic at all rather than credited to somebody who may
 * not have done the work.
 *
 * DRY RUN unless given --commit. Ringing a day twice is a much worse problem
 * than ringing it zero times, and the second run has no way to tell it is the
 * second run.
 */
import { getDb } from "../src/lib/db.ts";
import { currentBusinessDate } from "../src/lib/business-date.ts";
import { createSale, addItem, completeSale, listSalesForDate } from "../src/lib/sales.ts";
import { listSpecialOrders, setFulfillment } from "../src/lib/special-orders.ts";
import { takePayment, setPaymentSeq } from "../src/lib/payments.ts";
import { attachToSale } from "../src/lib/customers.ts";
import { stockOnHand } from "../src/lib/inventory.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const COMMIT = process.argv.includes("--commit");
const DAY = "2026-08-06";

const MECH = { jerry: 6, franklin: 8, kevin: 20, nelson: 10 } as const;
const PM = { cash: 1, cc: 2, credit: 7 } as const;
const CAT = { new_tire: 1, used_tire: 2, disposal: 4, other: 5 } as const;

type Mech = keyof typeof MECH;
type Method = keyof typeof PM;
type Cat = keyof typeof CAT;

type Line = {
  at: string;
  desc: string;
  qty: number;
  unit: number;
  /** Absent where the sheet said "Other" -- see the header. */
  mech?: Mech;
  tip?: number;
  comm?: number;
  method: Method;
  cat: Cat;
  sku?: string;
  po?: string;
  note?: string;
  seq?: string;
  special?: boolean;
  /** What was actually taken, when that is less than the ticket. A deposit. */
  paid?: number;
};

/** Money taken today against a ticket rung on an earlier day. See the header. */
type PriorPayment = {
  at: string;
  saleNo: string;
  amount: number;
  mech: Mech;
  method: Method;
  seq?: string;
  /** Paid off and picked up, so it comes off the pending board. */
  deliver?: boolean;
  note: string;
};

const LINES: Line[] = [
  { at: "09:09:42", desc: "NEW 245/45/20", qty: 1, unit: 15000, mech: "kevin", method: "credit", cat: "new_tire", sku: "2454520-VANTAGUHP103", po: "8442", note: "INV 8442 CREDITO WILLIAMS INSULLATION" },
  { at: "09:17:35", desc: "CHECK TIRE", qty: 1, unit: 500, mech: "jerry", method: "cash", cat: "other" },
  { at: "09:21:29", desc: "MOUNT", qty: 1, unit: 1500, method: "cc", cat: "other", seq: "2" },
  { at: "09:22:13", desc: "CHECK TIRE", qty: 1, unit: 500, method: "cc", cat: "other", seq: "1" },
  { at: "09:25:29", desc: "FLAT", qty: 2, unit: 1600, mech: "franklin", method: "cc", cat: "other", seq: "3" },
  { at: "09:35:22", desc: "NEW 245/70/19.5 LANDSAIL", qty: 1, unit: 28000, paid: 5000, special: true, mech: "jerry", method: "cc", cat: "new_tire", sku: "24570195-LANDSA", po: "8439", note: "owes 230 ordered outstanding" },
  { at: "09:56:37", desc: "FLAT", qty: 1, unit: 1500, mech: "franklin", method: "cash", cat: "other" },
  { at: "09:57:38", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", tip: 1400, comm: 300, method: "cc", cat: "other", seq: "7" },
  { at: "10:02:23", desc: "NEW 205/75/15 TRANSEAGLE 10 PLY", qty: 3, unit: 12000, mech: "kevin", method: "cc", cat: "new_tire", sku: "2057515-TRANSESTRADI-2", po: "8440", seq: "5", note: "INV 8440" },
  { at: "10:03:54", desc: "NEW 245/45/20", qty: 1, unit: 15000, mech: "jerry", method: "cc", cat: "new_tire", sku: "2454520-VANTAGUHP103", po: "8441" },
  { at: "10:05:31", desc: "FLAT", qty: 1, unit: 1600, method: "cc", cat: "other", seq: "8" },
  { at: "10:08:46", desc: "MOUNT & BALANCE", qty: 1, unit: 6000, mech: "jerry", method: "cc", cat: "other", seq: "9" },
  { at: "10:17:55", desc: "NEW 215/65/R16", qty: 1, unit: 11000, mech: "kevin", method: "cc", cat: "new_tire", sku: "2156516-VANTAGAS", seq: "10", note: "INV" },
  { at: "10:22:56", desc: "FLAT and rotation", qty: 1, unit: 4600, mech: "nelson", method: "cc", cat: "other", seq: "11" },
  { at: "10:25:23", desc: "FLAT", qty: 1, unit: 1600, mech: "kevin", method: "cc", cat: "other", seq: "12" },
  { at: "10:25:52", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cc", cat: "other", seq: "13" },
  { at: "10:41:23", desc: "FLAT", qty: 1, unit: 1600, mech: "kevin", method: "cc", cat: "other", seq: "14" },
  { at: "10:55:21", desc: "NEW 205/55/R16", qty: 2, unit: 11000, mech: "jerry", method: "cash", cat: "new_tire", sku: "2055516-VANTAGAS91V", po: "8444" },
  { at: "10:56:33", desc: "NEW 225/60/R17", qty: 1, unit: 12000, mech: "jerry", method: "cc", cat: "new_tire", sku: "2256017-VANTAGAS", po: "8443", seq: "15", note: "INV 8443" },
  { at: "11:13:29", desc: "NEW 225/65/17 VANTAGE", qty: 1, unit: 12000, mech: "kevin", method: "cc", cat: "new_tire", sku: "2256517-VANTAGAS102H", seq: "16" },
  { at: "11:26:56", desc: "CHECK TIRE", qty: 1, unit: 500, mech: "jerry", method: "cc", cat: "other", seq: "17" },
  { at: "11:30:41", desc: "FLAT", qty: 1, unit: 1500, mech: "kevin", method: "cash", cat: "other" },
  { at: "11:38:45", desc: "CHECK TIRE", qty: 1, unit: 500, mech: "franklin", method: "cash", cat: "other" },
  { at: "11:42:32", desc: "FLAT", qty: 1, unit: 1500, mech: "kevin", method: "cash", cat: "other" },
  { at: "11:44:57", desc: "MOUNT & BALANCE", qty: 1, unit: 3000, mech: "jerry", method: "cash", cat: "other" },
  { at: "12:15:56", desc: "MOUNT & BALANCE", qty: 4, unit: 1500, mech: "franklin", method: "cc", cat: "other", seq: "19" },
  { at: "12:33:01", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", tip: 500, comm: 100, method: "cc", cat: "other", seq: "20" },
  { at: "12:46:00", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other", seq: "21" },
  { at: "12:47:45", desc: "FLAT", qty: 1, unit: 1600, method: "cc", cat: "other" },
  { at: "12:56:59", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other", seq: "23" },
  { at: "12:58:22", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cc", cat: "other", seq: "24" },
  { at: "13:13:43", desc: "CHECK TIRE", qty: 1, unit: 500, mech: "kevin", method: "cc", cat: "other", seq: "26" },
  // The sheet's "-", read as four mount and balances -- see the header.
  { at: "13:45:30", desc: "MOUNT & BALANCE", qty: 4, unit: 2500, mech: "jerry", method: "cc", cat: "other" },
  { at: "13:46:15", desc: "Disposal Fee", qty: 4, unit: 500, mech: "jerry", method: "cc", cat: "disposal" },
  { at: "13:50:48", desc: "MOUNT & BALANCE", qty: 1, unit: 1700, mech: "jerry", tip: 200, comm: 100, method: "cash", cat: "other" },
  { at: "14:01:57", desc: "NEW 205/55/R16", qty: 1, unit: 11000, mech: "jerry", method: "cc", cat: "new_tire", sku: "2055516-VANTAGAS91V", po: "8445", seq: "29" },
  { at: "14:07:18", desc: "FLAT", qty: 1, unit: 1600, mech: "kevin", method: "cc", cat: "other", seq: "30" },
  { at: "14:20:32", desc: "MOUNT & BALANCE", qty: 1, unit: 3000, mech: "kevin", tip: 1000, comm: 200, method: "cc", cat: "other", seq: "31" },
  { at: "14:26:16", desc: "CHECK TIRE", qty: 1, unit: 500, mech: "kevin", method: "cash", cat: "other" },
  { at: "14:39:26", desc: "FLAT", qty: 1, unit: 1600, mech: "kevin", method: "cc", cat: "other", seq: "32" },
  { at: "14:43:55", desc: "CHECK TIRE", qty: 1, unit: 500, mech: "kevin", method: "cash", cat: "other" },
  { at: "14:45:48", desc: "MOUNT & BALANCE", qty: 2, unit: 3000, mech: "franklin", method: "cc", cat: "other", seq: "33" },
  { at: "15:19:11", desc: "FLAT", qty: 1, unit: 1500, mech: "kevin", method: "cash", cat: "other" },
  { at: "15:34:12", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other", seq: "34" },
  { at: "15:48:23", desc: "NEW 215/55/17 VANTAGE A/S 94V", qty: 1, unit: 12000, mech: "kevin", method: "cc", cat: "new_tire", sku: "2155517-VANTAGAS94V", seq: "35" },
  { at: "15:51:45", desc: "NEW 245/45/20 VANTAGE UHP 103W", qty: 1, unit: 15000, mech: "kevin", method: "cc", cat: "new_tire", sku: "2454520-VANTAGUHP103", seq: "36" },
];

const PRIOR_PAYMENTS: PriorPayment[] = [
  { at: "12:03:37", saleNo: "S-2026-000025", amount: 14000, mech: "jerry", method: "cc", seq: "18", deliver: true, note: "Balance on PO 8431, paid in full" },
  { at: "13:20:00", saleNo: "S-2026-000026", amount: 18000, mech: "kevin", method: "cc", seq: "28", deliver: true, note: "Balance on PO 8430, paid in full" },
];

/** Who a reference belongs to, where the sheet says. */
const CUSTOMERS: Record<string, { name: string; phone?: string; notes?: string }> = {
  "8442": { name: "Williams Insullation", notes: "CREDITO" },
};

// ---------------------------------------------------------------------------

const money = (c: number) => (c / 100).toFixed(2);
const db = getDb();

const took = (l: Line) => l.paid ?? l.qty * l.unit;

const sold = LINES.reduce((s, l) => s + l.qty * l.unit, 0);
const goods = LINES.reduce((s, l) => s + took(l), 0);
const tips = LINES.reduce((s, l) => s + (l.tip ?? 0), 0);
const comms = LINES.reduce((s, l) => s + (l.comm ?? 0), 0);
const priorCash = PRIOR_PAYMENTS.reduce((s, p) => s + p.amount, 0);
const collected = goods + tips + comms;

const byMethod = new Map<Method, number>();
for (const l of LINES)
  byMethod.set(l.method, (byMethod.get(l.method) ?? 0) + took(l) + (l.tip ?? 0) + (l.comm ?? 0));
for (const p of PRIOR_PAYMENTS)
  byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);

console.log(`day     : ${DAY}`);
console.log(`mode    : ${COMMIT ? "COMMIT" : "DRY RUN (nothing will be written)"}`);
console.log(`lines   : ${LINES.length} new tickets  (+${PRIOR_PAYMENTS.length} payments on earlier orders)`);
console.log(`sold    : ${money(sold)}   value of goods on today's tickets`);
console.log(`goods   : ${money(goods)}   collected for them`);
console.log(`tips    : ${money(tips)}`);
console.log(`comm    : ${money(comms)}`);
console.log(`prior   : ${money(priorCash)}   collected on earlier days' orders`);
console.log(`till    : ${money(collected + priorCash)}   through the till today`);
console.log(`owed    : ${money(sold - goods)}   deposits left standing`);
console.log(`tender  : ${[...byMethod].map(([m, c]) => `${m} ${money(c)}`).join("  ·  ")}`);

// The sheet's own grand-total column, which is the number to check against.
console.log(`\nthe sheet totals ${money(collected + priorCash)} across its 48 rows.`);

const today = currentBusinessDate();
if (today !== DAY) {
  console.log(
    `\n!! The current business date is ${today}, not ${DAY}.\n` +
      `   Everything below would be filed under ${today}. Stopping.`,
  );
  process.exit(1);
}

const already = listSalesForDate(DAY);
if (already.length > 0) {
  console.log(`\n!! ${DAY} already has ${already.length} tickets. Stopping rather than doubling it.`);
  process.exit(1);
}

// --- the earlier orders being paid off ---------------------------------------

console.log("\npayments on earlier orders:");
const priorIds = new Map<string, number>();
for (const p of PRIOR_PAYMENTS) {
  const s = db
    .prepare(
      `SELECT s.id, s.sale_no, s.po, s.total_cents, s.paid_cents, s.balance_cents, c.name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.sale_no = ? AND s.deleted = 0`,
    )
    .get(p.saleNo) as
    | { id: number; sale_no: string; po: string | null; total_cents: number; paid_cents: number; balance_cents: number; name: string | null }
    | undefined;
  if (!s) {
    console.log(`   !! ${p.saleNo} not found. Stopping.`);
    process.exit(1);
  }
  // The whole justification for treating these as payments is that the amount
  // equals the balance. If it does not, the match is wrong and ringing it would
  // quietly leave a part-paid order looking settled.
  if (s.balance_cents !== p.amount) {
    console.log(
      `   !! ${p.saleNo} owes ${money(s.balance_cents)} but the sheet paid ${money(p.amount)}. Stopping.`,
    );
    process.exit(1);
  }
  priorIds.set(p.saleNo, s.id);
  console.log(
    `   ${p.at}  ${s.sale_no}  PO ${s.po}  ${(s.name ?? "—").padEnd(16)} ` +
      `owes ${money(s.balance_cents).padStart(8)} -> pays ${money(p.amount).padStart(8)} -> 0.00${p.deliver ? "  (delivered)" : ""}`,
  );
}

// --- what the tire lines will do to stock ------------------------------------

console.log("\ntire lines, and where they land:");
const missing: string[] = [];
const need = new Map<string, number>();
for (const l of LINES.filter((x) => x.sku && !x.special)) need.set(l.sku!, (need.get(l.sku!) ?? 0) + l.qty);

for (const l of LINES.filter((x) => x.sku)) {
  const p = db
    .prepare("SELECT id, name, price_cents, condition FROM products WHERE sku = ? AND deleted = 0")
    .get(l.sku!) as { id: number; name: string; price_cents: number; condition: string } | undefined;
  if (!p) {
    missing.push(`${l.at} ${l.desc}: no product with SKU ${l.sku}`);
    continue;
  }
  const on = stockOnHand(p.id);
  const flag = l.special ? "  (on order — nothing leaves the rack)" : "";
  const priced =
    p.price_cents !== l.unit ? `  [list ${money(p.price_cents)}, sold ${money(l.unit)}]` : "";
  console.log(
    `   ${l.at}  ${l.desc.padEnd(32)} -> #${p.id} ${p.name.padEnd(32)} on hand ${String(on).padStart(3)}, need ${l.qty}${flag}${priced}`,
  );
}
if (missing.length) {
  console.log("\n!! unresolved products:");
  for (const m of missing) console.log("   " + m);
  process.exit(1);
}

console.log("\nstock after the day, for the sizes it touches:");
for (const [sku, qty] of need) {
  const p = db.prepare("SELECT id, name FROM products WHERE sku = ? AND deleted = 0").get(sku) as {
    id: number;
    name: string;
  };
  const on = stockOnHand(p.id);
  const after = on - qty;
  console.log(
    `   ${p.name.padEnd(36)} ${String(on).padStart(3)} - ${qty} = ${String(after).padStart(3)}` +
      (after < 0 ? `   OVERSELL ${-after}` : ""),
  );
}

if (!COMMIT) {
  console.log("\nDry run. Re-run with --commit to write this.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write.
// ---------------------------------------------------------------------------

const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute the import to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };
console.log(`\nattributing to: ${owner.name} (owner)\n`);

const skuToId = new Map<string, number>();
for (const l of LINES) {
  if (!l.sku || skuToId.has(l.sku)) continue;
  const p = db.prepare("SELECT id FROM products WHERE sku = ? AND deleted = 0").get(l.sku) as
    | { id: number }
    | undefined;
  if (!p) throw new Error(`No product for SKU ${l.sku}`);
  skuToId.set(l.sku, p.id);
}

/**
 * Move a ticket back to when it was actually rung. See the 5 August import for
 * why `audit_log.timestamp` is deliberately left alone.
 */
function restamp(saleId: number, at: string) {
  const ts = `${DAY}T${at}`;
  db.prepare(
    `UPDATE sales SET business_date = ?, opened_at = ?, completed_at = ?,
                      created_at = ?, updated_at = ? WHERE id = ?`,
  ).run(DAY, ts, ts, ts, ts, saleId);
  db.prepare("UPDATE sale_items SET created_at = ?, updated_at = ? WHERE sale_id = ?").run(ts, ts, saleId);
  db.prepare("UPDATE payments SET business_date = ?, created_at = ? WHERE sale_id = ?").run(DAY, ts, saleId);
  db.prepare("UPDATE inventory_movements SET business_date = ?, created_at = ? WHERE sale_id = ?").run(
    DAY,
    ts,
    saleId,
  );
}

let n = 0;

function ring(l: Line) {
  const sale = createSale(user, { isSpecialOrder: l.special });
  if (!sale.ok) throw new Error(`${l.at} createSale: ${sale.error}`);
  const saleId = sale.sale.id;

  const item = addItem(user, saleId, {
    description: l.desc,
    qty: l.qty,
    unitPriceCents: l.unit,
    productId: l.sku ? skuToId.get(l.sku)! : null,
    categoryId: CAT[l.cat],
    mechanicId: l.mech ? MECH[l.mech] : null,
  });
  if (!item.ok) throw new Error(`${l.at} addItem: ${item.error}`);

  const cust = l.po ? CUSTOMERS[l.po] : undefined;
  const notes = cust?.notes ? `${cust.notes}${l.note ? ` — ${l.note}` : ""}` : l.note;
  if (cust || l.po || notes) {
    const details = attachToSale(user, saleId, {
      name: cust?.name,
      phone: cust?.phone,
      po: l.po,
      notes,
    });
    if (!details.ok) throw new Error(`${l.at} attachToSale: ${details.error}`);
  }

  const pay = takePayment(user, saleId, {
    methodId: PM[l.method],
    amountCents: took(l) + (l.tip ?? 0) + (l.comm ?? 0),
    tipCents: l.tip ?? 0,
    mechanicId: l.mech ? MECH[l.mech] : null,
    commCentsOverride: l.comm ?? 0,
  });
  if (!pay.ok) throw new Error(`${l.at} takePayment: ${pay.error}`);

  if (l.seq) {
    const s = setPaymentSeq(user, pay.payment.id, l.seq);
    if (!s.ok) throw new Error(`${l.at} setPaymentSeq: ${s.error}`);
  }

  const done = completeSale(user, saleId);
  if (!done.ok) throw new Error(`${l.at} completeSale: ${done.error}`);

  restamp(saleId, l.at);
  n++;
}

/**
 * Money in today against a ticket from an earlier day.
 *
 * Only the payment is restamped, never the sale: the ticket belongs to the day
 * it was rung, and moving it would take yesterday's tire sale into today's
 * figures -- exactly the double-count this whole treatment exists to avoid.
 */
function payOff(p: PriorPayment) {
  const saleId = priorIds.get(p.saleNo)!;
  const pay = takePayment(user, saleId, {
    methodId: PM[p.method],
    amountCents: p.amount,
    mechanicId: MECH[p.mech],
    note: p.note,
  });
  if (!pay.ok) throw new Error(`${p.at} takePayment on ${p.saleNo}: ${pay.error}`);

  if (p.seq) {
    const s = setPaymentSeq(user, pay.payment.id, p.seq);
    if (!s.ok) throw new Error(`${p.at} setPaymentSeq: ${s.error}`);
  }

  db.prepare("UPDATE payments SET business_date = ?, created_at = ? WHERE id = ?").run(
    DAY,
    `${DAY}T${p.at}`,
    pay.payment.id,
  );

  if (p.deliver) {
    const f = setFulfillment(user, saleId, "delivered");
    if (!f.ok) throw new Error(`${p.at} setFulfillment on ${p.saleNo}: ${f.error}`);
  }
  console.log(`   ${p.saleNo}  paid ${money(p.amount)}${p.deliver ? ", delivered" : ""}`);
}

for (const l of LINES) ring(l);
console.log("\npaying off earlier orders:");
for (const p of PRIOR_PAYMENTS) payOff(p);

// --- check ------------------------------------------------------------------

const check = db
  .prepare(
    `SELECT COUNT(*) tickets, SUM(subtotal_cents) goods, SUM(tip_cents) tips,
            SUM(comm_cents) comm, SUM(total_cents) total, SUM(paid_cents) paid,
            SUM(balance_cents) balance
       FROM sales WHERE business_date = ? AND deleted = 0`,
  )
  .get(DAY) as Record<string, number>;

const tillToday = db
  .prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) n FROM payments WHERE business_date = ?",
  )
  .get(DAY) as { n: number };

console.log(`\nrang ${n} tickets.`);
console.log(`sold   ${money(check.goods)}   (sheet ${money(sold)})`);
console.log(`tips   ${money(check.tips)}   (sheet ${money(tips)})`);
console.log(`comm   ${money(check.comm)}   (sheet ${money(comms)})`);
console.log(`paid   ${money(check.paid)}   (on today's tickets ${money(collected)})`);
console.log(`owed   ${money(check.balance)}   (deposits outstanding ${money(sold - goods)})`);
console.log(`till   ${money(tillToday.n)}   (the sheet's own total ${money(collected + priorCash)})`);

console.log("\npending board:");
for (const o of listSpecialOrders())
  console.log(
    `   ${o.saleNo}  ${(o.customerName ?? "—").padEnd(18)} ${o.what.padEnd(30)} ` +
      `${money(o.totalCents).padStart(8)}  ${o.balanceCents > 0 ? `owes ${money(o.balanceCents)}` : "paid in full"}`,
  );

const oversells = db
  .prepare(
    `SELECT p.name, m.qty_delta, s.sale_no FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       JOIN sales s ON s.id = m.sale_id
      WHERE m.oversold = 1 AND m.business_date = ?`,
  )
  .all(DAY) as { name: string; qty_delta: number; sale_no: string }[];
if (oversells.length) {
  console.log(`\n${oversells.length} oversold lines — these are in the review queue:`);
  for (const o of oversells) console.log(`   ${o.sale_no}  ${o.name}  ${o.qty_delta}`);
}

const off =
  check.goods !== sold ||
  check.tips !== tips ||
  check.comm !== comms ||
  check.paid !== collected ||
  check.balance !== sold - goods ||
  tillToday.n !== collected + priorCash;
console.log(
  off
    ? "\n!! DOES NOT MATCH THE SHEET — look before trusting this day."
    : "\nMatches the sheet to the cent: takings, tips, commission, deposits owing, and the till.",
);
