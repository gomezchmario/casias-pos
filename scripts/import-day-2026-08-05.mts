/**
 * The 5 August 2026 sales sheet, rung into the POS.
 *
 * This is the last day the shop kept its books in Excel and the first day they
 * exist here, so the two have to agree to the cent or the changeover is not
 * worth having. Every line is transcribed as the sheet has it — including the
 * five tips the sheet charged no commission on, and the two 2:27pm "MIX PAY"
 * halves that are really one customer. Those are both wrong by the shop's own
 * rules, and both are copied anyway: the card was charged what it was charged,
 * and a tidier number here would be a number no customer ever paid.
 *
 * IT TAKES BOTH SHEETS, and that is the one place it does not copy blindly. The
 * sales sheet could only record money received, so a deposit on a pair of tires
 * was written as the sale of one tire — two rows of it literally read "DEPOSIT"
 * where a tire's name belongs. The green pending sheet is where the other half
 * of those tickets lived: how many tires, at what price, and how much is still
 * owed. Rung from the sales sheet alone, eight customers who are waiting on
 * tires would go live owed nothing and appear nowhere, and the count for their
 * sizes would drop for tires the shop never had. So the pending rows are rung
 * as what they are — special orders, carrying the full order and whatever was
 * actually taken against it.
 *
 * The two totals therefore differ on purpose, and both are checked at the end:
 * the tickets sell 3818.00, and 3448.00 of it came through the till, the
 * 370.00 gap being deposits still standing. The sheet's own daily figure is the
 * second number.
 *
 * It goes through createSale/addItem/takePayment/completeSale rather than
 * INSERTing rows, which is the whole point. That way the day arrives with real
 * audit rows, real inventory movements, real oversell flags and a frozen total,
 * and looks from every screen exactly like a day somebody rang at the counter.
 *
 * DRY RUN unless given --commit. Ringing a day twice is a much worse problem
 * than ringing it zero times, and the second run has no way to tell it is the
 * second run.
 *
 *   node --experimental-strip-types scripts/import-day-2026-08-05.mts
 *   node --experimental-strip-types scripts/import-day-2026-08-05.mts --commit
 */
import { getDb } from "../src/lib/db.ts";
import { currentBusinessDate } from "../src/lib/business-date.ts";
import { createSale, addItem, completeSale, listSalesForDate } from "../src/lib/sales.ts";
import { listSpecialOrders } from "../src/lib/special-orders.ts";
import { takePayment, setPaymentSeq } from "../src/lib/payments.ts";
import { createProduct } from "../src/lib/products.ts";
import { attachToSale } from "../src/lib/customers.ts";
import { stockOnHand } from "../src/lib/inventory.ts";
import type { PosUser } from "../src/lib/pos-session.ts";

const COMMIT = process.argv.includes("--commit");
const DAY = "2026-08-05";

const MECH = { jerry: 6, franklin: 8, jose: 7 } as const;
const PM = { cash: 1, cc: 2, credit: 7 } as const;
const CAT = { new_tire: 1, used_tire: 2, other: 5 } as const;

type Mech = keyof typeof MECH;
type Method = keyof typeof PM;
type Cat = keyof typeof CAT;

/**
 * One row of the sheet.
 *
 * `sku` points the line at a catalogue product so the tire comes off the rack.
 * Service lines carry none, which is right — nothing physical moves when
 * somebody patches a flat.
 */
type Line = {
  at: string;
  desc: string;
  qty: number;
  unit: number;
  mech: Mech;
  tip?: number;
  comm?: number;
  method: Method;
  cat: Cat;
  sku?: string;
  po?: string;
  note?: string;
  /** Force the card SEQ to what the terminal batch actually printed. */
  seq?: string;
  /**
   * On the pending board: the tire is not here and has to be ordered in.
   *
   * Independent of the money, which is the whole point. Two of these are paid in
   * full and still outstanding — the customer has handed over everything they
   * owe and is waiting on a tire, which the sales sheet had no way to say and
   * the green sheet said in a different book.
   */
  special?: boolean;
  /**
   * What was actually taken at the counter, when that is less than the ticket.
   *
   * A deposit. The old sheet could only record money received, so a $140 down
   * payment on $280 of tires was written as a $140 sale of one tire — which is
   * why two rows of it read "DEPOSIT" where a tire name belongs, and why the
   * count for those sizes went down for tires the shop had never had.
   */
  paid?: number;
};

