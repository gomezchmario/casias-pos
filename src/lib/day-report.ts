import { getDb } from "./db";
import { roleAtLeast, type PosRole } from "./roles";
import { taxIncludedInCents } from "./money";
import { getSetting } from "./settings";
import { COST_JOINS, assumedCostSql } from "./costs";
import {
  dayByMechanic,
  dayDiscounts,
  dayTotals,
  dayTrend,
  houseAccountChargesForDay,
  outstandingTickets,
  stockReceivedForDay,
  type DayTotals,
  type DayDiscount,
  type MechanicTotal,
  type StockReceived,
} from "./pos-reports";
import { expectedByMethodForDay, listShifts, byCashier, type MethodExpectation } from "./shifts";
import { drawerMovementsForDay, type DrawerMovement } from "./drawer";
import { registerChecksForDay, type RegisterCheck } from "./register-checks";
import { listOversells } from "./inventory";
import { receivablesAging, type AgingBucket } from "./reports-bi";
import { pricingFlagCount } from "./pricing-flags";
import { hoursForDay, type DayHours } from "./hours";

/**
 * The Close-out V2 report: one business day, answered completely.
 *
 * ASSEMBLED, NOT RECOMPUTED. Nearly every figure here is produced by the same
 * function that produces it somewhere else — `dayTotals` for the takings,
 * `expectedByMethodForDay` for the drawer, `dayByMechanic` for the board,
 * `outstandingTickets` for what is owed. That is the design and it is not
 * laziness: the fastest way to destroy trust in a close-out is for it to quote
 * $4,012 where the day screen says $4,019, and the only reliable way to make
 * two screens agree forever is for them to be the same code. The queries that
 * ARE new here answer questions no other screen asks — voids by name, the
 * hour-by-hour shape, whether the racks moved in step with the tickets.
 *
 * WHAT THIS REPORT REFUSES TO FAKE, so the page can say so instead:
 *
 *   Revenue per HOUR, technician efficiency against book hours, and comeback
 *   rate all need hours worked or repair-order linkage, and this shop records
 *   neither — the time clock holds a handful of rows against years of sales.
 *   Publishing them would be publishing noise with a KPI's name on it.
 *
 *   Labor vs parts is expressed as SERVICE vs TIRES, because that is the
 *   distinction this shop's lines actually carry. A tire shop's "labor" is
 *   flats, mounts and rotations, and its "parts" wall is the tire racks.
 *
 *   Profit is computed only over lines that carry a cost, with the coverage
 *   printed beside it — same rule as everywhere else in the program.
 */

const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";

// ─────────────────────────────────────────────────────────────────────────────

export type HourBar = { hour: number; tickets: number; goodsCents: number };

export type VoidRow = {
  saleId: number;
  saleNo: string;
  totalCents: number;
  voidedByName: string | null;
  reason: string | null;
  voidedAt: string | null;
};

export type RefundRow = {
  saleId: number;
  saleNo: string;
  amountCents: number;
  byName: string | null;
  note: string | null;
  createdAt: string;
};

export type UnpaidRow = {
  saleId: number;
  saleNo: string;
  customerName: string | null;
  totalCents: number;
  balanceCents: number;
};

export type TopLine = { label: string; qty: number; cents: number };

/**
 * The alarms this person may be told about.
 *
 * Owner rank, which the viewer also carries — that account exists to see what
 * an owner sees, and an alarm it could not read would make it a poor stand-in
 * for the screen it is meant to be checking. Manager and below never receive
 * the row, so there is nothing for a client to leak.
 */
export function exceptionsFor(list: Exception[], role: PosRole): Exception[] {
  if (roleAtLeast(role, "owner")) return list;
  return list.filter((e) => !e.ownerOnly);
}

