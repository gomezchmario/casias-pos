import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { nextShiftNo } from "./counters";
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

export function openShift(
  user: PosUser,
  args: { openingFloatCents?: number } = {},
): Result<{ shift: Shift }> {
  const float = args.openingFloatCents ?? 0;
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
  const info = getDb()
    .prepare(
      `INSERT INTO shifts
         (shift_no, business_date, opened_at, opened_by, opening_float_cents,
          is_open, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    )
    .run(shiftNo, currentBusinessDate(), now, user.employeeId, now, now);
  const id = Number(info.lastInsertRowid);
  logActorAudit(actorOf(user), {
    action: "shift.open",
    targetType: "shift",
    targetId: id,
    details: { shift_no: shiftNo, automatic: true },
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

export type MethodExpectation = {
  methodId: number;
  code: string;
  label: string;
  kind: string;
  isCard: number;
  /** Takings on this tender in the period, off the ledger. Signed. */
  takingsCents: number;
  /** Takings plus the opening float, for cash only -- what should be in hand. */
  expectedCents: number;
  count: number;
  tipCents: number;
  commCents: number;
};

function expectationsFrom(
  where: string,
  params: unknown[],
  openingFloatCents: number,
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
    .all(...params) as Omit<MethodExpectation, "expectedCents">[];

  return rows.map((r) => ({
    ...r,
    // Only the drawer holds a float. A card terminal's batch total is takings and
    // nothing else.
    expectedCents: r.kind === "cash" ? r.takingsCents + openingFloatCents : r.takingsCents,
  }));
}

export function expectedByMethod(shiftId: number): MethodExpectation[] {
  const shift = getShift(shiftId);
  return expectationsFrom("p.shift_id = ?", [shiftId], shift?.opening_float_cents ?? 0);
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
  return expectationsFrom("p.business_date = ?", [businessDate], floats.f);
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

export type Reconciliation = {
  methods: MethodVariance[];
  totalExpectedCents: number;
  totalCountedCents: number;
  totalVarianceCents: number;
  anyCounted: boolean;
  hints: SwapHint[];
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
  return {
    methods,
    totalExpectedCents: active.reduce((s, m) => s + m.expectedCents, 0),
    totalCountedCents: active.reduce((s, m) => s + (m.countedCents ?? 0), 0),
    totalVarianceCents: active.reduce((s, m) => s + m.varianceCents, 0),
    anyCounted: active.length > 0,
    hints: swapHints(methods, paymentScope),
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
