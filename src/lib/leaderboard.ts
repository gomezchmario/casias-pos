import { getDb } from "./db";
import { getSetting } from "./settings";

/**
 * The per-technician scoreboard that replaces the spreadsheet's weekly
 * dashboard: who sold what, what share of the shop's income each one brought
 * in, and whether they are up or down on last week.
 *
 * Everything here reads live from `sale_items` joined to `sales`, filtered to
 * completed, non-voided, non-deleted sale tickets. Purchases are excluded
 * throughout -- buying a used tire off a walk-in is money going out, and
 * letting it count toward a technician's income would reward them for spending.
 */

export type TechPeriod = {
  employeeId: number;
  name: string;
  /** Tires sold, counted in units rather than lines: a single line for four
   *  tires is four tires. This is what "MOST TIRES SOLD" means. */
  newTires: number;
  usedTires: number;
  /** Everything that is not a tire -- flats, mounts, oil, disposal. Counted in
   *  lines, because "3 flats" is the meaningful unit and a qty on a flat is
   *  rare enough not to matter. */
  otherCount: number;
  /** What those non-tire lines were worth. Kept apart from `incomeCents`
   *  because "most services" is a question about labour, and a technician who
   *  sold one set of four tires would win a blended figure without having
   *  turned a single wrench. */
  otherIncomeCents: number;
  /** Tickets they appear on, not lines. A ticket worked by two technicians
   *  counts once for each of them -- they both worked it. */
  ticketCount: number;
  incomeCents: number;
};

export type TechDayTips = {
  employeeId: number;
  name: string;
  tipCents: number;
};

export type RecentLine = {
  saleId: number;
  saleNo: string;
  description: string;
  techName: string | null;
  at: string;
  totalCents: number;
  service: string;
  voided: boolean;
  saleVoided: boolean;
};

/**
 * The business week containing `businessDate`, honouring `week_start_day`
 * (0 = Sunday ... 6 = Saturday; the shop runs 4, Thursday to Thursday).
 *
 * Dates are handled as plain YYYY-MM-DD strings on a UTC clock rather than as
 * local Date objects. A business date is already a calendar label -- the
 * timezone work was done when it was computed -- and constructing a local Date
 * from it would let a DST boundary shift the week by a day.
 */
