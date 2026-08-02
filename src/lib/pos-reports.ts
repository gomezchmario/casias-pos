import { getDb } from "./db";
import { taxIncludedInCents } from "./money";
import { getSetting } from "./settings";

export type DayTotals = {
  businessDate: string;
  saleCount: number;
  voidedCount: number;
  /** Goods rung on this day, off the sale headers. Excludes purchases. */
  goodsCents: number;
  /** Cash paid out over the counter for stock — used tires bought in. */
  purchasesCents: number;
  purchaseCount: number;
  /** Cashback paid out on this day, off the ledger. */
  tipCents: number;
  /** Cashback fees taken on this day, off the ledger. */
  commCents: number;
  /** What actually hit the drawer and the terminal on this day. */
  collectedCents: number;
  taxIncludedCents: number;
  /**
   * Ledger rows booked today against a ticket from another day — a late tip or
   * a refund. This is the reconciling item between goods sold and cash
   * collected, so it is reported rather than hidden.
   */
  priorDayAdjustmentCents: number;
  openTicketCount: number;
  outstandingCents: number;
};

export type MethodTotal = {
  code: string;
  label: string;
  isCard: number;
  amountCents: number;
  tipCents: number;
  commCents: number;
  count: number;
};

export type MechanicTotal = {
  employeeId: number | null;
  name: string;
  salesCents: number;
  lineCount: number;
};

/**
 * A day's money, counted along the two axes that actually differ: what was
 * SOLD that day (sale headers, bucketed by when the ticket was rung) and what
 * was COLLECTED that day (payment ledger, bucketed by when the money moved).
 *
 * They are deliberately not the same number. A tip added on Tuesday for
 * Monday's ticket is Monday's sale but Tuesday's money, and the drawer at
 * Tuesday close has to match Tuesday. `priorDayAdjustmentCents` is exactly
 * that difference.
 */
export function dayTotals(businessDate: string): DayTotals {
  const db = getDb();

  const sold = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(subtotal_cents), 0) AS goods
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'completed'
         AND kind = 'sale'`,
    )
    .get(businessDate) as { n: number; goods: number };

  // Goods bought over the counter. Held positive here — it is a cost, not
  // negative revenue, and netting it into sales would understate both.
  const bought = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(subtotal_cents), 0) AS cost
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'completed'
         AND kind = 'purchase'`,
    )
    .get(businessDate) as { n: number; cost: number };

  const collected = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total,
              COALESCE(SUM(tip_cents), 0)    AS tip,
              COALESCE(SUM(comm_cents), 0)   AS comm
       FROM payments
       WHERE business_date = ?`,
    )
    .get(businessDate) as { total: number; tip: number; comm: number };

  const priorDay = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE p.business_date = ? AND s.business_date <> ?`,
    )
    .get(businessDate, businessDate) as { total: number };

  const voided = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sales WHERE business_date = ? AND deleted = 0 AND status = 'voided'",
    )
    .get(businessDate) as { n: number };

  // An unfinished purchase still counts as an open ticket — someone has to go
  // back and close it — but its balance is money we owe, not money owed to us,
  // so it stays out of the outstanding figure.
  const open = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN kind = 'sale' THEN balance_cents ELSE 0 END), 0) AS due
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'open'`,
    )
    .get(businessDate) as { n: number; due: number };

  const owed = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS due
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'completed'
         AND kind = 'sale' AND balance_cents > 0`,
    )
    .get(businessDate) as { due: number };

  return {
    businessDate,
    saleCount: sold.n,
    voidedCount: voided.n,
    goodsCents: sold.goods,
    purchasesCents: bought.cost,
    purchaseCount: bought.n,
    tipCents: collected.tip,
    commCents: collected.comm,
    collectedCents: collected.total,
    taxIncludedCents: taxIncludedInCents(sold.goods, Number(getSetting("tax_rate_bp"))),
    priorDayAdjustmentCents: priorDay.total,
    openTicketCount: open.n,
    outstandingCents: open.due + owed.due,
  };
}

/** What actually hit each tender, straight off the ledger. */
export function dayByMethod(businessDate: string): MethodTotal[] {
  return getDb()
    .prepare(
      `SELECT m.code, m.label, m.is_card AS isCard,
              COALESCE(SUM(p.amount_cents), 0) AS amountCents,
              COALESCE(SUM(p.tip_cents), 0)    AS tipCents,
              COALESCE(SUM(p.comm_cents), 0)   AS commCents,
              COUNT(*)                         AS count
       FROM payments p
       JOIN payment_methods m ON m.id = p.method_id
       WHERE p.business_date = ?
       GROUP BY m.id
       ORDER BY m.sort_order`,
    )
    .all(businessDate) as MethodTotal[];
}

export function dayByMechanic(businessDate: string): MechanicTotal[] {
  return getDb()
    .prepare(
      `SELECT i.mechanic_id AS employeeId,
              COALESCE(e.name, 'Unassigned') AS name,
              COALESCE(SUM(i.line_total_cents), 0) AS salesCents,
              COUNT(*) AS lineCount
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
       LEFT JOIN employees e ON e.id = i.mechanic_id
       WHERE s.business_date = ? AND s.deleted = 0 AND s.status = 'completed'
         AND s.kind = 'sale' AND i.voided = 0
       GROUP BY i.mechanic_id
       ORDER BY salesCents DESC`,
    )
    .all(businessDate) as MechanicTotal[];
}

/**
 * Card terminal reconciliation. A gap or a duplicate in the SEQ run is how a
 * missed or double-rung transaction shows itself at close.
 */
export function seqReport(businessDate: string): {
  entries: { seq: string; saleNo: string; saleId: number; amountCents: number }[];
  duplicates: string[];
  gaps: string[];
  missing: { saleNo: string; saleId: number; method: string }[];
} {
  const db = getDb();

  const entries = db
    .prepare(
      `SELECT p.seq AS seq, s.sale_no AS saleNo, s.id AS saleId, p.amount_cents AS amountCents
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE p.business_date = ? AND p.seq IS NOT NULL AND p.seq <> ''
       ORDER BY p.seq`,
    )
    .all(businessDate) as {
    seq: string;
    saleNo: string;
    saleId: number;
    amountCents: number;
  }[];

  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.seq, (seen.get(e.seq) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);

  // Gaps only mean anything for a purely numeric run.
  const numeric = entries
    .map((e) => Number(e.seq))
    .filter((n) => Number.isInteger(n) && n > 0);
  const gaps: string[] = [];
  if (numeric.length > 1) {
    const sorted = [...new Set(numeric)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length && gaps.length < 50; i++) {
      for (let m = sorted[i - 1] + 1; m < sorted[i] && gaps.length < 50; m++) {
        gaps.push(String(m));
      }
    }
  }

  const missing = db
    .prepare(
      `SELECT s.sale_no AS saleNo, s.id AS saleId, m.label AS method
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       JOIN payment_methods m ON m.id = p.method_id
       WHERE p.business_date = ? AND m.is_card = 1 AND (p.seq IS NULL OR p.seq = '')
         AND p.kind <> 'reversal'
       ORDER BY s.id`,
    )
    .all(businessDate) as { saleNo: string; saleId: number; method: string }[];

  return { entries, duplicates, gaps, missing };
}
