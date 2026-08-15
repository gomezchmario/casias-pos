import { getDb } from "./db";
import { inTx } from "./tx";
import { nextSaleNo } from "./counters";
import { currentBusinessDate } from "./business-date";
import { nowLocalIso } from "./time";
import { getSetting } from "./settings";
import { diffRows, logActorAudit, type Actor } from "./audit";
import { applySaleMovements } from "./inventory";
// No runtime cycle despite fulfilment naming this file back: it only takes a
// type from here, and types erase.
import { stockHasMoved } from "./fulfillment";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

export type SaleStatus = "open" | "completed" | "voided";
/**
 * A 'purchase' is the shop buying over the counter — a used tire off a walk-in.
 * Its header amounts are positive (goods acquired, at cost); the money going out
 * is the negative payment row. See migrations/003_purchases.sql.
 */
export type SaleKind = "sale" | "purchase";
export type FulfillmentStatus =
  | "none"
  | "pending"
  | "ordered"
  | "arrived"
  | "no_answer"
  | "waiting_pickup"
  // Retired from the board, kept in the type and in the database's CHECK so the
  // handful of tickets that reached it before it was dropped still load. See
  // `FULFILLMENT_STAGES`.
  | "installed"
  | "delivered"
  | "cancelled";

/**
 * Where the car is. Chosen because these are the answers to the question
 * somebody at the counter is actually being asked — "is my truck ready?" — and
 * not because they are a tidy state machine.
 *
 * 'delivery' is the answer that is nobody's fault: the car is stripped, the
 * tire is on a truck, and there is nothing the shop can do until it lands. It
 * is worth its own word because it is the one status where the honest reply to
 * "how long?" is a different sentence — the other three are all "soon".
 *
 * It is NOT `fulfillment_status`. That tracks the ORDER, over days, with a
 * supplier at the other end; this says where the CAR is sitting this afternoon.
 * A ticket can easily be 'ordered' on one and 'working' on the other, and
 * collapsing them would make a special order that arrived and a car up on the
 * lift the same state.
 *
 * There is no "picked up". A ticket that has been paid and driven away leaves
 * the outstanding list by paying, which is the only signal anybody trusts.
 *
 * Adding to this list is deliberately cheap -- migration 014 left the column
 * without a CHECK constraint precisely so a fourth word would not need a
 * migration on a table holding every sale the shop has ever made. Old rows
 * carrying a word since removed still read fine; they just render as raw text.
 */
/**
 * Where the car is, as values. The words and colours live in `work-status.ts`,
 * which the browser can import; this is what the server will accept.
 *
 * Kept in the same order as `WORK_PILLS` on purpose — the two lists have to
 * agree, and the cheapest way to notice they have stopped agreeing is for them
 * to read the same way down the page.
 */