export function weekRange(
  businessDate: string,
  weekStartDay = Number(getSetting("week_start_day")),
): { start: string; end: string } {
  const d = new Date(`${businessDate}T00:00:00Z`);
  const shift = (d.getUTCDay() - weekStartDay + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { start, end: d.toISOString().slice(0, 10) };
}

/** The week before the one containing `businessDate`. */
export function previousWeekRange(
  businessDate: string,
  weekStartDay = Number(getSetting("week_start_day")),
): { start: string; end: string } {
  const { start } = weekRange(businessDate, weekStartDay);
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return weekRange(d.toISOString().slice(0, 10), weekStartDay);
}

/** Whole days from `from` to `to`, both plain YYYY-MM-DD on the UTC clock. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * The slice of last week that covers the same days of the week as this week so
 * far -- Thursday through Sunday on a Sunday, the whole week on a Wednesday.
 *
 * This is what makes the improvement column mean anything. Measuring four days
 * of trading against a full seven guarantees every technician shows red on a
 * Sunday and green on a Wednesday, which says nothing about them and trains
 * people to ignore the number. Comparing like days against like days is the
 * only version of "up or down on last week" that a person can act on.
 *
 * Naturally becomes the whole prior week on the last day of the week, so there
 * is no separate case for a completed week.
 */
export function comparableRange(
  businessDate: string,
  weekStartDay = Number(getSetting("week_start_day")),
): { start: string; end: string; days: number } {
  const week = weekRange(businessDate, weekStartDay);
  const prior = previousWeekRange(businessDate, weekStartDay);
  // Clamped, because `businessDate` can sit outside its own week only if a
  // caller hands us something malformed -- and a negative span would silently
  // invert the range into one that matches nothing.
  const days = Math.min(7, Math.max(1, daysBetween(week.start, businessDate) + 1));
  const end = new Date(`${prior.start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return { start: prior.start, end: end.toISOString().slice(0, 10), days };
}

/**
 * The three spans the shop thinks in. The week is what people are measured and
 * paid on; the month is what someone asks about when they want to know whether
 * a good week was a fluke; the day is what the floor asks about while it is
 * still happening.
 *
 * The day is deliberately last in importance and first in immediacy. Nobody is
 * paid on one day and a single day of tire work is weather as much as effort —
 * but the board is on the wall all afternoon, and "who is winning right now" is
 * the question it actually gets asked. Offering it is better than watching
 * somebody mentally do it off the weekly column, which is the same guess made
 * worse.
 */
export type StandingsPeriod = "day" | "week" | "month";

/** Last day of the month containing `date`, as YYYY-MM-DD. */
function endOfMonth(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * The period so far, and the matching slice of the period before it.
 *
 * "Matching" is the whole point and is the same argument as `comparableRange`:
 * four days of trading measured against a full seven -- or six days of a month
 * against thirty-one -- guarantees a red number that says nothing about the
 * person it is next to. The prior span always covers the same NUMBER of days,
 * starting from the same place in its own period.
 *
 * Months are clamped, because a 31-day span starting on 1 March has no
 * counterpart in February. Comparing 31 days to 28 is still lopsided, but it is
 * the honest maximum, and `days` is returned so callers can say so on screen.
 */
export function periodRange(
  businessDate: string,
  period: StandingsPeriod,
  weekStartDay = Number(getSetting("week_start_day")),
): { start: string; end: string; days: number; priorStart: string; priorEnd: string } {
  if (period === "day") {
    // One day against the one before it. Not "the same day last week", which
    // would be the tidier comparison and the wrong one: the point of the day
    // board is what is happening now, and a Tuesday-to-Tuesday delta is a
    // statistic, not something anybody on the floor is going to act on before
    // they go home.
    const before = new Date(`${businessDate}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);
    const prior = before.toISOString().slice(0, 10);
    return {
      start: businessDate,
      end: businessDate,
      days: 1,
      priorStart: prior,
      priorEnd: prior,
    };
  }

  if (period === "week") {
    const week = weekRange(businessDate, weekStartDay);
    const c = comparableRange(businessDate, weekStartDay);
    return {
      start: week.start,
      end: businessDate,
      days: c.days,
      priorStart: c.start,
      priorEnd: c.end,
    };
  }

  const start = `${businessDate.slice(0, 7)}-01`;
  const days = Math.max(1, daysBetween(start, businessDate) + 1);
  const before = new Date(`${start}T00:00:00Z`);
  before.setUTCDate(0); // last day of the previous month
  const priorStart = `${before.toISOString().slice(0, 7)}-01`;
  const priorLast = endOfMonth(priorStart);
  const wanted = new Date(`${priorStart}T00:00:00Z`);
  wanted.setUTCDate(wanted.getUTCDate() + days - 1);
  const priorEnd = wanted.toISOString().slice(0, 10);
  return {
    start,
    end: businessDate,
    days,
    priorStart,
    priorEnd: priorEnd > priorLast ? priorLast : priorEnd,
  };
}

/**
 * Per-technician totals over a date range.
 *
 * New and used tires are counted separately and never summed into a single
 * "tires" figure, because they are different businesses: a new tire has a cost
 * and a margin, a used one is priced at the counter from its condition. A
 * blended number would not be true of either.
 *
 * Lines with no technician are dropped rather than bucketed under "Unassigned".
 * This is a leaderboard -- a row nobody can be credited or held to is noise on
 * it. The day's totals elsewhere still count that money.
 */
