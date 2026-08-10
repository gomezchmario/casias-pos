import { getDb } from "./db";
import { taxIncludedInCents } from "./money";
import { getSetting } from "./settings";

/**
 * The management reports: everything the shop's own records can be made to say
 * about how it is doing.
 *
 * ONE MODULE, MANY SMALL QUERIES, rather than one enormous one. Each function
 * here answers a single question and can be read, checked and changed on its
 * own; a combined query would be faster on a database a thousand times this
 * size and unreadable at any size. The whole page is a few dozen indexed reads
 * against a local file — the cost of asking separately is not measurable, and
 * the cost of not being able to follow the arithmetic is.
 *
 * THE RULES EVERY FIGURE HERE OBEYS, so that no two of them can disagree:
 *
 *   Sales are `status = 'completed'`, `deleted = 0`, `kind = 'sale'`. Voided
 *   tickets are excluded everywhere except the report that counts voids, and
 *   purchases (buybacks) are money going out and never count as revenue.
 *
 *   Everything is bucketed by `business_date`, never by `created_at`. The
 *   shop's day runs on its own boundary and a ticket corrected after close
 *   belongs to the day it was rung.
 *
 *   Revenue means goods NET of discount, matching `dayTotals`. The close-out
 *   and these reports are read side by side and must not tell two stories.
 *
 *   Prices are tax-inclusive. Where a figure is compared against a cost — and
 *   only there — the tax is backed out, because the shop never had that part.
 *   Every such figure says so in its name.
 */

const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";

const taxRate = () => Number(getSetting("tax_rate_bp"));

/** Goods net of tax — what the shop actually keeps out of a tax-inclusive price. */
export function exTax(cents: number): number {
  return cents - taxIncludedInCents(cents, taxRate());
}

// ─────────────────────────────────────────────────────────────────────────────
// The trend
// ─────────────────────────────────────────────────────────────────────────────

export type Grain = "day" | "week" | "month";

export type TrendPoint = {
  /** The bucket's label AND its key: a date, a week's Monday, or a month. */
  bucket: string;
  goodsCents: number;
  collectedCents: number;
  discountsCents: number;
  tickets: number;
  /** Goods ÷ tickets. Zero when there were none, rather than a division by it. */
  avgTicketCents: number;
};

/**
 * Money over time, at whichever grain the window deserves.
 *
 * Days for a few weeks, weeks for a few months, months for a year. The caller
 * chooses, because the right answer depends on the question rather than on the
 * span: "how was last week" and "how is this year going" want different bars
 * out of the same rows.
 *
 * Both figures are here on purpose and they are not the same number. Goods is
 * what was SOLD on that day; collected is what came IN. A deposit taken today
 * on a tire ordered last week appears in one and not the other, and a report
 * that showed only one of them would be unable to explain the other.
 */
export function revenueTrend(from: string, to: string, grain: Grain): TrendPoint[] {
  const db = getDb();
  const key = bucketExpr(grain, "s.business_date");

  const sold = db
    .prepare(
      `SELECT ${key} AS bucket,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS goods,
              COALESCE(SUM(s.discount_cents), 0)                    AS discounts,
              COUNT(*)                                              AS tickets
         FROM sales s
        WHERE ${SALE} AND s.business_date BETWEEN ? AND ?
     GROUP BY bucket`,
    )
    .all(from, to) as { bucket: string; goods: number; discounts: number; tickets: number }[];

  const collected = db
    .prepare(
      `SELECT ${bucketExpr(grain, "p.business_date")} AS bucket,
              COALESCE(SUM(p.amount_cents), 0) AS collected
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
        WHERE s.deleted = 0 AND s.kind = 'sale'
          AND p.business_date BETWEEN ? AND ?
     GROUP BY bucket`,
    )
    .all(from, to) as { bucket: string; collected: number }[];

  const money = new Map(collected.map((r) => [r.bucket, r.collected]));
  const byBucket = new Map(sold.map((r) => [r.bucket, r]));

  // Every bucket in the window, whether it traded or not. A GROUP BY returns
  // only the days with rows, so a shop shut on Sunday produces a chart with no
  // gap in it — and a chart with no gap says the shop traded Sunday.
  return bucketsBetween(from, to, grain).map((bucket) => {
    const r = byBucket.get(bucket);
    const goodsCents = r?.goods ?? 0;
    const tickets = r?.tickets ?? 0;
    return {
      bucket,
      goodsCents,
      collectedCents: money.get(bucket) ?? 0,
      discountsCents: r?.discounts ?? 0,
      tickets,
      avgTicketCents: tickets > 0 ? Math.round(goodsCents / tickets) : 0,
    };
  });
}

/** The SQL that turns a business date into a bucket key. */
function bucketExpr(grain: Grain, col: string): string {
  if (grain === "day") return col;
  if (grain === "month") return `substr(${col}, 1, 7)`;
  // The week's Monday, so the label is a real date somebody can look up.
  // SQLite's %w is 0=Sunday, hence the shuffle.
  return `date(${col}, '-' || ((CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) || ' days')`;
}

