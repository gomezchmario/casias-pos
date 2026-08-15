import { getDb } from "./db";
import { taxIncludedInCents } from "./money";
import { getSetting } from "./settings";
import { COST_JOINS, assumedCostSql } from "./costs";
import { techPeriod, tipsByTech } from "./leaderboard";
import { normalizeTireSize, USED_POOL_SKU } from "./tire-size";

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
              COALESCE(SUM(CASE WHEN ${assumedCostSql()} IS NOT NULL
                                THEN ${assumedCostSql()} * i.qty ELSE 0 END), 0) AS costCents,
              COALESCE(SUM(CASE WHEN ${assumedCostSql()} IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) AS costedRevenueCents
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         ${COST_JOINS}
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date BETWEEN ? AND ?
     -- The EXPRESSION, not the bare name. SQLite binds a lone code to the real
     -- column in preference to the output alias, so lines with no category
     -- grouped apart from lines whose category IS other — and both printed as
     -- "other", two rows deep in the same table. Same trap that once collapsed
     -- the trends chart; see the note on part in trends.ts.
     GROUP BY COALESCE(c.code, 'other')
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

export type StaffingSlot = {
  weekday: number;
  hour: number;
  /** Customers to expect in that hour, averaged over the window. */
  avgTickets: number;
  /** How this hour compares with the busiest hour of the week, 0–1. */
  share: number;
};

export type Staffing = {
  from: string;
  to: string;
  tickets: number;
  /** Technician hours the time clock actually recorded in the window. */
  techHours: number;
  /**
   * Whether there are enough recorded hours to work a pace out of.
   *
   * FALSE IS THE INTERESTING CASE and the reason this flag exists rather than a
   * silent fallback. If the technicians are not clocking in, the shop cannot be
   * told how many technicians it needs — only how the work is spread. A report
   * that quietly substituted a made-up pace would answer the question with a
   * number nobody could trace, which is worse than saying it does not know.
   */
  paceFromData: boolean;
  /** The trading hours the grid covers, low to high. */
  hours: number[];
  slots: StaffingSlot[];
  /** Per weekday: the busiest hour and the customers that day carries. */
  days: {
    weekday: number;
    peakHour: number;
    peakTickets: number;
    openHours: number;
    tickets: number;
  }[];
  /**
   * The answer at several plausible paces, because the shop knows its own.
   *
   * Rather than inventing one figure for how long a job takes, the report hands
   * over the arithmetic at a few rates and lets whoever reads it pick the line
   * that matches what they see on the floor. A mount-and-balance set is not a
   * flat repair, and nobody in this office knows that better than the owner.
   */
  atPace: { perHour: number; label: string; peak: { weekday: number; techs: number }[] }[];
};

/**
 * How the work is spread across the week, and what that means for cover.
 *
 * WHAT THIS CAN AND CANNOT SAY. The shape of the week is solid — it is counted
 * off every ticket the shop rang, and it says exactly where the load falls.
 * What it cannot do on its own is turn that into a number of people, because
 * that needs a pace: how many customers one technician gets through in an hour.
 *
 * The honest source for that pace is the shop's own time clock — tickets served
 * divided by technician-hours clocked. Where those hours exist this reports
 * them. Where they do not, `paceFromData` comes back false and the report says
 * so plainly instead of substituting a figure from somebody else's shop and
 * presenting the result as arithmetic.
 *
 * Either way `atPace` gives the answer at several rates, so the owner can read
 * off the line that matches what actually happens in the bay.
 */
export function staffingNeed(from: string, to: string): Staffing {
  const db = getDb();

  const cells = hourHeatmap(from, to);
  const tickets = cells.reduce((n, c) => n + c.tickets, 0);

  /*
    Technician minutes on the clock: every check-in paired with that person's
    next entry the same day, capped at nine at night the way the auto-close
    caps it, so a shift left open cannot read as twelve hours. The types are
    `check_in`/`check_out` — the timeclock's own words, and worth naming here
    because guessing them wrong is silent: the query returns zero, which is
    indistinguishable from nobody having clocked in.
  */
  const minutes = (
    db
      .prepare(
        `SELECT COALESCE(SUM(
                  MIN(
                    (julianday(COALESCE(
                       (SELECT MIN(t2.timestamp) FROM time_entries t2
                         WHERE t2.employee_id = t.employee_id
                           AND t2.timestamp > t.timestamp
                           AND substr(t2.timestamp,1,10) = substr(t.timestamp,1,10)),
                       substr(t.timestamp,1,10) || 'T21:00:00'))
                     - julianday(t.timestamp)) * 1440,
                    720)
                ), 0) AS mins
           FROM time_entries t
           JOIN employees e ON e.id = t.employee_id
          WHERE e.pos_role = 'technician'
            -- BOTH kinds of start. A day with a lunch break in it is two work
            -- stretches, not one: check_in opens the morning and break_end
            -- opens the afternoon. Counting only check_in silently loses every
            -- hour after lunch, which is more than half the day.
            AND t.type IN ('check_in', 'break_end')
            AND substr(t.timestamp, 1, 10) BETWEEN ? AND ?`,
      )
      .get(from, to) as { mins: number }
  ).mins;

  const techHours = minutes / 60;
  /* Twenty hours is roughly one technician for half a week. Below that there is
     not enough on the clock to divide by — one person's odd afternoon would set
     the pace for the whole shop. */
  const paceFromData = techHours >= 20;

  // How many of each weekday the window held, so an average is an average.
  const dayCount = new Array(7).fill(0);
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    dayCount[cur.getUTCDay()] += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const hoursSeen = cells.map((c) => c.hour);
  const lo = hoursSeen.length ? Math.min(...hoursSeen) : 8;
  const hi = hoursSeen.length ? Math.max(...hoursSeen) : 18;
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  const raw: StaffingSlot[] = [];
  for (let wd = 0; wd < 7; wd++) {
    for (const h of hours) {
      const cell = cells.find((c) => c.weekday === wd && c.hour === h);
      raw.push({
        weekday: wd,
        hour: h,
        avgTickets: (cell?.tickets ?? 0) / Math.max(1, dayCount[wd]),
        share: 0,
      });
    }
  }
  const busiest = Math.max(...raw.map((s) => s.avgTickets), 0.001);
  const slots = raw.map((s) => ({ ...s, share: s.avgTickets / busiest }));

  const days = Array.from({ length: 7 }, (_, wd) => {
    const mine = slots.filter((s) => s.weekday === wd);
    const peak = mine.reduce((a, b) => (b.avgTickets > a.avgTickets ? b : a), mine[0]);
    return {
      weekday: wd,
      peakHour: peak?.hour ?? lo,
      peakTickets: peak?.avgTickets ?? 0,
      openHours: mine.filter((s) => s.avgTickets >= 0.5).length,
      tickets: mine.reduce((n, s) => n + s.avgTickets, 0),
    };
  });

  /*
    The same peak read at four paces. Stated as minutes per customer as well as
    customers per hour, because that is the form somebody standing in the bay
    can check against a watch.
  */
  const paces: [number, string][] = [
    [1.5, "40 minutes a customer — a set of four, mounted and balanced"],
    [2, "30 minutes a customer — a pair, or a set on a good day"],
    [3, "20 minutes a customer — flats, rotations, single tires"],
    [4, "15 minutes a customer — quick jobs, everything ready"],
  ];
  const atPace = paces.map(([perHour, label]) => ({
    perHour,
    label,
    peak: days.map((d) => ({
      weekday: d.weekday,
      // Rounded UP: half a technician cannot fit a tire, and the cost of
      // rounding down is a customer waiting in the lobby.
      techs: d.peakTickets === 0 ? 0 : Math.max(1, Math.ceil(d.peakTickets / perHour)),
    })),
  }));

  return { from, to, tickets, techHours, paceFromData, hours, slots, days, atPace };
}

export type SeasonalHours = {
  /** The calendar window, as month-day, repeated in every year of the data. */
  fromMD: string;
  toMD: string;
  /** What each year contributed, so a reader can see the mix rather than trust it. */
  years: { year: string; tickets: number; days: number }[];
  hours: number[];
  /** Per weekday and hour: the average customers across every year in the data. */
  slots: { weekday: number; hour: number; avgTickets: number; share: number }[];
  /** Days of each weekday the whole span held, which is what the averages divide by. */
  dayCount: number[];
  totalTickets: number;
};

/**
 * The same weeks of the year, every year the shop has records for.
 *
 * WHY THIS IS A DIFFERENT QUESTION from the four-week grid beside it. Four
 * weeks says how the shop is trading NOW, which is the right basis for next
 * week's roster and the wrong one for anything seasonal: a late-July heatmap
 * cannot tell you that late July is itself busy, because it has nothing to
 * compare against. Reading the same calendar window across every year does —
 * and for a tire shop, where heat and holidays move the work, that is the
 * difference between rostering for the season and rostering for last Tuesday.
 *
 * MATCHED ON MONTH AND DAY, not on a rolling span, so the window means the same
 * thing in each year. The wrap case is handled properly: a window running from
 * December into January is two ranges, not one impossible BETWEEN.
 *
 * IT REPORTS WHAT EACH YEAR CONTRIBUTED and does not smooth it away. This shop's
 * older years were kept in a workbook rather than on this register, and one of
 * them holds twice the tickets of the next — which may be a busier year or may
 * be a better-kept one. An average that hid that would be a confident number
 * resting on a difference in bookkeeping.
 */
export function seasonalHours(fromMD: string, toMD: string): SeasonalHours {
  const db = getDb();
  // A window that runs backwards through New Year is two ranges.
  const wraps = fromMD > toMD;
  const inWindow = wraps
    ? `(substr(s.business_date, 6, 5) >= '${fromMD}' OR substr(s.business_date, 6, 5) <= '${toMD}')`
    : `substr(s.business_date, 6, 5) BETWEEN '${fromMD}' AND '${toMD}'`;

  const cells = db
    .prepare(
      `SELECT CAST(strftime('%w', s.business_date) AS INTEGER) AS weekday,
              CAST(strftime('%H', s.opened_at) AS INTEGER)     AS hour,
              COUNT(*) AS tickets
         FROM sales s
        WHERE ${SALE} AND ${inWindow}
     GROUP BY weekday, hour`,
    )
    .all() as { weekday: number; hour: number; tickets: number }[];

  const years = db
    .prepare(
      `SELECT substr(s.business_date, 1, 4) AS year,
              COUNT(*) AS tickets,
              COUNT(DISTINCT s.business_date) AS days
         FROM sales s
        WHERE ${SALE} AND ${inWindow}
     GROUP BY year
     ORDER BY year`,
    )
    .all() as { year: string; tickets: number; days: number }[];

  /*
    How many of each weekday the whole span actually held — counted off the
    dates that carry tickets rather than off the calendar. A shop that was shut
    for a fortnight in one of these years should not have those Sundays counted
    against it as quiet Sundays; the days it did not trade are days it has
    nothing to say about.
  */
  const dayCount = new Array(7).fill(0);
  const dates = db
    .prepare(
      `SELECT DISTINCT s.business_date AS d
         FROM sales s
        WHERE ${SALE} AND ${inWindow}`,
    )
    .all() as { d: string }[];
  for (const { d } of dates) {
    const [y, m, dd] = d.split("-").map(Number);
    dayCount[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] += 1;
  }

  const hoursSeen = cells.map((c) => c.hour);
  const lo = hoursSeen.length ? Math.min(...hoursSeen) : 8;
  const hi = hoursSeen.length ? Math.max(...hoursSeen) : 18;
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  const raw = [];
  for (let wd = 0; wd < 7; wd++) {
    for (const h of hours) {
      const cell = cells.find((c) => c.weekday === wd && c.hour === h);
      raw.push({
        weekday: wd,
        hour: h,
        avgTickets: (cell?.tickets ?? 0) / Math.max(1, dayCount[wd]),
        share: 0,
      });
    }
  }
  const busiest = Math.max(...raw.map((r) => r.avgTickets), 0.001);

  return {
    fromMD,
    toMD,
    years,
    hours,
    dayCount,
    slots: raw.map((r) => ({ ...r, share: r.avgTickets / busiest })),
    totalTickets: cells.reduce((n, c) => n + c.tickets, 0),
  };
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
                     -- The snapshot where there is one, the product's own
                     -- cost where there is not. Every imported line is the
                     -- second case: the old workbook recorded no costs.
                     SUM(COALESCE(NULLIF(i.unit_cost_cents, 0), pp.default_cost_cents, 0) * i.qty) AS cost
                FROM sale_items i
                JOIN sales s ON s.id = i.sale_id
           LEFT JOIN products pp ON pp.id = i.product_id
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
 *
 * THE UNSORTED USED PILE IS THE ONE EXEMPTION. It is a row that holds stock and
 * makes no sales of its own — the sales happen against the sizes it is listed
 * into — so it would sit at the top of this list forever on a technicality,
 * priced at zero because a used tire has no recorded cost. A permanent $0 row
 * at the head of the list of where the cash is, is how a list stops being read.
 * The tires in it are not exempt from this question, only deferred: they get
 * counted here under their real size the moment somebody lists them.
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
            AND p.sku <> '${USED_POOL_SKU}'
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
/**
 * A number of tires a shop would actually hold, rounded up from a rate.
 *
 * NEVER THREE, and never five or seven. A car has four wheels, so tires move in
 * ones, pairs and sets — a customer buys one, two, or four, and a fleet buys
 * six or eight. Three on a shelf is two with an orphan, and a reorder point of
 * three would keep re-ordering the orphan forever.
 *
 * Rounded UP rather than to the nearest, because the failure this list exists
 * to prevent is running out. Past twelve the named steps stop and it rounds to
 * the next even number, which is still a pair.
 */
export function tireQuantity(rate: number): number {
  const STEPS = [1, 2, 4, 6, 8, 10, 12];
  const want = Math.max(1, rate);
  for (const step of STEPS) if (want <= step) return step;
  return Math.ceil(want / 2) * 2;
}

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
        // A fortnight of sales at the observed rate, snapped to a number of
        // tires a shop actually holds. A starting figure rather than an answer:
        // the right span is a fortnight only if the truck comes in a fortnight,
        // and nothing here knows that.
        suggested: tireQuantity(perDay * 14),
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

export type LostRow = {
  size: string;
  tires: number;
  asks: number;
  onHand: number | null;
  /**
   * The text resolved to a whole tire size.
   *
   * False on the debris the search box logs on the way to a real query — "21545"
   * typed on the way to "2154517", "USE" on the way to "USED", a size with a
   * brand still half-typed after it. Those are keystrokes rather than questions,
   * and the report hides them unless somebody asks to see them.
   */
  complete: boolean;
};

/**
 * The size somebody was actually looking for, out of whatever they typed.
 *
 * "2154517", "215/45/17", "215 45 17" and "215-45-17" are one size and must
 * count as one row — the register's own `normalizeTireSize` already settles
 * that. What it cannot settle is a size with a brand trailing after it
 * ("2259016 TRANS EAGLE 16"), so the first token is tried on its own as well.
 *
 * Returns null when nothing in the text resolves to a full size, which is the
 * signal that this was a keystroke rather than a question.
 */
function sizeFromQuery(raw: string): string | null {
  const whole = /^\d{2,3}-\d{2,3}(\.\d)?-\d{2}(\.\d)?$/;
  const one = normalizeTireSize(raw);
  if (whole.test(one)) return one;
  const first = normalizeTireSize(raw.trim().split(/\s+/)[0] ?? "");
  return whole.test(first) ? first : null;
}

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

  /*
    Grouped in JavaScript rather than in SQL, and it has to be — twice over.

    The search box logs on every keystroke, so one customer asking for a
    215/45/17 leaves "2", "21", "215", "21545", "215451" and "2154517" behind
    it. Grouping on the stored text counts that as six different sizes nobody
    had — the exact opposite of what the panel is for. Only `sizeFromQuery` can
    tell which of those six is a question, and it is not expressible in SQL.

    ONE CUSTOMER IS ONE ASK, however many times the size was typed. Even after
    the keystrokes collapse onto a size, the count is still inflated by the
    counter searching a size, talking to the customer, and searching it again to
    be sure. So repeats of the same size are ignored unless there is a gap
    between them: two minutes, long enough to swallow a size looked up three
    times while somebody is still standing there, short enough that the next
    customer asking for the same size an hour later counts again — which is the
    whole thing this panel is trying to measure.

    That second pass walks the rows in time order rather than grouping them,
    because "how many gaps are there in this run of timestamps" is not a
    question GROUP BY can answer.
  */
  const hits = db
    .prepare(
      `SELECT normalized_query AS q, created_at AS at
         FROM product_searches
        WHERE business_date BETWEEN ? AND ?
          AND (result_count = 0 OR in_stock = 0)
     ORDER BY created_at`,
    )
    .all(from, to) as { q: string; at: string }[];

  const APART_MS = 2 * 60 * 1000;
  const lastSeen = new Map<string, number>();
  const raw: { q: string; n: number }[] = [];
  const counted = new Map<string, number>();

  for (const h of hits) {
    // Keyed on the SIZE rather than on the text, so "2154517" typed at 10:00
    // and "215/45/17" typed at 10:01 are the same customer asking once.
    const key = sizeFromQuery(h.q) ?? h.q;
    const at = Date.parse(h.at.replace(" ", "T"));
    const prev = lastSeen.get(key);
    if (prev !== undefined && Number.isFinite(at) && at - prev < APART_MS) {
      lastSeen.set(key, at);
      continue;
    }
    if (Number.isFinite(at)) lastSeen.set(key, at);
    // The text of the first hit in each run carries the row, so a size that
    // only ever arrived half-typed still reports as half-typed.
    counted.set(h.q, (counted.get(h.q) ?? 0) + 1);
  }
  for (const [q, n] of counted) raw.push({ q, n });

  const onHandBySize = new Map(
    (
      db
        .prepare(
          `SELECT p.tire_size AS size, SUM(mv.qty_delta) AS q
             FROM inventory_movements mv
             JOIN products p ON p.id = mv.product_id
            WHERE p.deleted = 0 AND p.tire_size IS NOT NULL
         GROUP BY p.tire_size`,
        )
        .all() as { size: string; q: number }[]
    ).map((r) => [r.size, r.q]),
  );

  const merged = new Map<string, LostRow>();
  for (const r of raw) {
    const size = sizeFromQuery(r.q);
    const key = size ?? r.q;
    const row = merged.get(key) ?? {
      size: key,
      tires: 0,
      asks: 0,
      onHand: size ? (onHandBySize.get(size) ?? null) : null,
      complete: size !== null,
    };
    row.asks += r.n;
    merged.set(key, row);
  }

  const searched = [...merged.values()]
    // Whole sizes first, then by how often. The toggle on the page decides
    // whether the incomplete half is drawn at all; the order is the same either
    // way so nothing jumps when it is switched.
    .sort((a, b) => Number(b.complete) - Number(a.complete) || b.asks - a.asks)
    .slice(0, 40);

  return { recorded, searched };
}

/**
 * New tires through the door, both directions, over a window — as COUNTS.
 *
 * The inventory fold's opening tiles. Same definitions as the month sheets on
 * the movements page — sold means a completed sale line pointing at a new
 * tire, stocked means a `receive` movement on one — so a week read here and a
 * month printed there can never disagree about what counts as a tire moving.
 * Units only, no money: the fold is a manager's screen, and what the shop PAID
 * stays behind `viewCosts`.
 */
export function tiresInOut(from: string, to: string): { soldUnits: number; receivedUnits: number } {
  const db = getDb();
  const sold = db
    .prepare(
      `SELECT COALESCE(SUM(i.qty), 0) AS n
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
        WHERE ${SALE} AND i.voided = 0
          AND p.kind = 'tire' AND p.condition = 'new'
          AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number };
  const received = db
    .prepare(
      `SELECT COALESCE(SUM(m.qty_delta), 0) AS n
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
        WHERE m.reason = 'receive'
          AND p.kind = 'tire' AND p.condition = 'new'
          AND m.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number };
  return { soldUnits: sold.n, receivedUnits: received.n };
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
      `SELECT COALESCE(SUM(CASE WHEN ${assumedCostSql()} IS NOT NULL
                               THEN i.line_total_cents ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN ${assumedCostSql()} IS NOT NULL
                               THEN ${assumedCostSql()} * i.qty ELSE 0 END), 0) AS cost,
              COALESCE(SUM(i.line_total_cents), 0) AS allRevenue
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
         ${COST_JOINS}
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

// ─────────────────────────────────────────────────────────────────────────────
// The people
// ─────────────────────────────────────────────────────────────────────────────

export type EmployeeRow = {
  employeeId: number;
  name: string;
  role: string;
  active: number;
  newTires: number;
  usedTires: number;
  otherCount: number;
  ticketCount: number;
  incomeCents: number;
  tipCents: number;
  /** Days this person was credited with anything — the only attendance the sales records can prove. */
  daysWorked: number;
  lastDay: string | null;
  perDayCents: number;
  perTicketCents: number;
  tipPerTicketCents: number;
  incomePct: number;
  prior: { incomeCents: number; daysWorked: number; perDayCents: number };
};

/**
 * The credit union, spelled once.
 *
 * A line can pay two people — the seller of an ordered tire and whoever fitted
 * it days later — and `techPeriod` in leaderboard.ts already settles how that
 * splits. Attendance has to be counted over the SAME union or a fitter who only
 * ever mounted other people's tires reads as never having come in.
 */
const CREDIT_DAYS = `
  SELECT i.mechanic_id AS emp, s.business_date AS d
    FROM sale_items i JOIN sales s ON s.id = i.sale_id
   WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id IS NOT NULL
     AND s.business_date BETWEEN ? AND ?
   UNION
  SELECT i.mount_mechanic_id, s.business_date
    FROM sale_items i JOIN sales s ON s.id = i.sale_id
   WHERE ${SALE} AND i.voided = 0 AND i.mount_mechanic_id IS NOT NULL
     AND s.business_date BETWEEN ? AND ?`;

/** Days present and the last of them, per person, over a window. */
function attendance(from: string, to: string): Map<number, { days: number; lastDay: string }> {
  const rows = getDb()
    .prepare(
      `SELECT emp, COUNT(*) AS days, MAX(d) AS lastDay
         FROM (${CREDIT_DAYS})
     GROUP BY emp`,
    )
    .all(from, to, from, to) as { emp: number; days: number; lastDay: string }[];
  return new Map(rows.map((r) => [r.emp, { days: r.days, lastDay: r.lastDay }]));
}

/**
 * How each technician did, against how they did over the window before it.
 *
 * BUILT ON WHAT THE RECORDS CAN ACTUALLY PROVE, which is a shorter list than it
 * looks. The obvious performance measure — money per hour on the clock — is not
 * here, and deliberately: the time clock has a handful of entries against two
 * and a half years of sales, so a revenue-per-hour column would be blank for
 * everybody and wrong for the two it wasn't. Days credited is the attendance
 * this data can support, so that is what per-day is divided by.
 *
 * Who was at the counter is not measured either. Every imported ticket names
 * one person as cashier because the workbook it came from never recorded that,
 * and a chart of it would say far more about the import than about the shop.
 *
 * The prior window is the same length ending the day before this one, matching
 * the headline tiles, so a delta here and a delta there mean the same thing.
 */
export function employeePerformance(
  from: string,
  to: string,
): { rows: EmployeeRow[]; priorFrom: string; priorTo: string; priorTradingDays: number } {
  const db = getDb();
  const span =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const priorTo = shiftDate(from, -1);
  const priorFrom = shiftDate(priorTo, -(span - 1));

  const now = techPeriod(from, to);
  const before = new Map(techPeriod(priorFrom, priorTo).map((t) => [t.employeeId, t]));
  const tips = new Map(tipsByTech(from, to).map((t) => [t.employeeId, t.tipCents]));
  const daysNow = attendance(from, to);
  const daysBefore = attendance(priorFrom, priorTo);
  const who = new Map(
    (
      db.prepare("SELECT id, pos_role AS role, active FROM employees").all() as {
        id: number;
        role: string;
        active: number;
      }[]
    ).map((e) => [e.id, e]),
  );

  const total = now.reduce((n, t) => n + t.incomeCents, 0);

  /*
    Whether the window before this one has any record of the shop opening.
    Eleven weeks of 2026 do not — the workbooks the history was rebuilt from
    never covered them — and without this the page would draw every technician
    as down 100% for a fortnight nobody wrote down. The page checks it and says
    so instead of drawing an arrow.
  */
  const priorTradingDays = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT s.business_date) AS d FROM sales s
          WHERE ${SALE} AND s.business_date BETWEEN ? AND ?`,
      )
      .get(priorFrom, priorTo) as { d: number }
  ).d;

  const rows = now.map((t) => {
    const d = daysNow.get(t.employeeId);
    const pd = daysBefore.get(t.employeeId);
    const p = before.get(t.employeeId);
    const days = d?.days ?? 0;
    const priorDays = pd?.days ?? 0;
    const priorIncome = p?.incomeCents ?? 0;
    const tipCents = tips.get(t.employeeId) ?? 0;
    return {
      ...t,
      role: who.get(t.employeeId)?.role ?? "technician",
      active: who.get(t.employeeId)?.active ?? 0,
      tipCents,
      daysWorked: days,
      lastDay: d?.lastDay ?? null,
      // Per DAY PRESENT, not per day in the window. Somebody who works
      // Saturdays only is not a sixth as productive as somebody who works six
      // days, and a column that said so would be read as saying they were.
      perDayCents: days > 0 ? Math.round(t.incomeCents / days) : 0,
      perTicketCents: t.ticketCount > 0 ? Math.round(t.incomeCents / t.ticketCount) : 0,
      tipPerTicketCents: t.ticketCount > 0 ? Math.round(tipCents / t.ticketCount) : 0,
      incomePct: total > 0 ? (t.incomeCents / total) * 100 : 0,
      prior: {
        incomeCents: priorIncome,
        daysWorked: priorDays,
        perDayCents: priorDays > 0 ? Math.round(priorIncome / priorDays) : 0,
      },
    };
  });

  return { rows, priorFrom, priorTo, priorTradingDays };
}