export function techPeriod(start: string, end: string): TechPeriod[] {
  return getDb()
    .prepare(
      `SELECT i.mechanic_id                        AS employeeId,
              e.name                               AS name,
              COALESCE(SUM(CASE WHEN c.code = 'new_tire'  THEN i.qty END), 0) AS newTires,
              COALESCE(SUM(CASE WHEN c.code = 'used_tire' THEN i.qty END), 0) AS usedTires,
              COALESCE(SUM(CASE WHEN c.code IS NULL
                                  OR c.code NOT IN ('new_tire', 'used_tire')
                                THEN 1 END), 0)    AS otherCount,
              COALESCE(SUM(CASE WHEN c.code IS NULL
                                  OR c.code NOT IN ('new_tire', 'used_tire')
                                THEN i.line_total_cents END), 0) AS otherIncomeCents,
              COUNT(DISTINCT i.sale_id)            AS ticketCount,
              COALESCE(SUM(i.line_total_cents), 0) AS incomeCents
         FROM sale_items i
         JOIN sales s     ON s.id = i.sale_id
         JOIN employees e ON e.id = i.mechanic_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE s.business_date BETWEEN ? AND ?
          AND s.deleted = 0
          AND s.status = 'completed'
          AND s.kind = 'sale'
          AND i.voided = 0
          AND i.mechanic_id IS NOT NULL
     GROUP BY i.mechanic_id
     ORDER BY incomeCents DESC`,
    )
    .all(start, end) as TechPeriod[];
}

/**
 * Tips earned per technician on one business day.
 *
 * The technician's share, not the customer's charge: `tip_cents` is what was
 * left for them and `comm_cents` -- the shop's cut for the tax on it -- is
 * deliberately not added back. Showing a technician a number they will not be
 * handed would be the wrong figure on the one report they care most about.
 *
 * Summed across every ledger row including reversals, which carry the negative
 * of what they undo, so a voided ticket's tip cancels itself out here with no
 * special case. Rows that net to zero are dropped for that reason.
 */
export function dayTipsByTech(businessDate: string): TechDayTips[] {
  return getDb()
    .prepare(
      `SELECT p.mechanic_id            AS employeeId,
              e.name                   AS name,
              COALESCE(SUM(p.tip_cents), 0) AS tipCents
         FROM payments p
         JOIN employees e ON e.id = p.mechanic_id
        WHERE p.business_date = ?
          AND p.mechanic_id IS NOT NULL
     GROUP BY p.mechanic_id
       HAVING tipCents <> 0
     ORDER BY tipCents DESC`,
    )
    .all(businessDate) as TechDayTips[];
}

/**
 * The day's lines, newest first -- the spreadsheet's LAST TRANSACTIONS strip.
 *
 * Voided lines and voided tickets are included and flagged rather than
 * filtered, because the whole reason to look at a consecutive list is to find
 * the thing that went wrong. Hiding the voids would hide exactly what is being
 * looked for. Callers that want only live money filter on the flags.
 */
export function recentLines(businessDate: string, limit = 200): RecentLine[] {
  return getDb()
    .prepare(
      `SELECT s.id                          AS saleId,
              s.sale_no                     AS saleNo,
              i.description                 AS description,
              e.name                        AS techName,
              COALESCE(s.completed_at, s.opened_at) AS at,
              i.line_total_cents            AS totalCents,
              COALESCE(c.label, 'Other Service')    AS service,
              i.voided                      AS voided,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS saleVoided
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN employees e ON e.id = i.mechanic_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE s.business_date = ?
          AND s.deleted = 0
          AND s.kind = 'sale'
     ORDER BY i.id DESC
        LIMIT ?`,
    )
    .all(businessDate, limit)
    .map((r) => {
      const row = r as Omit<RecentLine, "voided" | "saleVoided"> & {
        voided: number;
        saleVoided: number;
      };
      return { ...row, voided: !!row.voided, saleVoided: !!row.saleVoided };
    });
}

export type TechScore = TechPeriod & {
  /** Share of the shop's income this period, 0-100. */
  incomePct: number;
  /** Share of all the period's non-tire revenue, 0-100. The service-work
   *  equivalent of `incomePct`, and the figure the podium ranks on when money
   *  itself is being withheld. */
  otherIncomePct: number;
  /** Change against the same days of last week, as a percentage of those days.
   *  Null when they did not work them — there is no honest percentage change
   *  from zero, and rendering one as +100% or ∞ would put a number on the board
   *  that means nothing. */
  improvementPct: number | null;
  tipCentsToday: number;
  /** Last week over the SAME span of days as this week so far, not the whole
   *  of it. See `comparableRange`. */
  prior: { newTires: number; usedTires: number; otherCount: number; incomeCents: number };
};