export type Exception = {
  /**
   * The alarm's identity, stable for the life of the shop.
   *
   * The text is written for a person and gets reworded; the code is what a
   * dismissal points at, so it must never be renamed once it has been used —
   * renaming one un-dismisses every alarm anybody ever waved away under the old
   * name. See `alarm_actions` in 036_alarms.sql.
   */
  code: string;
  /**
   * Only the owner may be told about this one.
   *
   * The register logs not balancing is a question about whoever counted the
   * drawer, and the people it is asking about are the people standing at the
   * counter reading the screen. Every other alarm here is work to be done and
   * belongs in front of whoever can do it; this one is the owner deciding
   * whether to ask somebody a question, and it should not announce itself to
   * the room first.
   *
   * Enforced where the report is SERVED, not where it is drawn — see
   * exceptionsFor. A page that hid the row would still have been handed the
   * text, and the text is the whole of what is being withheld.
   */
  ownerOnly?: boolean;
  /**
   * Whether this alarm is about THE DAY or about RIGHT NOW.
   *
   * Most are about the day: the tickets left open on it, the voids rung on it,
   * the drawer counted at the end of it. Reopening a report for last Tuesday
   * re-judges Tuesday, and the answer is a fact about Tuesday.
   *
   * Two are not. Oversells awaiting review and pricing warnings on the racks
   * are conditions of the shop as it stands, and they are on this page because
   * they are today's risk, not because they happened on the date at the top.
   * On a single-day report that distinction costs nothing. In the alarm log it
   * is the difference between an alarm and ninety copies of one — see
   * `alarmBook`, which is what forced the field to exist.
   */
  scope: "day" | "standing";
  severity: "serious" | "watch";
  text: string;
  /**
   * Who waved this away, when, and what they said — null while nobody has.
   *
   * Read off `alarm_actions` (036_alarms.sql), which the alarm log writes.
   * The alarm itself is still computed exactly as before and still fires: the
   * figures underneath it have not changed, and an alarm that could be switched
   * off would be switched off. What this does is let the page that shows it
   * distinguish "nobody has looked at this" from "Mario looked at it at 3:51
   * and said what it was" — which is the whole difference between a list worth
   * reading at close and a list of things somebody already dealt with.
   */
  dismissed: { byName: string; at: string; note: string } | null;
};

export type ChecklistItem = {
  label: string;
  /** true done · false pending · null = nothing to do today. */
  done: boolean | null;
  detail: string;
};