export const WORK_STATUSES = [
  "waiting",
  "working",
  "delivery",
  "ready",
  "no_answer",
  "waiting_pickup",
  "picked_up",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export type Sale = {
  id: number;
  sale_no: string;
  business_date: string;
  opened_at: string;
  completed_at: string | null;
  status: SaleStatus;
  kind: SaleKind;
  fulfillment_status: FulfillmentStatus;
  /** Where the car is, right now. NULL until somebody says. See 014. */
  work_status: WorkStatus | null;
  /** When it was dropped off, and when it left. Both NULL if it never was. 017. */
  vehicle_in_at: string | null;
  vehicle_out_at: string | null;
  is_special_order: number;
  cashier_id: number;
  customer_id: number | null;
  vehicle_id: number | null;
  seq: string | null;
  po: string | null;
  notes: string | null;
  /**
   * The note the counter leaves itself on this ticket — see 023_ticket_note.sql.
   *
   * NOT `notes`, which is part of the ticket's details and describes the job.
   * This is a message to whoever is on the counter next: "back after 5",
   * "called twice", "do not release until the torque is checked". It never
   * reaches the customer's receipt.
   */
  pinned_note: string | null;
  pinned_note_by: string | null;
  pinned_note_at: string | null;
  subtotal_cents: number;
  /** Taken off the goods, held POSITIVE and subtracted. See 009_discounts.sql
   *  for why this is a header column rather than a negative line. */
  discount_cents: number;
  discount_reason: string | null;
  discount_by: number | null;
  discount_at: string | null;
  tip_cents: number;
  comm_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  tax_rate_bp: number | null;
  voided_by: number | null;
  voided_at: string | null;
  void_reason: string | null;
  deleted: number;
};

export type SaleItem = {
  id: number;
  sale_id: number;
  line_no: number;
  product_id: number | null;
  description: string;
  category_id: number | null;
  mechanic_id: number | null;
  /**
   * A written-in name, for work done by somebody who is not on the payroll.
   * Only ever set when `mechanic_id` is NULL. See migrations/016 for the rule:
   * this is a label the ticket and the receipt can show, and every per-mechanic
   * report folds it into a single "Other" — it is never an identity.
   */
  mechanic_name: string | null;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  unit_cost_cents: number;
  /**
   * What the shelf said when this line was rung, or NULL if no shelf price was
   * in play (free-text service, used tire, purchase). Frozen on purpose — see
   * migrations/011_list_price.sql. Compare it to unit_price_cents to know the
   * price was typed over at the counter.
   */
  list_price_cents: number | null;
  /**
   * Who fitted the tire, when that is not the person who sold it. See
   * migrations/018_mount_credit.sql — the leaderboard moves
   * `mount_unit_cents * qty` from the seller to this name, the customer is
   * charged nothing extra, and NULL means the line behaves as it always did.
   */
  mount_mechanic_id: number | null;
  /** What one tire's fitting was worth when the name was put on. Frozen, so a
   *  later change to the shop's rate cannot restate a week already paid. */
  mount_unit_cents: number;
  voided: number;
  voided_by: number | null;
  voided_at: string | null;
  void_reason: string | null;
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

export function getSale(id: number): Sale | null {
  return (
    (getDb().prepare("SELECT * FROM sales WHERE id = ?").get(id) as Sale | undefined) ??
    null
  );
}

export function listSaleItems(saleId: number, includeVoided = false): SaleItem[] {
  const sql = includeVoided
    ? "SELECT * FROM sale_items WHERE sale_id = ? ORDER BY line_no"
    : "SELECT * FROM sale_items WHERE sale_id = ? AND voided = 0 ORDER BY line_no";
  return getDb().prepare(sql).all(saleId) as SaleItem[];
}

export function listOpenSales(): Sale[] {
  return getDb()
    .prepare(
      "SELECT * FROM sales WHERE status = 'open' AND deleted = 0 ORDER BY id DESC",
    )
    .all() as Sale[];
}

export function listSalesForDate(businessDate: string): Sale[] {
  return getDb()
    .prepare(
      "SELECT * FROM sales WHERE business_date = ? AND deleted = 0 ORDER BY id DESC",
    )
    .all(businessDate) as Sale[];
}

/**
 * Recompute the goods subtotal from live line items. Only valid while a sale is
 * open — once it completes the subtotal is frozen, because payments were taken
 * against that number.
 */
function recalcSubtotal(saleId: number): void {
  const db = getDb();
  const { n } = db
    .prepare(
      "SELECT COALESCE(SUM(line_total_cents), 0) AS n FROM sale_items WHERE sale_id = ? AND voided = 0",
    )
    .get(saleId) as { n: number };
  db.prepare("UPDATE sales SET subtotal_cents = ?, updated_at = ? WHERE id = ?").run(
    n,
    nowLocalIso(),
    saleId,
  );
  // A discount can outlive the lines it was given against: $15 off a $60 ticket,
  // then three of the four lines come back off, and the ticket owes -$5. Clamped
  // here rather than at the point of sale because this is the only place that
  // knows the subtotal moved. Reducing a discount someone authorised is a real
  // change to the ticket, so it is written down rather than applied on the fly
  // in `recalcMoney` -- a stored figure that disagrees with the arithmetic done
  // on it is how a report and a receipt end up telling different stories.
  db.prepare(
    "UPDATE sales SET discount_cents = ? WHERE id = ? AND discount_cents > ?",
  ).run(n, saleId, n);
  recalcMoney(saleId);
}

/**
 * Roll the payment ledger up onto the sale header. Tips and commission live on
 * payments, not on the sale, so this keeps running after completion — that is
 * exactly what makes a late tip land on the original ticket instead of a
 * phantom one.
 */
export function recalcMoney(saleId: number): void {
  const db = getDb();
  const sums = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid,
              COALESCE(SUM(tip_cents), 0)    AS tip,
              COALESCE(SUM(comm_cents), 0)   AS comm
       FROM payments WHERE sale_id = ?`,
    )
    .get(saleId) as { paid: number; tip: number; comm: number };
  const { subtotal_cents, discount_cents, status, kind } = db
    .prepare("SELECT subtotal_cents, discount_cents, status, kind FROM sales WHERE id = ?")
    .get(saleId) as {
    subtotal_cents: number;
    discount_cents: number;
    status: SaleStatus;
    kind: SaleKind;
  };

  // The one place the discount's sign is decided. It is stored positive; every
  // other reader takes the total's word for it rather than doing this again.
  const total = subtotal_cents - discount_cents + sums.tip + sums.comm;
  // On a purchase the money runs the other way — its ledger rows are negative —
  // so settling one drives `paid` down rather than up. Comparing on magnitude
  // lets a settled purchase land at a zero balance like a settled sale.
  const settled = kind === "purchase" ? -sums.paid : sums.paid;
  // A voided ticket keeps its total as the record of what was voided, but
  // nobody owes it — its payments have all been reversed.
  const balance = status === "voided" ? 0 : total - settled;
  db.prepare(
    `UPDATE sales SET tip_cents = ?, comm_cents = ?, total_cents = ?,
                      paid_cents = ?, balance_cents = ?, updated_at = ?
     WHERE id = ?`,
  ).run(sums.tip, sums.comm, total, sums.paid, balance, nowLocalIso(), saleId);
}

export function createSale(
  user: PosUser,
  opts: {
    isSpecialOrder?: boolean;
    customerId?: number | null;
    kind?: SaleKind;
  } = {},
): Result<{ sale: Sale }> {
  const kind = opts.kind ?? "sale";
  if (kind === "purchase" && !can(user.role, "cashPurchase"))
    return { ok: false, error: "Only a manager can buy over the counter" };

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    const saleNo = nextSaleNo();
    const info = db
      .prepare(
        `INSERT INTO sales
           (sale_no, business_date, opened_at, status, kind, fulfillment_status,
            is_special_order, cashier_id, customer_id, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleNo,
        currentBusinessDate(),
        now,
        kind,
        opts.isSpecialOrder ? "pending" : "none",
        opts.isSpecialOrder ? 1 : 0,
        user.employeeId,
        opts.customerId ?? null,
        now,
        now,
      );
    const id = Number(info.lastInsertRowid);
    logActorAudit(actorOf(user), {
      action: "sale.create",
      targetType: "sale",
      targetId: id,
      details: {
        sale_no: saleNo,
        kind,
        is_special_order: opts.isSpecialOrder ? 1 : 0,
      },
    });
    return { ok: true as const, sale: getSale(id)! };
  });
}

/**
 * Settle the two mechanic columns against each other, once, here.
 *
 * They are mutually exclusive by design and there is exactly one place that
 * decides it, because the alternative is a row with both set — and then every
 * report has to guess which one wins, and two of them will guess differently.
 * An employee id always wins: if the counter picked a real person, a name typed
 * next to it is stale and must not survive to be shown on the receipt instead
 * of them.
 *
 * A blank name with no id is the plain "Other" case — somebody pressed Other
 * and did not bother writing who. That is a real answer and is stored as the
 * word, not as NULL, because NULL already means "nobody did this" and the two
 * are different facts.
 */
