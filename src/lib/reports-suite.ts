import { getDb } from "./db";
import { bucketExpr, bucketsBetween, type Grain } from "./reports-bi";

/**
 * The second shelf of the management reports: what the suite pages ask that the
 * original one-page report never did.
 *
 * SAME RULES AS `reports-bi.ts`, restated because two modules that quietly
 * disagree about what counts as a sale would be worse than one long file:
 * sales are `status = 'completed'`, `deleted = 0`, `kind = 'sale'`; everything
 * is bucketed by `business_date`; revenue is goods net of discount. Anything
 * here that averages across history divides by TRADING DAYS, never by calendar
 * days — the imported workbook has stretches nobody wrote down, and dividing
 * by a calendar invents a collapse that never happened.
 *
 * WHAT IS DELIBERATELY NOT HERE, because the records cannot carry it honestly:
 * time-per-job (nobody punches a job), comebacks (no warranty flag on a
 * ticket), and anything that judges a cashier by imported history (the
 * workbook's cashier column is who typed it in, not who made the sale).
 */

const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";

// ─────────────────────────────────────────────────────────────────────────────
// Revenue by category, over time
// ─────────────────────────────────────────────────────────────────────────────

export type CategoryTrend = {
  /** Category labels, in one fixed order — every column's values match it. */
  labels: string[];
  columns: { bucket: string; values: number[] }[];
};

/**
 * What each bucket of the window was made of.
 *
 * The mix donut says what sold over the whole window; this says whether that
 * mix is stable — a month where used tires quietly become half the take looks
 * identical in the donut and unmissable here. The label order is fixed across
 * every column and sorted by total, so the biggest band is always the bottom
 * band and the eye can follow it.
 */
