import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { ensureShift } from "./shifts";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
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
  /**
   * Kept off the floor. Excluded from the expected drawer figure and from
   * every screen except the owner close-out — see `026_drawer_hidden.sql`.
   */
  hidden: number;
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

/**
 * Hidden rows are left out unless they are explicitly asked for.
 *
 * The default is the safe direction: a caller that has not thought about this
 * shows the floor exactly what the floor is meant to see, and only a caller
 * that names `includeHidden` — the owner's own close-out — gets the rest.
 */
const visible = (includeHidden?: boolean) => (includeHidden ? "" : " AND d.hidden = 0");

export function drawerMovementsForDay(
  businessDate: string,
  opts?: { includeHidden?: boolean },
): DrawerMovement[] {
  return getDb()
    .prepare(
      `${SELECT} WHERE d.business_date = ?${visible(opts?.includeHidden)} ORDER BY d.id`,
    )
    .all(businessDate) as DrawerMovement[];
}

export function drawerMovementsForShift(
  shiftId: number,
  opts?: { includeHidden?: boolean },
): DrawerMovement[] {
  return getDb()
    .prepare(`${SELECT} WHERE d.shift_id = ?${visible(opts?.includeHidden)} ORDER BY d.id`)
    .all(shiftId) as DrawerMovement[];
}

/**
 * What has been taken out of sight, for the one screen allowed to say so.
 *
 * Signed like everything else in this table, so a day with one hidden $40
 * withdrawal returns -4000. The close-out shows it to the owner beside the
 * count, because the count is short by exactly this and the owner is the only
 * person who can tell that apart from a genuine shortfall.
 */
export function hiddenDrawerCents(
  scope: { shiftId: number } | { businessDate: string },
): number {
  const where = "shiftId" in scope ? "shift_id = ?" : "business_date = ?";
  const param = "shiftId" in scope ? scope.shiftId : scope.businessDate;
  return (
    getDb()
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS n
           FROM drawer_movements WHERE ${where} AND hidden = 1`,
      )
      .get(param) as { n: number }
  ).n;
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
 *
 * HIDDEN MOVEMENTS ARE EXCLUDED, and that exclusion is the entire mechanism
 * rather than a detail of it. A hidden withdrawal that adjusted this number
 * would leave the drawer balancing exactly as it did before — an ordinary
 * cash-out with a flag that changed nothing. Leaving it out is what makes the
 * box come up short against the books on purpose, which is the only way to tell
 * a person who counts the money from a person who reads the expected figure off
 * the screen and types it back in.
 *
 * There is no `includeHidden` here, deliberately. What the drawer is expected to
 * hold has exactly one answer on any given night, and offering a second one
 * would eventually get the two compared.
 */
export function drawerAdjustmentCents(
  scope: { shiftId: number } | { businessDate: string },
): number {
  const where = "shiftId" in scope ? "shift_id = ?" : "business_date = ?";
  const param = "shiftId" in scope ? scope.shiftId : scope.businessDate;
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n
         FROM drawer_movements WHERE ${where} AND hidden = 0`,
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
    /** Owner only. See `026_drawer_hidden.sql`. */
    hidden?: boolean;
  },
): Result<{ movement: DrawerMovement }> {
  const amount = Math.round(args.amountCents);
  if (!Number.isInteger(amount) || amount <= 0)
    return { ok: false, error: "Enter an amount greater than zero" };
  const reason = args.reason.trim();
  if (!reason) return { ok: false, error: "Say what the money is for" };
  if (args.kind !== "withdrawal" && args.kind !== "deposit")
    return { ok: false, error: "Invalid drawer movement" };
  // Checked here rather than only at the route, because this is the function
  // that decides whether a night's count is allowed to be wrong on purpose.
  if (args.hidden && !can(user.role, "hideDrawerMovement"))
    return { ok: false, error: "Only the owner can keep a drawer move off the sheet" };

  const signed = args.kind === "withdrawal" ? -amount : amount;

  return inTx(() => {
    const shift = ensureShift(user);
    const now = nowLocalIso();
    const info = getDb()
      .prepare(
        `INSERT INTO drawer_movements
           (shift_id, business_date, amount_cents, kind, reason, note, hidden,
            created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        shift.id,
        currentBusinessDate(),
        signed,
        args.kind,
        reason,
        args.note?.trim() || null,
        args.hidden ? 1 : 0,
        user.employeeId,
        now,
      );
    const id = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: args.kind === "withdrawal" ? "drawer.withdraw" : "drawer.deposit",
      targetType: "drawer_movement",
      targetId: id,
      // Hidden is recorded in the audit details on purpose. The row is kept off
      // the floor's screens; it is not kept off the record, and the audit log is
      // the record.
      details: {
        amount_cents: signed,
        reason,
        shift_id: shift.id,
        hidden: !!args.hidden,
      },
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
            hidden, created_by, created_at)
         VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, ?, ?)`,
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
        // Inherited, and it has to be. A reversal defaulting to visible would
        // put a matching deposit on the floor's sheet for a withdrawal they
        // were never shown — the drawer would jump by an amount with no cause
        // anywhere on the page, which is more revealing than the original
        // withdrawal would have been. Undoing something invisible has to be
        // invisible too.
        original.hidden,
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
