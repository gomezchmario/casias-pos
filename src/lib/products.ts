import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { logActorAudit, diffRows, type Actor } from "./audit";
import { can } from "./roles";
import { stockOnHandFor } from "./inventory";
import type { PosUser } from "./pos-session";

export type ProductKind = "tire" | "part" | "service" | "fee";
export type ProductCondition = "new" | "used";

export type Product = {
  id: number;
  sku: string;
  name: string;
  category_id: number | null;
  kind: ProductKind;
  tire_size: string | null;
  brand: string | null;
  model: string | null;
  ply: string | null;
  condition: ProductCondition | null;
  price_cents: number;
  default_cost_cents: number;
  track_inventory: number;
  track_lots: number;
  reorder_point: number;
  active: number;
  deleted: number;
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
// Tire sizes
// ---------------------------------------------------------------------------

/**
 * Put a tire size into one canonical shape.
 *
 * The same tire gets written "195/65R15", "195 65 15", "195-65-r15" and
 * "1956515" by different people on different days. Without this, the rack would
 * hold four separate products for one size and the count on every one of them
 * would be wrong. Anything that does not look like a tire size is passed
 * through uppercased rather than mangled — an odd size is better than a
 * silently wrong one.
 */
export function normalizeTireSize(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";

  // Flotation sizes read differently — 31X10.50R15 — and must not be forced
  // into the metric shape.
  const flot = s.match(/^(\d{2})\s*X\s*(\d{1,2}(?:\.\d+)?)\s*R?\s*(\d{2})$/);
  if (flot) return `${flot[1]}X${flot[2]}R${flot[3]}`;

  const m = s.match(/^([A-Z]{0,3})\s*(\d{3})\s*[\/\-\s]?\s*(\d{2})\s*[\/\-\s]?\s*R?\s*[\/\-\s]?\s*(\d{2})$/);
  if (m) return `${m[1]}${m[2]}/${m[3]}R${m[4]}`;

  return s.replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function getProduct(id: number): Product | null {
  return (
    (getDb().prepare("SELECT * FROM products WHERE id = ? AND deleted = 0").get(id) as
      | Product
      | undefined) ?? null
  );
}

export function listProducts(
  opts: { includeInactive?: boolean; kind?: ProductKind } = {},
): Product[] {
  const where = ["deleted = 0"];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push("active = 1");
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  return getDb()
    .prepare(`SELECT * FROM products WHERE ${where.join(" AND ")} ORDER BY name`)
    .all(...params) as Product[];
}

export type ProductWithStock = Product & { on_hand: number };

export function withStock(products: Product[]): ProductWithStock[] {
  const stock = stockOnHandFor(products.filter((p) => p.track_inventory).map((p) => p.id));
  return products.map((p) => ({ ...p, on_hand: stock.get(p.id) ?? 0 }));
}

/**
 * The rack, as someone standing in front of it sees it.
 *
 * Grouped by size, because that is the only question anyone actually asks —
 * "what have we got in 195/65R15". Within a size, new tires list individually
 * with their brand and price; used collapses to a single count, because a used
 * tire genuinely has nothing else to say about it. See `ensureUsedTire`.
 *
 * A used line with a count of zero is omitted entirely rather than shown as
 * "Used: 0". A sheet padded with zeroes is a sheet people learn to skim, and
 * the whole value of walking this around the racks is that every line on it
 * means something.
 */
export type SizeGroup = {
  size: string;
  newTires: ProductWithStock[];
  usedCount: number;
  usedProductId: number | null;
  total: number;
};

export function inventoryBySize(opts: { includeOutOfStock?: boolean } = {}): SizeGroup[] {
  const tires = withStock(listProducts({ kind: "tire" }));
  const bySize = new Map<string, SizeGroup>();

  for (const t of tires) {
    const size = t.tire_size ?? "(no size)";
    let g = bySize.get(size);
    if (!g) {
      g = { size, newTires: [], usedCount: 0, usedProductId: null, total: 0 };
      bySize.set(size, g);
    }
    if (t.condition === "used") {
      g.usedProductId = t.id;
      g.usedCount = t.on_hand;
    } else {
      g.newTires.push(t);
    }
  }

  for (const g of bySize.values()) {
    if (!opts.includeOutOfStock) g.newTires = g.newTires.filter((t) => t.on_hand !== 0);
    g.total = g.newTires.reduce((s, t) => s + t.on_hand, 0) + Math.max(0, g.usedCount);
  }

  return [...bySize.values()]
    .filter((g) => opts.includeOutOfStock || g.newTires.length > 0 || g.usedCount !== 0)
    .sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------
// Used tires
// ---------------------------------------------------------------------------

/**
 * The one product row that represents every used tire of a given size.
 *
 * A used tire has no brand, no model, no DOT, no cost and no price. Its price
 * is decided at the counter from its condition and the customer, so there is
 * genuinely nothing else to record — and a price column filled in "just in
 * case" is a number someone would eventually trust. The size IS the identity:
 * one row per size, never one per tire.
 *
 * `track_lots` is 0 for the same reason. FIFO exists to answer "what did this
 * one cost us", and for a tire that came in on a buyback at no recorded cost
 * that question has no answer worth storing.
 */
export function ensureUsedTire(user: PosUser, rawSize: string): Result<{ product: Product }> {
  const size = normalizeTireSize(rawSize);
  if (!size) return { ok: false, error: "A tire size is required" };

  const db = getDb();
  const existing = db
    .prepare(
      "SELECT * FROM products WHERE kind = 'tire' AND condition = 'used' AND tire_size = ? AND deleted = 0",
    )
    .get(size) as Product | undefined;
  if (existing) return { ok: true, product: existing };

  if (!can(user.role, "manageProducts"))
    return { ok: false, error: "Only a manager can add a new size" };

  return inTx(() => {
    const now = nowLocalIso();
    const categoryId =
      (db.prepare("SELECT id FROM service_categories WHERE code = 'used_tire'").get() as
        | { id: number }
        | undefined)?.id ?? null;

    const info = db
      .prepare(
        `INSERT INTO products
           (sku, name, category_id, kind, tire_size, condition,
            price_cents, default_cost_cents, track_inventory, track_lots,
            active, created_at, updated_at)
         VALUES (?, ?, ?, 'tire', ?, 'used', 0, 0, 1, 0, 1, ?, ?)`,
      )
      .run(`USED-${size}`, `Used ${size}`, categoryId, size, now, now);

    const id = Number(info.lastInsertRowid);
    logActorAudit(actorOf(user), {
      action: "product.create",
      targetType: "product",
      targetId: id,
      details: { name: `Used ${size}`, condition: "used", tire_size: size },
    });
    return { ok: true as const, product: getProduct(id)! };
  });
}

/** Every used size that currently has stock. Powers the register's used-tire picker. */
export function listUsedSizesInStock(): { productId: number; size: string; count: number }[] {
  return (
    getDb()
      .prepare(
        `SELECT p.id AS productId, p.tire_size AS size,
                (SELECT COALESCE(SUM(qty_delta), 0) FROM inventory_movements m
                  WHERE m.product_id = p.id) AS count
           FROM products p
          WHERE p.kind = 'tire' AND p.condition = 'used' AND p.deleted = 0 AND p.active = 1
          ORDER BY p.tire_size`,
      )
      .all() as { productId: number; size: string; count: number }[]
  ).filter((r) => r.count !== 0);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function createProduct(
  user: PosUser,
  args: {
    name?: string;
    sku?: string;
    kind: ProductKind;
    tireSize?: string | null;
    brand?: string | null;
    model?: string | null;
    ply?: string | null;
    condition?: ProductCondition | null;
    priceCents?: number;
    defaultCostCents?: number;
    trackInventory?: boolean;
    trackLots?: boolean;
    reorderPoint?: number;
    categoryId?: number | null;
  },
): Result<{ product: Product }> {
  if (!can(user.role, "manageProducts"))
    return { ok: false, error: "Only a manager can add products" };

  // Used tires never take descriptive fields. Rejecting rather than ignoring
  // them: a caller that thinks it is storing a used tire's brand has a bug, and
  // silently dropping it would hide that.
  if (args.condition === "used") {
    if (args.brand || args.model || args.ply || args.priceCents || args.defaultCostCents)
      return {
        ok: false,
        error: "A used tire is recorded by size only — no brand, price or cost",
      };
    if (!args.tireSize) return { ok: false, error: "A tire size is required" };
    return ensureUsedTire(user, args.tireSize);
  }

  const size = args.tireSize ? normalizeTireSize(args.tireSize) : null;
  const name =
    args.name?.trim() ||
    [args.brand, args.model, size].filter(Boolean).join(" ").trim();
  if (!name) return { ok: false, error: "A name is required" };

  const priceCents = args.priceCents ?? 0;
  const costCents = args.defaultCostCents ?? 0;
  if (!Number.isInteger(priceCents) || priceCents < 0)
    return { ok: false, error: "Price is not valid" };
  if (!Number.isInteger(costCents) || costCents < 0)
    return { ok: false, error: "Cost is not valid" };

  const sku = (args.sku?.trim() || autoSku(args.kind, name, size)).toUpperCase();
  const db = getDb();
  const clash = db
    .prepare("SELECT id, name FROM products WHERE sku = ? AND deleted = 0")
    .get(sku) as { id: number; name: string } | undefined;
  if (clash) return { ok: false, error: `SKU ${sku} is already used by ${clash.name}` };

  const trackInventory = args.trackInventory ?? (args.kind === "tire" || args.kind === "part");
  const trackLots = args.trackLots ?? args.kind === "tire";

  return inTx(() => {
    const now = nowLocalIso();
    const info = db
      .prepare(
        `INSERT INTO products
           (sku, name, category_id, kind, tire_size, brand, model, ply, condition,
            price_cents, default_cost_cents, track_inventory, track_lots, reorder_point,
            active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        sku,
        name,
        args.categoryId ?? null,
        args.kind,
        size,
        args.brand?.trim() || null,
        args.model?.trim() || null,
        args.ply?.trim() || null,
        args.kind === "tire" ? (args.condition ?? "new") : null,
        priceCents,
        costCents,
        trackInventory ? 1 : 0,
        trackLots ? 1 : 0,
        args.reorderPoint ?? 0,
        now,
        now,
      );

    const id = Number(info.lastInsertRowid);
    logActorAudit(actorOf(user), {
      action: "product.create",
      targetType: "product",
      targetId: id,
      details: { sku, name, kind: args.kind, tire_size: size, condition: args.condition ?? null },
    });
    return { ok: true as const, product: getProduct(id)! };
  });
}

function autoSku(kind: ProductKind, name: string, size: string | null): string {
  const base = (size ?? name)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `${kind.slice(0, 3).toUpperCase()}-${base.toUpperCase()}`;
}

export function updateProduct(
  user: PosUser,
  id: number,
  args: {
    name?: string;
    brand?: string | null;
    model?: string | null;
    ply?: string | null;
    priceCents?: number;
    defaultCostCents?: number;
    reorderPoint?: number;
    active?: boolean;
    tireSize?: string | null;
  },
): Result {
  if (!can(user.role, "manageProducts"))
    return { ok: false, error: "Only a manager can edit products" };
  const product = getProduct(id);
  if (!product) return { ok: false, error: "Product not found" };

  // The used row is a bucket for a size, not a tire. Letting someone give it a
  // price would turn every used tire of that size into that price.
  if (product.condition === "used") {
    const touching =
      args.brand !== undefined ||
      args.model !== undefined ||
      args.ply !== undefined ||
      args.priceCents !== undefined ||
      args.defaultCostCents !== undefined;
    if (touching)
      return {
        ok: false,
        error: "A used size has no brand, price or cost — only its count changes",
      };
  }

  const next = {
    name: args.name?.trim() || product.name,
    brand: args.brand === undefined ? product.brand : args.brand?.trim() || null,
    model: args.model === undefined ? product.model : args.model?.trim() || null,
    ply: args.ply === undefined ? product.ply : args.ply?.trim() || null,
    tire_size:
      args.tireSize === undefined
        ? product.tire_size
        : args.tireSize
          ? normalizeTireSize(args.tireSize)
          : null,
    price_cents: args.priceCents ?? product.price_cents,
    default_cost_cents: args.defaultCostCents ?? product.default_cost_cents,
    reorder_point: args.reorderPoint ?? product.reorder_point,
    active: args.active === undefined ? product.active : args.active ? 1 : 0,
  };

  if (!Number.isInteger(next.price_cents) || next.price_cents < 0)
    return { ok: false, error: "Price is not valid" };
  if (!Number.isInteger(next.default_cost_cents) || next.default_cost_cents < 0)
    return { ok: false, error: "Cost is not valid" };

  return inTx(() => {
    getDb()
      .prepare(
        `UPDATE products SET name = ?, brand = ?, model = ?, ply = ?, tire_size = ?,
                             price_cents = ?, default_cost_cents = ?, reorder_point = ?,
                             active = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.name,
        next.brand,
        next.model,
        next.ply,
        next.tire_size,
        next.price_cents,
        next.default_cost_cents,
        next.reorder_point,
        next.active,
        nowLocalIso(),
        id,
      );

    const diff = diffRows(product as unknown as Record<string, unknown>, next);
    if (diff)
      logActorAudit(actorOf(user), {
        action: "product.update",
        targetType: "product",
        targetId: id,
        before: diff.before,
        after: diff.after,
      });
    return { ok: true as const };
  });
}

/**
 * Soft delete. The row stays because sale_items and movements point at it, and
 * a sale from last March must still be able to say what was sold.
 */
export function deleteProduct(user: PosUser, id: number, reason: string): Result {
  if (!can(user.role, "manageProducts"))
    return { ok: false, error: "Only a manager can remove products" };
  const product = getProduct(id);
  if (!product) return { ok: false, error: "Product not found" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };

  return inTx(() => {
    getDb()
      .prepare(
        "UPDATE products SET deleted = 1, deleted_by = ?, deleted_at = ?, deleted_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(user.employeeId, nowLocalIso(), reason.trim(), nowLocalIso(), id);
    logActorAudit(actorOf(user), {
      action: "product.delete",
      targetType: "product",
      targetId: id,
      details: { name: product.name, sku: product.sku, reason: reason.trim() },
      before: { deleted: 0 },
      after: { deleted: 1 },
    });
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Counter search. Matches a tire size in any of the ways people write it, and
 * falls back to a plain name/brand/SKU match.
 *
 * Only fruitless searches are logged — see `logSearch`. A search that found
 * what it wanted tells purchasing nothing; one that found nothing, or nothing
 * in stock, is exactly the signal worth having.
 */
export function searchProducts(
  query: string,
  opts: { user?: PosUser; log?: boolean } = {},
): ProductWithStock[] {
  const raw = query.trim();
  if (!raw) return [];

  const size = normalizeTireSize(raw);
  const like = `%${raw.toLowerCase()}%`;
  const rows = getDb()
    .prepare(
      `SELECT * FROM products
        WHERE deleted = 0 AND active = 1
          AND (tire_size = ?
               OR LOWER(name) LIKE ?
               OR LOWER(COALESCE(brand, '')) LIKE ?
               OR LOWER(COALESCE(model, '')) LIKE ?
               OR LOWER(sku) LIKE ?)
        ORDER BY condition, name
        LIMIT 50`,
    )
    .all(size, like, like, like, like) as Product[];

  const results = withStock(rows);
  if (opts.log !== false) logSearch(raw, size, results, opts.user);
  return results;
}

function logSearch(
  raw: string,
  normalized: string,
  results: ProductWithStock[],
  user?: PosUser,
): void {
  const inStock = results.some((r) => !r.track_inventory || r.on_hand > 0);
  if (results.length > 0 && inStock) return;

  getDb()
    .prepare(
      `INSERT INTO product_searches
         (query, normalized_query, matched_product_id, result_count, in_stock,
          employee_id, business_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      raw,
      normalized,
      results[0]?.id ?? null,
      results.length,
      inStock ? 1 : 0,
      user?.employeeId ?? null,
      currentBusinessDate(),
      nowLocalIso(),
    );
}

/** Sizes people asked for and the shop could not sell. The buying list. */
export function listUnmetDemand(
  sinceBusinessDate: string,
): { query: string; times: number; lastAsked: string; everFound: number }[] {
  return getDb()
    .prepare(
      `SELECT normalized_query AS query, COUNT(*) AS times,
              MAX(business_date) AS lastAsked, MAX(result_count > 0) AS everFound
         FROM product_searches
        WHERE business_date >= ?
        GROUP BY normalized_query
        ORDER BY times DESC, lastAsked DESC
        LIMIT 100`,
    )
    .all(sinceBusinessDate) as {
    query: string;
    times: number;
    lastAsked: string;
    everFound: number;
  }[];
}

/** Stocked products at or below their reorder point. */
export function listLowStock(): ProductWithStock[] {
  const products = listProducts().filter((p) => p.track_inventory && p.reorder_point > 0);
  return withStock(products).filter((p) => p.on_hand <= p.reorder_point);
}
