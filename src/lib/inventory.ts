import { getDb } from "./db";
import { inTx } from "./tx";
import { nextLotNo } from "./counters";
import { currentBusinessDate } from "./business-date";
import { nowLocalIso } from "./time";
import { getSetting } from "./settings";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

/**
 * Stock is DERIVED, never stored.
 *
 * `inventory_movements` is an append-only ledger and the single source of truth
 * for how many of a thing the shop has. There is deliberately no `qty_on_hand`
 * column on `products` to drift out of step with it: the only way to change
 * stock is to write a row saying why it changed, and the only way to undo one is
 * to write a reversing row that points at it.
 *
 * `inventory_lots.qty_remaining` looks like an exception but is not — it is a
 * FIFO cursor, not an authority. Every function here updates it inside the same
 * transaction as the movement that caused it, and `lotIntegrityCheck` exists to
 * prove the two still agree.
 */

export type MovementReason =
  | "receive"
  | "sale"
  | "void_return"
  | "refund_return"
  | "adjust"
  | "count"
  | "damage"
  | "opening";

export type InventoryLot = {
  id: number;
  lot_no: string;
  product_id: number;
  received_at: string;
  unit_cost_cents: number;
  qty_received: number;
  qty_remaining: number;
  supplier: string | null;
  reference: string | null;
  is_default: number;
  received_by: number | null;
  deleted: number;
};

