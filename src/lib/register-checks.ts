import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { currentShift, expectedByMethodForDay } from "./shifts";
import { logActorAudit, type Actor } from "./audit";
import type { PosUser } from "./pos-session";

/**
 * A count of the register taken partway through the day.
 *
 * See `migrations/015_register_checks.sql` for why this is its own table and
 * why the expectation is frozen on the row rather than recomputed.
 */
export type RegisterCheckLine = {
  methodId: number;
  code: string;
  label: string;
  /**
   * Whether the counted figure came off a card terminal.
   *
   * Carried because the close-out reads a difference on a terminal-backed
   * tender differently from one on a drawer: nothing can be taken out of a
   * settled batch, so a gap there is the register having logged a payment the
   * terminal never ran, not money gone. See the close-out's `shownVariance`.
   */
  isCard: number;
  countedCents: number;
  expectedCents: number;
  varianceCents: number;
};

export type RegisterCheck = {
  id: number;
  businessDate: string;
  shiftId: number | null;
  note: string | null;
  checkedAt: string;
  checkedBy: number;
  checkedByName: string;
  deleted: number;
  deletedByName: string | null;
  deletedAt: string | null;
  deletedReason: string | null;
  lines: RegisterCheckLine[];
  /** Sum of the per-tender differences. */
  varianceCents: number;
  /**
   * True only when every tender counted came out exactly right.
   *
   * Deliberately not `varianceCents === 0`: cash short forty and card over
   * forty nets to nothing and is still a sale rung on the wrong button. The
   * same rule the close-out uses, for the same reason.
   */
  balanced: boolean;
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

function linesFor(checkId: number): RegisterCheckLine[] {
  return getDb()
    .prepare(
      `SELECT c.method_id AS methodId, m.code, m.label, m.is_card AS isCard,
              c.counted_cents AS countedCents, c.expected_cents AS expectedCents,
              c.counted_cents - c.expected_cents AS varianceCents
         FROM register_check_counts c
         JOIN payment_methods m ON m.id = c.method_id
        WHERE c.check_id = ?
        ORDER BY m.sort_order`,
    )
    .all(checkId) as RegisterCheckLine[];
}

function hydrate(row: Omit<RegisterCheck, "lines" | "varianceCents" | "balanced">): RegisterCheck {
  const lines = linesFor(row.id);
  return {
    ...row,
    lines,
    varianceCents: lines.reduce((s, l) => s + l.varianceCents, 0),
    balanced: lines.every((l) => l.varianceCents === 0),
  };
}

const SELECT = `
  SELECT rc.id, rc.business_date AS businessDate, rc.shift_id AS shiftId, rc.note,
         rc.checked_at AS checkedAt, rc.checked_by AS checkedBy, e.name AS checkedByName,
         rc.deleted, d.name AS deletedByName,
         rc.deleted_at AS deletedAt, rc.deleted_reason AS deletedReason
    FROM register_checks rc
    JOIN employees e ON e.id = rc.checked_by
    LEFT JOIN employees d ON d.id = rc.deleted_by`;

export function getRegisterCheck(id: number): RegisterCheck | null {
  const row = getDb().prepare(`${SELECT} WHERE rc.id = ?`).get(id) as
    | Omit<RegisterCheck, "lines" | "varianceCents" | "balanced">
    | undefined;
  return row ? hydrate(row) : null;
}

/**
 * Every check taken on a day, oldest first, deleted ones excluded.
 *
 * Oldest first because these are read as a timeline — the point of having four
 * of them is to see which gap the money went missing in, and a timeline printed
 * newest-first is one nobody reads correctly.
 */
export function registerChecksForDay(businessDate: string): RegisterCheck[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE rc.business_date = ? AND rc.deleted = 0 ORDER BY rc.checked_at, rc.id`)
    .all(businessDate) as Omit<RegisterCheck, "lines" | "varianceCents" | "balanced">[];
  return rows.map(hydrate);
}

export function registerChecksForShift(shiftId: number): RegisterCheck[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE rc.shift_id = ? AND rc.deleted = 0 ORDER BY rc.checked_at, rc.id`)
    .all(shiftId) as Omit<RegisterCheck, "lines" | "varianceCents" | "balanced">[];
  return rows.map(hydrate);
}

