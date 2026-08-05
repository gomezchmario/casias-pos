import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { ensureShift } from "./shifts";
import { logActorAudit, type Actor } from "./audit";
import type { PosUser } from "./pos-session";

export type DrawerKind = "withdrawal" | "deposit" | "reversal";

export type DrawerMovement = {
  id: number;
  shift_id: number | null;
  business_date: string;
  /** Signed: negative when money left the drawer. */
  amount_cents: number;
  kind: DrawerKind;
  reason: string;
  note: string | null;
  reverses_id: number | null;
  created_by: number;
  created_at: string;
  /** Joined for display; not columns. */
  created_by_name: string;
  reversed_by_id: number | null;
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

const SELECT = `
  SELECT d.*, e.name AS created_by_name,
         (SELECT r.id FROM drawer_movements r WHERE r.reverses_id = d.id) AS reversed_by_id
  FROM drawer_movements d
  JOIN employees e ON e.id = d.created_by`;

export function getDrawerMovement(id: number): DrawerMovement | null {
  return (
    (getDb().prepare(`${SELECT} WHERE d.id = ?`).get(id) as DrawerMovement | undefined) ??
    null
  );
}

export function drawerMovementsForDay(businessDate: string): DrawerMovement[] {
  return getDb()
    .prepare(`${SELECT} WHERE d.business_date = ? ORDER BY d.id`)
    .all(businessDate) as DrawerMovement[];
}

export function drawerMovementsForShift(shiftId: number): DrawerMovement[] {
  return getDb()
    .prepare(`${SELECT} WHERE d.shift_id = ? ORDER BY d.id`)
    .all(shiftId) as DrawerMovement[];
}

/**
 * The net effect of every non-sale cash move on what should be in the drawer.
 *
 * Signed, and a plain SUM, because the sign is already carried on the row. A
 * day with a $400 run to the bank and a $50 change delivery returns -35000.
 *
 * This is the ONLY number the rest of the app should take from this table, and
 * only the drawer count should take it. Nothing about revenue changes when
 * money moves from a wooden box to a safe.
 */
export function drawerAdjustmentCents(
  scope: { shiftId: number } | { businessDate: string },
): number {
  const where = "shiftId" in scope ? "shift_id = ?" : "business_date = ?";
  const param = "shiftId" in scope ? scope.shiftId : scope.businessDate;
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM drawer_movements WHERE ${where}`,
    )
    .get(param) as { n: number };
  return row.n;
}

/**
 * Take money out of the drawer, or put money in, for a reason that is not a
 * sale.
 *
 * `amountCents` is a plain positive amount and the sign comes from `kind`. The
 * alternative -- asking the caller to pass -40000 for a withdrawal -- makes a
 * dropped minus sign turn a run to the bank into a four hundred dollar cash
 * deposit, silently, with the drawer count then reading $800 over. There is no
 * reason to ever hand this function a negative number, so it refuses one.
 */
export function recordDrawerMovement(
  user: PosUser,
  args: {
    amountCents: number;
    kind: "withdrawal" | "deposit";
    reason: string;
    note?: string | null;
  },
): Result<{ movement: DrawerMovement }> {
  const amount = Math.round(args.amountCents);
  if (!Number.isInteger(amount) || amount <= 0)
    return { ok: false, error: "Enter an amount greater than zero" };
  const reason = args.reason.trim();
  if (!reason) return { ok: false, error: "Say what the money is for" };
  if (args.kind !== "withdrawal" && args.kind !== "deposit")
    return { ok: false, error: "Invalid drawer movement" };

  const signed = args.kind === "withdrawal" ? -amount : amount;

  return inTx(() => {
    const shift = ensureShift(user);
    const now = nowLocalIso();
    const info = getDb()
      .prepare(
        `INSERT INTO drawer_movements
           (shift_id, business_date, amount_cents, kind, reason, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        shift.id,
        currentBusinessDate(),
        signed,
        args.kind,
        reason,
        args.note?.trim() || null,
        user.employeeId,
        now,
      );
    const id = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: args.kind === "withdrawal" ? "drawer.withdraw" : "drawer.deposit",
      targetType: "drawer_movement",
      targetId: id,
      details: { amount_cents: signed, reason, shift_id: shift.id },
    });

    return { ok: true as const, movement: getDrawerMovement(id)! };
  });
}

/**
 * Undo a drawer movement by writing its opposite. The original row stays,
 * because the cash physically did leave the drawer for however long it took
 * someone to notice, and an audit trail that erases that is worth less than no
 * trail at all.
 */
export function reverseDrawerMovement(
  user: PosUser,
  id: number,
  reason: string,
): Result<{ movement: DrawerMovement }> {
  const original = getDrawerMovement(id);
  if (!original) return { ok: false, error: "That drawer movement doesn't exist" };
  if (original.kind === "reversal")
    return { ok: false, error: "A reversal can't itself be reversed" };
  if (original.reversed_by_id)
    return { ok: false, error: "That movement has already been reversed" };
  const why = reason.trim();
  if (!why) return { ok: false, error: "Say why it is being undone" };

  return inTx(() => {
    const shift = ensureShift(user);
    const info = getDb()
      .prepare(
        `INSERT INTO drawer_movements
           (shift_id, business_date, amount_cents, kind, reason, note, reverses_id,
            created_by, created_at)
         VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, ?)`,
      )
      .run(
        shift.id,
        // The reversal belongs to the day it is made, not the day of the row it
        // undoes. Money going back in the drawer today changes today's count.
        currentBusinessDate(),
        -original.amount_cents,
        why,
        `Reverses #${original.id}: ${original.reason}`,
        original.id,
        user.employeeId,
        nowLocalIso(),
      );
    const newId = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: "drawer.reversal",
      targetType: "drawer_movement",
      targetId: newId,
      details: { reverses_id: original.id, amount_cents: -original.amount_cents, reason: why },
    });

    return { ok: true as const, movement: getDrawerMovement(newId)! };
  });
}
