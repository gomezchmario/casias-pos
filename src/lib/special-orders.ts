import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import { getSale, type FulfillmentStatus, type SaleStatus } from "./sales";
import { BOARD_RANK, FULFILLMENT_STAGES, type FulfillmentStage } from "./fulfillment";
import type { PosUser } from "./pos-session";

/**
 * The green and blue sheet, which was a list of tires somebody had promised
 * somebody else.
 *
 * A special order is NOT a separate kind of money. It is an ordinary ticket
 * with two extra facts attached: a lifecycle, and usually a balance. That is
 * the whole design, and it is the reason there is no `special_orders` table --
 * a parallel money model would have to be reconciled against the real one
 * every night, and the night it disagreed would be the night nobody could say
 * which of the two was right.
 *
 * THE ONE THING TO KEEP HOLD OF: 'completed' is not 'paid'. A special order is
 * routinely completed with money still owing -- the deposit is taken, the
 * ticket is closed, the tire is ordered, the balance is collected on pickup
 * three days later. Any code that reads `status = 'completed'` as "settled" is
 * wrong about this screen specifically, which is why balance is carried
 * separately everywhere below.
 */

export type SpecialOrder = {
  saleId: number;
  saleNo: string;
  businessDate: string;
  openedAt: string;
  saleStatus: SaleStatus;
  status: FulfillmentStatus;
  /** When the status last moved, or the day it was opened if it never has. */
  statusAt: string;
  /** Whole days since then. The board's headline number: how long has this sat. */
  daysWaiting: number;
  customerName: string | null;
  customerPhone: string | null;
  vehicle: string | null;
  /** What was ordered, from the ticket's own lines. */
  what: string;
  notes: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
};

type Row = {
  saleId: number;
  saleNo: string;
  businessDate: string;
  openedAt: string;
  saleStatus: SaleStatus;
  status: FulfillmentStatus;
  fulfillmentAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  what: string | null;
  notes: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
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

/** Whole days between a local-ISO stamp and now, floored, never negative. */
function daysSince(at: string): number {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * Every special order, board-ordered.
 *
 * Delivered and cancelled ones are included but sink to the bottom, and only
 * for a while -- see `settledDays`. They are on the list at all because "did
 * that tire ever get picked up" is asked about orders that are finished at
 * least as often as about ones that are not, and a board that forgets a ticket
 * the moment it is done sends that question to the audit log.
 */
export function listSpecialOrders(settledDays = 14): SpecialOrder[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id                 AS saleId,
              s.sale_no            AS saleNo,
              s.business_date      AS businessDate,
              s.opened_at          AS openedAt,
              s.status             AS saleStatus,
              s.fulfillment_status AS status,
              s.fulfillment_at     AS fulfillmentAt,
              c.name               AS customerName,
              c.phone              AS customerPhone,
              v.year               AS year,
              v.make               AS make,
              v.model              AS model,
              v.plate              AS plate,
              s.notes              AS notes,
              s.total_cents        AS totalCents,
              s.paid_cents         AS paidCents,
              s.balance_cents      AS balanceCents,
              -- The lines, as one string, because the board wants "4× 205/55R16"
              -- and not a second query per row. Voided lines are left out: a
              -- line struck off an order is not part of what was ordered.
              (SELECT GROUP_CONCAT(
                        CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                             ELSE i.description END, ', ')
                 FROM sale_items i
                WHERE i.sale_id = s.id AND i.voided = 0) AS what
         FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN vehicles  v ON v.id = s.vehicle_id
        WHERE s.deleted = 0
          AND s.is_special_order = 1
          AND s.fulfillment_status <> 'none'`,
    )
    .all() as Row[];

  return rows
    .map((r): SpecialOrder => {
      const statusAt = r.fulfillmentAt ?? r.openedAt;
      return {
        saleId: r.saleId,
        saleNo: r.saleNo,
        businessDate: r.businessDate,
        openedAt: r.openedAt,
        saleStatus: r.saleStatus,
        status: r.status,
        statusAt,
        daysWaiting: daysSince(statusAt),
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        vehicle:
          [r.year, r.make, r.model].filter(Boolean).join(" ") ||
          r.plate ||
          null,
        what: r.what ?? "",
        notes: r.notes,
        totalCents: r.totalCents,
        paidCents: r.paidCents,
        balanceCents: r.balanceCents,
      };
    })
    .filter((o) => {
      // A finished order drops off the board after a fortnight -- unless it
      // still owes money, in which case it is not finished no matter what the
      // status says, and it stays until somebody deals with it.
      const settled = o.status === "delivered" || o.status === "cancelled";
      return !settled || o.daysWaiting <= settledDays || o.balanceCents !== 0;
    })
    .sort((a, b) => {
      const rank = BOARD_RANK[a.status] - BOARD_RANK[b.status];
      if (rank !== 0) return rank;
      // Oldest first inside a bucket. The one that has been waiting longest is
      // the one that has been forgotten longest.
      return b.daysWaiting - a.daysWaiting;
    });
}

/**
 * Turn an ordinary ticket into a special order, or back.
 *
 * Available after the fact rather than only at the moment the ticket is
 * opened, because that is when it is known: the tire is rung up, the rack is
 * checked, and only then does it turn out there are two of that size and the
 * customer wants four.
 */
export function markSpecialOrder(
  user: PosUser,
  saleId: number,
  on: boolean,
): Result<{ status: FulfillmentStatus }> {
  if (!can(user.role, "manageSpecialOrders"))
    return { ok: false, error: "You cannot change special orders" };

  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Ticket not found" };
  if (sale.status === "voided")
    return { ok: false, error: "This ticket is voided" };
  if (sale.kind === "purchase")
    return { ok: false, error: "A buyback is not something to order in" };

  // Turning it off once it is under way would strand a customer's deposit on a
  // ticket that no longer appears on any list. Cancel it instead -- that is
  // what cancel is for, and it leaves a trail.
  if (!on && sale.fulfillment_status !== "pending")
    return {
      ok: false,
      error: "This order is already under way. Cancel it rather than un-marking it.",
    };

  const status: FulfillmentStatus = on ? "pending" : "none";
  if (status === sale.fulfillment_status) return { ok: true, status };

  return inTx(() => {
    getDb()
      .prepare(
        `UPDATE sales SET is_special_order = ?, fulfillment_status = ?,
                          fulfillment_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(on ? 1 : 0, status, on ? nowLocalIso() : null, nowLocalIso(), saleId);

    logActorAudit(actorOf(user), {
      action: "sale.fulfillment_change",
      targetType: "sale",
      targetId: saleId,
      details: { sale_no: sale.sale_no, marked: on },
      before: { fulfillment_status: sale.fulfillment_status },
      after: { fulfillment_status: status },
    });
    return { ok: true as const, status };
  });
}