/**
 * Take a count now and freeze it.
 *
 * The expectation is read inside the transaction, from the day rather than the
 * shift, because the drawer is one physical box: a cashier counting at noon
 * counts everything in it, including whatever the shift before them left. A
 * shift-scoped expectation would report every check taken after a handover as
 * short by the previous shift's takings.
 */
export function recordRegisterCheck(
  user: PosUser,
  args: { counts: { methodId: number; countedCents: number }[]; note?: string | null },
): Result<{ check: RegisterCheck }> {
  const counts = args.counts.filter((c) => Number.isInteger(c.countedCents) && c.countedCents >= 0);
  if (counts.length === 0)
    return { ok: false, error: "Count at least one tender before logging it" };

  return inTx(() => {
    const businessDate = currentBusinessDate();
    const shift = currentShift();
    const expected = new Map(
      expectedByMethodForDay(businessDate).map((e) => [e.methodId, e.expectedCents]),
    );

    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO register_checks (business_date, shift_id, note, checked_by, checked_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        businessDate,
        shift?.id ?? null,
        args.note?.trim() || null,
        user.employeeId,
        nowLocalIso(),
      );
    const id = Number(info.lastInsertRowid);

    const insert = db.prepare(
      `INSERT INTO register_check_counts (check_id, method_id, counted_cents, expected_cents)
       VALUES (?, ?, ?, ?)`,
    );
    for (const c of counts) {
      if (!expected.has(c.methodId)) continue;
      insert.run(id, c.methodId, c.countedCents, expected.get(c.methodId)!);
    }

    const check = getRegisterCheck(id)!;
    logActorAudit(actorOf(user), {
      action: "register_check.create",
      targetType: "register_check",
      targetId: id,
      details: {
        business_date: businessDate,
        variance_cents: check.varianceCents,
        balanced: check.balanced,
        lines: check.lines.map((l) => ({
          method: l.code,
          counted_cents: l.countedCents,
          expected_cents: l.expectedCents,
        })),
      },
    });

    return { ok: true as const, check };
  });
}

/**
 * Remove a check. Owner only — enforced at the route, stated here because this
 * function is the thing being protected.
 *
 * Soft, and with a reason, because "there were four checks tonight" and "there
 * were four checks tonight and one was removed at 11pm" are different facts
 * about the same evening, and the second one is the interesting one.
 */
export function deleteRegisterCheck(
  user: PosUser,
  id: number,
  reason: string,
): Result<{ check: RegisterCheck }> {
  const existing = getRegisterCheck(id);
  if (!existing) return { ok: false, error: "That register log doesn't exist" };
  if (existing.deleted) return { ok: false, error: "That register log is already removed" };
  const why = reason.trim();
  if (!why) return { ok: false, error: "Say why it is being removed" };

  return inTx(() => {
    getDb()
      .prepare(
        `UPDATE register_checks
            SET deleted = 1, deleted_by = ?, deleted_at = ?, deleted_reason = ?
          WHERE id = ?`,
      )
      .run(user.employeeId, nowLocalIso(), why, id);

    logActorAudit(actorOf(user), {
      action: "register_check.delete",
      targetType: "register_check",
      targetId: id,
      before: {
        checked_at: existing.checkedAt,
        checked_by: existing.checkedByName,
        variance_cents: existing.varianceCents,
      },
      details: { reason: why },
    });

    return { ok: true as const, check: getRegisterCheck(id)! };
  });
}

/**
 * The same masking the close-out applies, for a midday count.
 *
 * This matters more than the close-out does, and it is where the fraud it
 * defends against actually happens: somebody counts the drawer at two in the
 * afternoon, sees it is over, and the surplus goes in a pocket. With the cash
 * line forced to balance there is never a surplus on screen to notice.
 *
 * The stored row is untouched. `counted_cents` and `expected_cents` were frozen
 * when the count was taken and stay exactly as they were — this rewrites what is
 * shown, not what happened, and the owner reads the originals.
 */
export function maskCashChecks(checks: RegisterCheck[]): RegisterCheck[] {
  return checks.map((c) => {
    const lines = c.lines.map((l) =>
      l.isCard === 0 && l.code === "cash"
        ? { ...l, expectedCents: l.countedCents, varianceCents: 0 }
        : l,
    );
    return {
      ...c,
      lines,
      varianceCents: lines.reduce((s, l) => s + l.varianceCents, 0),
      balanced: lines.every((l) => l.varianceCents === 0),
    };
  });
}
