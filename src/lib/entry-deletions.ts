import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

/**
 * Rows the owner has struck off the day's log.
 *
 * The Logs tab is a consecutive record of everything that happened, and that is
 * its whole value — it is what somebody opens when the drawer is short. But a
 * day collects rows nobody will ever want to read again: a line rung and voided
 * ten seconds later, a ticket put through to test a printer, a payment taken on
 * the wrong tender and reversed. They are already dead and counted nowhere. They
 * are also still there, and past a handful of them the list stops reading as a
 * record of what the shop did.
 *
 * SO THIS HIDES ROWS AND NEVER MOVES MONEY, and the two halves of that sentence
 * are load-bearing.
 *
 * A row may only be struck once it is already dead — a voided line, anything on
 * a voided ticket, a reversal, or a payment that has been reversed. Anything
 * still carrying money is refused and the caller is told to undo it properly
 * first. This is not caution for its own sake: a live $20 cash payment taken off
 * the ledger would leave the drawer $20 over at close with no row on any screen
 * to account for it. That is strictly worse than the untidy row it removed, and
 * it is exactly the class of bug the append-only ledgers exist to prevent.
 *
 * The consequence, stated plainly: this cannot be used to make a mistake go
 * away. It makes the RECORD of a mistake go away, once the mistake itself has
 * been undone through the paths that undo mistakes. Everything struck is still
 * in `sale_items` and `payments`, still readable to the owner on this screen,
 * and both the strike and its undo are in `audit_log` with a name against them.
 */

export type EntryKind = "line" | "money";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

/**
 * The struck rows, as the two sets `dayEntries` needs to filter by.
 *
 * Read whole rather than joined into the two big queries. The table holds one
 * row per thing anybody ever tidied away — tens, not thousands — and a pair of
 * `Set`s the reader can consult is far easier to get right than a `NOT EXISTS`
 * repeated in two places, where the first one somebody forgets to update is a
 * deleted row back in front of the floor.
 */
export function deletedEntryIds(): { lines: Set<number>; money: Set<number> } {
  const rows = getDb()
    .prepare("SELECT entry_kind AS kind, target_id AS id FROM entry_deletions")
    .all() as { kind: EntryKind; id: number }[];
  return {
    lines: new Set(rows.filter((r) => r.kind === "line").map((r) => r.id)),
    money: new Set(rows.filter((r) => r.kind === "money").map((r) => r.id)),
  };
}

/** Who struck each one and when, for the pill on the owner's copy of the list. */
export type EntryDeletion = {
  entryKind: EntryKind;
  targetId: number;
  reason: string | null;
  byName: string;
  deletedAt: string;
};

export function listEntryDeletions(): EntryDeletion[] {
  return getDb()
    .prepare(
      `SELECT d.entry_kind AS entryKind, d.target_id AS targetId, d.reason,
              e.name AS byName, d.deleted_at AS deletedAt
         FROM entry_deletions d
         JOIN employees e ON e.id = d.deleted_by`,
    )
    .all() as EntryDeletion[];
}

/**
 * Is there still live money on this row?
 *
 * The whole gate, in one place, so the answer cannot differ between the check
 * and the thing it guards. Returns the reason it is still live, or null when the
 * row is dead and may be struck.
 */
function stillLive(kind: EntryKind, id: number): string | null {
  const db = getDb();

  if (kind === "line") {
    const line = db
      .prepare(
        `SELECT i.voided, s.status, s.sale_no
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE i.id = ?`,
      )
      .get(id) as { voided: number; status: string; sale_no: string } | undefined;
    if (!line) return "That line doesn't exist";
    if (line.voided || line.status === "voided") return null;
    return `${line.sale_no} still counts this line. Void the line or the ticket first — deleting a row only takes it off the list, it does not take the money back.`;
  }

  const pay = db
    .prepare(
      `SELECT p.kind, s.status, s.sale_no,
              (SELECT rv.id FROM payments rv WHERE rv.reverses_payment_id = p.id) AS reversedById
         FROM payments p JOIN sales s ON s.id = p.sale_id
        WHERE p.id = ?`,
    )
    .get(id) as
    | { kind: string; status: string; sale_no: string; reversedById: number | null }
    | undefined;
  if (!pay) return "That payment doesn't exist";
  if (pay.status === "voided" || pay.kind === "reversal" || pay.reversedById !== null)
    return null;
  return `${pay.sale_no} still counts this payment. Void the ticket or correct the payment first — deleting a row only takes it off the list, it does not take the money back.`;
}