/**
 * The last twelve months of each technician's income, for a sparkline.
 *
 * Not windowed, and it must not be: the point of the row of bars beside a name
 * is to say whether the figure to its left is where that person has always been
 * or somewhere they have just arrived, and a shape drawn only over the window
 * cannot answer that.
 */
export function employeeSparks(
  to: string,
  months = 12,
): { months: string[]; byEmployee: Record<number, number[]> } {
  const start = `${shiftMonths(to.slice(0, 7), -(months - 1))}-01`;
  const keys = bucketsBetween(start, to, "month");
  const rows = getDb()
    .prepare(
      `SELECT emp, bucket, SUM(cents) AS cents FROM (
         SELECT i.mechanic_id AS emp, substr(s.business_date, 1, 7) AS bucket,
                i.line_total_cents
                  - CASE WHEN i.mount_mechanic_id IS NULL THEN 0
                         ELSE MIN(i.mount_unit_cents * i.qty, i.line_total_cents) END AS cents
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id IS NOT NULL
            AND s.business_date BETWEEN ? AND ?
          UNION ALL
         SELECT i.mount_mechanic_id, substr(s.business_date, 1, 7),
                MIN(i.mount_unit_cents * i.qty, i.line_total_cents)
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.mount_mechanic_id IS NOT NULL
            AND s.business_date BETWEEN ? AND ?
       ) GROUP BY emp, bucket`,
    )
    .all(start, to, start, to) as { emp: number; bucket: string; cents: number }[];

  const byEmployee: Record<number, number[]> = {};
  for (const r of rows) {
    const series = (byEmployee[r.emp] ??= keys.map(() => 0));
    const at = keys.indexOf(r.bucket);
    if (at >= 0) series[at] = r.cents;
  }
  return { months: keys, byEmployee };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

/** A month key, `n` months away: "2026-08" → "2025-08". */
function shiftMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** A date, `n` days away. */
function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