/**
 * The two tires this day sold that the price list has never heard of.
 *
 * Cost is left at zero because the sales sheet has no cost column and there is
 * nothing to copy. A guessed cost would be worse than none: it would show up as
 * a margin figure that looks researched, on a line nobody would think to
 * question. These want filling in from the supplier invoice.
 *
 * 20/1000-10 is a trailer size and is flagged specialised so it prints with the
 * other odd sizes rather than in the middle of the passenger racks.
 *
 * The Landsail is stored as 245-70-17, not LT245-70-17, because that is the
 * convention the shop's own list already uses — #202 is "VANTAGE LT HD
 * 245-75-17", with the load range in the model and not in the size. Storing the
 * LT in the size would open a second bucket for a rim that already has one, and
 * the inventory page groups by size.
 */
const NEW_PRODUCTS = [
  {
    sku: "20100010-DEESTO",
    tireSize: "20/1000-10",
    brand: "DEESTONE",
    model: null as string | null,
    // 150, not the 100 Jesus handed over. The pending sheet says he still owes
    // 50 on one tire, and one tire at 100 paid with 50 owing is a 150 tire.
    priceCents: 15000,
    specialized: true,
  },
  {
    sku: "2457017-LANDSALT",
    tireSize: "245-70-17",
    brand: "LANDSAIL",
    model: "LT",
    priceCents: 18000,
    specialized: false,
  },
  {
    // Carrillo's, from the 3rd. The list has a Toyo M/T in this size and an A/T
    // III in others, but not this one, so it is a real gap rather than a
    // near-miss to be filed under something close.
    sku: "35125017-TOYOOPENCOAT3",
    tireSize: "35-12.50-17",
    brand: "TOYO",
    model: "OPEN COUNTRY A/T III",
    priceCents: 45000,
    specialized: false,
  },
];

/**
 * The day, line for line, in the order it was rung.
 *
 * Tips and commission are the sheet's own numbers, not the shop's $1-per-$5
 * rule. Five of them disagree with it — $2, $3, $3, $4 and $2 tips charged
 * nothing, while an identical $4 tip two rows away was charged $1. That gap is
 * the "Tips Charge $12 vs Tips $51" discrepancy from the original plan, showing
 * up in a real day. It is copied, not corrected, because the terminal already
 * charged what it charged.
 */