export type CloseoutV2 = {
  businessDate: string;
  totals: DayTotals;
  /** D-7 → D, zero-filled — the last bar is the day being read. */
  trend: ReturnType<typeof dayTrend>;
  compare: {
    yesterdayGoodsCents: number;
    sameDayLastWeekGoodsCents: number;
    avg7GoodsCents: number;
  };
  tenders: MethodExpectation[];
  drawer: {
    floatCents: number;
    /** When the opening drawer was counted, and by whom. Null = never counted
     *  today, so the float above is the standing figure and nothing more. */
    floatCountedAt: string | null;
    floatCountedByName: string | null;
    cashSalesCents: number;
    movementsCents: number;
    expectedCents: number;
    movements: DrawerMovement[];
    checks: RegisterCheck[];
  };
  tickets: {
    completed: number;
    open: number;
    voided: number;
    unpaid: UnpaidRow[];
    voids: VoidRow[];
    refunds: RefundRow[];
    discounts: DayDiscount[];
  };
  mechanics: MechanicTotal[];
  /** Hours on the clock, and how much of that was actually clocked out. */
  hours: DayHours;
  /**
   * What each person at the counter took in, and on which tenders.
   *
   * The tender split is the half that makes this printable. A cashier's total
   * answers "how much went through them"; the split answers the question
   * somebody actually has at the end of a shift — how much of that is cash
   * they should be handing over, and how much went to the card batch and is
   * nobody's to carry.
   */
  cashiers: {
    employeeId: number;
    name: string;
    collectedCents: number;
    tipCents: number;
    count: number;
    tenders: { methodId: number; label: string; isCard: number; count: number; cents: number; tipCents: number }[];
  }[];
  sold: {
    newTires: { units: number; cents: number };
    usedTires: { units: number; cents: number };
    service: { lines: number; cents: number };
    /** Every live line on the day's tickets — tires, services, everything. */
    lineCount: number;
    /** Tickets carrying at least one new tire, over completed tickets. */
    attachmentPct: number;
    disposalUnits: number;
    disposalCents: number;
    topProducts: TopLine[];
    topServices: TopLine[];
  };
  stock: {
    /** Tire units that left the racks on sale movements today. */
    unitsOut: number;
    /** Tire units on today's completed sale LINES. */
    unitsSoldOnTickets: number;
    /**
     * The two legitimate reasons the counts differ, measured so the exception
     * can subtract them before accusing anybody. An ordered tire is SOLD one
     * day and FITTED another: on the fitting day it is a movement with no
     * same-day line, and on the selling day it is a line with no same-day
     * movement. Both are the special-order design working, not stock walking.
     */
    fulfilledForEarlierUnits: number;
    awaitingFulfillmentUnits: number;
    received: StockReceived[];
    adjustments: number;
    unreviewedOversells: number;
    /** The rows behind the count — which tire, which ticket, who rang it. A
     *  warning that does not say WHERE is homework, not a warning. */
    oversellRows: {
      productName: string;
      tireSize: string | null;
      saleNo: string | null;
      byName: string | null;
      short: number;
      onHand: number;
    }[];
  };
  margin: {
    /** Ex-tax revenue on costed lines, minus their cost. */
    marginCents: number;
    marginPct: number;
    coveragePct: number;
  };
  owed: {
    outstandingTicketCents: number;
    outstandingTicketCount: number;
    aging: AgingBucket[];
    houseChargedTodayCents: number;
  };
  customers: {
    newToday: number;
    namedTickets: number;
    fleetChargesCents: number;
  };
  exceptions: Exception[];
  checklist: ChecklistItem[];
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each cashier's takings, split by tender.
 *
 * Built here rather than inside `byCashier` because that one is also the
 * shift-level figure on the close-out's own screen, and widening it would put
 * a query per cashier behind a number that only ever needed one total.
 *
 * Reads the same payments table and the same day, so the per-cashier totals
 * cannot disagree with the day's tender lines — they are the same rows grouped
 * two ways.
 */
function cashiersWithTenders(businessDate: string): CloseoutV2["cashiers"] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.id AS employeeId, e.name,
              m.id AS methodId, m.label, m.is_card AS isCard,
              COUNT(*) AS count,
              COALESCE(SUM(p.amount_cents), 0) AS cents,
              COALESCE(SUM(p.tip_cents), 0) AS tipCents
         FROM payments p
         JOIN employees e ON e.id = p.taken_by
         JOIN payment_methods m ON m.id = p.method_id
         -- The printed sheet is handed to a person as a record of what they
         -- took. A deleted ticket never happened, so it cannot be on it.
    LEFT JOIN sales ds ON ds.id = p.sale_id
        WHERE p.business_date = ? AND COALESCE(ds.deleted, 0) = 0
     GROUP BY e.id, m.id
     ORDER BY e.name, m.sort_order`,
    )
    .all(businessDate) as {
    employeeId: number;
    name: string;
    methodId: number;
    label: string;
    isCard: number;
    count: number;
    cents: number;
    tipCents: number;
  }[];

  const by = new Map<number, CloseoutV2["cashiers"][number]>();
  for (const r of rows) {
    const who = by.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      name: r.name,
      collectedCents: 0,
      tipCents: 0,
      count: 0,
      tenders: [],
    };
    who.collectedCents += r.cents;
    who.tipCents += r.tipCents;
    who.count += r.count;
    who.tenders.push({
      methodId: r.methodId,
      label: r.label,
      isCard: r.isCard,
      count: r.count,
      cents: r.cents,
      tipCents: r.tipCents,
    });
    by.set(r.employeeId, who);
  }
  return [...by.values()].sort((a, b) => b.collectedCents - a.collectedCents);
}

export function closeoutV2(businessDate: string): CloseoutV2 {
  const db = getDb();
  const totals = dayTotals(businessDate);
  const trend = dayTrend(businessDate, 7);
  const tenders = expectedByMethodForDay(businessDate);
  const currentBp = Number(getSetting("tax_rate_bp"));

  // ── The drawer, decomposed the same way the sheet that explains it is ─────
  const shiftsToday = listShifts(businessDate);
  const floatCents = shiftsToday.reduce((n, s) => n + s.opening_float_cents, 0);
  // The FIRST shift's count is the morning one; a second shift opening later in
  // the day is a handover, not the opening of the drawer.
  const firstShift = shiftsToday[0] ?? null;
  const floatCounter = firstShift?.float_counted_by
    ? (db
        .prepare("SELECT name FROM employees WHERE id = ?")
        .get(firstShift.float_counted_by) as { name: string } | undefined)
    : undefined;
  const cash = tenders.find((t) => t.kind === "cash");
  /*
    HIDDEN ROWS COME BACK IN THE PAYLOAD AND GO OUT AT THE DOOR.

    They used to be dropped here, which kept them off the floor's screen and
    also kept them off the owner's — the one person they exist for. The route
    strips them for everybody below owner instead, the same way it strips
    owner-only alarms, so the withholding happens once, at the edge, where it
    can be read.

    No arithmetic changes: `movementsCents` comes from the drawer adjustment
    query, which has always counted only the visible ones.
  */
  const allMovements = drawerMovementsForDay(businessDate, { includeHidden: true });

  /*
    A MOVEMENT THAT WAS UNDONE IS NOT A MOVEMENT, AND IT IS DROPPED HERE.

    "Gorditas −$12.00" followed by "Entered by mistake +$12.00" is one mistake
    and its correction. Two lines on a screen describing nothing that happened
    to the drawer, on every screen that lists them — and there are three: the
    Drawer page's fold, the Daily Report's panel, and the reason list printed on
    the close-out sheet. Filtering in each of them is how the first two ended up
    disagreeing with the third; the pair kept coming back because another list
    had never been told.

    BOTH HALVES GO, NEVER ONE. They sum to zero, so dropping them together
    leaves every total untouched. Dropping only the reversal would leave a
    withdrawal on screen that the arithmetic no longer counts, which is worse
    than showing both.

    The rows are still in the table and in the audit log. This is what the day
    SHOWS, not what the shop keeps.
  */
  const undoneIds = new Set<number>();
  for (const m of allMovements) {
    if (m.reverses_id != null) {
      undoneIds.add(m.id);
      undoneIds.add(m.reverses_id);
    }
  }
  const movements = allMovements.filter((m) => !undoneIds.has(m.id));
  const drawer = {
    floatCents,
    floatCountedAt: firstShift?.float_counted_at ?? null,
    floatCountedByName: floatCounter?.name ?? null,
    cashSalesCents: cash?.takingsCents ?? 0,
    movementsCents: cash?.drawerAdjustCents ?? 0,
    expectedCents: cash?.expectedCents ?? 0,
    movements,
    checks: registerChecksForDay(businessDate),
  };

  // ── Tickets: the states, and the rows behind the bad ones ─────────────────
  const states = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'open'      THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'voided'    THEN 1 ELSE 0 END) AS voided
       FROM sales s
      WHERE s.deleted = 0 AND s.kind = 'sale' AND s.business_date = ?`,
    )
    .get(businessDate) as { completed: number; open: number; voided: number };

  const unpaid = db
    .prepare(
      `SELECT s.id AS saleId, s.sale_no AS saleNo, c.name AS customerName,
              s.total_cents AS totalCents, s.balance_cents AS balanceCents
         FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${SALE} AND s.business_date = ? AND s.balance_cents > 0
     ORDER BY s.balance_cents DESC`,
    )
    .all(businessDate) as UnpaidRow[];

  const voids = db
    .prepare(
      `SELECT s.id AS saleId, s.sale_no AS saleNo, s.total_cents AS totalCents,
              e.name AS voidedByName, s.void_reason AS reason, s.voided_at AS voidedAt
         FROM sales s
    LEFT JOIN employees e ON e.id = s.voided_by
        WHERE s.deleted = 0 AND s.kind = 'sale' AND s.status = 'voided'
          AND s.business_date = ?
     ORDER BY s.voided_at`,
    )
    .all(businessDate) as VoidRow[];

  const refunds = db
    .prepare(
      `SELECT s.id AS saleId, s.sale_no AS saleNo, p.amount_cents AS amountCents,
              e.name AS byName, p.note, p.created_at AS createdAt
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
    LEFT JOIN employees e ON e.id = p.taken_by
        WHERE p.kind = 'refund' AND p.business_date = ? AND s.deleted = 0
     ORDER BY p.created_at`,
    )
    .all(businessDate) as RefundRow[];

  // ── What sold ──────────────────────────────────────────────────────────────
  const cat = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN c.code = 'new_tire'  THEN i.qty ELSE 0 END), 0)              AS newUnits,
         COALESCE(SUM(CASE WHEN c.code = 'new_tire'  THEN i.line_total_cents ELSE 0 END), 0) AS newCents,
         COALESCE(SUM(CASE WHEN c.code = 'used_tire' THEN i.qty ELSE 0 END), 0)              AS usedUnits,
         COALESCE(SUM(CASE WHEN c.code = 'used_tire' THEN i.line_total_cents ELSE 0 END), 0) AS usedCents,
         COALESCE(SUM(CASE WHEN c.code IS NULL OR c.code NOT IN ('new_tire','used_tire')
                           THEN 1 ELSE 0 END), 0)                                            AS svcLines,
         COALESCE(SUM(CASE WHEN c.code IS NULL OR c.code NOT IN ('new_tire','used_tire')
                           THEN i.line_total_cents ELSE 0 END), 0)                           AS svcCents,
         -- Every live line on the day's completed tickets, tires included.
         -- svcLines above is the SERVICE lines only, which is a different
         -- question and was the only one the report could answer: "how much
         -- work went through" counts a tire fitted as work done.
         COUNT(*)                                                                            AS allLines
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
  LEFT JOIN service_categories c ON c.id = i.category_id
      WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?`,
    )
    .get(businessDate) as {
    allLines: number;
    newUnits: number;
    newCents: number;
    usedUnits: number;
    usedCents: number;
    svcLines: number;
    svcCents: number;
  };

  const attach = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS withTire
         FROM sales s
         JOIN sale_items i ON i.sale_id = s.id AND i.voided = 0
         JOIN service_categories c ON c.id = i.category_id AND c.code = 'new_tire'
        WHERE ${SALE} AND s.business_date = ?`,
    )
    .get(businessDate) as { withTire: number };

  const disposal = db
    .prepare(
      `SELECT COALESCE(SUM(i.qty), 0) AS units, COALESCE(SUM(i.line_total_cents), 0) AS cents
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?
          AND UPPER(i.description) LIKE '%DISPOSAL%'`,
    )
    .get(businessDate) as { units: number; cents: number };

  const topProducts = db
    .prepare(
      `SELECT p.name AS label, SUM(i.qty) AS qty, SUM(i.line_total_cents) AS cents
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?
     GROUP BY p.id ORDER BY qty DESC, cents DESC LIMIT 8`,
    )
    .all(businessDate) as TopLine[];

  const topServices = db
    .prepare(
      `SELECT UPPER(TRIM(i.description)) AS label, COUNT(*) AS qty,
              SUM(i.line_total_cents) AS cents
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?
          AND i.product_id IS NULL
     GROUP BY label ORDER BY qty DESC, cents DESC LIMIT 8`,
    )
    .all(businessDate) as TopLine[];

  // ── Did the racks move in step with the tickets ───────────────────────────
  /*
    Two independent recorders of the same physical event. A sold tire leaves a
    LINE on the ticket and a MOVEMENT on the stock ledger, written by different
    code — so if the two counts disagree, a tire left the building without the
    racks hearing about it (or vice versa). Voids are excluded from both sides
    the same way: a voided ticket's return movement nets its sale movement out.
  */
  const stockOut = db
    .prepare(
      `SELECT COALESCE(-SUM(m.qty_delta), 0) AS unitsOut
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
        WHERE m.business_date = ? AND p.kind = 'tire'
          AND m.reason IN ('sale', 'void_return', 'refund_return')`,
    )
    .get(businessDate) as { unitsOut: number };

  const soldOnTickets = db
    .prepare(
      `SELECT COALESCE(SUM(i.qty), 0) AS units
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?
          AND p.kind = 'tire'`,
    )
    .get(businessDate) as { units: number };

  /*
    The cross-day halves of the special-order cycle — see the type note. The
    first is signed over all three sale-shaped reasons so a void or refund
    return against an old ticket cancels out the same way it does in unitsOut.
  */
  const fulfilledForEarlier = db
    .prepare(
      `SELECT COALESCE(-SUM(m.qty_delta), 0) AS units
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
         JOIN sales s ON s.id = m.sale_id
        WHERE m.business_date = ? AND p.kind = 'tire'
          AND m.reason IN ('sale', 'void_return', 'refund_return')
          AND s.business_date <> ?`,
    )
    .get(businessDate, businessDate) as { units: number };

  const awaitingFulfillment = db
    .prepare(
      `SELECT COALESCE(SUM(i.qty), 0) AS units
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         JOIN products p ON p.id = i.product_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?
          AND p.kind = 'tire'
          AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                           WHERE m.sale_id = s.id AND m.reason = 'sale')`,
    )
    .get(businessDate) as { units: number };

  const adjustments = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements
        WHERE business_date = ? AND reason = 'adjustment'`,
    )
    .get(businessDate) as { n: number };

  const oversells = listOversells(false);
  const unreviewedOversells = oversells.length;

  // ── Margin today, under the program's one margin rule ─────────────────────
  const costed = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN ${assumedCostSql()} IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN ${assumedCostSql()} IS NOT NULL
                                THEN ${assumedCostSql()} * i.qty ELSE 0 END), 0) AS cost,
              COALESCE(SUM(i.line_total_cents), 0) AS allRevenue
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         ${COST_JOINS}
        WHERE ${SALE} AND i.voided = 0 AND s.business_date = ?`,
    )
    .get(businessDate) as { revenue: number; cost: number; allRevenue: number };
  const exTaxRevenue = costed.revenue - taxIncludedInCents(costed.revenue, currentBp);
  const marginCents = exTaxRevenue - costed.cost;

  // ── Owed ───────────────────────────────────────────────────────────────────
  const outstanding = outstandingTickets();
  const houseToday = houseAccountChargesForDay(businessDate);

  // ── Customers ──────────────────────────────────────────────────────────────
  const newToday = db
    .prepare(
      "SELECT COUNT(*) AS n FROM customers WHERE deleted = 0 AND substr(created_at, 1, 10) = ?",
    )
    .get(businessDate) as { n: number };
  const namedTickets = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sales s
        WHERE ${SALE} AND s.business_date = ? AND s.customer_id IS NOT NULL`,
    )
    .get(businessDate) as { n: number };
  /*
    Fleet charges: today's account charges whose customer bills to a parent.
    The one place V2 reads the fleet relationship, and it reads it through the
    same COALESCE rule as every balance — see BILL_TO in fleets.ts.
  */
  const fleetCharges = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_cents), 0) AS cents
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN payment_methods m ON m.id = p.method_id
         JOIN customers c ON c.id = s.customer_id
        WHERE m.code = 'credit_account' AND s.deleted = 0
          AND p.business_date = ? AND c.fleet_id IS NOT NULL`,
    )
    .get(businessDate) as { cents: number };

  // ── The base report, before the judgements ────────────────────────────────
  const report: CloseoutV2 = {
    businessDate,
    totals,
    trend,
    compare: {
      yesterdayGoodsCents: trend.at(-2)?.goodsCents ?? 0,
      sameDayLastWeekGoodsCents: trend[0]?.goodsCents ?? 0,
      avg7GoodsCents: Math.round(
        trend.slice(0, 7).reduce((n, d) => n + d.goodsCents, 0) / Math.max(1, 7),
      ),
    },
    tenders,
    drawer,
    tickets: {
      completed: states.completed ?? 0,
      open: states.open ?? 0,
      voided: states.voided ?? 0,
      unpaid,
      voids,
      refunds,
      discounts: dayDiscounts(businessDate),
    },
    mechanics: dayByMechanic(businessDate),
    hours: hoursForDay(businessDate),
    cashiers: cashiersWithTenders(businessDate),
    sold: {
      newTires: { units: cat.newUnits, cents: cat.newCents },
      usedTires: { units: cat.usedUnits, cents: cat.usedCents },
      service: { lines: cat.svcLines, cents: cat.svcCents },
      lineCount: cat.allLines,
      attachmentPct:
        states.completed > 0 ? (attach.withTire / states.completed) * 100 : 0,
      disposalUnits: disposal.units,
      disposalCents: disposal.cents,
      topProducts,
      topServices,
    },
    stock: {
      unitsOut: stockOut.unitsOut,
      unitsSoldOnTickets: soldOnTickets.units,
      fulfilledForEarlierUnits: fulfilledForEarlier.units,
      awaitingFulfillmentUnits: awaitingFulfillment.units,
      received: stockReceivedForDay(businessDate),
      adjustments: adjustments.n,
      unreviewedOversells,
      oversellRows: oversells.slice(0, 10).map((o) => ({
        productName: o.product_name,
        tireSize: o.tire_size,
        saleNo: o.sale_no,
        byName: o.employee_name,
        // qty_delta is the signed stock movement; the overdraw is how far past
        // zero it pushed, which is what the reviewer goes to look for.
        short: Math.abs(o.qty_delta),
        onHand: o.on_hand,
      })),
    },
    margin: {
      marginCents,
      marginPct: exTaxRevenue > 0 ? (marginCents / exTaxRevenue) * 100 : 0,
      coveragePct:
        costed.allRevenue > 0 ? Math.round((costed.revenue / costed.allRevenue) * 100) : 0,
    },
    owed: {
      outstandingTicketCents: outstanding.reduce((n, t) => n + t.balanceCents, 0),
      outstandingTicketCount: outstanding.length,
      aging: receivablesAging(businessDate),
      houseChargedTodayCents: houseToday.reduce((n, h) => n + h.amountCents, 0),
    },
    customers: {
      newToday: newToday.n,
      namedTickets: namedTickets.n,
      fleetChargesCents: fleetCharges.cents,
    },
    exceptions: [],
    checklist: [],
  };

  report.exceptions = markDismissed(businessDate, findExceptions(report));
  report.checklist = buildChecklist(report);
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach the human answer, where somebody has given one.
 *
 * One query for the whole day rather than one per alarm, and the NEWEST row per
 * code wins — reopening writes a `reopen` row rather than deleting the
 * dismissal, so the last word is the current state. See 036_alarms.sql.
 *
 * Queried here rather than imported from `alarms.ts`, which imports this file:
 * the alarm log needs the whole history and builds its own richer read, and a
 * shared helper between the two would be a circle for the sake of nine lines.
 */
