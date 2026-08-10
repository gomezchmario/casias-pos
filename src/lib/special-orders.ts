import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import { getSale, type FulfillmentStatus, type SaleStatus } from "./sales";
import { BOARD_RANK, FULFILLMENT_STAGES, stockHasMoved, type FulfillmentStage } from "./fulfillment";
import { applySaleMovements, receiveOrderedStock, stockOnHand } from "./inventory";
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

  // Taking an order back off a ticket that is already under way says the shop
  // was wrong about something it has already told the customer -- the same act
  // as walking a stage backwards, and gated the same way. It used to be refused
  // outright, on the grounds that a deposit would be stranded on a ticket that
  // fell off every list; the Outstanding panel now keeps any ticket that owes
  // money or has a car against it, so what is left is a judgement call rather
  // than a hole, and a judgement call is a manager's.
  const undoing = !on && sale.fulfillment_status !== "pending";
  if (undoing && !can(user.role, "reverseSpecialOrder"))
    return {
      ok: false,
      error: "Only a manager can take back an order that is already under way",
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

    // 'none' means an ordinary ticket, and an ordinary ticket's tires went out
    // with the customer. So un-marking a completed order that never reached
    // Fitted has to book the stock out now -- otherwise the rack goes on
    // counting a tire that was sold, and nothing will ever come back to book it,
    // because leaving the order lifecycle is exactly what just happened.
    // See `stockHasMoved` for why the predicate reads the way it does.
    if (
      !on &&
      sale.status === "completed" &&
      !stockHasMoved(sale.fulfillment_status) &&
      stockHasMoved(status)
    ) {
      const stock = applySaleMovements(user, saleId, { allowOversell: true });
      if (!stock.ok) throw new Error(stock.error);
    }

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
 *
 * A ticket that is not an order yet becomes one on the way past. Marking and
 * staging used to be two calls, which meant the counter had to toggle a ticket
 * into being an order and only then say what stage it was at — two moves for
 * one fact, with a ticket sitting in a state nobody chose in between. Saying
 * "this one needs ordering" is a single answer and is now a single call.
 */
export function setFulfillment(
  user: PosUser,
  saleId: number,
  status: FulfillmentStatus,
  opts?: {
    /**
     * Sale items the counter says are already on the rack, so fulfilment must
     * not book them in a second time. See orderStockPreview for the double
     * count this prevents.
     */
    alreadyStockedItemIds?: number[];
  },
): Result<{ status: FulfillmentStatus }> {
  if (!can(user.role, "manageSpecialOrders"))
    return { ok: false, error: "You cannot change special orders" };
  if (status === "none")
    return { ok: false, error: "Un-mark the ticket instead" };

  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Ticket not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.kind === "purchase")
    return { ok: false, error: "A buyback is not something to order in" };
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
        `UPDATE sales SET is_special_order = 1, fulfillment_status = ?,
                          fulfillment_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(status, now, now, saleId);

    // The tire comes off the rack HERE, not when the ticket completed. A special
    // order completes the day the deposit is taken; the tire turns up later, is
    // received like any other stock, and only leaves when it goes on the car.
    // Booking it at completion is what put eight impossible negatives in the
    // oversell queue on the first day this ran.
    //
    // Only for a ticket that is already completed. An order still open has not
    // been rung yet, and `completeSale` will do it when it is.
    if (sale.status === "completed" && !stockHasMoved(sale.fulfillment_status) && stockHasMoved(status)) {
      // The tire arrives and leaves in the same movement, because that is what
      // actually happened -- it came off the van and went onto the car. Booked
      // in first so the sale below has something to take, which is what keeps
      // the count where it was: zero stays zero, one stays one. Without it every
      // delivered order drove the size negative and filed a false oversell.
      // See `receiveOrderedStock`.
      const arrived = receiveOrderedStock(user, saleId, sale.po, {
        skipItemIds: opts?.alreadyStockedItemIds,
      });
      if (!arrived.ok) throw new Error(arrived.error);

      // Still overridden. The receipt above covers the ordered tires, but a
      // ticket can carry lines that were never ordered -- the mount, or a second
      // tire taken off the rack on the day -- and those are on the car now
      // whatever the count says. Refusing to book them out would leave the
      // ledger claiming the shop still has them, and an oversell flag is exactly
      // how a wrong count should be said out loud.
      const stock = applySaleMovements(user, saleId, { allowOversell: true });
      if (!stock.ok) throw new Error(stock.error);
    }

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

export type OrderStockLine = {
  saleItemId: number;
  productId: number;
  description: string;
  qty: number;
  onHand: number;
  /**
   * This exact line has already been booked in against the order — the
   * fulfilment will skip it on its own and nothing needs deciding.
   */
  alreadyReceivedForOrder: boolean;
  /** The product's recent stock history, so the counter can see what happened. */
  movements: {
    id: number;
    at: string;
    businessDate: string;
    qtyDelta: number;
    reason: string;
    byName: string | null;
    saleNo: string | null;
    /** A receipt with no ticket behind it — the shape of a hand-entered one. */
    looksManual: boolean;
  }[];
};

/**
 * What fulfilling this order is about to do to the racks, before it does it.
 *
 * The double count this exists to prevent: an ordered tire arrives, somebody
 * receives it through the normal Receive Stock screen, and then the order is
 * fulfilled — at which point `receiveOrderedStock` books it in AGAIN, because
 * that function skips only lines with a receipt tied to the sale item and a
 * hand-entered receipt has no sale item on it. The tire is then sold once and
 * received twice, and the size sits one high forever with nothing on any screen
 * to say why.
 *
 * The shop cannot be expected to remember whether they received it three weeks
 * ago, so this hands them the evidence instead: the line, what the count is
 * now, and every movement that product has had. A receipt in that list with no
 * ticket number against it is very probably the tire in front of them.
 */
export function orderStockPreview(saleId: number): OrderStockLine[] {
  const db = getDb();
  const lines = db
    .prepare(
      `SELECT i.id AS saleItemId, i.product_id AS productId,
              i.description, i.qty,
              EXISTS (SELECT 1 FROM inventory_movements m
                       WHERE m.sale_item_id = i.id AND m.reason = 'receive')
                AS alreadyReceivedForOrder
         FROM sale_items i
         JOIN products p ON p.id = i.product_id
        WHERE i.sale_id = ? AND i.voided = 0 AND p.track_inventory = 1
          AND p.condition <> 'used'
        ORDER BY i.id`,
    )
    .all(saleId) as {
    saleItemId: number;
    productId: number;
    description: string;
    qty: number;
    alreadyReceivedForOrder: number;
  }[];

  return lines.map((l) => ({
    saleItemId: l.saleItemId,
    productId: l.productId,
    description: l.description,
    qty: l.qty,
    onHand: stockOnHand(l.productId),
    alreadyReceivedForOrder: l.alreadyReceivedForOrder === 1,
    movements: (
      db
        .prepare(
          `SELECT m.id, m.created_at AS at, m.business_date AS businessDate,
                  m.qty_delta AS qtyDelta, m.reason,
                  e.name AS byName, s.sale_no AS saleNo
             FROM inventory_movements m
        LEFT JOIN employees e ON e.id = m.created_by
        LEFT JOIN sales s ON s.id = m.sale_id
            WHERE m.product_id = ?
         ORDER BY m.id DESC LIMIT 12`,
        )
        .all(l.productId) as {
        id: number;
        at: string;
        businessDate: string;
        qtyDelta: number;
        reason: string;
        byName: string | null;
        saleNo: string | null;
      }[]
    ).map((m) => ({ ...m, looksManual: m.reason === "receive" && m.saleNo === null })),
  }));
}

/**
 * Every state an order has been in, and when it moved.
 *
 * READ OUT OF `audit_log` RATHER THAN FROM A HISTORY TABLE OF ITS OWN, and that
 * is a deliberate choice rather than a shortcut. Every move an order makes is
 * already written there — before, after, who, and the minute — inside the same
 * transaction as the change itself. A second table recording the same events
 * would be a second thing to keep in step, and the first time somebody added a
 * path that moved an order without remembering to write to it, the history
 * would quietly start lying while the audit log stayed correct.
 *
 * The board itself only ever knew the CURRENT state and when it was last
 * touched, which answers "how long has this sat" and cannot answer "how long
 * did it sit at the supplier", "who rang them", or "when did this actually
 * arrive". Those are the questions asked a week later, and they were
 * unanswerable.
 */
export type OrderMove = {
  saleId: number;
  at: string;
  from: FulfillmentStatus | null;
  to: FulfillmentStatus;
  byName: string | null;
  byRole: string | null;
  /** Days this order sat in `from` before this move. Null on the first one. */
  daysInPrevious: number | null;
};

export function orderHistory(saleIds: number[]): Map<number, OrderMove[]> {
  const out = new Map<number, OrderMove[]>();
  if (saleIds.length === 0) return out;

  // Chunked, because SQLite caps a statement's variables and a shop with a
  // year of orders on screen would sail past it. 400 is well inside the limit
  // and makes the loop a formality on any real list.
  const db = getDb();
  const rows: {
    saleId: number;
    at: string;
    before_json: string | null;
    after_json: string | null;
    employee_name: string | null;
    employee_role: string | null;
  }[] = [];

  for (let i = 0; i < saleIds.length; i += 400) {
    const chunk = saleIds.slice(i, i + 400);
    rows.push(
      ...(db
        .prepare(
          `SELECT CAST(target_id AS INTEGER) AS saleId, timestamp AS at,
                  before_json, after_json, employee_name, employee_role
             FROM audit_log
            WHERE action = 'sale.fulfillment_change'
              AND target_type = 'sale'
              AND CAST(target_id AS INTEGER) IN (${chunk.map(() => "?").join(",")})
         ORDER BY id`,
        )
        .all(...chunk) as typeof rows),
    );
  }

  const parse = (j: string | null): FulfillmentStatus | null => {
    if (!j) return null;
    try {
      return (JSON.parse(j) as { fulfillment_status?: FulfillmentStatus })
        .fulfillment_status ?? null;
    } catch {
      return null;
    }
  };

  for (const r of rows) {
    const to = parse(r.after_json);
    if (!to) continue;
    const list = out.get(r.saleId) ?? [];
    const prev = list[list.length - 1];
    list.push({
      saleId: r.saleId,
      at: r.at,
      from: parse(r.before_json),
      to,
      byName: r.employee_name,
      byRole: r.employee_role,
      // Measured against the previous MOVE rather than against the ticket's
      // own date, so the figure answers "how long did it sit like that" — the
      // question somebody asks when a customer complains about the wait.
      daysInPrevious: prev ? daysSince(prev.at) - daysSince(r.at) : null,
    });
    out.set(r.saleId, list);
  }
  return out;
}

/**
 * Orders as a LOG rather than as a board.
 *
 * `listSpecialOrders` answers "who is waiting on us right now" and is shaped
 * entirely around that: finished orders drop off after a fortnight, and the
 * sort is by whose turn it is rather than by time. Both of those are right for
 * a counter and wrong for the question this answers, which is "what happened to
 * the orders we took in March".
 *
 * So this one hides nothing, sorts newest first, and takes a window. It is a
 * second reading of the same rows, not a second source for them.
 */
export function listOrderLog(args?: {
  /** Business-date window, inclusive. Omitted means every order ever taken. */
  from?: string;
  to?: string;
}): SpecialOrder[] {
  const where: string[] = [
    "s.deleted = 0",
    "s.is_special_order = 1",
    "s.fulfillment_status <> 'none'",
  ];
  const params: string[] = [];
  if (args?.from) {
    where.push("s.business_date >= ?");
    params.push(args.from);
  }
  if (args?.to) {
    where.push("s.business_date <= ?");
    params.push(args.to);
  }

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
              (SELECT GROUP_CONCAT(
                        CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                             ELSE i.description END, ', ')
                 FROM sale_items i
                WHERE i.sale_id = s.id AND i.voided = 0) AS what
         FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN vehicles  v ON v.id = s.vehicle_id
        WHERE ${where.join(" AND ")}
     ORDER BY s.business_date DESC, s.id DESC`,
    )
    .all(...params) as Row[];

  return rows.map((r): SpecialOrder => {
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
      vehicle: [r.year, r.make, r.model].filter(Boolean).join(" ") || r.plate || null,
      what: r.what ?? "",
      notes: r.notes,
      totalCents: r.totalCents,
      paidCents: r.paidCents,
      balanceCents: r.balanceCents,
    };
  });
}
