import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { nextShiftNo } from "./counters";
import { getSetting } from "./settings";
import { logActorAudit, type Actor } from "./audit";
import type { PosUser } from "./pos-session";

export type Shift = {
  id: number;
  shift_no: string;
  business_date: string;
  opened_at: string;
  opened_by: number;
  opening_float_cents: number;
  closed_at: string | null;
  closed_by: number | null;
  closing_note: string | null;
  is_open: number;
  created_at: string;
  updated_at: string;
  /** Joined for display; not a column. */
  opened_by_name?: string;
  closed_by_name?: string | null;
};

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

const SHIFT_SELECT = `
  SELECT s.*,
         eo.name AS opened_by_name,
         ec.name AS closed_by_name
  FROM shifts s
  JOIN employees eo ON eo.id = s.opened_by
  LEFT JOIN employees ec ON ec.id = s.closed_by`;

export function currentShift(): Shift | null {
  return (getDb().prepare(`${SHIFT_SELECT} WHERE s.is_open = 1`).get() as Shift) ?? null;
}

export function getShift(id: number): Shift | null {
  return (getDb().prepare(`${SHIFT_SELECT} WHERE s.id = ?`).get(id) as Shift) ?? null;
}

export function listShifts(businessDate: string): Shift[] {
  return getDb()
    .prepare(`${SHIFT_SELECT} WHERE s.business_date = ? ORDER BY s.id`)
    .all(businessDate) as Shift[];
}

/**
 * The change fund the drawer starts every shift with.
 *
 * The shop keeps a standing $100 in there so the first cash customer of the
 * morning can be given change. It is the shop's own money sitting in the till,
 * not takings, which is why it is added back on the expected side at close
 * rather than counted as revenue anywhere.
 */