function normalizeMechanic(args: {
  mechanicId?: number | null;
  mechanicName?: string | null;
}): { mechanicId: number | null; mechanicName: string | null } {
  const id = args.mechanicId ?? null;
  if (id !== null) return { mechanicId: id, mechanicName: null };
  if (args.mechanicName === undefined || args.mechanicName === null)
    return { mechanicId: null, mechanicName: null };
  const name = args.mechanicName.trim().slice(0, 60);
  return { mechanicId: null, mechanicName: name || "Other" };
}

export function addItem(
  user: PosUser,
  saleId: number,
  args: {
    description: string;
    qty: number;
    unitPriceCents: number;
    productId?: number | null;
    categoryId?: number | null;
    mechanicId?: number | null;
    /** Only honoured when `mechanicId` is absent. See `normalizeMechanic`. */
    mechanicName?: string | null;
    unitCostCents?: number;
  },
): Result<{ item: SaleItem }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status !== "open")
    return { ok: false, error: "This ticket is closed. Reopen it to add lines." };

  const description = args.description.trim();
  if (!description) return { ok: false, error: "Description is required" };
  if (!Number.isInteger(args.qty) || args.qty < 1)
    return { ok: false, error: "Quantity must be a whole number of 1 or more" };
  if (!Number.isInteger(args.unitPriceCents) || args.unitPriceCents < 0)
    return { ok: false, error: "Price is not valid" };

  const mech = normalizeMechanic(args);

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    const { next } = db
      .prepare(
        "SELECT COALESCE(MAX(line_no), 0) + 1 AS next FROM sale_items WHERE sale_id = ?",
      )
      .get(saleId) as { next: number };

    /**
     * The shelf price is read here, from the database, rather than accepted
     * from whatever posted the line. It is the number the flag will be judged
     * against, so a caller must not be able to supply it — a client that sent
     * its own list price could hand over the price it charged and produce a
     * line that was edited and does not say so, which is the one failure this
     * whole column exists to prevent.
     *
     * A price of 0 is stored as NULL: that is a used tire or anything else the
     * shop prices at the counter, and there is no shelf figure it could have
     * deviated from.
     */
    let listPriceCents: number | null = null;
    if (args.productId) {
      const p = db
        .prepare("SELECT price_cents FROM products WHERE id = ?")
        .get(args.productId) as { price_cents: number } | undefined;
      if (p && p.price_cents > 0) listPriceCents = p.price_cents;
    }

    const info = db
      .prepare(
        `INSERT INTO sale_items
           (sale_id, line_no, product_id, description, category_id, mechanic_id,
            mechanic_name, qty, unit_price_cents, line_total_cents, unit_cost_cents,
            list_price_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        next,
        args.productId ?? null,
        description,
        args.categoryId ?? null,
        mech.mechanicId,
        mech.mechanicName,
        args.qty,
        args.unitPriceCents,
        args.qty * args.unitPriceCents,
        args.unitCostCents ?? 0,
        listPriceCents,
        now,
        now,
      );

    const id = Number(info.lastInsertRowid);
    recalcSubtotal(saleId);
    logActorAudit(actorOf(user), {
      action: "sale_item.create",
      targetType: "sale",
      targetId: saleId,
      details: {
        item_id: id,
        description,
        qty: args.qty,
        unit_price_cents: args.unitPriceCents,
        mechanic_id: mech.mechanicId,
        mechanic_name: mech.mechanicName,
      },
    });
    const item = db.prepare("SELECT * FROM sale_items WHERE id = ?").get(id) as SaleItem;
    return { ok: true as const, item };
  });
}

export function updateItem(
  user: PosUser,
  itemId: number,
  args: {
    description?: string;
    qty?: number;
    unitPriceCents?: number;
    mechanicId?: number | null;
    mechanicName?: string | null;
    categoryId?: number | null;
  },
): Result {
  const db = getDb();
  const item = db.prepare("SELECT * FROM sale_items WHERE id = ?").get(itemId) as
    | SaleItem
    | undefined;
  if (!item) return { ok: false, error: "Line not found" };
  if (item.voided) return { ok: false, error: "That line is voided" };

  const sale = getSale(item.sale_id);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.status === "completed" && !canEditCompleted(user))
    return { ok: false, error: "Only a manager can edit a completed ticket" };

  // Either mechanic column being touched re-settles both, so an edit that moves
  // a line from Other onto a real fitter clears the written-in name instead of
  // leaving it behind to be printed next to somebody else's work.
  const mech =
    args.mechanicId === undefined && args.mechanicName === undefined
      ? { mechanicId: item.mechanic_id, mechanicName: item.mechanic_name }
      : normalizeMechanic({
          mechanicId: args.mechanicId ?? null,
          mechanicName:
            args.mechanicName === undefined ? item.mechanic_name : args.mechanicName,
        });

  const next = {
    description: args.description?.trim() ?? item.description,
    qty: args.qty ?? item.qty,
    unit_price_cents: args.unitPriceCents ?? item.unit_price_cents,
    mechanic_id: mech.mechanicId,
    mechanic_name: mech.mechanicName,
    category_id: args.categoryId === undefined ? item.category_id : args.categoryId,
  };
  if (!next.description) return { ok: false, error: "Description cannot be empty" };
  if (!Number.isInteger(next.qty) || next.qty < 1)
    return { ok: false, error: "Quantity must be a whole number of 1 or more" };
  if (!Number.isInteger(next.unit_price_cents) || next.unit_price_cents < 0)
    return { ok: false, error: "Price is not valid" };

  return inTx(() => {
    const lineTotal = next.qty * next.unit_price_cents;
    db.prepare(
      `UPDATE sale_items SET description = ?, qty = ?, unit_price_cents = ?,
                             line_total_cents = ?, mechanic_id = ?, mechanic_name = ?,
                             category_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.description,
      next.qty,
      next.unit_price_cents,
      lineTotal,
      next.mechanic_id,
      next.mechanic_name,
      next.category_id,
      nowLocalIso(),
      itemId,
    );

    // A completed ticket's subtotal is frozen; a manager edit deliberately
    // re-freezes it, and the audit row below is the record of that decision.
    recalcSubtotal(item.sale_id);

    const diff = diffRows(
      item as unknown as Record<string, unknown>,
      { ...next, line_total_cents: lineTotal } as Record<string, unknown>,
    );
    logActorAudit(actorOf(user), {
      action: "sale_item.update",
      targetType: "sale",
      targetId: item.sale_id,
      details: { item_id: itemId, sale_status: sale.status },
      before: diff?.before ?? null,
      after: diff?.after ?? null,
    });
    return { ok: true as const };
  });
}

