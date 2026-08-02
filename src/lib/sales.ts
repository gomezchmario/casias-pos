import { getDb } from "./db";
import { inTx } from "./tx";
import { nextSaleNo } from "./counters";
import { currentBusinessDate } from "./business-date";
import { nowLocalIso } from "./time";
import { getSetting } from "./settings";
import { diffRows, logActorAudit, type Actor } from "./audit";
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
  | "installed"
  | "delivered"
  | "cancelled";

export type Sale = {
  id: number;
  sale_no: string;
  business_date: string;
  opened_at: string;
  completed_at: string | null;
  status: SaleStatus;
  kind: SaleKind;
  fulfillment_status: FulfillmentStatus;
  is_special_order: number;
  cashier_id: number;
  customer_id: number | null;
  vehicle_id: number | null;
  seq: string | null;
  po: string | null;
  notes: string | null;
  subtotal_cents: number;
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
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  unit_cost_cents: number;
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
  const { subtotal_cents, status, kind } = db
    .prepare("SELECT subtotal_cents, status, kind FROM sales WHERE id = ?")
    .get(saleId) as { subtotal_cents: number; status: SaleStatus; kind: SaleKind };

  const total = subtotal_cents + sums.tip + sums.comm;
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

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    const { next } = db
      .prepare(
        "SELECT COALESCE(MAX(line_no), 0) + 1 AS next FROM sale_items WHERE sale_id = ?",
      )
      .get(saleId) as { next: number };

    const info = db
      .prepare(
        `INSERT INTO sale_items
           (sale_id, line_no, product_id, description, category_id, mechanic_id,
            qty, unit_price_cents, line_total_cents, unit_cost_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        next,
        args.productId ?? null,
        description,
        args.categoryId ?? null,
        args.mechanicId ?? null,
        args.qty,
        args.unitPriceCents,
        args.qty * args.unitPriceCents,
        args.unitCostCents ?? 0,
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
        mechanic_id: args.mechanicId ?? null,
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

  const next = {
    description: args.description?.trim() ?? item.description,
    qty: args.qty ?? item.qty,
    unit_price_cents: args.unitPriceCents ?? item.unit_price_cents,
    mechanic_id: args.mechanicId === undefined ? item.mechanic_id : args.mechanicId,
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
                             line_total_cents = ?, mechanic_id = ?, category_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.description,
      next.qty,
      next.unit_price_cents,
      lineTotal,
      next.mechanic_id,
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
      details: { item_id: itemId, description: item.description, reason: reason.trim() },
    });
    return { ok: true as const };
  });
}

/**
 * Freeze the ticket. After this the customer owes a specific number, and only
 * the payment ledger may move it.
 */
export function completeSale(user: PosUser, saleId: number): Result<{ sale: Sale }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (sale.status === "completed") return { ok: true, sale };

  const items = listSaleItems(saleId);
  if (items.length === 0)
    return { ok: false, error: "Add at least one line before completing" };

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
}

/** SEQ is the card terminal's ticket number. Anyone at the register may fix it,
 *  but every change is on the record — that is the whole point of the column. */
export function updateSeq(user: PosUser, saleId: number, seq: string | null): Result {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  const next = seq?.trim() || null;
  if (next === sale.seq) return { ok: true };

  return inTx(() => {
    getDb()
      .prepare("UPDATE sales SET seq = ?, updated_at = ? WHERE id = ?")
      .run(next, nowLocalIso(), saleId);
    logActorAudit(actorOf(user), {
      action: "sale.seq_update",
      targetType: "sale",
      targetId: saleId,
      before: { seq: sale.seq },
      after: { seq: next },
    });
    return { ok: true as const };
  });
}

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
      `SELECT s.id, s.sale_no, s.subtotal_cents, s.total_cents, s.paid_cents, s.tip_cents, s.comm_cents,
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
    if (r.total_cents !== r.subtotal_cents + r.tip_actual + r.comm_actual)
      issues.push({
        saleId: r.id,
        saleNo: r.sale_no,
        issue: `total_cents ${r.total_cents} but subtotal + tips + commission is ${r.subtotal_cents + r.tip_actual + r.comm_actual}`,
      });
  }
  return issues;
}