/**
 * Strike a row off.
 *
 * A payment and the reversal that killed it are struck TOGETHER, whichever of
 * the two was clicked. They are one event to the person reading the day — money
 * that went in and came straight back out — and leaving half of it on the list
 * would produce the one thing this screen must never show: a payment with
 * nothing beside it explaining where it went.
 */
export function deleteEntry(
  user: PosUser,
  kind: EntryKind,
  id: number,
  reason: string,
): Result<{ struck: number }> {
  if (!can(user.role, "deleteEntry"))
    return { ok: false, error: "Only the owner can take a row off the log" };

  const live = stillLive(kind, id);
  if (live) return { ok: false, error: live };

  const db = getDb();

  // The row asked for, plus its other half when it has one.
  const targets = new Set<number>([id]);
  if (kind === "money") {
    const pair = db
      .prepare(
        `SELECT p.reverses_payment_id AS reverses,
                (SELECT rv.id FROM payments rv WHERE rv.reverses_payment_id = p.id) AS reversedBy
           FROM payments p WHERE p.id = ?`,
      )
      .get(id) as { reverses: number | null; reversedBy: number | null };
    if (pair?.reverses) targets.add(pair.reverses);
    if (pair?.reversedBy) targets.add(pair.reversedBy);
  }

  return inTx(() => {
    const now = nowLocalIso();
    const why = reason.trim() || null;
    let struck = 0;
    for (const target of targets) {
      const info = db
        .prepare(
          `INSERT INTO entry_deletions (entry_kind, target_id, reason, deleted_by, deleted_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (entry_kind, target_id) DO NOTHING`,
        )
        .run(kind, target, why, user.employeeId, now);
      struck += info.changes;
    }

    logActorAudit(actorOf(user), {
      action: "pos_entry.strike",
      targetType: kind === "line" ? "sale_item" : "payment",
      targetId: id,
      details: { entry_kind: kind, also_struck: [...targets].filter((t) => t !== id), reason: why },
    });
    return { ok: true as const, struck };
  });
}

/**
 * Put one back.
 *
 * Symmetrical with the strike: a payment and its reversal come back together,
 * for the same reason they went together.
 */
export function restoreEntry(
  user: PosUser,
  kind: EntryKind,
  id: number,
): Result<{ restored: number }> {
  if (!can(user.role, "deleteEntry"))
    return { ok: false, error: "Only the owner can put a row back on the log" };

  const db = getDb();
  const targets = new Set<number>([id]);
  if (kind === "money") {
    const pair = db
      .prepare(
        `SELECT p.reverses_payment_id AS reverses,
                (SELECT rv.id FROM payments rv WHERE rv.reverses_payment_id = p.id) AS reversedBy
           FROM payments p WHERE p.id = ?`,
      )
      .get(id) as { reverses: number | null; reversedBy: number | null } | undefined;
    if (pair?.reverses) targets.add(pair.reverses);
    if (pair?.reversedBy) targets.add(pair.reversedBy);
  }

  return inTx(() => {
    let restored = 0;
    for (const target of targets) {
      const info = db
        .prepare("DELETE FROM entry_deletions WHERE entry_kind = ? AND target_id = ?")
        .run(kind, target);
      restored += info.changes;
    }
    if (restored === 0) return { ok: false as const, error: "That row is not deleted" };

    logActorAudit(actorOf(user), {
      action: "pos_entry.restore",
      targetType: kind === "line" ? "sale_item" : "payment",
      targetId: id,
      details: { entry_kind: kind, restored },
    });
    return { ok: true as const, restored };
  });
}
