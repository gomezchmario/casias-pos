/* Read-only: Close-out V2's figures against independent SQL, one pass. */
import { getDb } from "../src/lib/db";
import { closeoutV2 } from "../src/lib/day-report";
import { formatCents } from "../src/lib/money";

const DATE = process.argv[2] ?? "2026-08-11";
const db = getDb();
const r = closeoutV2(DATE);
const m = formatCents;
let bad = 0;
const check = (name: string, got: number, want: number) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(34)} report ${m(got).padStart(11)}  sql ${m(want).padStart(11)}`);
};
const checkN = (name: string, got: number, want: number) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(34)} report ${String(got).padStart(11)}  sql ${String(want).padStart(11)}`);
};

const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as [])) as T;

// Money
const goods = one<{ n: number }>(
  `SELECT COALESCE(SUM(subtotal_cents - discount_cents),0) n FROM sales
    WHERE deleted=0 AND status='completed' AND kind='sale' AND business_date=?`, DATE);
check("goods", r.totals.goodsCents, goods.n);

const collected = one<{ n: number }>(
  `SELECT COALESCE(SUM(p.amount_cents),0) n FROM payments p
     JOIN sales s ON s.id=p.sale_id
    WHERE s.deleted=0 AND s.kind='sale' AND p.business_date=?`, DATE);
check("collected", r.totals.collectedCents, collected.n);
check("tenders sum to collected",
  r.tenders.reduce((n, t) => n + t.takingsCents, 0), collected.n);

// Drawer
const flt = one<{ n: number }>(
  "SELECT COALESCE(SUM(opening_float_cents),0) n FROM shifts WHERE business_date=?", DATE);
const mov = one<{ n: number }>(
  "SELECT COALESCE(SUM(amount_cents),0) n FROM drawer_movements WHERE business_date=? AND hidden=0", DATE);
const cashSql = one<{ n: number }>(
  `SELECT COALESCE(SUM(p.amount_cents),0) n FROM payments p
     JOIN payment_methods pm ON pm.id=p.method_id JOIN sales s ON s.id=p.sale_id
    WHERE pm.kind='cash' AND s.deleted=0 AND s.kind='sale' AND p.business_date=?`, DATE);
check("drawer float", r.drawer.floatCents, flt.n);
check("drawer movements", r.drawer.movementsCents, mov.n);
check("drawer cash sales", r.drawer.cashSalesCents, cashSql.n);
check("drawer expected = f+c+m", r.drawer.expectedCents, flt.n + cashSql.n + mov.n);

// Tickets
const st = one<{ c: number; o: number; v: number }>(
  `SELECT SUM(status='completed') c, SUM(status='open') o, SUM(status='voided') v
     FROM sales WHERE deleted=0 AND kind='sale' AND business_date=?`, DATE);
checkN("completed", r.tickets.completed, st.c ?? 0);
checkN("open", r.tickets.open, st.o ?? 0);
checkN("voided", r.tickets.voided, st.v ?? 0);
const unpaid = one<{ n: number }>(
  `SELECT COALESCE(SUM(balance_cents),0) n FROM sales
    WHERE deleted=0 AND status='completed' AND kind='sale' AND business_date=? AND balance_cents>0`, DATE);
check("unpaid sum", r.tickets.unpaid.reduce((n, u) => n + u.balanceCents, 0), unpaid.n);

// Sold — the three parts must cover every live line exactly once
const lines = one<{ n: number }>(
  `SELECT COALESCE(SUM(i.line_total_cents),0) n FROM sale_items i JOIN sales s ON s.id=i.sale_id
    WHERE s.deleted=0 AND s.status='completed' AND s.kind='sale' AND i.voided=0 AND s.business_date=?`, DATE);
check("new+used+service = all lines",
  r.sold.newTires.cents + r.sold.usedTires.cents + r.sold.service.cents, lines.n);

// Stock: both sides independently
const out = one<{ n: number }>(
  `SELECT COALESCE(-SUM(m.qty_delta),0) n FROM inventory_movements m
     JOIN products p ON p.id=m.product_id
    WHERE m.business_date=? AND p.kind='tire' AND m.reason IN ('sale','void_return','refund_return')`, DATE);
const sold = one<{ n: number }>(
  `SELECT COALESCE(SUM(i.qty),0) n FROM sale_items i
     JOIN sales s ON s.id=i.sale_id JOIN products p ON p.id=i.product_id
    WHERE s.deleted=0 AND s.status='completed' AND s.kind='sale' AND i.voided=0
      AND s.business_date=? AND p.kind='tire'`, DATE);
checkN("stock unitsOut", r.stock.unitsOut, out.n);
checkN("stock unitsSoldOnTickets", r.stock.unitsSoldOnTickets, sold.n);

// Compare strip
const day = (d: string) =>
  one<{ n: number }>(
    `SELECT COALESCE(SUM(subtotal_cents - discount_cents),0) n FROM sales
      WHERE deleted=0 AND status='completed' AND kind='sale' AND business_date=?`, d).n;
const shift = (n: number) => {
  const d = new Date(`${DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
check("yesterday", r.compare.yesterdayGoodsCents, day(shift(1)));
check("same day last week", r.compare.sameDayLastWeekGoodsCents, day(shift(7)));

// Exceptions/checklist sanity for this date + today must not throw
console.log(`\nexceptions (${DATE}):`, r.exceptions.map((e) => `[${e.severity}] ${e.text.slice(0, 60)}…`));
console.log("checklist:", r.checklist.map((c) => `${c.label}=${c.done}`).join(" · "));
const today = closeoutV2(new Date().toISOString().slice(0, 10));
console.log("today loads:", !!today.checklist.length);

console.log(bad === 0 ? "\nALL CHECKS PASS" : `\n${bad} FAILURES`);