function markDismissed(businessDate: string, out: Exception[]): Exception[] {
  if (out.length === 0) return out;
  const rows = getDb()
    .prepare(
      `SELECT a.code, a.kind, a.note, a.created_at, e.name AS by_name
         FROM alarm_actions a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.business_date = ?
        ORDER BY a.id`,
    )
    .all(businessDate) as {
    code: string;
    kind: "dismiss" | "reopen";
    note: string;
    created_at: string;
    by_name: string;
  }[];

  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.code, r);

  return out.map((e) => {
    const r = latest.get(e.code);
    return r && r.kind === "dismiss"
      ? { ...e, dismissed: { byName: r.by_name, at: r.created_at, note: r.note } }
      : e;
  });
}

/**
 * The judgements — everything on the page an owner would otherwise have to
 * notice by reading eighteen tables against each other. Computed fresh on every
 * load, same philosophy as the Trends page's findings: a report of figures with
 * no conclusions only helps the reader who already knew what to look for.
 */
function findExceptions(r: CloseoutV2): Exception[] {
  const out: Exception[] = [];
  const money = (c: number) =>
    `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (r.drawer.expectedCents < 0)
    out.push({
      code: "drawer-negative",
      scope: "day",
      dismissed: null,
      severity: "serious",
      text: `The drawer's books are negative (−${money(-r.drawer.expectedCents)}) — more cash recorded leaving than ever came in. A movement is too big or entered twice; fix it before counting.`,
    });

  const badChecks = r.drawer.checks.filter((c) => !c.balanced && !c.deleted);
  if (badChecks.length > 0)
    out.push({
      code: "checks-unbalanced",
      scope: "day",
      dismissed: null,
      severity: "serious",
      ownerOnly: true,
      text: `${badChecks.length} register ${badChecks.length === 1 ? "log" : "logs"} today did not balance. The earliest imbalance is the fact worth chasing — everything after it inherits the problem.`,
    });

  /*
    Judged AFTER the special-order cycle is subtracted from both sides. The two
    recorders legitimately disagree by exactly the ordered tires — fitted today
    for an earlier ticket, or rung today and not yet fitted — and the first
    live week produced precisely that: 19 on tickets, 25 off the racks, six of
    them order fulfilments. An exception that fires on the system's own design
    is an exception that gets ignored the week it matters.
  */
  {
    const racksSameDay = r.stock.unitsOut - r.stock.fulfilledForEarlierUnits;
    const ticketsSameDay = r.stock.unitsSoldOnTickets - r.stock.awaitingFulfillmentUnits;
    if (racksSameDay !== ticketsSameDay)
      out.push({
        code: "racks-vs-tickets",
      scope: "day",
      dismissed: null,
      severity: "serious",
        text: `The racks and the tickets disagree even after order fulfilments are set aside: ${ticketsSameDay} tires sold-and-fitted on today's lines, ${racksSameDay} off the racks. A tire moved without the other record hearing about it.`,
      });
  }

  if (r.stock.unreviewedOversells > 0) {
    const named = r.stock.oversellRows
      .slice(0, 3)
      .map((o) => `${o.productName}${o.saleNo ? ` on ${o.saleNo}` : ""}`)
      .join("; ");
    out.push({
      code: "oversells",
      scope: "standing",
      dismissed: null,
      severity: "watch",
      text: `${r.stock.unreviewedOversells} oversell${r.stock.unreviewedOversells === 1 ? "" : "s"} awaiting review — stock the register sold that its count said was not there: ${named}${r.stock.unreviewedOversells > 3 ? "; …" : ""}. Review on the Inventory tab.`,
    });
  }

  if (r.tickets.unpaid.length > 0)
    out.push({
      code: "unpaid-balances",
      scope: "day",
      dismissed: null,
      severity: "watch",
      text: `${r.tickets.unpaid.length} completed ticket${r.tickets.unpaid.length === 1 ? "" : "s"} today still carr${r.tickets.unpaid.length === 1 ? "ies" : "y"} a balance (${money(r.tickets.unpaid.reduce((n, u) => n + u.balanceCents, 0))} in total). Deliberate for an ordered tire; worth a look otherwise.`,
    });

  if (r.tickets.open > 0)
    out.push({
      code: "open-tickets",
      scope: "day",
      dismissed: null,
      severity: "watch",
      text: `${r.tickets.open} ticket${r.tickets.open === 1 ? "" : "s"} still open. An open ticket is not in any total on this page.`,
    });

  if (r.tickets.voided > 0)
    out.push({
      code: "voids",
      scope: "day",
      dismissed: null,
      severity: "watch",
      text: `${r.tickets.voided} void${r.tickets.voided === 1 ? "" : "s"} today, listed below with who and why. Voids netting to zero is what the reversal design guarantees — the question is only whether each reason holds up.`,
    });

  const discountTotal = r.tickets.discounts.reduce((n, d) => n + d.discountCents, 0);
  const goods = r.totals.goodsCents + discountTotal;
  if (goods > 0 && discountTotal / goods > 0.05)
    out.push({
      code: "discounts",
      scope: "day",
      dismissed: null,
      severity: "watch",
      text: `Discounts ran to ${((discountTotal / goods) * 100).toFixed(1)}% of the day's goods (${money(discountTotal)}). Over five percent is worth reading the list, not just the total.`,
    });

  if (r.hours.people.some((p) => p.onTheClock))
    out.push({
      code: "on-the-clock",
      scope: "day",
      dismissed: null,
      severity: "watch",
      text: `${r.hours.people.filter((p) => p.onTheClock).length} still on the clock: ${r.hours.people
        .filter((p) => p.onTheClock)
        .map((p) => p.name)
        .join(", ")}. Clock them out on the close-out so the day's hours are real rather than auto-closed at nine.`,
    });

  const flags = pricingFlagCount();
  if (flags > 0)
    out.push({
      code: "pricing-flags",
      scope: "standing",
      dismissed: null,
      severity: "watch",
      text: `${flags} pricing warning${flags === 1 ? "" : "s"} on the racks — tires in stock with no price, or priced under cost. Not today's doing, but today's risk.`,
    });

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "serious" ? -1 : 1));
}

