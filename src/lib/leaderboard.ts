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

export type TechTips = {
  employeeId: number;
  name: string;
  tipCents: number;
};

export type RecentLine = {
  saleId: number;
  saleNo: string;
  description: string;
  /**
   * How many, because the description does not say.
   *
   * A line reading "FLAT $45.00" and a line reading "3× FLAT $45.00" are two
   * very different afternoons, and without this the dashboard drew the first
   * one for both — the only clue being a total that looked wrong to anybody who
   * knew the price. The ticket drawer and the receipt have always shown it.
   */
  qty: number;
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
 *
 * ONE LINE CAN PAY TWO PEOPLE. An ordered tire is sold by whoever was at the
 * counter and fitted, days later, by whoever was free -- see
 * migrations/018_mount_credit.sql -- so the query works over a union of credits
 * rather than straight over the lines:
 *
 *   the seller  keeps the line minus the fitting, and keeps the TIRE COUNT
 *               whole, because they sold the tires whoever bolted them on;
 *   the fitter   takes the fitting, counted as service work, because mounting
 *               and balancing is exactly that and a technician who spent
 *               Thursday doing it should not read as idle.
 *
 * The two halves always sum to `line_total_cents`, so the shop's income is the
 * same number it was before any of this existed -- nothing is created here,
 * only moved. The clamp is what guarantees it: on a line worth less than the
 * fitting rate the credit is the whole line and the seller keeps nothing,
 * rather than the seller going negative to pay a fitter more than the customer
 * paid.
 */
export function techPeriod(start: string, end: string): TechPeriod[] {
  return getDb()
    .prepare(
      `WITH line AS (
         SELECT i.sale_id,
                i.qty,
                i.mechanic_id,
                i.mount_mechanic_id,
                i.line_total_cents,
                CASE WHEN i.mount_mechanic_id IS NULL THEN 0
                     ELSE MIN(i.mount_unit_cents * i.qty, i.line_total_cents)
                END AS mountCents,
                c.code AS cat
           FROM sale_items i
           JOIN sales s ON s.id = i.sale_id
      LEFT JOIN service_categories c ON c.id = i.category_id
          WHERE s.business_date BETWEEN ? AND ?
            AND s.deleted = 0
            AND s.status = 'completed'
            AND s.kind = 'sale'
            AND i.voided = 0
       ),
       credit AS (
         SELECT mechanic_id AS employeeId,
                sale_id,
                CASE WHEN cat = 'new_tire'  THEN qty ELSE 0 END AS newTires,
                CASE WHEN cat = 'used_tire' THEN qty ELSE 0 END AS usedTires,
                CASE WHEN cat IS NULL OR cat NOT IN ('new_tire', 'used_tire')
                     THEN 1 ELSE 0 END AS otherCount,
                CASE WHEN cat IS NULL OR cat NOT IN ('new_tire', 'used_tire')
                     THEN line_total_cents - mountCents ELSE 0 END AS otherIncomeCents,
                line_total_cents - mountCents AS incomeCents
           FROM line
          WHERE mechanic_id IS NOT NULL
          UNION ALL
         SELECT mount_mechanic_id, sale_id, 0, 0, 1, mountCents, mountCents
           FROM line
          WHERE mount_mechanic_id IS NOT NULL AND mountCents > 0
       )
       SELECT r.employeeId                          AS employeeId,
              e.name                                AS name,
              COALESCE(SUM(r.newTires), 0)          AS newTires,
              COALESCE(SUM(r.usedTires), 0)         AS usedTires,
              COALESCE(SUM(r.otherCount), 0)        AS otherCount,
              COALESCE(SUM(r.otherIncomeCents), 0)  AS otherIncomeCents,
              COUNT(DISTINCT r.sale_id)             AS ticketCount,
              COALESCE(SUM(r.incomeCents), 0)       AS incomeCents
         FROM credit r
         JOIN employees e ON e.id = r.employeeId
     GROUP BY r.employeeId
     ORDER BY incomeCents DESC`,
    )
    .all(start, end) as TechPeriod[];
}

/**
 * The last day before `businessDate` that each technician was credited with
 * anything, keyed by employee.
 *
 * THE DAY BOARD'S COMPARISON, and the reason it is not simply yesterday.
 * Technicians are not all in every day. Measured against the calendar day
 * before, anyone who was off reads as having collapsed to nothing — a column of
 * red −100%s that says only "he was not here on Tuesday", printed beside the
 * names of the people who were. That is not a comparison, it is an accusation
 * with a rota behind it.
 *
 * So each person is measured against their own last shift. "Better or worse
 * than the last time you did this job" is the question somebody on the floor
 * can actually answer, which is the only kind of number worth putting on a
 * board they read on their way out.
 *
 * Credited BY EITHER ROUTE — the line's own technician or the fitter on a
 * mounted tire — so a day spent bolting on somebody else's sale counts as a day
 * at work. It has to: `techPeriod` pays those two halves separately, and a
 * prior day chosen by one rule and scored by the other would compare a
 * technician against a day they are not credited for.
 */
export function lastWorkedDayByTech(businessDate: string): Map<number, string> {
  const rows = getDb()
    .prepare(
      `SELECT employeeId, MAX(business_date) AS day
         FROM (
              SELECT i.mechanic_id AS employeeId, s.business_date
                FROM sale_items i JOIN sales s ON s.id = i.sale_id
               WHERE s.business_date < ? AND s.deleted = 0
                 AND s.status = 'completed' AND s.kind = 'sale'
                 AND i.voided = 0 AND i.mechanic_id IS NOT NULL
              UNION ALL
              SELECT i.mount_mechanic_id, s.business_date
                FROM sale_items i JOIN sales s ON s.id = i.sale_id
               WHERE s.business_date < ? AND s.deleted = 0
                 AND s.status = 'completed' AND s.kind = 'sale'
                 AND i.voided = 0 AND i.mount_mechanic_id IS NOT NULL
                 AND i.mount_unit_cents > 0
              )
        GROUP BY employeeId`,
    )
    .all(businessDate, businessDate) as { employeeId: number; day: string }[];
  return new Map(rows.map((r) => [r.employeeId, r.day]));
}

/**
 * Tips earned per technician over a range of business days.
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
export function tipsByTech(start: string, end: string): TechTips[] {
  return getDb()
    .prepare(
      `SELECT p.mechanic_id            AS employeeId,
              e.name                   AS name,
              COALESCE(SUM(p.tip_cents), 0) AS tipCents
         FROM payments p
         JOIN employees e ON e.id = p.mechanic_id
        WHERE p.business_date BETWEEN ? AND ?
          AND p.mechanic_id IS NOT NULL
     GROUP BY p.mechanic_id
       HAVING tipCents <> 0
     ORDER BY tipCents DESC`,
    )
    .all(start, end) as TechTips[];
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
              i.qty                         AS qty,
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

export type RecentTicket = {
  saleNo: string;
  businessDate: string;
  at: string;
  totalCents: number;
  /** What was rung, as one line — "2× 205/55R16, MOUNT & B". */
  what: string;
  /** Whose hands were on it, distinct. Empty when nobody was named. */
  techs: string;
  /**
   * Who bolted the tires on, when that is NOT who sold them. Empty otherwise.
   *
   * Only the difference is reported, which is the whole value of it. On the
   * overwhelming majority of tickets the fitter and the seller are the same
   * person and saying so twice is noise; the board is for spotting the ticket
   * that is not like the others, and this is one of the ways a ticket differs.
   */
  fitters: string;
  /** Tips on this ticket, off the payment ledger. Zero on most of them. */
  tipCents: number;
  voided: boolean;
};