/**
 * Move an order along.
 *
 * Forward is anybody's job -- whoever is at the counter when the truck comes in
 * is who marks it arrived, and making them fetch a manager to do it is how a
 * board stops reflecting reality within a week.
 *
 * Backwards is not. Going back a stage says the shop was wrong about something
 * it already told the customer ("your tires are here"), and cancelling an order
 * usually means somebody's deposit has to go back. Both are manager work, and
 * both are logged with where they came from.
 */
export function setFulfillment(
  user: PosUser,
  saleId: number,
  status: FulfillmentStatus,
): Result<{ status: FulfillmentStatus }> {
  if (!can(user.role, "manageSpecialOrders"))
    return { ok: false, error: "You cannot change special orders" };
  if (status === "none")
    return { ok: false, error: "Un-mark the ticket instead" };

  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Ticket not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.fulfillment_status === "none")
    return { ok: false, error: "This ticket is not a special order" };
  if (status === sale.fulfillment_status) return { ok: true, status };

  const from = FULFILLMENT_STAGES.indexOf(sale.fulfillment_status as FulfillmentStage);
  const to = FULFILLMENT_STAGES.indexOf(status as FulfillmentStage);
  // Backwards, cancelling, or reviving something cancelled. All three are the
  // same kind of act: undoing a thing the shop has already acted on.
  const undoing = status === "cancelled" || sale.fulfillment_status === "cancelled" || to < from;
  if (undoing && !can(user.role, "reverseSpecialOrder"))
    return {
      ok: false,
      error: "Only a manager can move an order back or cancel it",
    };

  return inTx(() => {
    const now = nowLocalIso();
    getDb()
      .prepare(
        "UPDATE sales SET fulfillment_status = ?, fulfillment_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, now, now, saleId);

    logActorAudit(actorOf(user), {
      action: "sale.fulfillment_change",
      targetType: "sale",
      targetId: saleId,
      details: { sale_no: sale.sale_no, undoing },
      before: { fulfillment_status: sale.fulfillment_status },
      after: { fulfillment_status: status },
    });
    return { ok: true as const, status };
  });
}