export function registerFloatCents(): number {
  const n = Number(getSetting("register_float_cents"));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function openShift(
  user: PosUser,
  args: { openingFloatCents?: number } = {},
): Result<{ shift: Shift }> {
  // Defaulted, not required. Whoever opens the drawer is not being asked to
  // confirm a number that is the same every single day.
  const float = args.openingFloatCents ?? registerFloatCents();
  if (!Number.isInteger(float) || float < 0)
    return { ok: false, error: "Opening float is not valid" };
  if (currentShift()) return { ok: false, error: "A shift is already open" };

  return inTx(() => {
    const now = nowLocalIso();
    const shiftNo = nextShiftNo();
    const info = getDb()
      .prepare(
        `INSERT INTO shifts
           (shift_no, business_date, opened_at, opened_by, opening_float_cents,
            is_open, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(shiftNo, currentBusinessDate(), now, user.employeeId, float, now, now);
    const id = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: "shift.open",
      targetType: "shift",
      targetId: id,
      details: { shift_no: shiftNo, opening_float_cents: float },
    });
    return { ok: true as const, shift: getShift(id)! };
  });
}

/**
 * The shift a payment being written right now belongs to, opening one if nobody
 * did it explicitly.
 *
 * Auto-opening is the point. Requiring a cashier to remember to start a shift
 * before the first ticket of the morning would mean the register refuses a sale
 * over bookkeeping, which is exactly the kind of friction that gets a POS
 * abandoned. A shop that never touches the shift screen still gets one clean
 * shift per day for free.
 *
 * Must be called inside an open transaction -- it writes.
 */
export function ensureShift(user: PosUser): Shift {
  const open = currentShift();
  // A shift left open overnight belongs to the day it was opened. Roll it rather
  // than letting yesterday swallow today's money.
  if (open && open.business_date === currentBusinessDate()) return open;
  if (open) closeShiftRow(user, open, [], "Rolled over automatically at day change");

  const now = nowLocalIso();
  const shiftNo = nextShiftNo();
  // The same float an explicitly opened shift gets. A shift that opened itself
  // because someone rang a sale before touching the shift screen still has the
  // shop's $100 physically sitting in the drawer, and booking it as 0 would make
  // the count come out $100 over and send someone looking for a mistake.
  const float = registerFloatCents();
  const info = getDb()
    .prepare(
      `INSERT INTO shifts
         (shift_no, business_date, opened_at, opened_by, opening_float_cents,
          is_open, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(shiftNo, currentBusinessDate(), now, user.employeeId, float, now, now);
  const id = Number(info.lastInsertRowid);
  logActorAudit(actorOf(user), {
    action: "shift.open",
    targetType: "shift",
    targetId: id,
    details: { shift_no: shiftNo, opening_float_cents: float, automatic: true },
  });
  return getShift(id)!;
}

function closeShiftRow(
  user: PosUser,
  shift: Shift,
  counts: { methodId: number; countedCents: number }[],
  note: string | null,
) {
  const db = getDb();
  const now = nowLocalIso();
  const expected = expectedByMethod(shift.id);

  for (const c of counts) {
    const exp = expected.find((e) => e.methodId === c.methodId);
    db.prepare(
      `INSERT INTO shift_counts (shift_id, method_id, counted_cents, expected_cents, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (shift_id, method_id) DO UPDATE SET
         counted_cents = excluded.counted_cents,
         expected_cents = excluded.expected_cents,
         created_at = excluded.created_at`,
    ).run(shift.id, c.methodId, c.countedCents, exp?.expectedCents ?? 0, now);
  }

  db.prepare(
    `UPDATE shifts SET is_open = 0, closed_at = ?, closed_by = ?, closing_note = ?, updated_at = ?
     WHERE id = ?`,
  ).run(now, user.employeeId, note, now, shift.id);
}

export function closeShift(
  user: PosUser,
  shiftId: number,
  args: { counts: { methodId: number; countedCents: number }[]; note?: string | null },
): Result<{ shift: Shift }> {
  const shift = getShift(shiftId);
  if (!shift) return { ok: false, error: "Shift not found" };
  if (!shift.is_open) return { ok: false, error: "That shift is already closed" };

  for (const c of args.counts) {
    if (!Number.isInteger(c.countedCents) || c.countedCents < 0)
      return { ok: false, error: "Counted amounts are not valid" };
  }

  return inTx(() => {
    const before = reconcileShift(shiftId);
    closeShiftRow(user, shift, args.counts, args.note?.trim() || null);

    logActorAudit(actorOf(user), {
      action: "shift.close",
      targetType: "shift",
      targetId: shiftId,
      details: {
        shift_no: shift.shift_no,
        // The variance is recorded in the audit trail, not merely displayed --
        // a drawer that came up short is exactly the kind of thing someone will
        // want to look up in three weeks.
        variance_cents: before.totalVarianceCents,
        counts: args.counts,
      },
    });
    return { ok: true as const, shift: getShift(shiftId)! };
  });
}

/**
 * Non-sale cash moves in the period. The canonical accessor is
 * `drawerAdjustmentCents` in ./drawer, and this is a deliberate inline copy of
 * that one-line SUM: drawer.ts depends on this module for `ensureShift`, and
 * importing it back would make the pair circular for the sake of sharing a
 * query with no logic in it.
 */
function drawerAdjustFor(where: string, param: unknown): number {
  // `hidden = 0` here for the same reason it is in `drawerAdjustmentCents`, and
  // the two must never drift apart: they are the same figure computed in two
  // modules, and a hidden movement that reached one and not the other would put
  // two different expectations on one screen.
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n
         FROM drawer_movements WHERE ${where} AND hidden = 0`,
    )
    .get(param) as { n: number };
  return row.n;
}

export type MethodExpectation = {
  methodId: number;
  code: string;
  label: string;
  kind: string;
  isCard: number;
  /** Takings on this tender in the period, off the ledger. Signed. */
  takingsCents: number;
  /**
   * Takings plus the opening float plus any non-sale cash moves, for cash only
   * -- what should physically be in hand.
   */
  expectedCents: number;
  /**
   * Money taken out of or put into the drawer for reasons that are not sales:
   * a run to the bank, a change delivery. Signed, cash only, and NOT part of
   * takings -- it is surfaced separately so a drawer that is $400 light can be
   * explained rather than investigated.
   */
  drawerAdjustCents: number;
  count: number;
  tipCents: number;
  commCents: number;
};

function expectationsFrom(
  where: string,
  params: unknown[],
  openingFloatCents: number,
  drawerAdjustCents: number,
): MethodExpectation[] {
  const rows = getDb()
    .prepare(
      `SELECT m.id AS methodId, m.code, m.label, m.kind, m.is_card AS isCard,
              COALESCE(SUM(p.amount_cents), 0) AS takingsCents,
              COALESCE(SUM(p.tip_cents), 0)    AS tipCents,
              COALESCE(SUM(p.comm_cents), 0)   AS commCents,
              COUNT(p.id)                      AS count
       FROM payment_methods m
       LEFT JOIN payments p ON p.method_id = m.id AND ${where}
       WHERE m.active = 1
       GROUP BY m.id
       ORDER BY m.sort_order`,
    )
    .all(...params) as Omit<MethodExpectation, "expectedCents" | "drawerAdjustCents">[];

  return rows.map((r) => {
    // Only the drawer holds a float, and only the drawer can have cash carried
    // out of it. A card terminal's batch total is takings and nothing else.
    const cash = r.kind === "cash";
    const adjust = cash ? drawerAdjustCents : 0;
    return {
      ...r,
      drawerAdjustCents: adjust,
      expectedCents: cash ? r.takingsCents + openingFloatCents + adjust : r.takingsCents,
    };
  });
}

export function expectedByMethod(shiftId: number): MethodExpectation[] {
  const shift = getShift(shiftId);
  return expectationsFrom(
    "p.shift_id = ?",
    [shiftId],
    shift?.opening_float_cents ?? 0,
    drawerAdjustFor("shift_id = ?", shiftId),
  );
}

/**
 * A whole business day's expectation. Floats from every shift in the day are
 * added, because each one was money physically put in the drawer.
 */
export function expectedByMethodForDay(businessDate: string): MethodExpectation[] {
  const floats = getDb()
    .prepare(
      "SELECT COALESCE(SUM(opening_float_cents), 0) AS f FROM shifts WHERE business_date = ?",
    )
    .get(businessDate) as { f: number };
  return expectationsFrom(
    "p.business_date = ?",
    [businessDate],
    floats.f,
    drawerAdjustFor("business_date = ?", businessDate),
  );
}

export type MethodVariance = MethodExpectation & {
  countedCents: number | null;
  varianceCents: number;
  counted: boolean;
};

export type SwapHint = {
  overCode: string;
  overLabel: string;
  shortCode: string;
  shortLabel: string;
  amountCents: number;
  /**
   * Payments sitting on the SHORT tender for exactly the missing amount -- see
   * the note on `swapHints` for why that is the side the wrong row is on.
   */
  candidates: {
    paymentId: number;
    saleId: number;
    saleNo: string;
    amountCents: number;
    takenBy: string;
    createdAt: string;
  }[];
};

/**
 * The drawer, read with the tips in mind.
 *
 * Tips are earned on a ticket and handed over in cash, and not always at the
 * end of the night — a technician leaving at noon gets theirs at noon. The
 * drawer is then legitimately short by that money, and until now the count said
 * so in the same voice it uses for a genuine shortage. Somebody comparing a
 * drawer to a number every evening learns fast that it is always a bit under,
 * and a count nobody believes is a count nobody reads.
 *
 * So the arithmetic is done both ways and both are shown. Short by EXACTLY the
 * tips is not a discrepancy at all; short by anything else is still the
 * cashier's to explain, and the second figure only says how much of it the tips
 * account for.
 *
 * Every tip counts toward this, not only those left on cash tickets. A tip on a
 * card is money the shop was paid by the terminal and hands to the technician
 * out of the till, so it leaves the drawer exactly like a cash one does.
 */
export type TipReconciliation = {
  /** Every tip in scope, whatever tender the customer paid on. */
  cents: number;
  /** Was there a cash count to compare against at all? */
  cashCounted: boolean;
  /** The cash drawer's variance as counted — negative is short. */
  cashVarianceCents: number;
  /** What that variance becomes once the tips are treated as paid out. */
  cashVarianceIfTipsPaidCents: number;
  /** Short by exactly the tips: nothing to explain. */
  balancedByTips: boolean;
};

export type Reconciliation = {
  methods: MethodVariance[];
  totalExpectedCents: number;
  totalCountedCents: number;
  totalVarianceCents: number;
  anyCounted: boolean;
  hints: SwapHint[];
  tips: TipReconciliation;
};

function reconcileFrom(
  expectations: MethodExpectation[],
  counted: Map<number, number>,
  paymentScope: { where: string; params: unknown[] },
): Reconciliation {
  const methods: MethodVariance[] = expectations.map((e) => {
    const c = counted.get(e.methodId);
    return {
      ...e,
      countedCents: c ?? null,
      counted: c !== undefined,
      varianceCents: c === undefined ? 0 : c - e.expectedCents,
    };
  });

  const active = methods.filter((m) => m.counted);

  // Only the drawer, because only the drawer pays a tip out. A card tip is
  // money the terminal already banked; what leaves the building is cash.
  const cash = methods.find((m) => m.kind === "cash");
  const tipCents = methods.reduce((s, m) => s + m.tipCents, 0);
  const cashVariance = cash?.counted ? cash.varianceCents : 0;

  return {
    methods,
    totalExpectedCents: active.reduce((s, m) => s + m.expectedCents, 0),
    totalCountedCents: active.reduce((s, m) => s + (m.countedCents ?? 0), 0),
    totalVarianceCents: active.reduce((s, m) => s + m.varianceCents, 0),
    anyCounted: active.length > 0,
    hints: swapHints(methods, paymentScope),
    tips: {
      cents: tipCents,
      cashCounted: cash?.counted ?? false,
      cashVarianceCents: cashVariance,
      // Adding, not subtracting: the drawer is SHORT by what was handed out, so
      // putting the tips back is what the till would have held otherwise.
      cashVarianceIfTipsPaidCents: cashVariance + tipCents,
      balancedByTips:
        (cash?.counted ?? false) && tipCents > 0 && cashVariance === -tipCents,
    },
  };
}

/**
 * Find the signature of a sale rung on the wrong tender.
 *
 * When a card sale is keyed as cash, the register books money into the drawer
 * that never went there -- so the drawer counts SHORT by exactly that amount
 * and the terminal counts OVER by the same. Two equal and opposite variances is
 * a far stronger signal than either one alone; a drawer that is simply $40
 * short is a different problem, and this deliberately does not guess at those.
 *
 * Having identified the pair, the useful part is naming suspects. The wrong row
 * sits on the SHORT tender -- that is the side where the register recorded
 * money it does not have -- so that is where to look for payments of exactly
 * the missing amount. That turns "you are $40 out" into "one of these two $40
 * tickets is on the wrong tender", which is something a tired cashier can
 * actually act on at closing time.
 */
function swapHints(
  methods: MethodVariance[],
  scope: { where: string; params: unknown[] },
): SwapHint[] {
  const over = methods.filter((m) => m.counted && m.varianceCents > 0);
  const short = methods.filter((m) => m.counted && m.varianceCents < 0);
  const hints: SwapHint[] = [];

  for (const o of over) {
    for (const s of short) {
      if (o.varianceCents !== -s.varianceCents) continue;
      const amount = o.varianceCents;
      const candidates = getDb()
        .prepare(
          `SELECT p.id AS paymentId, p.sale_id AS saleId, sa.sale_no AS saleNo,
                  p.amount_cents AS amountCents, e.name AS takenBy, p.created_at AS createdAt
           FROM payments p
           JOIN sales sa ON sa.id = p.sale_id
           JOIN employees e ON e.id = p.taken_by
           WHERE ${scope.where} AND p.method_id = ? AND p.amount_cents = ?
           ORDER BY p.id`,
        )
        .all(...scope.params, s.methodId, amount) as SwapHint["candidates"];

      hints.push({
        overCode: o.code,
        overLabel: o.label,
        shortCode: s.code,
        shortLabel: s.label,
        amountCents: amount,
        candidates,
      });
    }
  }
  return hints;
}

function countsFor(shiftId: number): Map<number, number> {
  const rows = getDb()
    .prepare("SELECT method_id, counted_cents FROM shift_counts WHERE shift_id = ?")
    .all(shiftId) as { method_id: number; counted_cents: number }[];
  return new Map(rows.map((r) => [r.method_id, r.counted_cents]));
}

export function reconcileShift(
  shiftId: number,
  override?: Map<number, number>,
): Reconciliation {
  return reconcileFrom(expectedByMethod(shiftId), override ?? countsFor(shiftId), {
    where: "p.shift_id = ?",
    params: [shiftId],
  });
}

/** The day's reconciliation: every shift's count rolled up. */
export function reconcileDay(
  businessDate: string,
  override?: Map<number, number>,
): Reconciliation {
  const rows = getDb()
    .prepare(
      `SELECT c.method_id, SUM(c.counted_cents) AS counted
       FROM shift_counts c
       JOIN shifts s ON s.id = c.shift_id
       WHERE s.business_date = ?
       GROUP BY c.method_id`,
    )
    .all(businessDate) as { method_id: number; counted: number }[];
  const counted = override ?? new Map(rows.map((r) => [r.method_id, r.counted]));

  return reconcileFrom(expectedByMethodForDay(businessDate), counted, {
    where: "p.business_date = ?",
    params: [businessDate],
  });
}

export type CashierTotal = {
  employeeId: number;
  name: string;
  collectedCents: number;
  tipCents: number;
  count: number;
};

/** Who took the money. Attribution is per payment, so a ticket rung by one
 *  cashier and paid at another's till lands where the money actually moved. */
export function byCashier(scope:
  | { shiftId: number }
  | { businessDate: string }): CashierTotal[] {
  const where = "shiftId" in scope ? "p.shift_id = ?" : "p.business_date = ?";
  const param = "shiftId" in scope ? scope.shiftId : scope.businessDate;
  return getDb()
    .prepare(
      `SELECT e.id AS employeeId, e.name,
              COALESCE(SUM(p.amount_cents), 0) AS collectedCents,
              COALESCE(SUM(p.tip_cents), 0)    AS tipCents,
              COUNT(*)                         AS count
       FROM payments p
       JOIN employees e ON e.id = p.taken_by
       WHERE ${where}
       GROUP BY e.id
       ORDER BY collectedCents DESC`,
    )
    .all(param) as CashierTotal[];
}

/**
 * Make the cash line read as though it balanced, for the sheet the floor sees.
 *
 * The owner takes money out and marks it hidden — see `026_drawer_hidden.sql`.
 * That leaves the drawer light against an expectation that does not know about
 * it, and the floor would otherwise read a shortfall they cannot explain and
 * did not cause.
 *
 * What this does NOT do is add the hidden amount back into the expectation, and
 * the difference matters. Adding it back would make an honest count balance and
 * a genuine surplus visible again — and a visible surplus is the exact thing
 * somebody pockets. Forcing the DIFFERENCE to zero hides both: a drawer $20
 * over and a drawer $20 short read identically to whoever is counting, so
 * there is never anything on screen that looks like spare money.
 *
 * Cash only. Every other tender is unaffected, because nothing was taken out of
 * a card terminal.
 *
 * The counted figure is never touched. What the cashier typed is what is stored
 * and what the owner reads; only the comparison is suppressed, and only on a day
 * the owner has deliberately put into this state.
 */
export function maskCashVariance(r: Reconciliation): Reconciliation {
  const methods = r.methods.map((m) =>
    m.isCard === 0 && m.code === "cash" && m.counted
      ? { ...m, expectedCents: m.countedCents ?? 0, varianceCents: 0 }
      : m,
  );
  const totalExpectedCents = methods.reduce((s, m) => s + m.expectedCents, 0);
  const totalVarianceCents = methods.reduce((s, m) => s + m.varianceCents, 0);
  return {
    ...r,
    methods,
    totalExpectedCents,
    totalVarianceCents,
    // A mix-up hint is built from the very variances that have just been
    // masked, so leaving them in would point at a discrepancy the sheet no
    // longer shows.
    hints: r.hints.filter((h) => h.overCode !== "cash" && h.shortCode !== "cash"),
  };
}