/**
 * The last tickets rung, newest first — one row per ticket, not per line.
 *
 * The floor's own check on the register. A technician who fitted four tires
 * wants to see a ticket for four tires at the price they quoted, against their
 * name; that is a question about the whole ticket, and the line-by-line strip on
 * the dashboard answers a different one. Rung as $8 instead of $80, or against
 * the wrong person, is the kind of mistake that is obvious to the man who did
 * the work and invisible in a month-end report.
 *
 * Scoped to one business day, which is what makes it checkable. The man reading
 * it is looking for the ticket he just watched being rung, and yesterday's work
 * pushing this morning's off the bottom of a twelve-row list is exactly the
 * failure that matters. It costs an empty board for the first hour of a day, and
 * that is the right trade: an empty board is true.
 *
 * Voided tickets stay, struck through by the caller. They are most of the point:
 * the thing being looked for is the ticket that went wrong, and a list that
 * quietly drops the corrections is a list that cannot show a correction was
 * made.
 *
 * Open tickets are left out. A ticket somebody is still building is not yet a
 * claim about anything, and putting a half-rung total on a wall invites an
 * argument about a number that was never meant to be read.
 */
export function recentTickets(businessDate: string, limit = 12): RecentTicket[] {
  const rows = getDb()
    .prepare(
      `SELECT s.sale_no       AS saleNo,
              s.business_date AS businessDate,
              COALESCE(s.completed_at, s.opened_at) AS at,
              s.total_cents   AS totalCents,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS voided,
              COALESCE((SELECT GROUP_CONCAT(
                          CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                               ELSE i.description END, ', ')
                          FROM sale_items i
                         WHERE i.sale_id = s.id AND i.voided = 0), '') AS what,
              (SELECT GROUP_CONCAT(DISTINCT COALESCE(e.name, i.mechanic_name))
                 FROM sale_items i
            LEFT JOIN employees e ON e.id = i.mechanic_id
                WHERE i.sale_id = s.id AND i.voided = 0) AS techs,
              -- Only where the fitter is someone OTHER than the seller. On most
              -- tickets they are the same person, and naming them twice would
              -- bury the handful where the work was actually split.
              (SELECT GROUP_CONCAT(DISTINCT f.name)
                 FROM sale_items i
                 JOIN employees f ON f.id = i.mount_mechanic_id
                WHERE i.sale_id = s.id AND i.voided = 0
                  AND i.mount_mechanic_id IS NOT NULL
                  AND (i.mechanic_id IS NULL OR i.mount_mechanic_id <> i.mechanic_id)) AS fitters,
              -- Off the ledger, not off the sale header: a tip added the day
              -- after still belongs to the ticket it was left on, and the header
              -- is a cache that a late adjustment has to catch up with.
              COALESCE((SELECT SUM(p.tip_cents) FROM payments p
                         WHERE p.sale_id = s.id), 0) AS tipCents
         FROM sales s
        WHERE s.deleted = 0
          AND s.kind = 'sale'
          AND s.status <> 'open'
          AND s.business_date = ?
     ORDER BY s.id DESC
        LIMIT ?`,
    )
    .all(businessDate, limit) as (Omit<
    RecentTicket,
    "techs" | "fitters" | "voided"
  > & {
    techs: string | null;
    fitters: string | null;
    voided: number;
  })[];

  // GROUP_CONCAT's separator is a bare comma and cannot be given one while it
  // is also being asked for DISTINCT, so the space goes on here.
  return rows.map((r) => ({
    ...r,
    techs: (r.techs ?? "").split(",").filter(Boolean).join(", "),
    fitters: (r.fitters ?? "").split(",").filter(Boolean).join(", "),
    voided: !!r.voided,
  }));
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
  /**
   * Tips over the whole period, as opposed to `tipCentsToday`.
   *
   * Both, because the two answer different questions and the board asks both at
   * once. "What am I taking home tonight" is today's and belongs beside the
   * weekly table whatever period is selected; "who earns the tips around here"
   * is the period's, and a podium headed "employee of the month" ranked on one
   * afternoon's tips would be a lie told in large type on a wall.
   */
  tipCents: number;
  /**
   * Tips over the SAME span of the period before — last week's tips beside this
   * week's, last month's beside this month's.
   *
   * The tips column was the one figure on the board with nothing to read it
   * against. Every other column has its counterpart three cells to the left, so
   * "is this a good week" is answered by looking sideways; tips sat on their
   * own and could only be judged against whatever somebody remembered.
   *
   * On the day board it is the technician's own last shift, exactly like
   * `prior` — see `lastWorkedDayByTech`.
   */
  priorTipCents: number;
  /** Share of everything the shop was tipped this period, 0-100. What the tip
   *  figure becomes when the dollars are being withheld — it keeps the order
   *  and the proportions and drops the amount. */
  tipPct: number;
  /** Last week over the SAME span of days as this week so far, not the whole
   *  of it. See `comparableRange`. */
  prior: { newTires: number; usedTires: number; otherCount: number; incomeCents: number };
  /**
   * The day the `prior` figures came from, when it is this technician's own —
   * the day board and nowhere else. Null on week and month, where everybody is
   * measured against the same span and the range on the board says which.
   *
   * Null on the day board too for someone who has never worked before today,
   * whose `prior` is therefore zero and whose improvement is null. That is the
   * honest answer: there is nothing to compare a first shift to.
   */
  priorDate: string | null;
};