function canEditCompleted(user: PosUser): boolean {
  return user.role === "manager" || user.role === "owner";
}

/**
 * Move a line to a different mechanic — and change nothing else.
 *
 * Deliberately not a call to `updateItem` with only `mechanicId` set. That path
 * refuses a cashier on a completed ticket, and rightly so: it can also move the
 * price, the quantity and the description, so opening it up to cashiers would
 * hand every cashier the ability to rewrite what a customer was charged after
 * the money was taken.
 *
 * Attribution is a different kind of fact from money. Reassigning a line does
 * not touch `line_total_cents`, the subtotal, the frozen total or any payment —
 * the customer paid what the customer paid. What moves is who gets the credit
 * on the leaderboard and the commission that rides on it, and the person best
 * placed to know that is the cashier who rang the ticket and watched who did
 * the work. Making them fetch a manager to fix a name is how the name stays
 * wrong: the shop's answer would be to leave it, and the leaderboard is only
 * worth having if it is right.
 *
 * So: cashier and up, open or completed, always audited. A voided ticket is
 * still refused — there is no credit on it to move.
 *
 * `recalcSubtotal` is NOT called, because nothing here can change it. That is
 * the whole point of the narrower operation, and it is what makes this safe on
 * a ticket whose total is frozen.
 */
export function reassignMechanic(
  user: PosUser,
  itemId: number,
  mechanicId: number | null,
  /**
   * A written-in name, when the line is being moved to Other rather than to a
   * person. Left off entirely, a null `mechanicId` still means "nobody" — the
   * two are different answers and the caller has to say which it means.
   */
  mechanicName?: string | null,
): Result {
  const db = getDb();
  const item = db.prepare("SELECT * FROM sale_items WHERE id = ?").get(itemId) as
    | SaleItem
    | undefined;
  if (!item) return { ok: false, error: "Line not found" };
  if (item.voided) return { ok: false, error: "That line is voided" };

  const sale = getSale(item.sale_id);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };

  if (mechanicId !== null) {
    const who = db
      .prepare("SELECT id FROM employees WHERE id = ? AND active = 1")
      .get(mechanicId) as { id: number } | undefined;
    if (!who) return { ok: false, error: "That employee is not on the books" };
  }

  const mech = normalizeMechanic({ mechanicId, mechanicName });
  if (item.mechanic_id === mech.mechanicId && item.mechanic_name === mech.mechanicName)
    return { ok: true as const };

  return inTx(() => {
    db.prepare(
      "UPDATE sale_items SET mechanic_id = ?, mechanic_name = ?, updated_at = ? WHERE id = ?",
    ).run(mech.mechanicId, mech.mechanicName, nowLocalIso(), itemId);
    logActorAudit(actorOf(user), {
      action: "sale_item.update",
      targetType: "sale",
      targetId: item.sale_id,
      details: { item_id: itemId, sale_status: sale.status, reassigned: true },
      before: { mechanic_id: item.mechanic_id, mechanic_name: item.mechanic_name },
      after: { mechanic_id: mech.mechanicId, mechanic_name: mech.mechanicName },
    });

    /*
      A TIP LEFT BEHIND FOLLOWS THE TECHNICIAN.

      `takePayment` now refuses a tip with nobody to credit, so this cannot
      arise fresh. It can still arise the other way round: the tip was taken
      while somebody WAS named, that person was taken off the line, and the
      credit has been sitting on a payment row pointing at nobody ever since.
      On S-2026-000424 it was the reverse order and cost Franklin $12.

      Only when the ticket now has exactly one technician on it — which is the
      same inference `soleMechanicOf` makes at the register, applied a few
      minutes late. Two people on the ticket and there is a real question about
      whose tip it is, so it stays orphaned and somebody has to say.

      In the same transaction as the reassignment, because a tip that follows
      the line only sometimes is worse than one that never does.
    */
    const now = db
      .prepare(
        `SELECT DISTINCT mechanic_id FROM sale_items
          WHERE sale_id = ? AND voided = 0 AND mechanic_id IS NOT NULL`,
      )
      .all(item.sale_id) as { mechanic_id: number }[];
    if (now.length === 1) {
      const adopted = db
        .prepare(
          `UPDATE payments SET mechanic_id = ?
            WHERE sale_id = ? AND tip_cents > 0 AND mechanic_id IS NULL`,
        )
        .run(now[0].mechanic_id, item.sale_id);
      if (adopted.changes > 0)
        logActorAudit(actorOf(user), {
          action: "payment.correct",
          targetType: "sale",
          targetId: item.sale_id,
          details: { tips_adopted: adopted.changes, reason: "line reassigned" },
          before: { mechanic_id: null },
          after: { mechanic_id: now[0].mechanic_id },
        });
    }

    return { ok: true as const };
  });
}