export type Standings = {
  period: StandingsPeriod;
  /** The period so far: `start` to the business date, and how many days that is. */
  range: { start: string; end: string; days: number };
  /** The same number of days of the period before. See `periodRange`. */
  priorRange: { start: string; end: string };
  totalIncomeCents: number;
  /** All technicians' non-tire revenue, the denominator for a share of the
   *  service work as opposed to a share of everything. */
  totalOtherIncomeCents: number;
  techs: TechScore[];
};

/**
 * The board over one period, against the matching slice of the period before,
 * with today's tips alongside.
 *
 * Everyone who appears in either period is on it. Someone who sold nothing this
 * week but worked last week has to stay visible — a name quietly dropping off
 * the board is how a problem goes unnoticed for a month.
 *
 * Tips are always TODAY's regardless of the period. They are a "what am I taking
 * home tonight" figure, and a monthly tip total on a board headed by a monthly
 * podium would be read as this month's takings by someone who came to check one
 * number.
 */
export function standings(
  businessDate: string,
  period: StandingsPeriod = "week",
): Standings {
  const r = periodRange(businessDate, period);

  // The period runs start-to-today, not start-to-end: the rest of it has not
  // happened, and including it would be harmless only until someone back-dates
  // a ticket.
  const current = techPeriod(r.start, businessDate);
  const prior = new Map(techPeriod(r.priorStart, r.priorEnd).map((t) => [t.employeeId, t]));
  const tips = new Map(dayTipsByTech(businessDate).map((t) => [t.employeeId, t.tipCents]));

  const totalIncomeCents = current.reduce((s, t) => s + t.incomeCents, 0);
  const totalOtherIncomeCents = current.reduce((s, t) => s + t.otherIncomeCents, 0);

  const byId = new Map<number, TechPeriod>();
  for (const t of current) byId.set(t.employeeId, t);
  for (const [id, p] of prior) {
    if (!byId.has(id)) {
      byId.set(id, {
        employeeId: id,
        name: p.name,
        newTires: 0,
        usedTires: 0,
        otherCount: 0,
        otherIncomeCents: 0,
        ticketCount: 0,
        incomeCents: 0,
      });
    }
  }

  const techs = [...byId.values()].map((t): TechScore => {
    const p = prior.get(t.employeeId);
    const priorIncome = p?.incomeCents ?? 0;
    return {
      ...t,
      incomePct: totalIncomeCents > 0 ? (t.incomeCents / totalIncomeCents) * 100 : 0,
      otherIncomePct:
        totalOtherIncomeCents > 0 ? (t.otherIncomeCents / totalOtherIncomeCents) * 100 : 0,
      improvementPct:
        priorIncome > 0 ? ((t.incomeCents - priorIncome) / priorIncome) * 100 : null,
      tipCentsToday: tips.get(t.employeeId) ?? 0,
      prior: {
        newTires: p?.newTires ?? 0,
        usedTires: p?.usedTires ?? 0,
        otherCount: p?.otherCount ?? 0,
        incomeCents: priorIncome,
      },
    };
  });

  techs.sort((a, b) => b.incomeCents - a.incomeCents);
  return { period, range: r, priorRange: { start: r.priorStart, end: r.priorEnd }, totalIncomeCents, totalOtherIncomeCents, techs };
}

/**
 * The week board in the shape the day screen has always taken. A thin wrapper
 * over `standings` so there is one implementation of "who did what", not two
 * that drift.
 */
export function leaderboard(businessDate: string): Standings & {
  week: { start: string; end: string };
  priorWeek: { start: string; end: string };
  /** The days of last week the `prior` figures actually cover. */
  comparable: { start: string; end: string; days: number };
} {
  const s = standings(businessDate, "week");
  return {
    ...s,
    week: weekRange(businessDate),
    priorWeek: previousWeekRange(businessDate),
    comparable: { ...s.priorRange, days: s.range.days },
  };
}