/** Every bucket key between two dates, inclusive, in order. */
function bucketsBetween(from: string, to: string, grain: Grain): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;

  if (grain === "month") {
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    while (d <= end) {
      out.push(d.toISOString().slice(0, 7));
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }

  const d = new Date(start);
  if (grain === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + (grain === "week" ? 7 : 1));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the shop sells
// ─────────────────────────────────────────────────────────────────────────────

export type CategoryRow = {
  code: string;
  label: string;
  revenueCents: number;
  units: number;
  lines: number;
  /** Cost of the lines that carry one. See `costCoveragePct`. */
  costCents: number;
  /** Revenue ex-tax minus cost, over the lines that have a cost. */
  marginCents: number;
  /** What fraction of this category's revenue has a cost recorded against it,
   *  0-100. Below 100 the margin is a floor rather than the answer. */
  costCoveragePct: number;
};

/**
 * Revenue and margin by what was sold.
 *
 * THE COST COVERAGE COLUMN IS NOT DECORATION. Only a tire carries a cost; a
 * flat repair has none, and never should. So a margin computed over everything
 * would silently treat all labour as pure profit and report a number that is
 * true of nothing. Coverage says how much of the category the margin actually
 * covers, and the page refuses to headline a margin where coverage is thin.
 *
 * Tax is backed out of the revenue side and only there. The customer paid a
 * tax-inclusive price, the shop never kept the tax, and comparing the whole
 * price against a cost would overstate every margin on the page by 8.25%.
 */
export function categoryMix(from: string, to: string): CategoryRow[] {
  return getDb()
    .prepare(
      `SELECT COALESCE(c.code, 'other')        AS code,
              COALESCE(c.label, 'Other')       AS label,
              COALESCE(SUM(i.line_total_cents), 0) AS revenueCents,
              COALESCE(SUM(i.qty), 0)          AS units,
              COUNT(*)                         AS lines,
              COALESCE(SUM(CASE WHEN i.unit_cost_cents > 0
                                THEN i.unit_cost_cents * i.qty ELSE 0 END), 0) AS costCents,
              COALESCE(SUM(CASE WHEN i.unit_cost_cents > 0
                                THEN i.line_total_cents ELSE 0 END), 0) AS costedRevenueCents
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date BETWEEN ? AND ?
     GROUP BY code
     ORDER BY revenueCents DESC`,
    )
    .all(from, to)
    .map((r) => {
      const row = r as CategoryRow & { costedRevenueCents: number };
      return {
        code: row.code,
        label: row.label,
        revenueCents: row.revenueCents,
        units: row.units,
        lines: row.lines,
        costCents: row.costCents,
        marginCents: exTax(row.costedRevenueCents) - row.costCents,
        costCoveragePct:
          row.revenueCents > 0
            ? Math.round((row.costedRevenueCents / row.revenueCents) * 100)
            : 0,
      };
    });
}

export type TenderRow = {
  code: string;
  label: string;
  isCard: number;
  amountCents: number;
  count: number;
};

/**
 * How the money came in.
 *
 * Reversals and refunds are included and negative, so a corrected tender nets
 * itself out of its own bucket rather than inflating two of them. That is the
 * whole reason this reads the ledger rather than the sale headers.
 */
export function tenderMix(from: string, to: string): TenderRow[] {
  return getDb()
    .prepare(
      `SELECT m.code, m.label, m.is_card AS isCard,
              COALESCE(SUM(p.amount_cents), 0) AS amountCents,
              COUNT(*) AS count
         FROM payments p
         JOIN payment_methods m ON m.id = p.method_id
         JOIN sales s ON s.id = p.sale_id
        WHERE s.deleted = 0 AND p.business_date BETWEEN ? AND ?
     GROUP BY m.id
       HAVING amountCents <> 0 OR count > 0
     ORDER BY amountCents DESC`,
    )
    .all(from, to) as TenderRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// When the shop is busy
// ─────────────────────────────────────────────────────────────────────────────

export type HourCell = { weekday: number; hour: number; tickets: number; goodsCents: number };

/**
 * The week as a grid: which hours of which days actually carry the shop.
 *
 * THE ONE REPORT HERE THAT CHANGES A DECISION SOMEBODY MAKES EVERY WEEK — who
 * is rostered when. A shop can feel busy on a Saturday morning and turn out to
 * take most of its money on Thursday afternoon, and no amount of remembering
 * settles that argument.
 *
 * Bucketed on `opened_at` rather than on the business date, because the
 * question is what time of day it was — and deliberately on the LOCAL clock the
 * ticket was rung on, which is what `opened_at` already stores.
 */
export function hourHeatmap(from: string, to: string): HourCell[] {
  return getDb()
    .prepare(
      `SELECT CAST(strftime('%w', s.opened_at) AS INTEGER) AS weekday,
              CAST(strftime('%H', s.opened_at) AS INTEGER) AS hour,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS goodsCents
         FROM sales s
        WHERE ${SALE} AND s.business_date BETWEEN ? AND ?
     GROUP BY weekday, hour`,
    )
    .all(from, to) as HourCell[];
}

export type WeekdayRow = { weekday: number; tickets: number; goodsCents: number; days: number };

/**
 * Each day of the week, averaged over how many of them the window contained.
 *
 * The averaging is the point. A window with five Thursdays and four Fridays in
 * it makes Thursday look 25% better than Friday for no reason but the calendar,
 * and a rota decided off that raw total would be decided off an artefact.
 */
export function weekdayProfile(from: string, to: string): WeekdayRow[] {
  const rows = getDb()
    .prepare(
      `SELECT CAST(strftime('%w', s.business_date) AS INTEGER) AS weekday,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS goodsCents
         FROM sales s
        WHERE ${SALE} AND s.business_date BETWEEN ? AND ?
     GROUP BY weekday`,
    )
    .all(from, to) as { weekday: number; tickets: number; goodsCents: number }[];

  // How many of each weekday the window actually contains.
  const days = new Array(7).fill(0);
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    days[d.getUTCDay()]++;
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  return Array.from({ length: 7 }, (_, w) => ({
    weekday: w,
    tickets: byDay.get(w)?.tickets ?? 0,
    goodsCents: byDay.get(w)?.goodsCents ?? 0,
    days: days[w],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The racks
// ─────────────────────────────────────────────────────────────────────────────

export type ProductRow = {
  productId: number;
  name: string;
  size: string | null;
  brand: string | null;
  condition: string | null;
  units: number;
  revenueCents: number;
  costCents: number;
  onHand: number;
};

/**
 * What actually sells, and what does not.
 *
 * One list, ranked, and the caller takes either end of it. Slow movers are the
 * more valuable half and the harder one to see: a size that sold nothing is
 * absent from every sales report by definition, so it can only be found by
 * starting from the racks and asking what did NOT move.
 */
export function productMovement(from: string, to: string): ProductRow[] {
  return getDb()
    .prepare(
      `SELECT p.id AS productId,
              p.name, p.tire_size AS size, p.brand, p.condition,
              COALESCE(sold.units, 0)   AS units,
              COALESCE(sold.revenue, 0) AS revenueCents,
              COALESCE(sold.cost, 0)    AS costCents,
              COALESCE(oh.qty, 0)       AS onHand
         FROM products p
    LEFT JOIN (
              SELECT i.product_id,
                     SUM(i.qty) AS units,
                     SUM(i.line_total_cents) AS revenue,
                     SUM(COALESCE(i.unit_cost_cents, 0) * i.qty) AS cost
                FROM sale_items i
                JOIN sales s ON s.id = i.sale_id
               WHERE ${SALE} AND i.voided = 0 AND s.business_date BETWEEN ? AND ?
            GROUP BY i.product_id
             ) sold ON sold.product_id = p.id
    LEFT JOIN (
              SELECT product_id, SUM(qty_delta) AS qty
                FROM inventory_movements GROUP BY product_id
             ) oh ON oh.product_id = p.id
        WHERE p.deleted = 0 AND p.track_inventory = 1
     ORDER BY units DESC, revenueCents DESC`,
    )
    .all(from, to) as ProductRow[];
}

export type StockValueRow = { key: string; units: number; costCents: number };

/**
 * What is on the racks, at what it cost.
 *
 * Valued at the WEIGHTED AVERAGE cost of what was actually received rather than
 * at the product's default cost. The default is what the next one is expected to
 * cost; this answers what the shop has already spent and has not yet sold, which
 * is the figure that matters when it is sitting in a corner not moving.
 */
export function stockValue(): {
  totalUnits: number;
  totalCostCents: number;
  byBrand: StockValueRow[];
  byRim: StockValueRow[];
} {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.brand, p.tire_size AS size, p.condition,
              COALESCE(oh.qty, 0) AS onHand,
              COALESCE(lot.avgCost, p.default_cost_cents, 0) AS unitCostCents
         FROM products p
    LEFT JOIN (
              SELECT product_id, SUM(qty_delta) AS qty
                FROM inventory_movements GROUP BY product_id
             ) oh ON oh.product_id = p.id
    LEFT JOIN (
              -- Weighted average over everything ever received for the product.
              SELECT product_id,
                     CASE WHEN SUM(qty_received) > 0
                          THEN SUM(unit_cost_cents * qty_received) / SUM(qty_received)
                          END AS avgCost
                FROM inventory_lots
               WHERE deleted = 0 AND qty_received > 0
            GROUP BY product_id
             ) lot ON lot.product_id = p.id
        WHERE p.deleted = 0 AND p.track_inventory = 1`,
    )
    .all() as {
    id: number;
    brand: string | null;
    size: string | null;
    condition: string | null;
    onHand: number;
    unitCostCents: number;
  }[];

  const live = rows.filter((r) => r.onHand > 0);
  const brand = new Map<string, StockValueRow>();
  const rim = new Map<string, StockValueRow>();

  for (const r of live) {
    const cost = r.onHand * r.unitCostCents;
    const b = r.condition === "used" ? "Used tires" : r.brand || "No brand";
    // The rim diameter is the last number in a tire size and is how a rack is
    // actually organised — a shop thinks in 15s, 16s and 17s, not in 205/55R16.
    const m = r.size?.match(/R?(\d{2})(?:\D*)$/);
    const k = m ? `${m[1]}"` : "Other";

    for (const [map, key] of [
      [brand, b],
      [rim, k],
    ] as const) {
      const cur = map.get(key) ?? { key, units: 0, costCents: 0 };
      cur.units += r.onHand;
      cur.costCents += cost;
      map.set(key, cur);
    }
  }

  const sort = (m: Map<string, StockValueRow>) =>
    [...m.values()].sort((a, b) => b.costCents - a.costCents);

  return {
    totalUnits: live.reduce((n, r) => n + r.onHand, 0),
    totalCostCents: live.reduce((n, r) => n + r.onHand * r.unitCostCents, 0),
    byBrand: sort(brand),
    byRim: sort(rim),
  };
}

export type DeadStockRow = {
  productId: number;
  name: string;
  size: string | null;
  brand: string | null;
  onHand: number;
  costCents: number;
  /** Days since one of these last left the racks. Null if one never has. */
  daysSinceSale: number | null;
  /** Days since the oldest of the ones still here was received. */
  daysOnShelf: number | null;
};

/**
 * Money standing still.
 *
 * Stock that is on the racks and has not sold. Ranked by what it cost rather
 * than by how long it has sat, because the question this answers is "where is
 * my cash" — twenty dollars of something ancient matters less than four hundred
 * dollars of something bought in March.
 *
 * A tire that has NEVER sold ranks with the worst of them, not off the list.
 * Never having sold is the strongest form of not selling, and reporting it as a
 * blank would hide the clearest cases.
 */
export function deadStock(asOf: string, minDays = 60): DeadStockRow[] {
  return (
    getDb()
      .prepare(
        `SELECT p.id AS productId, p.name, p.tire_size AS size, p.brand,
                COALESCE(oh.qty, 0) AS onHand,
                COALESCE(lot.avgCost, p.default_cost_cents, 0) AS unitCostCents,
                CAST(julianday(?) - julianday(last.d) AS INTEGER) AS daysSinceSale,
                CAST(julianday(?) - julianday(recv.d) AS INTEGER) AS daysOnShelf
           FROM products p
      LEFT JOIN (SELECT product_id, SUM(qty_delta) AS qty
                   FROM inventory_movements GROUP BY product_id) oh ON oh.product_id = p.id
      LEFT JOIN (SELECT product_id, MAX(business_date) AS d
                   FROM inventory_movements WHERE reason = 'sale'
               GROUP BY product_id) last ON last.product_id = p.id
      LEFT JOIN (SELECT product_id, MIN(business_date) AS d
                   FROM inventory_movements WHERE reason = 'receive'
               GROUP BY product_id) recv ON recv.product_id = p.id
      LEFT JOIN (SELECT product_id,
                        CASE WHEN SUM(qty_received) > 0
                             THEN SUM(unit_cost_cents * qty_received) / SUM(qty_received) END AS avgCost
                   FROM inventory_lots WHERE deleted = 0 AND qty_received > 0
               GROUP BY product_id) lot ON lot.product_id = p.id
          WHERE p.deleted = 0 AND p.track_inventory = 1 AND COALESCE(oh.qty, 0) > 0
            AND (last.d IS NULL OR julianday(?) - julianday(last.d) >= ?)`,
      )
      .all(asOf, asOf, asOf, minDays) as (DeadStockRow & { unitCostCents: number })[]
  )
    .map((r) => ({
      productId: r.productId,
      name: r.name,
      size: r.size,
      brand: r.brand,
      onHand: r.onHand,
      costCents: r.onHand * r.unitCostCents,
      daysSinceSale: r.daysSinceSale ?? null,
      daysOnShelf: r.daysOnShelf ?? null,
    }))
    .sort((a, b) => b.costCents - a.costCents);
}

export type ReorderRow = {
  productId: number;
  name: string;
  size: string | null;
  brand: string | null;
  onHand: number;
  reorderPoint: number;
  /** Units sold in the last 90 days — how fast the hole is being dug. */
  sold90: number;
};

/** At or under the reorder point, worst first, with how fast it is going. */
export function reorderList(asOf: string): ReorderRow[] {
  return getDb()
    .prepare(
      `SELECT p.id AS productId, p.name, p.tire_size AS size, p.brand,
              COALESCE(oh.qty, 0) AS onHand,
              p.reorder_point AS reorderPoint,
              COALESCE(recent.units, 0) AS sold90
         FROM products p
    LEFT JOIN (SELECT product_id, SUM(qty_delta) AS qty
                 FROM inventory_movements GROUP BY product_id) oh ON oh.product_id = p.id
    LEFT JOIN (SELECT i.product_id, SUM(i.qty) AS units
                 FROM sale_items i JOIN sales s ON s.id = i.sale_id
                WHERE ${SALE} AND i.voided = 0
                  AND s.business_date >= date(?, '-90 days')
             GROUP BY i.product_id) recent ON recent.product_id = p.id
        WHERE p.deleted = 0 AND p.track_inventory = 1 AND p.active = 1
          AND p.reorder_point > 0 AND COALESCE(oh.qty, 0) <= p.reorder_point
     ORDER BY (COALESCE(oh.qty, 0) - p.reorder_point), sold90 DESC`,
    )
    .all(asOf) as ReorderRow[];
}

export type RestockRow = {
  productId: number;
  name: string;
  size: string | null;
  brand: string | null;
  onHand: number;
  /** Units sold over `overDays` — the evidence it is worth stocking. */
  sold90: number;
  /**
   * How many days that figure actually covers.
   *
   * Ninety at most, and fewer while the shop is young. It is on the row rather
   * than assumed because it is what makes the rate readable: four tires in
   * ninety days and four tires in seven are the same count and completely
   * different businesses.
   */
  overDays: number;
  /** What the shop currently reorders at. Zero means no standing level at all. */
  reorderPoint: number;
  /** What it probably should be: roughly a fortnight of sales at this rate. */
  suggested: number;
  /**
   * Days of stock left at the rate it has been going. Null when there is none
   * on the rack — which is not "infinite days", it is the worst case there is.
   */
  daysOfCover: number | null;
};

/**
 * What to keep in stock — the mirror image of the dead-stock list.
 *
 * THE GAP THIS FILLS, and it is a real one: the reorder list can only warn about
 * products that already have a reorder point set. A size nobody ever set one on
 * is invisible to it no matter how fast it sells, right up until a customer asks
 * for it and it is not there. The dead-stock report finds money standing still;
 * nothing found money about to run out.
 *
 * So this starts from what is SELLING rather than from what is flagged, and asks
 * whether the shop has arranged to keep having it. Two ways to fail that: no
 * standing level at all, or one set lower than the tire actually moves.
 *
 * The suggestion is a fortnight of sales at the observed rate, and it is offered
 * as a starting figure rather than an answer — the right number is a fortnight
 * only if the truck comes in a fortnight, and this cannot know that. It is a
 * long way better than the zero that is there now.
 *
 * Ninety days rather than the report's own window, deliberately. This is a
 * question about a rate, and a rate measured over the seven days somebody
 * happened to select is noise. It is the one figure on the page that does not
 * follow the window, and the panel says so.
 *
 * THE RATE IS DIVIDED BY THE DAYS THE SHOP HAS ACTUALLY TRADED, not by ninety.
 * Dividing a young shop's sales by ninety understates every rate by the margin
 * it has not been open — on this shop's first week it turned four tires sold in
 * seven days into "reorder at 1", which is advice that would empty the racks.
 * The observed span is capped at ninety and reported on the row.
 */
export function restockAdvice(asOf: string, minSold = 2): RestockRow[] {
  // How much history there actually is, capped at the ninety days asked for.
  const first = getDb()
    .prepare(
      `SELECT MIN(business_date) AS d FROM sales
        WHERE deleted = 0 AND status = 'completed' AND kind = 'sale'
          AND business_date >= date(?, '-90 days')`,
    )
    .get(asOf) as { d: string | null };
  const overDays = first.d
    ? Math.max(
        1,
        Math.round(
          (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${first.d}T00:00:00Z`)) / 86_400_000,
        ) + 1,
      )
    : 90;

  return (
    getDb()
      .prepare(
        `SELECT p.id AS productId, p.name, p.tire_size AS size, p.brand,
                COALESCE(oh.qty, 0)        AS onHand,
                COALESCE(recent.units, 0)  AS sold90,
                p.reorder_point            AS reorderPoint
           FROM products p
      LEFT JOIN (SELECT product_id, SUM(qty_delta) AS qty
                   FROM inventory_movements GROUP BY product_id) oh ON oh.product_id = p.id
      LEFT JOIN (SELECT i.product_id, SUM(i.qty) AS units
                   FROM sale_items i JOIN sales s ON s.id = i.sale_id
                  WHERE ${SALE} AND i.voided = 0
                    AND s.business_date >= date(?, '-90 days')
               GROUP BY i.product_id) recent ON recent.product_id = p.id
          WHERE p.deleted = 0 AND p.active = 1 AND p.track_inventory = 1
            AND COALESCE(recent.units, 0) >= ?`,
      )
      .all(asOf, minSold) as Omit<RestockRow, "suggested" | "daysOfCover" | "overDays">[]
  )
    .map((r) => {
      const perDay = r.sold90 / overDays;
      return {
        ...r,
        overDays,
        // A fortnight of sales at the observed rate. A starting figure rather
        // than an answer: the right number is a fortnight only if the truck
        // comes in a fortnight, and nothing here knows that.
        suggested: Math.max(1, Math.ceil(perDay * 14)),
        daysOfCover: r.onHand > 0 && perDay > 0 ? Math.round(r.onHand / perDay) : null,
      };
    })
    // Only where the shop has not already arranged to keep it: no standing
    // level, or one below what the tire actually moves. A size with an adequate
    // reorder point is already handled and belongs on the other list, not this
    // one — repeating it here would make both lists longer and neither clearer.
    .filter((r) => r.reorderPoint < r.suggested)
    // Emptiest first among the fast movers: nothing on the rack outranks two
    // weeks of cover however well the second one sells.
    .sort((a, b) => {
      const cover = (x: RestockRow) => (x.daysOfCover === null ? -1 : x.daysOfCover);
      if (cover(a) !== cover(b)) return cover(a) - cover(b);
      return b.sold90 - a.sold90;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// The people who owe the shop
// ─────────────────────────────────────────────────────────────────────────────

export type AgingBucket = { label: string; ticketCents: number; accountCents: number };

/**
 * What is owed, by how old it is.
 *
 * Two columns because they are chased differently and by different people. A
 * ticket balance is settled at the register by whoever is on the counter; a
 * house account is settled monthly by one person who is not on the floor.
 * Summing them into one figure would produce a number nobody is responsible for.
 *
 * Aged from the day the debt was incurred rather than from today's balance,
 * because "how long has this been outstanding" is the entire question. Anything
 * past sixty days in a shop that sells to walk-ins is a conversation, not a
 * receivable.
 */
export function receivablesAging(asOf: string): AgingBucket[] {
  const db = getDb();
  const buckets = [
    { label: "0–30 days", lo: 0, hi: 30 },
    { label: "31–60 days", lo: 31, hi: 60 },
    { label: "61–90 days", lo: 61, hi: 90 },
    { label: "Over 90 days", lo: 91, hi: 100000 },
  ];

  const tickets = db
    .prepare(
      `SELECT CAST(julianday(?) - julianday(s.business_date) AS INTEGER) AS age,
              s.balance_cents AS cents
         FROM sales s
        WHERE s.deleted = 0 AND s.status <> 'voided' AND s.balance_cents > 0`,
    )
    .all(asOf) as { age: number; cents: number }[];

  const accounts = db
    .prepare(
      `SELECT CAST(julianday(?) - julianday(d) AS INTEGER) AS age, cents FROM (
         SELECT s.business_date AS d, p.amount_cents AS cents
           FROM payments p
           JOIN sales s ON s.id = p.sale_id
           JOIN payment_methods m ON m.id = p.method_id
          WHERE m.code = 'credit_account' AND s.deleted = 0 AND s.customer_id IS NOT NULL
          UNION ALL
         SELECT a.business_date, -a.amount_cents FROM account_payments a
       )`,
    )
    .all(asOf) as { age: number; cents: number }[];

  return buckets.map((b) => ({
    label: b.label,
    ticketCents: tickets
      .filter((r) => r.age >= b.lo && r.age <= b.hi)
      .reduce((n, r) => n + r.cents, 0),
    accountCents: accounts
      .filter((r) => r.age >= b.lo && r.age <= b.hi)
      .reduce((n, r) => n + r.cents, 0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers
// ─────────────────────────────────────────────────────────────────────────────

export type CustomerStats = {
  /** Tickets that took a name at all, against those that did not. */
  named: number;
  anonymous: number;
  newCustomers: number;
  returningCustomers: number;
  top: { customerId: number; name: string; tickets: number; spentCents: number }[];
};

/**
 * Who the shop sold to.
 *
 * NEW means the window contains their first ticket ever, not their first in the
 * window — a customer of three years who happens not to have been in since
 * January is not a new customer, and counting them as one would make the
 * new-customer figure a measure of how long the window is.
 *
 * The anonymous count is here because it bounds everything else on this panel.
 * A shop that takes a name on one ticket in five cannot conclude much about
 * repeat business, and the figure says so out loud rather than letting the
 * percentages imply a certainty they do not have.
 */
export function customerStats(from: string, to: string): CustomerStats {
  const db = getDb();

  const counts = db
    .prepare(
      `SELECT SUM(CASE WHEN s.customer_id IS NULL THEN 1 ELSE 0 END) AS anonymous,
              SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS named
         FROM sales s
        WHERE ${SALE} AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { anonymous: number | null; named: number | null };

  const seen = db
    .prepare(
      `SELECT s.customer_id AS id,
              MIN(first.d) AS firstEver
         FROM sales s
         JOIN (SELECT customer_id, MIN(business_date) AS d
                 FROM sales
                WHERE deleted = 0 AND status = 'completed' AND kind = 'sale'
                  AND customer_id IS NOT NULL
             GROUP BY customer_id) first ON first.customer_id = s.customer_id
        WHERE ${SALE} AND s.customer_id IS NOT NULL
          AND s.business_date BETWEEN ? AND ?
     GROUP BY s.customer_id`,
    )
    .all(from, to) as { id: number; firstEver: string }[];

  const top = db
    .prepare(
      `SELECT s.customer_id AS customerId, c.name,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS spentCents
         FROM sales s
         JOIN customers c ON c.id = s.customer_id
        WHERE ${SALE} AND s.customer_id IS NOT NULL
          AND s.business_date BETWEEN ? AND ?
     GROUP BY s.customer_id
     ORDER BY spentCents DESC
        LIMIT 12`,
    )
    .all(from, to) as CustomerStats["top"];

  return {
    named: counts.named ?? 0,
    anonymous: counts.anonymous ?? 0,
    newCustomers: seen.filter((r) => r.firstEver >= from).length,
    returningCustomers: seen.filter((r) => r.firstEver < from).length,
    top,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Control: the things worth a second look
// ─────────────────────────────────────────────────────────────────────────────

export type ControlStats = {
  voids: { count: number; cents: number; byName: { name: string; count: number; cents: number }[] };
  refunds: { count: number; cents: number };
  discounts: { count: number; cents: number; byName: { name: string; count: number; cents: number }[] };
  /** Lines sold away from the rack price, and by how much in total. */
  overrides: { count: number; deltaCents: number };
  /** Tickets whose money moved after they were completed. */
  lateEdits: number;
  /** Stock sold that the racks said was gone. */
  oversells: number;
  /** Register checks that did not balance, and the worst of them. */
  badChecks: { count: number; worstCents: number };
};

/**
 * Everything on one panel that an owner should glance at and usually ignore.
 *
 * None of these is wrong by itself. A void is how a mistake gets corrected, a
 * discount is how a regular gets looked after, and a price override is a
 * judgement somebody is paid to make. What matters is the SHAPE — one person
 * accounting for most of them, or a month where the count doubles — and a shape
 * is only visible when the figures are side by side and attributed.
 */
export function controlStats(from: string, to: string): ControlStats {
  const db = getDb();

  const voids = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(s.total_cents), 0) AS cents
         FROM sales s
        WHERE s.deleted = 0 AND s.status = 'voided' AND s.kind = 'sale'
          AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { count: number; cents: number };

  const voidBy = db
    .prepare(
      `SELECT COALESCE(e.name, 'Unknown') AS name, COUNT(*) AS count,
              COALESCE(SUM(s.total_cents), 0) AS cents
         FROM sales s LEFT JOIN employees e ON e.id = s.voided_by
        WHERE s.deleted = 0 AND s.status = 'voided' AND s.kind = 'sale'
          AND s.business_date BETWEEN ? AND ?
     GROUP BY s.voided_by ORDER BY count DESC`,
    )
    .all(from, to) as { name: string; count: number; cents: number }[];

  const refunds = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(-p.amount_cents), 0) AS cents
         FROM payments p
        WHERE p.kind = 'refund' AND p.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { count: number; cents: number };

  const discounts = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(s.discount_cents), 0) AS cents
         FROM sales s
        WHERE ${SALE} AND s.discount_cents > 0 AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { count: number; cents: number };

  const discountBy = db
    .prepare(
      `SELECT COALESCE(e.name, 'Unknown') AS name, COUNT(*) AS count,
              COALESCE(SUM(s.discount_cents), 0) AS cents
         FROM sales s LEFT JOIN employees e ON e.id = s.discount_by
        WHERE ${SALE} AND s.discount_cents > 0 AND s.business_date BETWEEN ? AND ?
     GROUP BY s.discount_by ORDER BY cents DESC`,
    )
    .all(from, to) as { name: string; count: number; cents: number }[];

  const overrides = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(i.line_total_cents - i.list_price_cents * i.qty), 0) AS deltaCents
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE ${SALE} AND i.voided = 0 AND i.list_price_cents IS NOT NULL
          AND i.line_total_cents <> i.list_price_cents * i.qty
          AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { count: number; deltaCents: number };

  /**
   * Tickets whose money moved AFTER they were finished.
   *
   * Read off the `sale_status` the audit row recorded AT THE TIME, not off the
   * ticket's status now. Those are very different questions and the second is
   * useless: nearly every ticket ends up completed, so "was this edited, and is
   * it completed now" counts ordinary ticket-building — a line typed, corrected
   * and rung — as though somebody had gone back into a closed sale. On this
   * shop's own week that reads 24 where the truth is 9, and a control panel
   * that cries wolf is one nobody opens twice.
   */
  const lateEdits = db
    .prepare(
      `SELECT COUNT(DISTINCT a.target_id) AS n
         FROM audit_log a
        WHERE a.action IN ('sale_item.update', 'sale_item.void')
          AND a.target_type = 'sale'
          AND json_extract(a.details, '$.sale_status') = 'completed'
          AND date(a.timestamp) BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number };

  /**
   * Stock sold that the racks said was gone, AND THAT NOBODY HAS LOOKED AT.
   *
   * `reviewed_at IS NULL` is the whole difference between a panel worth opening
   * and one that is ignored by March. An oversell is a flag, not a verdict — a
   * manager clears it by counting the size and signing it off — and the rest of
   * the app has always read them that way (`listOversells`). Counting them
   * regardless meant every oversell ever recorded kept shouting after it had
   * been dealt with, which is exactly the growing-list failure the account
   * sign-off was built to avoid.
   */
  const oversells = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements
        WHERE oversold = 1 AND reviewed_at IS NULL
          AND business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number };

  // `rc.deleted = 0`, which was missing. A removed register log is removed
  // everywhere or it is not removed at all — this is the forgotten-WHERE bug
  // the append-only ledgers exist to make impossible, and it is possible here
  // precisely because a register check is an entity rather than a ledger row.
  const checks = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(MAX(ABS(worst)), 0) AS worstCents
         FROM (SELECT rc.id,
                      (SELECT MIN(cc.counted_cents - cc.expected_cents)
                         FROM register_check_counts cc WHERE cc.check_id = rc.id) AS worst
                 FROM register_checks rc
                WHERE rc.deleted = 0
                  AND rc.business_date BETWEEN ? AND ?
                  AND EXISTS (SELECT 1 FROM register_check_counts cc
                               WHERE cc.check_id = rc.id
                                 AND cc.counted_cents <> cc.expected_cents))`,
    )
    .get(from, to) as { count: number; worstCents: number };

  return {
    voids: { count: voids.count, cents: voids.cents, byName: voidBy },
    refunds,
    discounts: { count: discounts.count, cents: discounts.cents, byName: discountBy },
    overrides,
    lateEdits: lateEdits.n,
    oversells: oversells.n,
    badChecks: { count: checks.count, worstCents: checks.worstCents },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// What the shop could not sell
// ─────────────────────────────────────────────────────────────────────────────

export type LostRow = { size: string; tires: number; asks: number; onHand: number | null };

/**
 * Demand that walked out, from the counter's own study, alongside the searches
 * that came back empty.
 *
 * Two different qualities of evidence and they are kept apart. A recorded lost
 * sale is somebody watching a customer leave; an empty search is a keystroke,
 * which might be a typo or the same person trying four spellings. The first is
 * worth acting on and the second is worth glancing at, and averaging them would
 * lose that.
 */
export function lostDemand(from: string, to: string): { recorded: LostRow[]; searched: LostRow[] } {
  const db = getDb();

  // The column is named rather than aliased. A correlated subquery cannot see
  // the SELECT list it sits in, so referring to the output name silently is not
  // an option — SQLite rejects it outright, which is the good outcome.
  const onHandFor = (col: string) => `(SELECT SUM(mv.qty_delta)
                                         FROM inventory_movements mv
                                         JOIN products p ON p.id = mv.product_id
                                        WHERE p.deleted = 0 AND p.tire_size = ${col})`;

  const recorded = db
    .prepare(
      `SELECT size_norm AS size,
              COALESCE(SUM(qty), 0) AS tires, COUNT(*) AS asks,
              ${onHandFor("tire_demand.size_norm")} AS onHand
         FROM tire_demand
        WHERE business_date BETWEEN ? AND ?
     GROUP BY size_norm
     ORDER BY tires DESC, asks DESC
        LIMIT 20`,
    )
    .all(from, to) as LostRow[];

  const searched = db
    .prepare(
      `SELECT normalized_query AS size,
              0 AS tires, COUNT(*) AS asks,
              ${onHandFor("product_searches.normalized_query")} AS onHand
         FROM product_searches
        WHERE business_date BETWEEN ? AND ?
          AND (result_count = 0 OR in_stock = 0)
     GROUP BY normalized_query
       HAVING asks > 1
     ORDER BY asks DESC
        LIMIT 20`,
    )
    .all(from, to) as LostRow[];

  return { recorded, searched };
}

// ─────────────────────────────────────────────────────────────────────────────
// Buybacks
// ─────────────────────────────────────────────────────────────────────────────

export type PurchaseSummary = { tickets: number; costCents: number; units: number };

/** Used tires bought over the counter — money out, and stock in. */
export function purchaseSummary(from: string, to: string): PurchaseSummary {
  const r = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS tickets,
              COALESCE(SUM(s.subtotal_cents), 0) AS costCents,
              COALESCE((SELECT SUM(i.qty) FROM sale_items i
                         JOIN sales s2 ON s2.id = i.sale_id
                        WHERE s2.kind = 'purchase' AND s2.deleted = 0
                          AND s2.status = 'completed' AND i.voided = 0
                          AND s2.business_date BETWEEN ? AND ?), 0) AS units
         FROM sales s
        WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'purchase'
          AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to, from, to) as PurchaseSummary;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// The headline
// ─────────────────────────────────────────────────────────────────────────────

export type Headline = {
  goodsCents: number;
  collectedCents: number;
  tickets: number;
  avgTicketCents: number;
  discountsCents: number;
  tipsCents: number;
  /** Ex-tax revenue less cost, over the lines that carry a cost. */
  marginCents: number;
  marginPct: number;
  costCoveragePct: number;
  /** The same figures over the window immediately before this one. */
  prior: { goodsCents: number; tickets: number; avgTicketCents: number };
};

/**
 * The six numbers at the top, and the same window before this one to read them
 * against.
 *
 * The prior window is the SAME LENGTH ending the day before this one starts —
 * not "last month" — so a fortnight is compared against a fortnight whatever
 * dates were chosen. Comparing an arbitrary window against a calendar period is
 * how a report tells somebody trade collapsed when all that happened is that
 * they picked eleven days.
 */
export function headline(from: string, to: string): Headline {
  const db = getDb();

  const one = (a: string, b: string) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS goods,
                COALESCE(SUM(s.discount_cents), 0) AS discounts,
                COUNT(*) AS tickets
           FROM sales s
          WHERE ${SALE} AND s.business_date BETWEEN ? AND ?`,
      )
      .get(a, b) as { goods: number; discounts: number; tickets: number };

  const now = one(from, to);

  // The window before, of equal length.
  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  const priorEnd = new Date(`${from}T00:00:00Z`);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - (days - 1));
  const before = one(
    priorStart.toISOString().slice(0, 10),
    priorEnd.toISOString().slice(0, 10),
  );

  const money = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_cents), 0) AS collected,
              COALESCE(SUM(p.tip_cents), 0) AS tips
         FROM payments p JOIN sales s ON s.id = p.sale_id
        WHERE s.deleted = 0 AND p.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { collected: number; tips: number };

  const costed = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN i.unit_cost_cents > 0
                               THEN i.line_total_cents ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN i.unit_cost_cents > 0
                               THEN i.unit_cost_cents * i.qty ELSE 0 END), 0) AS cost,
              COALESCE(SUM(i.line_total_cents), 0) AS allRevenue
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { revenue: number; cost: number; allRevenue: number };

  const exTaxRevenue = exTax(costed.revenue);
  const marginCents = exTaxRevenue - costed.cost;

  return {
    goodsCents: now.goods,
    collectedCents: money.collected,
    tickets: now.tickets,
    avgTicketCents: now.tickets > 0 ? Math.round(now.goods / now.tickets) : 0,
    discountsCents: now.discounts,
    tipsCents: money.tips,
    marginCents,
    marginPct: exTaxRevenue > 0 ? (marginCents / exTaxRevenue) * 100 : 0,
    costCoveragePct:
      costed.allRevenue > 0 ? Math.round((costed.revenue / costed.allRevenue) * 100) : 0,
    prior: {
      goodsCents: before.goods,
      tickets: before.tickets,
      avgTicketCents: before.tickets > 0 ? Math.round(before.goods / before.tickets) : 0,
    },
  };
}