/**
 * Name the technician who FITTED an ordered tire, when that is not the one who
 * sold it.
 *
 * A special order is the job that reliably splits in two: the counter takes the
 * order on Monday and gets the credit for the tire, the tire lands on Thursday,
 * and whoever is free that afternoon does the mounting and balancing. The
 * leaderboard used to show the seller the whole price and the fitter nothing.
 *
 * This moves `mount_credit_cents` a tire off the seller and onto the fitter,
 * and that is ALL it does. `line_total_cents` is untouched, so the subtotal,
 * the frozen total, every payment and the day's takings are identical either
 * way -- the customer was never charged extra for this, and neither is the
 * shop's income restated. That is what makes it safe on a paid ticket, and it
 * is the same argument as `reassignMechanic`: who gets the credit is a
 * different kind of fact from what somebody was charged.
 *
 * Three things are refused rather than allowed to mean something surprising:
 *
 *   Not an order. The control is offered only on tickets the shop had to order
 *   a tire for, because that is the case where the two jobs genuinely happen on
 *   different days by different people. On a walk-in the person who sold it
 *   fitted it, and a second name there would mostly be a mis-click.
 *
 *   Not a tire line. $35 of fitting credit against a $20 flat repair would take
 *   more off the seller than the line is worth, and the clamp that stops that
 *   going negative would then quietly credit the fitter less than the rate.
 *
 *   Not the seller. Crediting somebody for fitting a tire they sold nets to
 *   zero money and still books them a service they did not separately do.
 *
 * The rate is copied onto the line, not read at report time. See the migration:
 * raising the shop's rate must not restate a week that has already been paid.
 */
export function setMountMechanic(
  user: PosUser,
  itemId: number,
  mechanicId: number | null,
): Result {
  const db = getDb();
  const item = db.prepare("SELECT * FROM sale_items WHERE id = ?").get(itemId) as
    | SaleItem
    | undefined;
  if (!item) return { ok: false, error: "Line not found" };
  if (item.voided) return { ok: false, error: "That line is voided" };

  const sale = getSale(item.sale_id);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };

  if (mechanicId !== null) {
    if (sale.fulfillment_status === "none")
      return { ok: false, error: "Only an ordered tire is fitted by somebody else" };
    if (mechanicId === item.mechanic_id)
      return { ok: false, error: "They already have this line" };

    const cat = db
      .prepare("SELECT code FROM service_categories WHERE id = ?")
      .get(item.category_id ?? -1) as { code: string } | undefined;
    if (cat?.code !== "new_tire" && cat?.code !== "used_tire")
      return { ok: false, error: "Only a tire line can be fitted" };

    const who = db
      .prepare("SELECT id FROM employees WHERE id = ? AND active = 1")
      .get(mechanicId) as { id: number } | undefined;
    if (!who) return { ok: false, error: "That employee is not on the books" };
  }

  // Cleared back to nobody, the rate goes with it. Leaving a stale rate on a
  // line with no name would be invisible until somebody re-credited it months
  // later and silently got the OLD rate instead of today's.
  const unitCents = mechanicId === null ? 0 : Number(getSetting("mount_credit_cents"));
  if (item.mount_mechanic_id === mechanicId && item.mount_unit_cents === unitCents)
    return { ok: true as const };

  return inTx(() => {
    db.prepare(
      "UPDATE sale_items SET mount_mechanic_id = ?, mount_unit_cents = ?, updated_at = ? WHERE id = ?",
    ).run(mechanicId, unitCents, nowLocalIso(), itemId);
    logActorAudit(actorOf(user), {
      action: "sale_item.update",
      targetType: "sale",
      targetId: item.sale_id,
      details: { item_id: itemId, sale_status: sale.status, mount: true },
      before: {
        mount_mechanic_id: item.mount_mechanic_id,
        mount_unit_cents: item.mount_unit_cents,
      },
      after: { mount_mechanic_id: mechanicId, mount_unit_cents: unitCents },
    });
    return { ok: true as const };
  });
}

export function voidItem(user: PosUser, itemId: number, reason: string): Result {
  const db = getDb();
  const item = db.prepare("SELECT * FROM sale_items WHERE id = ?").get(itemId) as
    | SaleItem
    | undefined;
  if (!item) return { ok: false, error: "Line not found" };
  if (item.voided) return { ok: true };

  const sale = getSale(item.sale_id);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.status === "completed" && !canEditCompleted(user))
    return { ok: false, error: "Only a manager can edit a completed ticket" };
  if (!reason.trim()) return { ok: false, error: "A reason is required to void a line" };

  return inTx(() => {
    db.prepare(
      "UPDATE sale_items SET voided = 1, voided_by = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?",
    ).run(user.employeeId, nowLocalIso(), reason.trim(), nowLocalIso(), itemId);
    recalcSubtotal(item.sale_id);
    logActorAudit(actorOf(user), {
      action: "sale_item.void",
      targetType: "sale",
      targetId: item.sale_id,
      // `sale_status` alongside the rest, matching `updateItem`. Striking a line
      // off a ticket that has already completed moves a figure the day has
      // counted, and the close-out lists those -- it can only do that if the row
      // says which kind of void this was. Without it every void looked like a
      // cashier tidying up an open ticket at the register.
      details: {
        item_id: itemId,
        description: item.description,
        reason: reason.trim(),
        sale_status: sale.status,
      },
    });
    return { ok: true as const };
  });
}

/**
 * Freeze the ticket. After this the customer owes a specific number, and only
 * the payment ledger may move it.
 *
 * Stock moves here too, in the same transaction. Deliberately not left to the
 * caller: a route that completed a sale and forgot to decrement inventory would
 * be indistinguishable from a working one until the counts drifted far enough
 * to notice, which is exactly the failure the spreadsheet already had.
 */