export type Standings = {
  period: StandingsPeriod;
  /** The period so far: `start` to the business date, and how many days that is. */
  range: { start: string; end: string; days: number };
  /** The same number of days of the period before. See `periodRange`. */
  priorRange: { start: string; end: string };
  /**
   * The prior figures are each technician's OWN last shift rather than one
   * shared span — true on the day board only. When it is set, `priorRange` is
   * merely the earliest and latest of those days and must not be printed as
   * though everybody was measured over it.
   */
  priorPerTech: boolean;
  totalIncomeCents: number;
  /** All technicians' non-tire revenue, the denominator for a share of the
   *  service work as opposed to a share of everything. */
  totalOtherIncomeCents: number;
  /** Everything the shop was tipped this period — the denominator behind
   *  `tipPct`, and the figure the weekly table foots its tip column with. */
  totalTipCents: number;
  /** The same over the period before, so the foot of the tip column can be read
   *  the way every row above it is. */
  totalPriorTipCents: number;
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

  /**
   * What each technician is measured against.
   *
   * One shared span on the week and month boards. On the day board it is per
   * person — their own last shift, not yesterday — so it is assembled a day at
   * a time. See `lastWorkedDayByTech` for why.
   *
   * Gathered by DISTINCT DAY rather than per technician: a shop of six people
   * who all worked Saturday is one query, not six.
   */
  const priorPerTech = period === "day";
  const lastWorked = priorPerTech ? lastWorkedDayByTech(businessDate) : new Map<number, string>();
  const prior = new Map<number, TechPeriod>();
  // Tips over the same prior span, gathered the same way and at the same time,
  // so the two halves of a row can never be measured over different days.
  const priorTips = new Map<number, number>();
  if (priorPerTech) {
    const byDay = new Map<string, Map<number, TechPeriod>>();
    const tipsByDay = new Map<string, Map<number, number>>();
    for (const day of new Set(lastWorked.values())) {
      byDay.set(day, new Map(techPeriod(day, day).map((t) => [t.employeeId, t])));
      tipsByDay.set(day, new Map(tipsByTech(day, day).map((t) => [t.employeeId, t.tipCents])));
    }
    for (const [employeeId, day] of lastWorked) {
      const t = byDay.get(day)?.get(employeeId);
      if (t) prior.set(employeeId, t);
      priorTips.set(employeeId, tipsByDay.get(day)?.get(employeeId) ?? 0);
    }
  } else {
    for (const t of techPeriod(r.priorStart, r.priorEnd)) prior.set(t.employeeId, t);
    for (const t of tipsByTech(r.priorStart, r.priorEnd)) priorTips.set(t.employeeId, t.tipCents);
  }

  // On the day board these two are the same query; asking twice for it would be
  // wasteful rather than wrong, so it is skipped.
  const periodTips = tipsByTech(r.start, businessDate);
  const todayTips = r.start === businessDate ? periodTips : tipsByTech(businessDate, businessDate);
  const tips = new Map(periodTips.map((t) => [t.employeeId, t.tipCents]));
  const tipsToday = new Map(todayTips.map((t) => [t.employeeId, t.tipCents]));

  const totalIncomeCents = current.reduce((s, t) => s + t.incomeCents, 0);
  const totalOtherIncomeCents = current.reduce((s, t) => s + t.otherIncomeCents, 0);
  const totalTipCents = periodTips.reduce((s, t) => s + t.tipCents, 0);

  const byId = new Map<number, TechPeriod>();
  for (const t of current) byId.set(t.employeeId, t);
  const blank = (employeeId: number, name: string) => {
    if (byId.has(employeeId)) return;
    byId.set(employeeId, {
      employeeId,
      name,
      newTires: 0,
      usedTires: 0,
      otherCount: 0,
      otherIncomeCents: 0,
      ticketCount: 0,
      incomeCents: 0,
    });
  };
  for (const [id, p] of prior) blank(id, p.name);
  // Somebody tipped but credited with no line still belongs on the board — a
  // tip is proof they worked, and dropping them would leave their money in
  // `totalTipCents` with nobody to attribute it to, so the shares would quietly
  // stop adding to a hundred.
  for (const t of [...periodTips, ...todayTips]) blank(t.employeeId, t.name);

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
      tipCentsToday: tipsToday.get(t.employeeId) ?? 0,
      tipCents: tips.get(t.employeeId) ?? 0,
      priorTipCents: priorTips.get(t.employeeId) ?? 0,
      tipPct: totalTipCents > 0 ? ((tips.get(t.employeeId) ?? 0) / totalTipCents) * 100 : 0,
      prior: {
        newTires: p?.newTires ?? 0,
        usedTires: p?.usedTires ?? 0,
        otherCount: p?.otherCount ?? 0,
        incomeCents: priorIncome,
      },
      // Only reported when it was actually used to fetch a figure. A date on a
      // row whose prior is zero would read as "he worked and sold nothing".
      priorDate: (p && lastWorked.get(t.employeeId)) || null,
    };
  });

  techs.sort((a, b) => b.incomeCents - a.incomeCents);

  // On the day board this is the span the individual days fall in, not a span
  // anybody was measured over — see `priorPerTech`.
  const usedDays = [...prior.keys()].map((id) => lastWorked.get(id)!).filter(Boolean).sort();
  return {
    period,
    range: r,
    priorRange: priorPerTech
      ? {
          start: usedDays[0] ?? r.priorStart,
          end: usedDays[usedDays.length - 1] ?? r.priorEnd,
        }
      : { start: r.priorStart, end: r.priorEnd },
    priorPerTech,
    totalIncomeCents,
    totalOtherIncomeCents,
    totalTipCents,
    // Footed off the same map the rows read, so the shop line and the column
    // above it cannot tell different stories.
    totalPriorTipCents: [...byId.keys()].reduce((n, id) => n + (priorTips.get(id) ?? 0), 0),
    techs,
  };
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