/**
 * The checklist is STATES, not promises. Every line is something the database
 * can verify — a box a person ticks but the system cannot check would let the
 * sheet claim things nobody did. The two steps the system deliberately does not
 * store (settling the terminal batch, signing the paper) live on the original
 * close-out, where the doing happens; this page is the reading of the day, and
 * it reports what is checkable.
 */
function buildChecklist(r: CloseoutV2): ChecklistItem[] {
  const liveChecks = r.drawer.checks.filter((c) => !c.deleted);
  const cashLogged = liveChecks.some((c) => c.lines.some((l) => l.methodId && l.label === "Cash"));
  const cardLogged = liveChecks.some((c) => c.lines.some((l) => l.isCard === 1));

  return [
    {
      label: "Opening drawer counted",
      done: r.drawer.floatCountedAt !== null,
      detail:
        r.drawer.floatCountedAt === null
          ? `Nobody counted it — the ${(r.drawer.floatCents / 100).toFixed(2)} float is the standing figure, not a fact.`
          : `${(r.drawer.floatCents / 100).toFixed(2)} counted at ${r.drawer.floatCountedAt.slice(11, 16)}${r.drawer.floatCountedByName ? ` by ${r.drawer.floatCountedByName}` : ""}.`,
    },
    {
      label: "Every ticket closed or accounted for",
      done: r.tickets.open === 0,
      detail:
        r.tickets.open === 0
          ? "No open tickets."
          : `${r.tickets.open} still open — complete, void, or leave deliberately with a note.`,
    },
    {
      label: "Cash drawer counted and logged",
      done: liveChecks.length === 0 ? false : cashLogged,
      detail: cashLogged
        ? "Logged on the register."
        : "Count the drawer on the Close-out tab and press Log Register.",
    },
    {
      label: "Card batch counted against the terminal",
      done: liveChecks.length === 0 ? false : cardLogged,
      detail: cardLogged
        ? "Logged against the terminal's total."
        : "Type the terminal batch into the Close-out tab and log it.",
    },
    {
      label: "Every logged count balanced",
      done:
        liveChecks.length === 0 ? null : liveChecks.every((c) => c.balanced),
      detail:
        liveChecks.length === 0
          ? "Nothing logged yet."
          : liveChecks.every((c) => c.balanced)
            ? "All balanced."
            : "At least one log is out — see the exceptions above.",
    },
    {
      label: "Oversells reviewed",
      done: r.stock.unreviewedOversells === 0,
      /*
        Named, not counted.

        "1 waiting on the Inventory tab" sent somebody to a tab to hunt for a
        row they had no way to recognise — and it is easily read as already
        handled, because DISMISSING THE ALARM AND REVIEWING THE OVERSELL ARE
        TWO DIFFERENT ACTS. Waving the alert away says somebody saw it; the
        queue only clears when somebody stands at the racks and says what the
        count really is. One line named the tire and this stopped being
        ambiguous.

        Note the queue is not today's — an oversell sits there until it is
        cleared, so the date is part of the answer.
      */
      detail:
        r.stock.unreviewedOversells === 0
          ? "Queue is empty."
          : r.stock.oversellRows.length > 0
            ? `${r.stock.unreviewedOversells} waiting on the Inventory tab: ` +
              r.stock.oversellRows
                .slice(0, 2)
                .map((o) => `${o.productName}${o.saleNo ? ` on ${o.saleNo}` : ""}`)
                .join("; ") +
              (r.stock.unreviewedOversells > 2 ? "; …" : "")
            : `${r.stock.unreviewedOversells} waiting on the Inventory tab.`,
    },
    // "Shift closed" used to sit here and was removed on purpose. It is
    // pending on every screen anybody looks at, because the shift is closed
    // AFTER the close-out is read — so the line was permanently amber during
    // the exact minutes the list is used, and a checklist with a box that is
    // always ticked wrong teaches people to skip the boxes. The shift's state
    // still drives the exceptions and the close-out itself.
  ];
}