export function completeSale(user: PosUser, saleId: number): Result<{ sale: Sale }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.status === "completed") return { ok: true, sale };

  const items = listSaleItems(saleId);
  if (items.length === 0)
    return { ok: false, error: "Add at least one line before completing" };

  try {
    return inTx(() => {
      const db = getDb();
      recalcSubtotal(saleId);
      const now = nowLocalIso();
      db.prepare(
        "UPDATE sales SET status = 'completed', completed_at = ?, tax_rate_bp = ?, updated_at = ? WHERE id = ?",
      ).run(
        now,
        // Buying a used tire off a walk-in is not a taxable retail sale, so a
        // purchase carries no rate rather than a misleading 0.
        sale.kind === "purchase" ? null : Number(getSetting("tax_rate_bp")),
        now,
        saleId,
      );
      recalcMoney(saleId);

      // Buying stock over the counter puts tires IN; that is booked by the
      // purchase flow against a real lot with a real cost, not here.
      //
      // And a special order takes nothing out yet: the ticket completes when the
      // deposit is taken, which is days before the tire is here to take. The
      // decrement waits for the fulfilment board to say it was fitted.
      if (sale.kind !== "purchase" && stockHasMoved(sale.fulfillment_status)) {
        const stock = applySaleMovements(user, saleId);
        // A Result is not enough to undo the UPDATE above — better-sqlite3 only
        // rolls back on a throw. Thrown here, caught below, reported as normal.
        if (!stock.ok) throw new StockError(stock.error);
      }

      const after = getSale(saleId)!;
      logActorAudit(actorOf(user), {
        action: "sale.complete",
        targetType: "sale",
        targetId: saleId,
        details: {
          sale_no: after.sale_no,
          subtotal_cents: after.subtotal_cents,
          total_cents: after.total_cents,
          paid_cents: after.paid_cents,
          balance_cents: after.balance_cents,
        },
      });
      return { ok: true as const, sale: after };
    });
  } catch (e) {
    if (e instanceof StockError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Not enough stock, and nobody present may override it. */
class StockError extends Error {}

/**
 * Put a finished ticket back into the open state.
 *
 * WHY THIS EXISTS: `addItem` has always refused a completed ticket with the
 * words "Reopen it to add lines", and there was no way to reopen one. A
 * customer who comes back to the counter for a valve stem two minutes after
 * paying left the shop ringing a second ticket for a dollar, or writing the
 * line onto the next job.
 *
 * WHAT IT DOES NOT TOUCH, and this is the whole safety of it:
 *
 *   - The payments stay exactly where they are, on the day they were taken and
 *     in the shift that took them. Reopening is not a refund; the money that
 *     came in is still in.
 *   - The stock stays out. The tires left on the original completion, and
 *     `applySaleMovements` skips any line that already has a sale movement — so
 *     completing a second time moves only what was ADDED, never the same tire
 *     twice. That guard is what makes this safe to offer at all.
 *
 * Manager and up, the same rank that may edit a paid ticket, because it is the
 * same act with a bigger opening.
 *
 * A ticket from an earlier day is allowed but is not a small thing: its day has
 * been counted and very likely signed. The screen says so before it happens;
 * the audit row records the business date so the change can be found later.
 */
export function reopenSale(user: PosUser, saleId: number, reason: string): Result<{ sale: Sale }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (!canEditCompleted(user))
    return { ok: false, error: "Only a manager can reopen a ticket" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.status === "open") return { ok: true, sale };

  /*
    A MANAGER MAY REOPEN TODAY'S TICKETS. ONLY THE OWNER MAY REOPEN AN OLDER ONE.

    The difference is what the day has already been through. Today is still
    being worked: the drawer has not been counted, nothing has been signed, and
    a manager fixing a ticket an hour after it was paid is the ordinary running
    of the shop. A ticket from an earlier day belongs to a close-out somebody
    put their name to — adding a line to it changes what that day sold after the
    fact, and that is the owner's decision to make rather than the floor's.

    Checked against the ticket's OWN business date, not the calendar: the shop's
    day rolls on a rule of its own, and a ticket rung at half past midnight
    belongs to the day before.
  */
  if (sale.business_date !== currentBusinessDate() && user.role !== "owner")
    return {
      ok: false,
      error: `That ticket belongs to ${sale.business_date}, and that day has been closed — only the owner can reopen it`,
    };

  const why = reason.trim();
  if (!why) return { ok: false, error: "Say why it is being reopened" };

  return inTx(() => {
    const now = nowLocalIso();
    getDb()
      .prepare("UPDATE sales SET status = 'open', completed_at = NULL, updated_at = ? WHERE id = ?")
      .run(now, saleId);
    recalcMoney(saleId);
    const after = getSale(saleId)!;
    logActorAudit(actorOf(user), {
      action: "sale.reopen",
      targetType: "sale",
      targetId: saleId,
      details: {
        sale_no: sale.sale_no,
        reason: why,
        // The day it belongs to, not today. Reopening last Tuesday's ticket
        // changes last Tuesday's goods figure, and this is what makes that
        // findable afterwards.
        sale_business_date: sale.business_date,
        paid_cents: sale.paid_cents,
      },
      before: { status: sale.status, total_cents: sale.total_cents },
      after: { status: "open" },
    });
    return { ok: true as const, sale: after };
  });
}

/** The most a cashier may take off without a manager, in cents. */
export function cashierDiscountMaxCents(): number {
  return Number(getSetting("discount_cashier_max_cents"));
}

/**
 * Take money off a ticket.
 *
 * Set to zero to remove one. That is deliberately the same call as setting one:
 * "the discount on this ticket is now $0" is a change to the ticket like any
 * other, and it lands in the audit log with a before and an after, which
 * removing a row would not.
 *
 * The ceiling is checked here rather than at the route, because the route is not
 * the only caller this will ever have and a permission enforced next to the
 * database is one that cannot be walked around by adding a second entry point.
 */
export function setDiscount(
  user: PosUser,
  saleId: number,
  cents: number,
  reason: string,
): Result<{ sale: Sale }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.kind === "purchase")
    return { ok: false, error: "You cannot discount a ticket the shop is paying out on" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.status === "completed" && !canEditCompleted(user))
    return { ok: false, error: "Only a manager can change a paid ticket" };
  if (!can(user.role, "discountSale"))
    return { ok: false, error: "Your account can't give discounts" };

  if (!Number.isInteger(cents) || cents < 0)
    return { ok: false, error: "That is not a valid amount" };
  // Not "would make the total negative" — a ticket that gives back more than it
  // charges is a refund, and a refund is a different operation with a different
  // paper trail. Saying so is more use than clamping silently.
  if (cents > sale.subtotal_cents)
    return {
      ok: false,
      error: `That is more than the ticket comes to (${(sale.subtotal_cents / 100).toFixed(2)})`,
    };

  const max = cashierDiscountMaxCents();
  if (cents > max && !can(user.role, "discountAnyAmount"))
    return {
      ok: false,
      error: `A manager has to approve more than $${(max / 100).toFixed(2)} off`,
    };

  const why = reason.trim();
  // Required whenever money is actually coming off. This is the column the
  // close-out prints, and a flagged discount with nothing beside it tells the
  // owner only that they have a question to ask and nobody left to ask it of.
  if (cents > 0 && !why)
    return { ok: false, error: "Say why the discount is being given" };

  return inTx(() => {
    const now = nowLocalIso();
    getDb()
      .prepare(
        `UPDATE sales SET discount_cents = ?, discount_reason = ?, discount_by = ?,
                          discount_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(cents, cents > 0 ? why : null, cents > 0 ? user.employeeId : null,
           cents > 0 ? now : null, now, saleId);
    recalcMoney(saleId);
    const after = getSale(saleId)!;
    logActorAudit(actorOf(user), {
      action: "sale.discount",
      targetType: "sale",
      targetId: saleId,
      details: { sale_no: sale.sale_no, sale_status: sale.status },
      before: {
        discount_cents: sale.discount_cents,
        discount_reason: sale.discount_reason,
        total_cents: sale.total_cents,
      },
      after: {
        discount_cents: after.discount_cents,
        discount_reason: after.discount_reason,
        total_cents: after.total_cents,
      },
    });
    return { ok: true as const, sale: after };
  });
}

/*
 * There is no `updateSeq` here any more, and `sales.seq` is not written by
 * anything.
 *
 * A sequence number belongs to a swipe, and a swipe is a payment: a ticket paid
 * half on one card and half on another is two charges off the terminal and two
 * numbers, which one column on the header cannot hold. The header's copy was
 * always the wrong shape and nothing ever read it. The live one is
 * `payments.seq`, handed out automatically and renumbered in exactly one place
 * — see `setPaymentSeq`. The column is left in the schema rather than dropped
 * because rows written before this still carry values, and a migration that
 * throws away recorded numbers to tidy up is not a trade worth making.
 */

export function updatePo(user: PosUser, saleId: number, po: string | null): Result {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  const next = po?.trim() || null;
  if (next === sale.po) return { ok: true };

  return inTx(() => {
    getDb()
      .prepare("UPDATE sales SET po = ?, updated_at = ? WHERE id = ?")
      .run(next, nowLocalIso(), saleId);
    logActorAudit(actorOf(user), {
      action: "sale.po_update",
      targetType: "sale",
      targetId: saleId,
      before: { po: sale.po },
      after: { po: next },
    });
    return { ok: true as const };
  });
}

/**
 * Say where the car is.
 *
 * Logged under its own action rather than sharing one with the money, and that
 * distinction is the whole point. This is a note somebody moves three times an
 * hour while a car is on the lift, so it is much the noisiest thing written to
 * `audit_log` — dropped into `sale.update` alongside price corrections and
 * voids it would bury the log that exists to answer questions about money under
 * a pile of shrugs. Under a name of its own it can be left out of that view
 * with a WHERE, and still be there when the question is "who said this car was
 * ready at four o'clock".
 *
 * The early no-op return matters more than it looks: a screen that re-sends the
 * status it is already showing would otherwise write a row saying nothing
 * changed, several times a minute.
 */
export function setWorkStatus(
  user: PosUser,
  saleId: number,
  status: WorkStatus | null,
): Result {
  if (!can(user.role, "ringSale"))
    return { ok: false, error: "You cannot change tickets" };

  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (status !== null && !WORK_STATUSES.includes(status))
    return { ok: false, error: "That is not one of the work statuses" };
  if (status === sale.work_status) return { ok: true };

  return inTx(() => {
    const now = nowLocalIso();

    /**
     * The stamps come off this one control rather than a pair of date boxes
     * somebody has to remember to fill in. Saying the car is here IS the
     * drop-off, and clearing the status IS handing the keys back — asking a
     * second time, in a field, would get answered on the busy days by nobody.
     *
     * A returning car overwrites both. The question the shop asks is "how long
     * have we had it", present tense, about the visit happening now; a stamp
     * kept from a visit three weeks ago would answer a question nobody asked and
     * make the current one unanswerable.
     */
    const arriving = sale.work_status === null && status !== null;
    const leaving = sale.work_status !== null && status === null;

    getDb()
      .prepare(
        `UPDATE sales
            SET work_status = ?,
                vehicle_in_at  = CASE WHEN ? THEN ? ELSE vehicle_in_at END,
                vehicle_out_at = CASE WHEN ? THEN ?
                                      WHEN ? THEN NULL
                                      ELSE vehicle_out_at END,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        status,
        arriving ? 1 : 0, now,
        leaving ? 1 : 0, now,
        arriving ? 1 : 0,
        now,
        saleId,
      );

    logActorAudit(actorOf(user), {
      action: "sale.work_status_change",
      targetType: "sale",
      targetId: saleId,
      details: { sale_no: sale.sale_no },
      before: { work_status: sale.work_status },
      after: { work_status: status },
    });
    return { ok: true as const };
  });
}