export function categoryTrend(from: string, to: string, grain: Grain): CategoryTrend {
  const rows = getDb()
    .prepare(
      `SELECT ${bucketExpr(grain, "s.business_date")} AS bucket,
              COALESCE(c.label, 'Other') AS label,
              COALESCE(SUM(i.line_total_cents), 0) AS cents
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date BETWEEN ? AND ?
     GROUP BY bucket, COALESCE(c.label, 'Other')`,
    )
    .all(from, to) as { bucket: string; label: string; cents: number }[];

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.label, (totals.get(r.label) ?? 0) + r.cents);
  const labels = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const index = new Map(labels.map((l, i) => [l, i]));

  const byBucket = new Map<string, number[]>();
  for (const r of rows) {
    let v = byBucket.get(r.bucket);
    if (!v) byBucket.set(r.bucket, (v = labels.map(() => 0)));
    v[index.get(r.label)!] += r.cents;
  }

  return {
    labels,
    columns: bucketsBetween(from, to, grain).map((bucket) => ({
      bucket,
      values: byBucket.get(bucket) ?? labels.map(() => 0),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Special orders
// ─────────────────────────────────────────────────────────────────────────────

export type SpecialOrders = {
  count: number;
  cents: number;
  /** Ordered and not yet in the customer's hands — pending or waiting pickup. */
  open: number;
  /** Ordered, called, no answer yet — money on a shelf with a name on it. */
  noAnswer: number;
  /** Average days from ringing the order to handing it over, where both ends exist. */
  avgDaysToDeliver: number | null;
};

export function specialOrders(from: string, to: string): SpecialOrders {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS cents,
              SUM(CASE WHEN s.fulfillment_status IN ('pending','waiting_pickup') THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN s.fulfillment_status = 'no_answer' THEN 1 ELSE 0 END) AS noAnswer,
              AVG(CASE WHEN s.fulfillment_at IS NOT NULL
                       THEN julianday(s.fulfillment_at) - julianday(s.opened_at) END) AS avgDays
         FROM sales s
        WHERE s.deleted = 0 AND s.kind = 'sale' AND s.is_special_order = 1
          AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as {
    count: number;
    cents: number;
    open: number | null;
    noAnswer: number | null;
    avgDays: number | null;
  };
  return {
    count: r.count,
    cents: r.cents,
    open: r.open ?? 0,
    noAnswer: r.noAnswer ?? 0,
    avgDaysToDeliver: r.avgDays === null ? null : Math.round(r.avgDays * 10) / 10,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The season: when tires actually sell
// ─────────────────────────────────────────────────────────────────────────────

export type SeasonalMonth = {
  /** "01".."12". */
  mm: string;
  newUnits: number;
  usedUnits: number;
  otherCents: number;
  tireCents: number;
  /** Days the shop actually traded in that month, over every year on record. */
  tradingDays: number;
};

/**
 * Every January on record folded into one January, per trading day.
 *
 * PER TRADING DAY IS THE WHOLE METHOD. The imported history has stretches
 * nobody wrote down; a month that is half blank looks like a month that half
 * died unless it is divided by the days that actually have records. Whether a
 * month of the year sells more tires is a per-day question anyway.
 */
export function seasonalCategories(): SeasonalMonth[] {
  return getDb()
    .prepare(
      `SELECT substr(s.business_date, 6, 2) AS mm,
              COALESCE(SUM(CASE WHEN c.code = 'new_tire'  THEN i.qty END), 0) AS newUnits,
              COALESCE(SUM(CASE WHEN c.code = 'used_tire' THEN i.qty END), 0) AS usedUnits,
              COALESCE(SUM(CASE WHEN c.code IN ('new_tire','used_tire')
                                THEN i.line_total_cents END), 0) AS tireCents,
              COALESCE(SUM(CASE WHEN c.code NOT IN ('new_tire','used_tire') OR c.code IS NULL
                                THEN i.line_total_cents END), 0) AS otherCents,
              COUNT(DISTINCT s.business_date) AS tradingDays
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0
     GROUP BY mm
     ORDER BY mm`,
    )
    .all() as SeasonalMonth[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The customer book: lifetime, not windowed
// ─────────────────────────────────────────────────────────────────────────────

export type RetentionBook = {
  /** Customers on file, not deleted — the whole book, visits or none. */
  onFile: number;
  withVisit: number;
  /** Of those with a visit, how many came back at least once. */
  repeat: number;
  vehiclesOnFile: number;
  /** The day the first ticket ever took a name — everything here starts there. */
  firstNamedSale: string | null;
  avgLifetimeCents: number;
  avgVisits: number;
  /** How many customers have exactly 1 / 2 / 3–5 / 6+ visits. */
  visitSpread: { one: number; two: number; threeToFive: number; sixUp: number };
  top: {
    customerId: number;
    name: string;
    isFleet: number;
    visits: number;
    lifetimeCents: number;
    lastSeen: string;
  }[];
  /** Came at least twice, then stopped — the list worth a phone call. */
  lapsed: {
    customerId: number;
    name: string;
    phone: string | null;
    visits: number;
    lifetimeCents: number;
    lastSeen: string;
    daysSince: number;
  }[];
};

/**
 * Who the shop's customers are over their whole lives, not over a window.
 *
 * Retention is the one question a date range cannot answer — "did they come
 * back" has no meaning inside a fortnight. So this takes `asOf` and nothing
 * else, like the trends page, and the page that draws it says so.
 *
 * LAPSED is deliberately narrow: at least two visits, then sixty days of
 * silence. One visit and gone is a walk-in the shop never really had; two
 * visits is a habit that stopped, and a habit that stopped has a reason.
 */
export function retentionBook(asOf: string): RetentionBook {
  const db = getDb();

  const file = db
    .prepare(
      `SELECT COUNT(*) AS onFile FROM customers WHERE deleted = 0`,
    )
    .get() as { onFile: number };
  const vehicles = db
    .prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE deleted = 0`)
    .get() as { n: number };

  const per = db
    .prepare(
      `SELECT s.customer_id AS customerId,
              c.name,
              COALESCE(c.is_fleet, 0) AS isFleet,
              c.phone,
              COUNT(*) AS visits,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS lifetimeCents,
              MIN(s.business_date) AS firstSeen,
              MAX(s.business_date) AS lastSeen
         FROM sales s
         JOIN customers c ON c.id = s.customer_id AND c.deleted = 0
        WHERE ${SALE} AND s.customer_id IS NOT NULL
     GROUP BY s.customer_id`,
    )
    .all() as {
    customerId: number;
    name: string;
    isFleet: number;
    phone: string | null;
    visits: number;
    lifetimeCents: number;
    firstSeen: string;
    lastSeen: string;
  }[];

  const withVisit = per.length;
  const repeat = per.filter((c) => c.visits >= 2).length;
  const lifetime = per.reduce((n, c) => n + c.lifetimeCents, 0);
  const visitsTotal = per.reduce((n, c) => n + c.visits, 0);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const days = (d: string) => Math.floor((asOfMs - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);

  return {
    onFile: file.onFile,
    withVisit,
    repeat,
    vehiclesOnFile: vehicles.n,
    firstNamedSale: per.length
      ? per.reduce((min, c) => (c.firstSeen < min ? c.firstSeen : min), per[0].firstSeen)
      : null,
    avgLifetimeCents: withVisit ? Math.round(lifetime / withVisit) : 0,
    avgVisits: withVisit ? Math.round((visitsTotal / withVisit) * 10) / 10 : 0,
    visitSpread: {
      one: per.filter((c) => c.visits === 1).length,
      two: per.filter((c) => c.visits === 2).length,
      threeToFive: per.filter((c) => c.visits >= 3 && c.visits <= 5).length,
      sixUp: per.filter((c) => c.visits >= 6).length,
    },
    top: per
      .slice()
      .sort((a, b) => b.lifetimeCents - a.lifetimeCents)
      .slice(0, 12)
      .map((c) => ({
        customerId: c.customerId,
        name: c.name,
        isFleet: c.isFleet,
        visits: c.visits,
        lifetimeCents: c.lifetimeCents,
        lastSeen: c.lastSeen,
      })),
    lapsed: per
      .filter((c) => c.visits >= 2 && days(c.lastSeen) > 60)
      .sort((a, b) => b.lifetimeCents - a.lifetimeCents)
      .slice(0, 20)
      .map((c) => ({
        customerId: c.customerId,
        name: c.name,
        phone: c.phone,
        visits: c.visits,
        lifetimeCents: c.lifetimeCents,
        lastSeen: c.lastSeen,
        daysSince: days(c.lastSeen),
      })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fleet and commercial accounts
// ─────────────────────────────────────────────────────────────────────────────

export type FleetBook = {
  accounts: number;
  creditApproved: number;
  windowTickets: number;
  windowCents: number;
  owedCents: number;
  rows: {
    customerId: number;
    name: string;
    creditApproved: number;
    windowTickets: number;
    windowCents: number;
    lifetimeCents: number;
    owedCents: number;
    vehicles: number;
    lastSeen: string | null;
  }[];
};

/**
 * The commercial accounts, one row per fleet.
 *
 * Window figures and lifetime figures side by side on purpose: a fleet is a
 * relationship, and "quiet this month" only means something next to "worth
 * eleven thousand dollars so far". Owed is the sum of open ticket balances —
 * the same figure the aging report carries, cut by who owes it.
 */
export function fleetBook(from: string, to: string): FleetBook {
  const rows = getDb()
    .prepare(
      `SELECT c.id AS customerId,
              c.name,
              COALESCE(c.credit_approved, 0) AS creditApproved,
              COALESCE(SUM(CASE WHEN ${SALE} AND s.business_date BETWEEN ? AND ?
                                THEN 1 ELSE 0 END), 0) AS windowTickets,
              COALESCE(SUM(CASE WHEN ${SALE} AND s.business_date BETWEEN ? AND ?
                                THEN s.subtotal_cents - s.discount_cents ELSE 0 END), 0) AS windowCents,
              COALESCE(SUM(CASE WHEN ${SALE}
                                THEN s.subtotal_cents - s.discount_cents ELSE 0 END), 0) AS lifetimeCents,
              COALESCE(SUM(CASE WHEN ${SALE} AND s.balance_cents > 0
                                THEN s.balance_cents ELSE 0 END), 0) AS owedCents,
              (SELECT COUNT(*) FROM vehicles v
                WHERE v.customer_id = c.id AND v.deleted = 0) AS vehicles,
              MAX(CASE WHEN ${SALE} THEN s.business_date END) AS lastSeen
         FROM customers c
    LEFT JOIN sales s ON s.customer_id = c.id
        WHERE c.deleted = 0 AND c.is_fleet = 1
     GROUP BY c.id
     ORDER BY lifetimeCents DESC`,
    )
    .all(from, to, from, to) as FleetBook["rows"];

  return {
    accounts: rows.length,
    creditApproved: rows.filter((r) => r.creditApproved).length,
    windowTickets: rows.reduce((n, r) => n + r.windowTickets, 0),
    windowCents: rows.reduce((n, r) => n + r.windowCents, 0),
    owedCents: rows.reduce((n, r) => n + r.owedCents, 0),
    rows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// One technician, up close
// ─────────────────────────────────────────────────────────────────────────────

export type TechDetail = {
  employeeId: number;
  name: string | null;
  trend: { bucket: string; incomeCents: number; tickets: number }[];
  mix: { label: string; cents: number; units: number }[];
  weekdays: { weekday: number; incomeCents: number; days: number }[];
};

/**
 * The drill-down behind a name on the crew board.
 *
 * Everything is credited work — lines whose `mechanic_id` is this person —
 * which is the one attribution the records carry honestly all the way back.
 * No clocked hours appear here on purpose: for most of the history nobody
 * punched, and a chart that mixed real credit with invented hours would
 * poison the half of it that is true.
 */
export function techDetail(
  employeeId: number,
  from: string,
  to: string,
  grain: Grain,
): TechDetail {
  const db = getDb();

  const name = db
    .prepare(`SELECT name FROM employees WHERE id = ?`)
    .get(employeeId) as { name: string } | undefined;

  const trendRows = db
    .prepare(
      `SELECT ${bucketExpr(grain, "s.business_date")} AS bucket,
              COALESCE(SUM(i.line_total_cents), 0) AS incomeCents,
              COUNT(DISTINCT s.id) AS tickets
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
        WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id = ?
          AND s.business_date BETWEEN ? AND ?
     GROUP BY bucket`,
    )
    .all(employeeId, from, to) as { bucket: string; incomeCents: number; tickets: number }[];
  const byBucket = new Map(trendRows.map((r) => [r.bucket, r]));

  const mix = db
    .prepare(
      `SELECT COALESCE(c.label, 'Other') AS label,
              COALESCE(SUM(i.line_total_cents), 0) AS cents,
              COALESCE(SUM(i.qty), 0) AS units
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id = ?
          AND s.business_date BETWEEN ? AND ?
     GROUP BY COALESCE(c.label, 'Other')
     ORDER BY cents DESC`,
    )
    .all(employeeId, from, to) as TechDetail["mix"];

  const weekdays = db
    .prepare(
      `SELECT CAST(strftime('%w', s.business_date) AS INTEGER) AS weekday,
              COALESCE(SUM(i.line_total_cents), 0) AS incomeCents,
              COUNT(DISTINCT s.business_date) AS days
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
        WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id = ?
          AND s.business_date BETWEEN ? AND ?
     GROUP BY weekday
     ORDER BY weekday`,
    )
    .all(employeeId, from, to) as TechDetail["weekdays"];

  return {
    employeeId,
    name: name?.name ?? null,
    trend: bucketsBetween(from, to, grain).map((bucket) => ({
      bucket,
      incomeCents: byBucket.get(bucket)?.incomeCents ?? 0,
      tickets: byBucket.get(bucket)?.tickets ?? 0,
    })),
    mix,
    weekdays,
  };
}