export type Movement = {
  id: number;
  product_id: number;
  lot_id: number | null;
  qty_delta: number;
  unit_cost_cents: number;
  reason: MovementReason;
  sale_id: number | null;
  sale_item_id: number | null;
  reverses_movement_id: number | null;
  oversold: number;
  reviewed_by: number | null;
  reviewed_at: string | null;
  note: string | null;
  business_date: string;
  created_by: number;
  created_at: string;
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

// ---------------------------------------------------------------------------
// Reading stock
// ---------------------------------------------------------------------------

export function stockOnHand(productId: number): number {
  const { n } = getDb()
    .prepare(
      "SELECT COALESCE(SUM(qty_delta), 0) AS n FROM inventory_movements WHERE product_id = ?",
    )
    .get(productId) as { n: number };
  return n;
}

/** Stock for many products at once — one query, so a list page is not N+1. */
export function stockOnHandFor(productIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (productIds.length === 0) return out;
  const rows = getDb()
    .prepare(
      `SELECT product_id, COALESCE(SUM(qty_delta), 0) AS n
         FROM inventory_movements
        WHERE product_id IN (${productIds.map(() => "?").join(",")})
        GROUP BY product_id`,
    )
    .all(...productIds) as { product_id: number; n: number }[];
  for (const r of rows) out.set(r.product_id, r.n);
  for (const id of productIds) if (!out.has(id)) out.set(id, 0);
  return out;
}

export function listLots(productId: number, includeEmpty = false): InventoryLot[] {
  const sql = includeEmpty
    ? "SELECT * FROM inventory_lots WHERE product_id = ? AND deleted = 0 ORDER BY received_at, id"
    : "SELECT * FROM inventory_lots WHERE product_id = ? AND deleted = 0 AND qty_remaining <> 0 ORDER BY received_at, id";
  return getDb().prepare(sql).all(productId) as InventoryLot[];
}

export function listMovements(productId: number, limit = 200): Movement[] {
  return getDb()
    .prepare(
      "SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(productId, limit) as Movement[];
}

/**
 * One tire's history, with the names filled in.
 *
 * `listMovements` returns the raw ledger — employee ids and sale ids — which is
 * right for code and useless to a person: "created_by 8" answers nothing at a
 * counter. This is the same rows with the ticket number and the name attached,
 * for the history a manager opens by pressing a tire on the inventory sheet.
 *
 * Newest first. Unlike the order board's history, which is a story read from
 * the beginning, this is a feed — the question is almost always "what happened
 * to this recently", and the answer is at the top.
 */
export function productHistory(productId: number, limit = 200): MovementRow[] {
  return getDb()
    .prepare(
      `SELECT m.*, p.name AS productName, p.tire_size AS tireSize,
              COALESCE(p.condition, 'new') AS condition,
              e.name AS byName, s.sale_no AS saleNo, r.name AS reviewedByName
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
    LEFT JOIN employees e ON e.id = m.created_by
    LEFT JOIN employees r ON r.id = m.reviewed_by
    LEFT JOIN sales s ON s.id = m.sale_id
        WHERE m.product_id = ?
     ORDER BY m.id DESC
        LIMIT ?`,
    )
    .all(productId, limit) as MovementRow[];
}

/** A movement with enough around it to read without opening anything else. */
export type MovementRow = Movement & {
  productName: string;
  tireSize: string | null;
  condition: string;
  byName: string | null;
  saleNo: string | null;
  reviewedByName: string | null;
};

/**
 * Every stock movement there has been, newest first.
 *
 * `listMovements` above answers "what happened to THIS tire", which is the
 * question asked with a product already in front of you. This answers the other
 * one — "what has moved" — and it is the question asked when the count is wrong
 * and nobody knows where to start looking. Those need different screens because
 * they need different starting points, and the ledger has always been able to
 * answer both; there was simply no way in.
 *
 * Ordered by id rather than by `created_at`. Two movements written inside one
 * transaction share a timestamp to the second — a sale of four tires off two
 * lots is four rows in the same instant — and sorting on the timestamp lets the
 * order of those shuffle between page loads. The id is the order they were
 * written in and it never moves.
 *
 * A date range and a text filter, and nothing else. Reason and product are the
 * two things worth narrowing by and both are on screen; anything more would be
 * a report, and reports live on the day screen.
 */
export function listAllMovements(args?: {
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
}): MovementRow[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (args?.from) { where.push("m.business_date >= ?"); params.push(args.from); }
  if (args?.to) { where.push("m.business_date <= ?"); params.push(args.to); }

  // Matched against the tire and the ticket, which are the two things somebody
  // arrives holding. Not against the note: notes are sentences, and a substring
  // search over them turns one honest word into a page of unrelated rows.
  const q = args?.q?.trim();
  if (q) {
    where.push("(p.name LIKE ? OR p.tire_size LIKE ? OR p.brand LIKE ? OR s.sale_no LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  params.push(args?.limit ?? 500);

  return getDb()
    .prepare(
      `SELECT m.*,
              p.name        AS productName,
              p.tire_size   AS tireSize,
              p.condition   AS condition,
              e.name        AS byName,
              s.sale_no     AS saleNo,
              r.name        AS reviewedByName
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
    LEFT JOIN employees e ON e.id = m.created_by
    LEFT JOIN employees r ON r.id = m.reviewed_by
    LEFT JOIN sales s ON s.id = m.sale_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY m.id DESC
        LIMIT ?`,
    )
    .all(...params) as MovementRow[];
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

/**
 * The catch-all lot for a product that does not track lots.
 *
 * Only tires carry real lots — for a can of oil, "which batch did this come
 * from" is a question nobody asks. But a movement with a NULL lot would force
 * every stock query to handle two shapes, so each product gets one default lot
 * and the queries stay uniform. Created on demand rather than at product
 * creation, so products that never move stock never grow one.
 */
export function ensureDefaultLot(productId: number, unitCostCents = 0): InventoryLot {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM inventory_lots WHERE product_id = ? AND is_default = 1 AND deleted = 0")
    .get(productId) as InventoryLot | undefined;
  if (existing) return existing;

  const now = nowLocalIso();
  const info = db
    .prepare(
      `INSERT INTO inventory_lots
         (lot_no, product_id, received_at, unit_cost_cents, qty_received, qty_remaining,
          is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, 1, ?, ?)`,
    )
    .run(nextLotNo(), productId, now, unitCostCents, now, now);
  return db
    .prepare("SELECT * FROM inventory_lots WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as InventoryLot;
}

/**
 * Book stock in. A receipt always creates its own lot, because that is what
 * makes "which of these has sat here longest" and a real per-tire cost possible.
 */
export function receiveStock(
  user: PosUser,
  args: {
    productId: number;
    qty: number;
    unitCostCents: number;
    supplier?: string | null;
    reference?: string | null;
    receivedAt?: string;
    note?: string | null;
  },
): Result<{ lot: InventoryLot }> {
  if (!can(user.role, "receiveInventory"))
    return { ok: false, error: "Only a manager can receive stock" };
  if (!Number.isInteger(args.qty) || args.qty < 1)
    return { ok: false, error: "Quantity must be a whole number of 1 or more" };
  if (!Number.isInteger(args.unitCostCents) || args.unitCostCents < 0)
    return { ok: false, error: "Cost is not valid" };

  const product = getDb()
    .prepare("SELECT id, name, track_inventory FROM products WHERE id = ? AND deleted = 0")
    .get(args.productId) as
    | { id: number; name: string; track_inventory: number }
    | undefined;
  if (!product) return { ok: false, error: "Product not found" };
  if (!product.track_inventory)
    return { ok: false, error: `${product.name} is not stocked` };

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    const receivedAt = args.receivedAt ?? now;

    const lotInfo = db
      .prepare(
        `INSERT INTO inventory_lots
           (lot_no, product_id, received_at, unit_cost_cents, qty_received, qty_remaining,
            supplier, reference, received_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nextLotNo(),
        args.productId,
        receivedAt,
        args.unitCostCents,
        args.qty,
        args.qty,
        args.supplier?.trim() || null,
        args.reference?.trim() || null,
        user.employeeId,
        now,
        now,
      );
    const lotId = Number(lotInfo.lastInsertRowid);

    writeMovement(user, {
      productId: args.productId,
      lotId,
      qtyDelta: args.qty,
      unitCostCents: args.unitCostCents,
      reason: "receive",
      note: args.note ?? null,
    });

    const lot = db.prepare("SELECT * FROM inventory_lots WHERE id = ?").get(lotId) as InventoryLot;
    logActorAudit(actorOf(user), {
      action: "inventory.receive",
      targetType: "product",
      targetId: args.productId,
      details: {
        lot_no: lot.lot_no,
        qty: args.qty,
        unit_cost_cents: args.unitCostCents,
        supplier: lot.supplier,
        reference: lot.reference,
      },
    });
    return { ok: true as const, lot };
  });
}

/**
 * Book in the tires a special order brought through the door.
 *
 * A tire ordered in for one customer never sits on the rack. It comes off the
 * delivery van and goes onto the car, often within the same hour, and nobody is
 * ever going to stop and receive it first -- the whole point of ordering it in
 * was that the shop did not have one. The lifecycle assumed somebody would, and
 * booked the sale at fulfilment against stock that had never been received. The
 * result was a count that went negative every time an order was delivered, and
 * a review queue filling up with oversells that were not oversells at all: the
 * shop had the tire, it just arrived and left on the same afternoon.
 *
 * So the arrival is recorded as what it was. A receipt for exactly what the
 * ticket ordered, immediately before the sale takes it out again, which nets to
 * nothing: a size sitting at zero is still at zero afterwards, a size with one
 * on the rack still has that one. The shop never sees a number it has to
 * explain, and the ledger can still answer "where did that tire come from" a
 * year later, because both halves are on it.
 *
 * NOT gated on `receiveInventory`, and that is deliberate rather than an
 * oversight. Moving an order along the board is a cashier's job on purpose --
 * whoever is at the counter when the truck pulls up is who knows the tire
 * arrived. This receipt is not a second decision they are making, it is the
 * bookkeeping that makes the first one true, so it takes its authority from the
 * fulfilment. Gating it on a manager would mean the cashier who is allowed to
 * say "it is here" is not allowed to record it arriving, which is how the
 * negatives got here in the first place.
 *
 * Idempotent per line: a line already carrying a receipt is left alone, so an
 * order walked back and forward along the board does not receive twice.
 *
 * It does assume nobody received the tire separately when it came in, which is
 * true of this shop and is the reason any of this is needed. If somebody does
 * book one in by hand against the same order, the count reads one high until the
 * next count corrects it -- the wrong direction to be wrong in, but a visible
 * one, and far cheaper than the negatives it replaces.
 *
 * Used sizes are skipped. A used tire is not ordered in from anybody, and its
 * count already floors at zero rather than going negative -- see
 * `applySaleMovements`.
 */
export function receiveOrderedStock(
  user: PosUser,
  saleId: number,
  reference?: string | null,
  opts?: { skipItemIds?: number[] },
): Result<{ received: { productId: number; name: string; qty: number }[] }> {
  const db = getDb();
  const skip = (opts?.skipItemIds ?? []).filter((n) => Number.isInteger(n));
  const lines = db
    .prepare(
      `SELECT i.id, i.product_id, i.qty, p.name, p.condition,
              -- The ticket's own cost where it has one, the catalogue's where it
              -- does not. Zero is left as zero: an invented cost is a margin
              -- figure that looks researched on a line nobody would question.
              COALESCE(NULLIF(i.unit_cost_cents, 0), p.default_cost_cents, 0) AS cost
         FROM sale_items i
         JOIN products p ON p.id = i.product_id
        WHERE i.sale_id = ? AND i.voided = 0 AND p.track_inventory = 1
          AND p.condition <> 'used'
          AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                           WHERE m.sale_item_id = i.id AND m.reason = 'receive')
          -- Lines the counter has said are already on the rack.
          --
          -- The NOT EXISTS above only catches a receipt tied to this sale item.
          -- A tire received through the ordinary Receive Stock screen has no
          -- sale item on it, so it is invisible here — and booking it in again
          -- leaves the size one high forever, sold once and received twice.
          -- Nothing in the data can tell the two apart, so the person holding
          -- the tire is asked, and this is their answer.
          ${skip.length ? `AND i.id NOT IN (${skip.map(() => "?").join(",")})` : ""}`,
    )
    .all(saleId, ...skip) as {
    id: number;
    product_id: number;
    qty: number;
    name: string;
    condition: string;
    cost: number;
  }[];

  const received: { productId: number; name: string; qty: number }[] = [];
  if (lines.length === 0) return { ok: true, received };

  return inTx(() => {
    const now = nowLocalIso();
    for (const line of lines) {
      const lotInfo = db
        .prepare(
          `INSERT INTO inventory_lots
             (lot_no, product_id, received_at, unit_cost_cents, qty_received, qty_remaining,
              supplier, reference, received_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        )
        .run(nextLotNo(), line.product_id, now, line.cost, line.qty, line.qty, reference ?? null, user.employeeId, now, now);

      writeMovement(user, {
        productId: line.product_id,
        lotId: Number(lotInfo.lastInsertRowid),
        qtyDelta: line.qty,
        unitCostCents: line.cost,
        reason: "receive",
        saleId,
        saleItemId: line.id,
        note: "Ordered in for this ticket",
      });
      received.push({ productId: line.product_id, name: line.name, qty: line.qty });
    }

    logActorAudit(actorOf(user), {
      action: "inventory.receive",
      targetType: "sale",
      targetId: saleId,
      details: { ordered_in: received },
    });
    return { ok: true as const, received };
  });
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * Append one row to the ledger. Everything that changes stock goes through
 * here, and nothing else may INSERT into inventory_movements.
 *
 * Caller is responsible for the surrounding transaction and for keeping
 * `qty_remaining` in step — see `consumeLot`.
 */
function writeMovement(
  user: PosUser,
  args: {
    productId: number;
    lotId: number | null;
    qtyDelta: number;
    unitCostCents: number;
    reason: MovementReason;
    saleId?: number | null;
    saleItemId?: number | null;
    reversesMovementId?: number | null;
    oversold?: boolean;
    note?: string | null;
    businessDate?: string;
  },
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO inventory_movements
         (product_id, lot_id, qty_delta, unit_cost_cents, reason, sale_id, sale_item_id,
          reverses_movement_id, oversold, note, business_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.productId,
      args.lotId,
      args.qtyDelta,
      args.unitCostCents,
      args.reason,
      args.saleId ?? null,
      args.saleItemId ?? null,
      args.reversesMovementId ?? null,
      args.oversold ? 1 : 0,
      args.note ?? null,
      args.businessDate ?? currentBusinessDate(),
      user.employeeId,
      nowLocalIso(),
    );
  return Number(info.lastInsertRowid);
}

/** Move a lot's FIFO cursor. Negative `delta` takes stock out. */
function consumeLot(lotId: number, delta: number): void {
  getDb()
    .prepare("UPDATE inventory_lots SET qty_remaining = qty_remaining + ?, updated_at = ? WHERE id = ?")
    .run(delta, nowLocalIso(), lotId);
}

export type Allocation = { lotId: number; qty: number; unitCostCents: number };

/**
 * Oldest stock leaves first.
 *
 * Returns what could actually be covered plus the `short` remainder. It does
 * NOT decide what to do about a shortfall — that is a permission question, and
 * it belongs to the caller.
 */
export function allocateFifo(
  productId: number,
  qty: number,
): { allocations: Allocation[]; short: number } {
  const lots = getDb()
    .prepare(
      `SELECT id, unit_cost_cents, qty_remaining FROM inventory_lots
        WHERE product_id = ? AND deleted = 0 AND qty_remaining > 0
        ORDER BY received_at, id`,
    )
    .all(productId) as { id: number; unit_cost_cents: number; qty_remaining: number }[];

  const allocations: Allocation[] = [];
  let left = qty;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, lot.qty_remaining);
    allocations.push({ lotId: lot.id, qty: take, unitCostCents: lot.unit_cost_cents });
    left -= take;
  }
  return { allocations, short: left };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * Who may sell stock the system says is gone.
 *
 * `allow_oversell` is the shop's switch. While it is on this is a routine
 * cashier action — the tire is in their hand, the count is wrong, and the sale
 * should not stop for it. Turning it off is the owner asking for stock
 * discipline, so it drops to a manager's decision rather than becoming
 * absolute.
 *
 * Absolute would be worse, which is the whole reason this is not a single
 * boolean. A hard block does not stop the tire leaving the shop; it stops the
 * sale being rung against the product. The discrepancy then goes from a flagged
 * row in the review queue to nothing at all, and the count is just as wrong
 * with no record of why.
 */
function mayOversell(user: PosUser, override?: boolean): boolean {
  if (override !== undefined) return override && can(user.role, "overrideStock");
  return getSetting("allow_oversell") === "1"
    ? can(user.role, "overrideStock")
    : can(user.role, "adjustInventory");
}

type StockLine = {
  id: number;
  product_id: number;
  description: string;
  qty: number;
  voided: number;
  name: string;
  default_cost_cents: number;
  condition: string | null;
};

function stockedLinesFor(saleId: number): StockLine[] {
  return getDb()
    .prepare(
      `SELECT i.id, i.product_id, i.description, i.qty, i.voided,
              p.name, p.default_cost_cents, p.condition
         FROM sale_items i
         JOIN products p ON p.id = i.product_id
        WHERE i.sale_id = ? AND p.track_inventory = 1`,
    )
    .all(saleId) as StockLine[];
}

/**
 * Take stock out for a completed sale.
 *
 * Idempotent per line: a line that already has a `sale` movement is skipped, so
 * a manager editing a completed ticket books stock for the lines they added
 * without double-counting the ones that were already there. That matters
 * because `completeSale` is not the only thing that can reach a completed sale.
 *
 * A shortfall is a decision, not an error to swallow. If the shop allows it and
 * the cashier has the permission, the missing units are booked against the
 * product's default lot — driving it negative on purpose, flagged `oversold`,
 * and costed at the product's default cost since the real cost is unknown. The
 * negative is the point: it says "we sold something we did not have" in a way
 * that shows up in the review queue instead of quietly rounding to zero.
 *
 * USED TIRES ARE THE EXCEPTION, and the reason is about the trade rather than
 * the code. A used tire can turn up without ever being received: a customer
 * leaves their old set behind at a change, and the next customer buys one off
 * it the same afternoon. Nobody wrote either event down, and nobody was going
 * to. So a used size at zero is not a discrepancy — it is the normal state of a
 * bucket that fills and empties between counts.
 *
 * Treating it like a new tire would be wrong twice over. The count would go
 * negative, and "-3 used 205-55-16" is not a claim about the racks that could
 * ever be true or acted on. And every one of those sales would land in the
 * oversell review queue, which is a list of things somebody should look into —
 * fill it with the ordinary business of used tires and it stops being read,
 * taking the real discrepancies with it.
 *
 * So a used line takes what the ledger has, down to zero, and the rest simply
 * does not move stock. That is not a fudge: the tire that walked in unrecorded
 * walked out unrecorded, and the ledger is telling the exact truth about the
 * only thing it ever knew about.
 */
export function applySaleMovements(
  user: PosUser,
  saleId: number,
  opts: { allowOversell?: boolean } = {},
): Result<{ oversold: { productId: number; name: string; short: number }[] }> {
  const db = getDb();
  const lines = stockedLinesFor(saleId).filter((l) => !l.voided);
  const oversold: { productId: number; name: string; short: number }[] = [];
  if (lines.length === 0) return { ok: true, oversold };

  const oversellAllowed = mayOversell(user, opts.allowOversell);

  return inTx(() => {
    for (const line of lines) {
      const already = db
        .prepare(
          "SELECT 1 FROM inventory_movements WHERE sale_item_id = ? AND reason = 'sale' LIMIT 1",
        )
        .get(line.id);
      if (already) continue;

      const { allocations, short: rawShort } = allocateFifo(line.product_id, line.qty);
      // Dropped rather than booked for used sizes — see the note above. Every
      // decision below keys off this, so the floor-at-zero rule is stated once.
      const short = line.condition === "used" ? 0 : rawShort;

      if (short > 0 && !oversellAllowed) {
        const have = line.qty - short;
        // Says who can unblock it. A dead end at the counter with a customer
        // waiting is how a sale ends up rung as an untracked free-text line.
        const who = can(user.role, "adjustInventory")
          ? ""
          : " — a manager can override";
        return {
          ok: false as const,
          error: `Only ${have} of ${line.name} in stock, ticket needs ${line.qty}${who}`,
        };
      }

      for (const a of allocations) {
        consumeLot(a.lotId, -a.qty);
        writeMovement(user, {
          productId: line.product_id,
          lotId: a.lotId,
          qtyDelta: -a.qty,
          unitCostCents: a.unitCostCents,
          reason: "sale",
          saleId,
          saleItemId: line.id,
        });
      }

      if (short > 0) {
        const lot = ensureDefaultLot(line.product_id, line.default_cost_cents);
        consumeLot(lot.id, -short);
        writeMovement(user, {
          productId: line.product_id,
          lotId: lot.id,
          qtyDelta: -short,
          unitCostCents: line.default_cost_cents,
          reason: "sale",
          saleId,
          saleItemId: line.id,
          oversold: true,
          note: `Sold ${short} beyond recorded stock`,
        });
        oversold.push({ productId: line.product_id, name: line.name, short });
        logActorAudit(actorOf(user), {
          action: "inventory.oversell",
          targetType: "product",
          targetId: line.product_id,
          details: { sale_id: saleId, sale_item_id: line.id, short, product: line.name },
        });
      }

      // COGS snapshot on the line. Taken here rather than at ringing time
      // because until FIFO runs, which lot the tire came out of is not known.
      const totalCost =
        allocations.reduce((s, a) => s + a.qty * a.unitCostCents, 0) +
        short * line.default_cost_cents;
      db.prepare("UPDATE sale_items SET unit_cost_cents = ?, updated_at = ? WHERE id = ?").run(
        Math.round(totalCost / line.qty),
        nowLocalIso(),
        line.id,
      );
    }
    return { ok: true as const, oversold };
  });
}

/**
 * Put stock back for a voided or refunded ticket.
 *
 * Every original `sale` movement gets a mirrored return row pointing at it, on
 * the same lot at the same cost. The originals are never touched — a voided
 * ticket that moved stock is a thing that happened, and the ledger says so
 * twice rather than pretending once.
 */
export function reverseSaleMovements(
  user: PosUser,
  saleId: number,
  reason: "void_return" | "refund_return",
  note?: string,
): Result<{ returned: number }> {
  const db = getDb();
  return inTx(() => {
    const originals = db
      .prepare(
        `SELECT * FROM inventory_movements
          WHERE sale_id = ? AND reason = 'sale'
            AND id NOT IN (SELECT reverses_movement_id FROM inventory_movements
                            WHERE reverses_movement_id IS NOT NULL)`,
      )
      .all(saleId) as Movement[];

    for (const m of originals) {
      if (m.lot_id != null) consumeLot(m.lot_id, -m.qty_delta);
      writeMovement(user, {
        productId: m.product_id,
        lotId: m.lot_id,
        qtyDelta: -m.qty_delta,
        unitCostCents: m.unit_cost_cents,
        reason,
        saleId,
        saleItemId: m.sale_item_id,
        reversesMovementId: m.id,
        note: note ?? null,
      });
    }
    return { ok: true as const, returned: originals.length };
  });
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/**
 * A manual correction — a miscount found on the rack, a damaged tire.
 *
 * `qtyDelta` is the change, not the new total, because the ledger records what
 * happened rather than what things became. `setCount` below is the "I counted
 * the rack and there are 6" form, and it works out the delta for you.
 */
export function adjustStock(
  user: PosUser,
  args: {
    productId: number;
    qtyDelta: number;
    reason: Extract<MovementReason, "adjust" | "count" | "damage" | "opening">;
    note: string;
    lotId?: number | null;
  },
): Result<{ onHand: number }> {
  if (!can(user.role, "adjustInventory"))
    return { ok: false, error: "Only a manager can adjust stock" };
  if (!Number.isInteger(args.qtyDelta) || args.qtyDelta === 0)
    return { ok: false, error: "Enter how many to add or remove" };
  if (!args.note.trim())
    return { ok: false, error: "A reason is required for a stock adjustment" };

  const product = getDb()
    .prepare("SELECT id, name, default_cost_cents, track_inventory FROM products WHERE id = ? AND deleted = 0")
    .get(args.productId) as
    | { id: number; name: string; default_cost_cents: number; track_inventory: number }
    | undefined;
  if (!product) return { ok: false, error: "Product not found" };
  if (!product.track_inventory)
    return { ok: false, error: `${product.name} is not stocked` };

  return inTx(() => {
    let lotId = args.lotId ?? null;
    let unitCost = product.default_cost_cents;

    if (args.qtyDelta > 0 && lotId == null) {
      const lot = ensureDefaultLot(args.productId, product.default_cost_cents);
      lotId = lot.id;
      unitCost = lot.unit_cost_cents;
    } else if (args.qtyDelta < 0 && lotId == null) {
      // Take from the oldest stock, same as a sale would.
      const { allocations, short } = allocateFifo(args.productId, -args.qtyDelta);
      const spread = [...allocations];
      if (short > 0) {
        const lot = ensureDefaultLot(args.productId, product.default_cost_cents);
        spread.push({ lotId: lot.id, qty: short, unitCostCents: lot.unit_cost_cents });
      }
      for (const a of spread) {
        consumeLot(a.lotId, -a.qty);
        writeMovement(user, {
          productId: args.productId,
          lotId: a.lotId,
          qtyDelta: -a.qty,
          unitCostCents: a.unitCostCents,
          reason: args.reason,
          note: args.note.trim(),
        });
      }
      logAdjust(user, args, product.name);
      return { ok: true as const, onHand: stockOnHand(args.productId) };
    }

    if (lotId != null) consumeLot(lotId, args.qtyDelta);
    writeMovement(user, {
      productId: args.productId,
      lotId,
      qtyDelta: args.qtyDelta,
      unitCostCents: unitCost,
      reason: args.reason,
      note: args.note.trim(),
    });
    logAdjust(user, args, product.name);
    return { ok: true as const, onHand: stockOnHand(args.productId) };
  });
}

function logAdjust(
  user: PosUser,
  args: { productId: number; qtyDelta: number; reason: string; note: string },
  productName: string,
): void {
  logActorAudit(actorOf(user), {
    action: args.reason === "count" ? "inventory.count" : "inventory.adjust",
    targetType: "product",
    targetId: args.productId,
    details: {
      product: productName,
      qty_delta: args.qtyDelta,
      reason: args.reason,
      note: args.note.trim(),
    },
  });
}

/** "I counted the rack and there are 6." Books the difference. */
export function setCount(
  user: PosUser,
  productId: number,
  counted: number,
  note: string,
): Result<{ onHand: number }> {
  if (!Number.isInteger(counted) || counted < 0)
    return { ok: false, error: "A count cannot be negative" };
  const current = stockOnHand(productId);
  if (counted === current) return { ok: true, onHand: current };
  return adjustStock(user, {
    productId,
    qtyDelta: counted - current,
    reason: "count",
    note: note.trim() || `Counted ${counted}, system had ${current}`,
  });
}

// ---------------------------------------------------------------------------
// Oversell review queue
// ---------------------------------------------------------------------------

export type OversellRow = Movement & {
  product_name: string;
  tire_size: string | null;
  condition: string | null;
  sale_no: string | null;
  employee_name: string | null;
  on_hand: number;
};

export function listOversells(includeReviewed = false): OversellRow[] {
  const sql = `
    SELECT m.*, p.name AS product_name, p.tire_size, p.condition,
           s.sale_no, e.name AS employee_name,
           (SELECT COALESCE(SUM(qty_delta), 0) FROM inventory_movements x
             WHERE x.product_id = m.product_id) AS on_hand
      FROM inventory_movements m
      JOIN products p ON p.id = m.product_id
      LEFT JOIN sales s ON s.id = m.sale_id
      LEFT JOIN employees e ON e.id = m.created_by
     WHERE m.oversold = 1 ${includeReviewed ? "" : "AND m.reviewed_at IS NULL"}
     ORDER BY m.id DESC`;
  return getDb().prepare(sql).all() as OversellRow[];
}

/**
 * Mark an oversell as looked at.
 *
 * This deliberately does not change stock. Someone deciding the count was wrong
 * should write an adjustment saying so; clearing the flag only records that a
 * human saw it, which is a different fact and worth keeping separate.
 */
export function reviewOversell(user: PosUser, movementId: number, note?: string): Result {
  if (!can(user.role, "adjustInventory"))
    return { ok: false, error: "Only a manager can clear an oversell" };
  const db = getDb();
  const m = db
    .prepare("SELECT * FROM inventory_movements WHERE id = ? AND oversold = 1")
    .get(movementId) as Movement | undefined;
  if (!m) return { ok: false, error: "Not found" };
  if (m.reviewed_at) return { ok: true };

  return inTx(() => {
    db.prepare("UPDATE inventory_movements SET reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(
      user.employeeId,
      nowLocalIso(),
      movementId,
    );
    logActorAudit(actorOf(user), {
      action: "inventory.review",
      targetType: "product",
      targetId: m.product_id,
      details: { movement_id: movementId, qty_delta: m.qty_delta, note: note?.trim() || null },
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

/**
 * Prove the FIFO cursor still agrees with the ledger.
 *
 * `qty_remaining` is a cache of "received minus everything taken out of this
 * lot". If the two ever disagree, FIFO is handing out stock that is not there
 * (or hiding stock that is), and it is a bug to surface loudly — never to
 * silently repair, because the repair would destroy the evidence.
 */
export function lotIntegrityCheck(): { lotId: number; lotNo: string; issue: string }[] {
  const rows = getDb()
    .prepare(
      `SELECT l.id, l.lot_no, l.qty_remaining,
              (SELECT COALESCE(SUM(qty_delta), 0) FROM inventory_movements m WHERE m.lot_id = l.id) AS ledger
         FROM inventory_lots l
        WHERE l.deleted = 0`,
    )
    .all() as { id: number; lot_no: string; qty_remaining: number; ledger: number }[];

  return rows
    .filter((r) => r.qty_remaining !== r.ledger)
    .map((r) => ({
      lotId: r.id,
      lotNo: r.lot_no,
      issue: `qty_remaining ${r.qty_remaining} but its movements sum to ${r.ledger}`,
    }));
}