export function updateSaleMeta(
  user: PosUser,
  saleId: number,
  args: { customerId?: number | null; vehicleId?: number | null; notes?: string | null },
): Result {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };

  const next = {
    customer_id: args.customerId === undefined ? sale.customer_id : args.customerId,
    vehicle_id: args.vehicleId === undefined ? sale.vehicle_id : args.vehicleId,
    notes: args.notes === undefined ? sale.notes : args.notes?.trim() || null,
  };

  return inTx(() => {
    getDb()
      .prepare(
        "UPDATE sales SET customer_id = ?, vehicle_id = ?, notes = ?, updated_at = ? WHERE id = ?",
      )
      .run(next.customer_id, next.vehicle_id, next.notes, nowLocalIso(), saleId);
    const diff = diffRows(sale as unknown as Record<string, unknown>, next);
    if (diff)
      logActorAudit(actorOf(user), {
        action: "sale.update",
        targetType: "sale",
        targetId: saleId,
        before: diff.before,
        after: diff.after,
      });
    return { ok: true as const };
  });
}

/** Header totals vs. the lines and the ledger. Any mismatch is a bug to surface,
 *  never to quietly repair. */
export function integrityCheck(businessDate?: string): {
  saleId: number;
  saleNo: string;
  issue: string;
}[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.id, s.sale_no, s.subtotal_cents, s.discount_cents, s.total_cents,
              s.paid_cents, s.tip_cents, s.comm_cents,
              (SELECT COALESCE(SUM(line_total_cents), 0) FROM sale_items i
                WHERE i.sale_id = s.id AND i.voided = 0) AS items_total,
              (SELECT COALESCE(SUM(amount_cents), 0) FROM payments p WHERE p.sale_id = s.id) AS paid_actual,
              (SELECT COALESCE(SUM(tip_cents), 0) FROM payments p WHERE p.sale_id = s.id) AS tip_actual,
              (SELECT COALESCE(SUM(comm_cents), 0) FROM payments p WHERE p.sale_id = s.id) AS comm_actual
       FROM sales s
       WHERE s.deleted = 0 ${businessDate ? "AND s.business_date = ?" : ""}`,
    )
    .all(...(businessDate ? [businessDate] : [])) as {
    id: number;
    sale_no: string;
    subtotal_cents: number;
    discount_cents: number;
    total_cents: number;
    paid_cents: number;
    tip_cents: number;
    comm_cents: number;
    items_total: number;
    paid_actual: number;
    tip_actual: number;
    comm_actual: number;
  }[];

  const issues: { saleId: number; saleNo: string; issue: string }[] = [];
  for (const r of rows) {
    if (r.paid_cents !== r.paid_actual)
      issues.push({
        saleId: r.id,
        saleNo: r.sale_no,
        issue: `paid_cents ${r.paid_cents} but payments sum to ${r.paid_actual}`,
      });
    if (r.tip_cents !== r.tip_actual)
      issues.push({
        saleId: r.id,
        saleNo: r.sale_no,
        issue: `tip_cents ${r.tip_cents} but payments sum to ${r.tip_actual}`,
      });
    if (r.comm_cents !== r.comm_actual)
      issues.push({
        saleId: r.id,
        saleNo: r.sale_no,
        issue: `comm_cents ${r.comm_cents} but payments sum to ${r.comm_actual}`,
      });
    const expected =
      r.subtotal_cents - r.discount_cents + r.tip_actual + r.comm_actual;
    if (r.total_cents !== expected)
      issues.push({
        saleId: r.id,
        saleNo: r.sale_no,
        issue: `total_cents ${r.total_cents} but subtotal − discount + tips + commission is ${expected}`,
      });
    // A discount bigger than the goods it came off means the total went
    // negative, which is a refund wearing a discount's clothes. `recalcSubtotal`
    // clamps this, so seeing it here means the clamp was bypassed.
    if (r.discount_cents > r.subtotal_cents)
      issues.push({
        saleId: r.id,
        saleNo: r.sale_no,
        issue: `discount ${r.discount_cents} exceeds the goods total ${r.subtotal_cents}`,
      });
  }
  return issues;
}

/**
 * The note the counter pins to a ticket for whoever is on it next.
 *
 * NOT the details note. `notes` describes the job and prints on the customer's
 * receipt; this is a message between staff — "back after five", "called twice",
 * "do not release until Hector checks the torque" — and never leaves the
 * building. Keeping them apart is the whole point: one column serving both
 * audiences means the note that prints on paperwork and the note that says
 * "ring him again" become the same string, and people write neither honestly.
 *
 * ANYBODY WHO CAN RING A TICKET CAN WRITE ONE, deliberately. It is the sticky
 * note that used to live on the monitor, and a sticky note nobody but a manager
 * may write is a sticky note that goes back on the monitor. The name and the
 * time ride along instead, which is the accountability that actually works
 * here — everyone can write, everyone can see who did.
 *
 * Blank clears it. There is no separate delete: the note is gone when there is
 * nothing to say, which is how a whiteboard behaves and what anybody expects of
 * one.
 */
export function setPinnedNote(
  user: PosUser,
  saleId: number,
  text: string | null,
): Result<{ sale: Sale }> {
  if (!can(user.role, "ringSale"))
    return { ok: false, error: "You cannot change tickets" };

  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };

  const next = text?.trim() || null;
  if (next === (sale.pinned_note ?? null)) return { ok: true as const, sale };
  if (next && next.length > 500)
    return { ok: false, error: "That note is too long for a ticket" };

  return inTx(() => {
    const now = nowLocalIso();
    getDb()
      .prepare(
        `UPDATE sales
            SET pinned_note = ?, pinned_note_by = ?, pinned_note_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      // The author is cleared with the text. A name left behind on an empty
      // note would put somebody's name against a message that is not there.
      .run(next, next ? user.name : null, next ? now : null, now, saleId);

    logActorAudit(actorOf(user), {
      action: "sale.update",
      targetType: "sale",
      targetId: saleId,
      details: { sale_no: sale.sale_no, change: "pinned_note" },
      before: { pinned_note: sale.pinned_note },
      after: { pinned_note: next },
    });
    return { ok: true as const, sale: getSale(saleId)! };
  });
}