const LINES: Line[] = [
  { at: "08:09:49", desc: "NEW 20/1000-10 DEESTONE", qty: 1, unit: 15000, paid: 10000, special: true, mech: "jerry", method: "cc", cat: "new_tire", sku: "20100010-DEESTO", po: "88428" },
  { at: "08:10:17", desc: "NEW 225/65/17 VANTAGE", qty: 1, unit: 12000, mech: "jerry", tip: 800, comm: 200, method: "cc", cat: "new_tire", sku: "2256517-VANTAGAS102H", po: "88429" },
  { at: "08:12:11", desc: "FLAT", qty: 1, unit: 1500, mech: "franklin", method: "cash", cat: "other" },
  { at: "09:02:22", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", tip: 400, comm: 100, method: "cc", cat: "other" },
  { at: "09:12:29", desc: "VALVE STEM", qty: 1, unit: 1500, mech: "franklin", tip: 400, comm: 100, method: "cc", cat: "other" },
  { at: "09:20:14", desc: "FLAT", qty: 1, unit: 1500, mech: "jerry", method: "cash", cat: "other" },
  { at: "09:31:32", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", tip: 400, comm: 100, method: "cc", cat: "other" },
  { at: "09:39:01", desc: "FLAT", qty: 1, unit: 1500, mech: "franklin", method: "cash", cat: "other" },
  { at: "09:43:19", desc: "AIR", qty: 1, unit: 500, mech: "franklin", method: "cc", cat: "other" },
  // Size taken from the owner: the sheet's "USED" row was left blank.
  { at: "09:49:02", desc: "USED 215-55-16", qty: 1, unit: 6500, mech: "jerry", tip: 200, comm: 0, method: "cc", cat: "used_tire", sku: "USED-215-55-16" },
  { at: "09:51:32", desc: "FLAT", qty: 1, unit: 1500, mech: "franklin", method: "cash", cat: "other" },
  { at: "10:17:26", desc: "FLAT", qty: 1, unit: 1500, mech: "franklin", method: "cash", cat: "other" },
  { at: "10:30:04", desc: "FLAT", qty: 1, unit: 1500, mech: "jerry", method: "cash", cat: "other" },
  { at: "10:42:45", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cc", cat: "other" },
  { at: "10:53:11", desc: "CHECK TIRE", qty: 1, unit: 1000, mech: "jerry", method: "cash", cat: "other" },
  { at: "11:04:33", desc: "MOUNT", qty: 1, unit: 3500, mech: "jerry", method: "cc", cat: "other" },
  { at: "11:25:11", desc: "AIR", qty: 1, unit: 500, mech: "jerry", method: "cash", cat: "other" },
  { at: "11:28:41", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other" },
  { at: "11:37:13", desc: "DISMOUNT", qty: 2, unit: 1000, mech: "jerry", method: "cash", cat: "other" },
  { at: "11:50:16", desc: "MOUNT & BALANCE", qty: 4, unit: 3500, mech: "franklin", method: "cc", cat: "other", seq: "12" },
  { at: "12:10:42", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cash", cat: "other" },
  { at: "12:18:04", desc: "AIR", qty: 1, unit: 500, mech: "jerry", method: "cash", cat: "other" },
  { at: "12:26:45", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cc", cat: "other" },
  { at: "12:43:59", desc: "NEW 245/40/20 VANTAGE", qty: 2, unit: 14000, paid: 14000, special: true, mech: "jerry", method: "cc", cat: "new_tire", sku: "2454020-VANTAGUHP", po: "88431", note: "DEPOSIT 140.00" },
  { at: "12:46:15", desc: "NEW 255/55/20 FORTUNE", qty: 2, unit: 18000, paid: 18000, special: true, mech: "franklin", method: "cc", cat: "new_tire", sku: "2555520-FORTUN", po: "88430", note: "DEPOSIT 180.00" },
  { at: "12:50:34", desc: "NEW 245/45/18 VANTAGE", qty: 4, unit: 11000, mech: "jerry", method: "cash", cat: "new_tire", sku: "2454518-VANTAGUHP100", po: "88432" },
  { at: "13:06:55", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cash", cat: "other" },
  { at: "13:12:36", desc: "AIR", qty: 1, unit: 500, mech: "franklin", method: "cc", cat: "other" },
  { at: "13:25:41", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other" },
  { at: "13:42:14", desc: "MOUNT", qty: 1, unit: 2000, mech: "jerry", method: "cc", cat: "other" },
  { at: "13:53:17", desc: "NEW 235/55/19 VANTAGE", qty: 1, unit: 14000, special: true, mech: "jerry", method: "cc", cat: "new_tire", sku: "2355519-VANTAGTOURIN", po: "88433" },
  { at: "14:10:29", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cash", cat: "other" },
  { at: "14:11:37", desc: "NEW 215/70/16 VANTAGE", qty: 1, unit: 12000, special: true, mech: "franklin", method: "cc", cat: "new_tire", sku: "2157016-VANTAGSUV", po: "88435" },
  { at: "14:26:01", desc: "NEW LT245/70/17 LANDSAIL", qty: 1, unit: 18000, special: true, mech: "jerry", method: "credit", cat: "new_tire", sku: "2457017-LANDSALT", po: "88434", note: "MUNDO VERDE" },
  { at: "14:27:01", desc: "FLAT MIX PAY", qty: 1, unit: 1000, mech: "franklin", tip: 300, comm: 0, method: "cc", cat: "other", note: "MIX PAY" },
  { at: "14:27:18", desc: "FLAT MIX PAY", qty: 1, unit: 600, mech: "franklin", method: "cash", cat: "other", note: "MIX PAY" },
  { at: "14:43:52", desc: "MOVE TIRE", qty: 1, unit: 1500, mech: "jerry", method: "cash", cat: "other" },
  { at: "15:10:50", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", tip: 1000, comm: 200, method: "cc", cat: "other" },
  { at: "15:21:04", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cc", cat: "other" },
  { at: "15:37:40", desc: "AIR", qty: 1, unit: 500, mech: "franklin", method: "cash", cat: "other" },
  { at: "15:54:50", desc: "PLUG", qty: 1, unit: 1500, mech: "franklin", tip: 800, comm: 200, method: "cc", cat: "other" },
  { at: "16:03:16", desc: "CHECK TIRE", qty: 1, unit: 1000, mech: "franklin", method: "cash", cat: "other" },
  { at: "16:11:44", desc: "NEW 235/65/16C FORTUNE", qty: 2, unit: 16000, mech: "franklin", tip: 800, comm: 200, method: "cc", cat: "new_tire", sku: "2356516-FORTUN10PLY", po: "88436" },
  { at: "16:13:15", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", tip: 300, comm: 0, method: "cc", cat: "other" },
  { at: "16:31:42", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other" },
  { at: "16:44:19", desc: "AIR", qty: 1, unit: 500, mech: "jerry", method: "cc", cat: "other" },
  { at: "16:57:13", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", method: "cc", cat: "other" },
  { at: "17:05:05", desc: "MOUNT & BALANCE", qty: 2, unit: 2500, mech: "jerry", method: "cc", cat: "other" },
  { at: "17:10:23", desc: "NEW LT245/75/17 VANTAGE", qty: 4, unit: 17000, special: true, mech: "jerry", method: "credit", cat: "new_tire", sku: "2457517-VANTAGLTHD", po: "88437", note: "MUNDO VERDE" },
  { at: "17:41:16", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", tip: 400, comm: 0, method: "cc", cat: "other" },
  { at: "17:42:31", desc: "FLAT", qty: 1, unit: 1600, mech: "franklin", method: "cc", cat: "other" },
  { at: "17:56:04", desc: "TPMS SENSORS", qty: 2, unit: 7500, mech: "franklin", tip: 800, comm: 200, method: "cc", cat: "other", po: "88438" },
  { at: "17:56:27", desc: "ROTATION", qty: 1, unit: 2000, mech: "franklin", method: "cc", cat: "other" },
  { at: "18:07:22", desc: "MOUNT & BALANCE", qty: 2, unit: 2500, mech: "jerry", tip: 400, comm: 100, method: "cc", cat: "other" },
  { at: "18:22:51", desc: "AIR", qty: 1, unit: 500, mech: "franklin", method: "cc", cat: "other" },
  { at: "18:27:40", desc: "FLAT", qty: 1, unit: 1600, mech: "jerry", tip: 200, comm: 0, method: "cc", cat: "other" },
];

/** Who each PO belongs to, off the pending sheet. */
const CUSTOMERS: Record<string, { name: string; phone: string; notes?: string }> = {
  "88411": { name: "Steve Carrillo", phone: "210-421-3006", notes: "CARRILLO" },
  "88428": { name: "Jesus", phone: "210-621-7734" },
  "88430": { name: "Homer", phone: "361-235-9345" },
  "88431": { name: "Sebastian", phone: "210-550-3969" },
  "88433": { name: "Michelle Borrego", phone: "210-915-3874" },
  "88434": { name: "Germain Baca", phone: "210-946-4673", notes: "MUNDO VERDE. LEFT RIM HERE." },
  "88435": { name: "Eric F", phone: "210-334-9688" },
  "88437": { name: "Alexander Lazano", phone: "210-818-9450", notes: "MUNDO VERDE" },
};

/**
 * Orders still open from before this day, which have to come across too.
 *
 * There is only one, and it is on the pending sheet rather than the sales sheet
 * because the 3rd's sales sheet is not being imported. Leaving it out would put
 * the board live missing a tire the shop owes somebody, which is the one thing
 * a pending board must never do.
 */
const PRIOR: (Line & { day: string })[] = [
  {
    day: "2026-08-03",
    at: "12:00:00",
    desc: "NEW LT35X12.50R17 TOYO OC AT3",
    qty: 2,
    unit: 45000,
    special: true,
    mech: "jose",
    method: "credit",
    cat: "new_tire",
    sku: "35125017-TOYOOPENCOAT3",
    po: "88411",
    note: "CARRILLO",
  },
];

// ---------------------------------------------------------------------------

const money = (c: number) => (c / 100).toFixed(2);
const db = getDb();

/** What the counter actually took on a line: the deposit, or the whole thing. */
const took = (l: Line) => l.paid ?? l.qty * l.unit;

// Two different numbers, and the reason the old books could not tell this day's
// story. `sold` is what the shop agreed to supply; `goods` is what came through
// the till. The sales sheet could only ever record the second, so a deposit on
// a pair of tires went in looking like the sale of one.
const sold = LINES.reduce((s, l) => s + l.qty * l.unit, 0);
const goods = LINES.reduce((s, l) => s + took(l), 0);
const tips = LINES.reduce((s, l) => s + (l.tip ?? 0), 0);
const comms = LINES.reduce((s, l) => s + (l.comm ?? 0), 0);
const collected = goods + tips + comms;

const byMethod = new Map<Method, number>();
for (const l of LINES)
  byMethod.set(l.method, (byMethod.get(l.method) ?? 0) + took(l) + (l.tip ?? 0) + (l.comm ?? 0));

console.log(`day     : ${DAY}`);
console.log(`mode    : ${COMMIT ? "COMMIT" : "DRY RUN (nothing will be written)"}`);
console.log(`lines   : ${LINES.length}  (+${PRIOR.length} carried over from earlier days)`);
console.log(`sold    : ${money(sold)}   value of goods on the tickets`);
console.log(`goods   : ${money(goods)}   collected for them, per the sales sheet`);
console.log(`tips    : ${money(tips)}`);
console.log(`comm    : ${money(comms)}`);
console.log(`total   : ${money(collected)}   through the till`);
console.log(`owed    : ${money(sold - goods)}   deposits left standing`);
console.log(
  `tender  : ${[...byMethod].map(([m, c]) => `${m} ${money(c)}`).join("  ·  ")}`,
);
console.log(`orders  : ${LINES.filter((l) => l.special).length + PRIOR.length} tickets go on the pending board`);

// The business date is not a parameter anywhere in the library -- it is read off
// the clock. If the clock has rolled past 4am this would file a whole day under
// the wrong date, silently, and the first sign would be an empty dashboard.
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

// --- what the tire lines will do to stock ------------------------------------

console.log("\ntire lines, and where they land:");
const missing: string[] = [];
for (const l of [...PRIOR, ...LINES].filter((x) => x.sku)) {
  const p = db
    .prepare("SELECT id, name, price_cents, condition FROM products WHERE sku = ? AND deleted = 0")
    .get(l.sku!) as { id: number; name: string; price_cents: number; condition: string } | undefined;
  if (!p) {
    const pending = NEW_PRODUCTS.find((n) => n.sku === l.sku);
    if (pending) {
      console.log(`   ${l.at}  ${l.desc.padEnd(30)} -> WILL CREATE ${l.sku}`);
      continue;
    }
    missing.push(`${l.at} ${l.desc}: no product with SKU ${l.sku}`);
    continue;
  }
  const on = stockOnHand(p.id);
  const short = Math.max(0, l.qty - on);
  const flag = l.special
    ? "  (on order — nothing leaves the rack)"
    : p.condition === "used"
      ? "  (used — floors at zero, no oversell)"
      : short > 0
        ? `  OVERSELL ${short}`
        : "";
  const priced =
    p.price_cents !== l.unit ? `  [list ${money(p.price_cents)}, sold ${money(l.unit)}]` : "";
  console.log(
    `   ${l.at}  ${l.desc.padEnd(30)} -> #${p.id} ${p.name.padEnd(34)} on hand ${String(on).padStart(3)}, need ${l.qty}${flag}${priced}`,
  );
}
if (missing.length) {
  console.log("\n!! unresolved products:");
  for (const m of missing) console.log("   " + m);
  process.exit(1);
}

console.log("\ncustomers to attach:");
for (const [po, c] of Object.entries(CUSTOMERS))
  console.log(`   PO ${po}  ${c.name.padEnd(20)} ${c.phone}${c.notes ? `  — ${c.notes}` : ""}`);

console.log("\nthe pending board, once this has run:");
for (const l of [...PRIOR, ...LINES].filter((x) => x.special)) {
  const c = l.po ? CUSTOMERS[l.po] : undefined;
  const owed = l.qty * l.unit - took(l);
  console.log(
    `   PO ${l.po}  ${(c?.name ?? "—").padEnd(18)} ${l.qty}× ${l.desc.replace(/^NEW /, "").padEnd(26)} ` +
      `${money(l.qty * l.unit).padStart(8)}  ${owed > 0 ? `owes ${money(owed)}` : "paid in full"}`,
  );
}

if (!COMMIT) {
  console.log("Dry run. Re-run with --commit to write this.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write.
// ---------------------------------------------------------------------------

/**
 * Attributed to the owner, because it has to be someone and it was him.
 *
 * Not cosmetic: copying the sheet's commission figures verbatim means overriding
 * the shop's own $1-per-$5 rule on five tickets, and `takePayment` only lets a
 * manager or above do that. An import that ran as a cashier would silently get
 * the computed number instead and quietly invent about five dollars.
 */
const owner = db
  .prepare("SELECT id, name FROM employees WHERE pos_role = 'owner' AND active = 1 ORDER BY id")
  .get() as { id: number; name: string } | undefined;
if (!owner) throw new Error("No active owner to attribute the import to");
const user: PosUser = { employeeId: owner.id, name: owner.name, role: "owner" };
console.log(`attributing to: ${owner.name} (owner)\n`);

for (const n of NEW_PRODUCTS) {
  const exists = db.prepare("SELECT id FROM products WHERE sku = ? AND deleted = 0").get(n.sku);
  if (exists) continue;
  const r = createProduct(user, {
    kind: "tire",
    condition: "new",
    sku: n.sku,
    tireSize: n.tireSize,
    brand: n.brand,
    model: n.model,
    priceCents: n.priceCents,
    defaultCostCents: 0,
    specialized: n.specialized,
  });
  if (!r.ok) throw new Error(`create ${n.sku}: ${r.error}`);
  console.log(`created product #${r.product.id} ${r.product.name}`);
}

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
 * Move a ticket back to when it was actually rung.
 *
 * The library reads the clock, and the clock says one in the morning on the
 * sixth. The business date lands right on its own — the day rolls at 4am, so it
 * is still the fifth — but a receipt reading 01:52 for a flat fixed at half past
 * eight is wrong on the face of it, and the day's tickets want to read in the
 * order the shop worked them.
 *
 * `audit_log.timestamp` is deliberately NOT moved. Those rows say when somebody
 * touched the system, and the honest answer is that all 57 arrived in one batch
 * at one in the morning. That is the one place a reader can find out this day
 * was imported rather than rung, and it should not be papered over.
 *
 * `business_date` moves with it for the one ticket that is not from this day.
 * It is the column every report groups on, so Carrillo's order landing under the
 * 5th would put 900.00 of tires into a day they were not sold in.
 */
function restamp(saleId: number, at: string, day = DAY) {
  const ts = `${day}T${at}`;
  db.prepare(
    `UPDATE sales SET business_date = ?, opened_at = ?, completed_at = ?,
                      created_at = ?, updated_at = ? WHERE id = ?`,
  ).run(day, ts, ts, ts, ts, saleId);
  db.prepare("UPDATE sale_items SET created_at = ?, updated_at = ? WHERE sale_id = ?").run(
    ts,
    ts,
    saleId,
  );
  db.prepare("UPDATE payments SET business_date = ?, created_at = ? WHERE sale_id = ?").run(
    day,
    ts,
    saleId,
  );
  db.prepare(
    "UPDATE inventory_movements SET business_date = ?, created_at = ? WHERE sale_id = ?",
  ).run(day, ts, saleId);
}

let n = 0;
const oversells: string[] = [];

function ring(l: Line, day = DAY) {
  // `isSpecialOrder` at creation, not marked on afterwards, and that ordering
  // is load-bearing: `completeSale` looks at it to decide whether to take the
  // tires off the rack. Set it late and the stock is already gone.
  const sale = createSale(user, { isSpecialOrder: l.special });
  if (!sale.ok) throw new Error(`${l.at} createSale: ${sale.error}`);
  const saleId = sale.sale.id;

  const item = addItem(user, saleId, {
    description: l.desc,
    qty: l.qty,
    unitPriceCents: l.unit,
    productId: l.sku ? skuToId.get(l.sku)! : null,
    categoryId: CAT[l.cat],
    mechanicId: MECH[l.mech],
  });
  if (!item.ok) throw new Error(`${l.at} addItem: ${item.error}`);

  // Only called when there is something to attach, and with `undefined` rather
  // than `null` for the fields this line has nothing to say about. The two are
  // not the same to `attachToSale`: a present-but-empty `po` counts as the
  // cashier having touched the panel, and the first run of this import passed
  // `po: null` on all 56 tickets and got 49 nameless customer records for it.
  const cust = l.po ? CUSTOMERS[l.po] : undefined;
  const notes = cust?.notes ?? l.note;
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
    mechanicId: MECH[l.mech],
    commCentsOverride: l.comm ?? 0,
  });
  if (!pay.ok) throw new Error(`${l.at} takePayment: ${pay.error}`);

  // The terminal's own number, where the sheet recorded one. Setting it here
  // rather than letting the run continue from 11 keeps every later charge lined
  // up with the batch, since `nextSeq` takes the highest so far and adds one.
  if (l.seq) {
    const s = setPaymentSeq(user, pay.payment.id, l.seq);
    if (!s.ok) throw new Error(`${l.at} setPaymentSeq: ${s.error}`);
  }

  const done = completeSale(user, saleId);
  if (!done.ok) throw new Error(`${l.at} completeSale: ${done.error}`);

  restamp(saleId, l.at, day);
  n++;
}

// Earlier days first, so the board reads in the order the orders were taken and
// the sale numbers do not have Carrillo's sitting after a day that followed it.
for (const l of PRIOR) ring(l, l.day);
for (const l of LINES) ring(l);

for (const row of db
  .prepare(
    `SELECT p.name, m.qty_delta, s.sale_no FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       JOIN sales s ON s.id = m.sale_id
      WHERE m.oversold = 1 AND m.business_date = ?`,
  )
  .all(DAY) as { name: string; qty_delta: number; sale_no: string }[])
  oversells.push(`   ${row.sale_no}  ${row.name}  ${row.qty_delta}`);

const check = db
  .prepare(
    `SELECT COUNT(*) tickets, SUM(subtotal_cents) goods, SUM(tip_cents) tips,
            SUM(comm_cents) comm, SUM(total_cents) total, SUM(paid_cents) paid,
            SUM(balance_cents) balance
       FROM sales WHERE business_date = ? AND deleted = 0`,
  )
  .get(DAY) as Record<string, number>;

console.log(`\nrang ${n} tickets.`);
console.log(`sold   ${money(check.goods)}   (sheet ${money(sold)})`);
console.log(`tips   ${money(check.tips)}   (sheet ${money(tips)})`);
console.log(`comm   ${money(check.comm)}   (sheet ${money(comms)})`);
console.log(`total  ${money(check.total)}   (sheet ${money(sold + tips + comms)})`);
console.log(`paid   ${money(check.paid)}   (sheet's own daily figure ${money(collected)})`);
console.log(`owed   ${money(check.balance)}   (deposits outstanding ${money(sold - goods)})`);

console.log("\npending board:");
for (const o of listSpecialOrders())
  console.log(
    `   ${o.saleNo}  ${(o.customerName ?? "—").padEnd(18)} ${o.what.padEnd(30)} ` +
      `${money(o.totalCents).padStart(8)}  ${o.balanceCents > 0 ? `owes ${money(o.balanceCents)}` : "paid in full"}`,
  );

if (oversells.length) {
  console.log(`\n${oversells.length} oversold lines — these are in the review queue:`);
  for (const o of oversells) console.log(o);
}

// Checked against `sold` and against `collected` separately, because they are
// two different claims and only one of them is the sales sheet's. The sheet
// totalled money through the till; the tickets total what was sold. They differ
// by exactly the deposits left standing, and if they differ by anything else
// something has gone wrong that a single combined check would hide.
const off =
  check.goods !== sold ||
  check.tips !== tips ||
  check.comm !== comms ||
  check.paid !== collected ||
  check.balance !== sold - goods;
console.log(
  off
    ? "\n!! DOES NOT MATCH THE SHEET — look before trusting this day."
    : "\nMatches the sheet to the cent: takings, tips, commission and deposits owing.",
);
