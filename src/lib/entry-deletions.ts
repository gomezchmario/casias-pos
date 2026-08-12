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
 *
 * A ROW OF A VOIDED TICKET TAKES THE WHOLE TICKET WITH IT.
 *
 * Striking one line of a ticket that no longer exists left the other five lines,
 * the payment, the reversal and the ticket itself on the log — so "delete" read
 * as "delete", removed a fraction of what it named, and the ticket went on
 * being counted as one of the day's voids on the close-out with nothing
 * anywhere to take it off. Every row of a voided ticket is dead by definition
 * and they are one event to the person reading the day, so they go together and
 * `sales.deleted` is set beside them, which is the flag every count already
 * honours. A voided line on a LIVE ticket is still struck on its own: the
 * ticket around it is real and still owed for.
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

/** The ticket a struck row belongs to, and whether it is still alive. */
function saleOf(kind: EntryKind, id: number): { id: number; status: string } | null {
  const sql =
    kind === "line"
      ? `SELECT s.id, s.status FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.id = ?`
      : `SELECT s.id, s.status FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.id = ?`;
  return (getDb().prepare(sql).get(id) as { id: number; status: string } | undefined) ?? null;
}

/**
 * Take a voided ticket off the day entirely.
 *
 * Every line, every payment, and the sale itself. The sale carries the soft
 * delete the schema has always had room for — see invariant 3 — which is what
 * makes it disappear from the void count on the close-out rather than merely
 * from the log. Nothing is destroyed and no money moves: the ticket was already
 * voided, so its payments were already reversed and its stock already returned.
 */
function strikeWholeSale(user: PosUser, saleId: number, reason: string): Result<{ struck: number }> {
  const db = getDb();
  const lines = db
    .prepare("SELECT id FROM sale_items WHERE sale_id = ?")
    .all(saleId) as { id: number }[];
  const pays = db
    .prepare("SELECT id FROM payments WHERE sale_id = ?")
    .all(saleId) as { id: number }[];

  return inTx(() => {
    const now = nowLocalIso();
    const why = reason.trim() || null;
    let struck = 0;
    const put = db.prepare(
      `INSERT INTO entry_deletions (entry_kind, target_id, reason, deleted_by, deleted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (entry_kind, target_id) DO NOTHING`,
    );
    for (const l of lines) struck += put.run("line", l.id, why, user.employeeId, now).changes;
    for (const m of pays) struck += put.run("money", m.id, why, user.employeeId, now).changes;

    const before = db.prepare("SELECT sale_no, deleted FROM sales WHERE id = ?").get(saleId) as {
      sale_no: string;
      deleted: number;
    };
    db.prepare("UPDATE sales SET deleted = 1 WHERE id = ?").run(saleId);

    logActorAudit(actorOf(user), {
      action: "sale.delete",
      targetType: "sale",
      targetId: saleId,
      details: {
        sale_no: before.sale_no,
        reason: why,
        lines: lines.length,
        payments: pays.length,
      },
      before: { deleted: before.deleted },
      after: { deleted: 1 },
    });
    return { ok: true as const, struck };
  });
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

  /*
    A dead ticket goes whole.

    Worked out before the per-row pairing below, because if this fires it
    supersedes it: striking every payment on the ticket already includes both
    halves of any reversal.
  */
  const sale = saleOf(kind, id);
  if (sale?.status === "voided") return strikeWholeSale(user, sale.id, reason);

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

/** The undo of `strikeWholeSale`, row for row and flag for flag. */
function restoreWholeSale(user: PosUser, saleId: number): Result<{ restored: number }> {
  const db = getDb();
  return inTx(() => {
    const lines = db
      .prepare("SELECT id FROM sale_items WHERE sale_id = ?")
      .all(saleId) as { id: number }[];
    const pays = db
      .prepare("SELECT id FROM payments WHERE sale_id = ?")
      .all(saleId) as { id: number }[];

    let restored = 0;
    const drop = db.prepare(
      "DELETE FROM entry_deletions WHERE entry_kind = ? AND target_id = ?",
    );
    for (const l of lines) restored += drop.run("line", l.id).changes;
    for (const m of pays) restored += drop.run("money", m.id).changes;

    const before = db.prepare("SELECT sale_no, deleted FROM sales WHERE id = ?").get(saleId) as {
      sale_no: string;
      deleted: number;
    };
    db.prepare("UPDATE sales SET deleted = 0 WHERE id = ?").run(saleId);
    if (restored === 0 && before.deleted === 0)
      return { ok: false as const, error: "That ticket is not deleted" };

    logActorAudit(actorOf(user), {
      action: "pos_entry.restore",
      targetType: "sale",
      targetId: saleId,
      details: { sale_no: before.sale_no, restored, whole_ticket: true },
      before: { deleted: before.deleted },
      after: { deleted: 0 },
    });
    return { ok: true as const, restored };
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

  // Symmetrical with the strike: a whole ticket came off, a whole ticket goes
  // back. Anything else would leave a ticket half restored — visible on the log
  // but still missing from the day's counts, or the other way round.
  const sale = saleOf(kind, id);
  if (sale?.status === "voided") return restoreWholeSale(user, sale.id);

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
