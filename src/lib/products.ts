import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { logActorAudit, diffRows, type Actor } from "./audit";
import { can } from "./roles";
import { stockOnHandFor, USED_POOL_SKU } from "./inventory";
import {
  looksSpecialized,
  normalizeTireSize,
  rimDiameterOf,
  SPECIALTY_SECTION,
} from "./tire-size";
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
  /** Eighteen-wheeler, trailer or other specialty stock. See 005_tire_sections.sql. */
  specialized: number;
  /** Who we normally buy this from. Per-delivery supplier lives on the lot. */
  supplier: string | null;
  /**
   * Priced under cost on purpose, and not a mistake to be reviewed.
   *
   * Silences the below-cost warning and marks the row on the inventory sheet
   * instead. On a tire that is NOT under cost it just shows the mark, which is
   * the same switch doing the other half of its job. See 020_discount_flag.sql.
   */
  discounted: number;
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

// Parsing lives in ./tire-size so the client can import it without dragging
// better-sqlite3 into the browser bundle. Re-exported here because every
// server-side caller already reaches for products.ts.
export {
  normalizeTireSize,
  rimDiameterOf,
  looksSpecialized,
  SPECIALTY_SECTION,
} from "./tire-size";

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
  opts: { includeInactive?: boolean; includeDeleted?: boolean; kind?: ProductKind } = {},
): Product[] {
  // Removed rows stay out unless somebody asks for them by name. The only
  // caller that does is the owner's "Show removed" on the inventory page,
  // which exists so a row deleted by mistake can be found again.
  const where = opts.includeDeleted ? ["1 = 1"] : ["deleted = 0"];
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
 * "what have we got in 195-65-15". Within a size, new tires list individually
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
  /**
   * The used row itself, not just its id.
   *
   * The id alone was enough while the used line only offered "Add", and stopped
   * being enough the moment it needed Count and Remove: those open the same
   * sheets every other row opens, and a sheet wants the product. Carrying the
   * id and then looking the product up somewhere else would mean the screen
   * holding a number that stands for a row it cannot see — which is how a size
   * keyed wrong ends up on the board with nothing on it that can be pressed.
   */
  usedProduct: ProductWithStock | null;
  total: number;
};

/**
 * Sizes gathered under a rim heading — "15", "16", "17" — in the order the
 * racks run. This mirrors the old workbook, which is organised the same way,
 * and more importantly mirrors the building: someone counting stock walks one
 * rim at a time, so a sheet ordered any other way sends them back and forth.
 *
 * `key` is what the heading reads. `rim` is null for the specialty section,
 * which is the one bucket not defined by a rim diameter.
 */
export type RimSection = {
  key: string;
  rim: number | null;
  specialized: boolean;
  groups: SizeGroup[];
  total: number;
};

export function inventoryBySize(
  opts: { includeOutOfStock?: boolean; includeDeleted?: boolean } = {},
): SizeGroup[] {
  const tires = withStock(
    listProducts({ kind: "tire", includeDeleted: opts.includeDeleted }),
  );
  const bySize = new Map<string, SizeGroup>();

  for (const t of tires) {
    // The general pool is a tire with no size, and this function's whole job is
    // to bucket tires by size — it would land under "(no size)" and print as a
    // rack row headed by nothing, in the specialty block, next to the semi
    // tires. It is shown on its own instead; see `getUsedPool`.
    if (t.sku === USED_POOL_SKU) continue;
    const size = t.tire_size ?? "(no size)";
    let g = bySize.get(size);
    if (!g) {
      g = {
        size,
        newTires: [],
        usedCount: 0,
        usedProductId: null,
        usedProduct: null,
        total: 0,
      };
      bySize.set(size, g);
    }
    if (t.condition === "used") {
      // A live used row always wins the size's one used line. Two can only
      // both be here while "Show removed" is on, and the count that belongs on
      // the sheet is the one the racks actually answer to.
      if (!g.usedProduct || (g.usedProduct.deleted && !t.deleted)) {
        g.usedProductId = t.id;
        g.usedProduct = t;
        g.usedCount = t.on_hand;
      }
    } else {
      g.newTires.push(t);
    }
  }

  for (const g of bySize.values()) {
    /* Only exact zeroes are hidden, so an oversold row survives the filter and
       is always on the sheet — which is the behaviour the sort below depends on. */
    // A removed row is exempt: it was only fetched because somebody asked to
    // see removed rows, and almost every one of them is at zero — which is
    // usually why it was removed. Hiding it again would make the box do
    // nothing on exactly the rows it exists for.
    if (!opts.includeOutOfStock)
      g.newTires = g.newTires.filter((t) => t.on_hand !== 0 || t.deleted);

    /* Oversold to the top of its own size, deepest first.
       The panel at the head of the page lists these too, but a list at the top
       and a row in the middle are two different jobs — the panel says WHICH,
       and this puts the row where somebody counting that size will meet it
       first rather than three lines down among the healthy ones. */
    g.newTires.sort(
      (a, b) =>
        Number(a.on_hand >= 0) - Number(b.on_hand >= 0) ||
        (a.on_hand < 0 ? a.on_hand - b.on_hand : 0),
    );

    g.total = g.newTires.reduce((s, t) => s + t.on_hand, 0) + Math.max(0, g.usedCount);
  }

  return [...bySize.values()]
    .filter(
      (g) =>
        opts.includeOutOfStock ||
        g.newTires.length > 0 ||
        g.usedCount !== 0 ||
        !!g.usedProduct?.deleted,
    )
    .sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
}

/**
 * The same rack view, split into the sections the sheet prints in.
 *
 * A size lands in the specialty block if ANY product of that size is flagged
 * specialized. It has to be all-or-nothing per size, because a size is one
 * heading on one sheet and cannot be printed in two places — and if someone has
 * marked even one 225-70-19.5 as a semi tire, the whole size is a semi size.
 *
 * Sizes with no parseable rim also fall here rather than inventing a heading of
 * their own. The real list has a handful (16-6 8-6.5, a mower tire) and one
 * junk-drawer section at the end beats six sections of one line each.
 */
export function inventoryBySection(
  opts: { includeOutOfStock?: boolean; includeDeleted?: boolean } = {},
): RimSection[] {
  const groups = inventoryBySize(opts);

  // Which sizes are specialty, decided across every product sharing the size.
  const specialSizes = new Set(
    (
      getDb()
        .prepare(
          `SELECT DISTINCT tire_size FROM products
             WHERE kind = 'tire' AND deleted = 0 AND specialized = 1 AND tire_size IS NOT NULL`,
        )
        .all() as { tire_size: string }[]
    ).map((r) => r.tire_size),
  );

  const sections = new Map<string, RimSection>();
  for (const g of groups) {
    const rim = rimDiameterOf(g.size);
    const special = specialSizes.has(g.size) || rim === null;
    const key = special ? SPECIALTY_SECTION : String(rim);
    let s = sections.get(key);
    if (!s) {
      s = { key, rim: special ? null : rim, specialized: special, groups: [], total: 0 };
      sections.set(key, s);
    }
    s.groups.push(g);
    s.total += g.total;
  }

  return [...sections.values()].sort((a, b) => {
    if (a.specialized !== b.specialized) return a.specialized ? 1 : -1;
    return (a.rim ?? 0) - (b.rim ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Batteries
// ---------------------------------------------------------------------------

/**
 * The battery shelf: Large, Medium, Small, and nothing else. See
 * 010_batteries.sql for why these are ordinary stocked products rather than a
 * table of three numbers.
 *
 * Ordered by price descending, which is the same order as biggest-to-smallest
 * and does not depend on anyone spelling the three names the same way twice.
 * The alternative -- a hand-maintained list of size labels -- goes stale the
 * first time a fourth size appears.
 *
 * Zero-stock rows are dropped under the same rule as a used tire line: a shelf
 * heading with "Small: 0" under it teaches people to skim the sheet. Unlike a
 * used size, though, the row survives at zero when `includeOutOfStock` is on,
 * because "we are out of small batteries" is a thing someone reordering needs
 * to see.
 */
/**
 * One shelf of stocked parts, by category.
 *
 * Batteries were the first and Miscellaneous is the second, and they want
 * identical treatment: a heading of their own on the sheet, counts off the
 * ledger like everything else, and zero-stock rows dropped unless somebody is
 * reordering. Written once rather than twice because the second copy is where
 * the two quietly stop agreeing about what an empty shelf looks like.
 */
function listShelf(
  categoryCode: string,
  opts: { includeOutOfStock?: boolean; includeDeleted?: boolean } = {},
): ProductWithStock[] {
  const rows = withStock(
    getDb()
      .prepare(
        `SELECT p.* FROM products p
           JOIN service_categories c ON c.id = p.category_id
          WHERE c.code = ? AND (p.deleted = 0 OR ?) AND p.active = 1
          ORDER BY p.price_cents DESC`,
      )
      .all(categoryCode, opts.includeDeleted ? 1 : 0) as Product[],
  );
  // Removed rows are exempt from the sold-out hide for the reason given in
  // `inventoryBySize`: they were asked for, and they are nearly all at zero.
  return opts.includeOutOfStock ? rows : rows.filter((b) => b.on_hand !== 0 || b.deleted);
}

export function listBatteries(
  opts: { includeOutOfStock?: boolean; includeDeleted?: boolean } = {},
): ProductWithStock[] {
  return listShelf("battery", opts);
}

/**
 * Everything that is neither a tire nor a battery — TPMS sensors, and whatever
 * joins them. Same shelf treatment; see `listShelf`.
 */
export function listMisc(
  opts: { includeOutOfStock?: boolean; includeDeleted?: boolean } = {},
): ProductWithStock[] {
  return listShelf("misc", opts);
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
export function ensureUsedTire(
  user: PosUser,
  rawSize: string,
  specialized?: boolean,
): Result<{ product: Product }> {
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
            specialized, active, created_at, updated_at)
         VALUES (?, ?, ?, 'tire', ?, 'used', 0, 0, 1, 0, ?, 1, ?, ?)`,
      )
      .run(
        `USED-${size}`,
        `Used ${size}`,
        categoryId,
        size,
        (specialized ?? looksSpecialized(size)) ? 1 : 0,
        now,
        now,
      );

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

// ---------------------------------------------------------------------------
// The general pool
// ---------------------------------------------------------------------------

/**
 * The one row that holds used tires nobody has looked at yet.
 *
 * Used tires arrive here by the truckload, bought by the load and not by the
 * tire: a hundred and forty of them come off a trailer and no two people would
 * write down the same hundred and forty sizes. Until then the shop genuinely
 * owns "a hundred and forty used tires" and nothing more precise, and a system
 * that will only accept a size forces whoever is unloading to either invent one
 * or write nothing — and writing nothing is what actually happened.
 *
 * So the pool is a real product row with a real count, and the sizes are
 * subtracted out of it later as somebody works down the pile (`fromPool` on the
 * receive route). Two counts of the same tires, one coarse and one fine, with
 * the pool draining as the fine one fills.
 *
 * `tire_size` is NULL rather than a sentinel like "GENERAL", and that is what
 * keeps it honest: every size query in the app — the rack sheet, the demand
 * report, the quoter — is keyed on the size, so a pool row simply does not
 * appear in any of them, without one of them having to know the word GENERAL.
 * The one place it must NOT disappear from is `inventoryBySize`, which buckets
 * a null size into "(no size)" and would print it as a rack row; that function
 * drops it by hand and shows it separately.
 */
// Declared in inventory.ts and re-exported here, because that file cannot
// import this one — the note beside it there says why. Callers reach for
// products.ts, which is where the rest of the pool lives.
export { USED_POOL_SKU };
export const USED_POOL_NAME = "Used Tires - General";

const usedPoolRow = (): Product | undefined =>
  getDb()
    .prepare("SELECT * FROM products WHERE sku = ? AND deleted = 0")
    .get(USED_POOL_SKU) as Product | undefined;

/** The pool as it stands, or null if the shop has never used one. */
export function getUsedPool(): ProductWithStock | null {
  const row = usedPoolRow();
  return row ? withStock([row])[0] : null;
}

/**
 * The pool, created on first use.
 *
 * Get-or-create on the sku, which is unique among live rows, so this is safe to
 * call from anywhere and can never end up with two pools for the counter to
 * pick the wrong one of.
 */
export function ensureUsedPool(user: PosUser): Result<{ product: ProductWithStock }> {
  const existing = usedPoolRow();
  if (existing) return { ok: true, product: withStock([existing])[0] };

  if (!can(user.role, "manageProducts"))
    return { ok: false, error: "Only a manager can open the general pool" };

  const db = getDb();
  return inTx(() => {
    const now = nowLocalIso();
    const categoryId =
      (db.prepare("SELECT id FROM service_categories WHERE code = 'used_tire'").get() as
        | { id: number }
        | undefined)?.id ?? null;

    // Same shape as a sized used row — no price, no cost, no lots — for the
    // same reasons, which are written out at length on `ensureUsedTire`.
    const info = db
      .prepare(
        `INSERT INTO products
           (sku, name, category_id, kind, tire_size, condition,
            price_cents, default_cost_cents, track_inventory, track_lots,
            specialized, active, created_at, updated_at)
         VALUES (?, ?, ?, 'tire', NULL, 'used', 0, 0, 1, 0, 0, 1, ?, ?)`,
      )
      .run(USED_POOL_SKU, USED_POOL_NAME, categoryId, now, now);

    const id = Number(info.lastInsertRowid);
    logActorAudit(actorOf(user), {
      action: "product.create",
      targetType: "product",
      targetId: id,
      details: { name: USED_POOL_NAME, condition: "used", pool: true },
    });
    return { ok: true as const, product: withStock([getProduct(id)!])[0] };
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
    specialized?: boolean;
    supplier?: string | null;
  },
): Result<{ product: Product }> {
  if (!can(user.role, "manageProducts"))
    return { ok: false, error: "Only a manager can add products" };

  // Used tires never take descriptive fields. Rejecting rather than ignoring
  // them: a caller that thinks it is storing a used tire's brand has a bug, and
  // silently dropping it would hide that.
  //
  // `specialized` is the exception, and passes through: it says which rack the
  // tire lives on, not anything about the tire itself, and a used semi tire is
  // a real thing that still has to print in the right section.
  if (args.condition === "used") {
    if (args.brand || args.model || args.ply || args.priceCents || args.defaultCostCents)
      return {
        ok: false,
        error: "A used tire is recorded by size only — no brand, price or cost",
      };
    if (!args.tireSize) return { ok: false, error: "A tire size is required" };
    return ensureUsedTire(user, args.tireSize, args.specialized);
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

  const sku = (
    args.sku?.trim() || autoSku(args.kind, name, size, args.brand, args.model)
  ).toUpperCase();
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
            specialized, supplier, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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
        (args.specialized ?? looksSpecialized(size)) ? 1 : 0,
        args.supplier?.trim() || null,
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

/**
 * A SKU nobody at the counter has to invent.
 *
 * Built from size AND brand, because size alone collides the moment a size has
 * two brands in it — and most do here: the shop carries nine different 11-22.5s.
 * Both import scripts already generated their own SKUs to dodge this, which was
 * the tell that the shared helper was wrong rather than that the imports were
 * special. Matching their format keeps one scheme across all 556 rows.
 *
 * The suffix is checked against the table rather than a set held in memory, so
 * two tires added a week apart de-duplicate as reliably as two in one import.
 */
function autoSku(
  kind: ProductKind,
  name: string,
  size: string | null,
  brand?: string | null,
  model?: string | null,
): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  const detail = `${slug(brand ?? "").slice(0, 6)}${slug(model ?? "").slice(0, 6)}`;
  const base = size
    ? `${slug(size)}${detail ? `-${detail}` : ""}`
    : `${kind.slice(0, 3).toUpperCase()}-${slug(name).slice(0, 20)}`;

  // `deleted = 0` matches the partial unique index exactly. A soft-deleted row
  // does not own its SKU, so skipping past one would suffix every future tire
  // in that size for no reason.
  const taken = getDb().prepare("SELECT 1 FROM products WHERE sku = ? AND deleted = 0 LIMIT 1");
  let sku = base;
  for (let i = 2; taken.get(sku); i++) sku = `${base}-${i}`;
  return sku;
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
    specialized?: boolean;
    supplier?: string | null;
    discounted?: boolean;
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
    specialized:
      args.specialized === undefined ? product.specialized : args.specialized ? 1 : 0,
    supplier:
      args.supplier === undefined ? product.supplier : args.supplier?.trim() || null,
    discounted:
      args.discounted === undefined ? product.discounted : args.discounted ? 1 : 0,
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
                             active = ?, specialized = ?, supplier = ?, discounted = ?,
                             updated_at = ?
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
        next.specialized,
        next.supplier,
        next.discounted,
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
  const product = getProduct(id);
  if (!product) return { ok: false, error: "Product not found" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };

  /*
    Two doors to the same act, and which one is open depends on the rack.

    The owner may remove anything. A manager may remove one that is EMPTY,
    which is the tidying case — a size the shop has stopped carrying, sold out
    and not coming back. See `deleteEmptyProduct` in roles.ts for why that is
    the cheaper act.

    The count is read here, at the moment of removing, rather than trusted from
    whatever the screen said: a page loaded ten minutes ago does not know about
    the four tires somebody just received onto that row.
  */
  if (!can(user.role, "deleteProduct")) {
    if (!can(user.role, "deleteEmptyProduct"))
      return { ok: false, error: "Only the owner can remove a product" };
    const onHand = stockOnHandFor([id]).get(id) ?? 0;
    if (onHand !== 0)
      return {
        ok: false,
        error: `${product.name} still has ${onHand} on the rack. Only the owner can remove a product that is not sold out.`,
      };
  }

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

/**
 * Put a removed product back on the list.
 *
 * The reason removals are soft, made usable. Nothing but the flag is touched:
 * the stock, the price, the lots and every ticket the row ever sold were left
 * alone when it went, so it comes back exactly as it left.
 *
 * Owner only, on `deleteProduct` rather than `deleteEmptyProduct` — a manager
 * who can clear a sold-out size cannot un-clear one, because the row they would
 * be reaching for is one they cannot see. Restoring is the owner's correction
 * of somebody else's decision, and it needs the person who can see both.
 *
 * Reads through the raw table rather than `getProduct`, which filters removed
 * rows out by definition and would answer "not found" for every row this
 * function exists to act on.
 */
export function restoreProduct(user: PosUser, id: number): Result {
  if (!can(user.role, "deleteProduct"))
    return { ok: false, error: "Only the owner can put a product back" };
  const row = getDb().prepare("SELECT * FROM products WHERE id = ?").get(id) as
    | Product
    | undefined;
  if (!row) return { ok: false, error: "Product not found" };
  if (!row.deleted) return { ok: false, error: "That product is already on the list" };

  return inTx(() => {
    getDb()
      .prepare(
        "UPDATE products SET deleted = 0, deleted_by = NULL, deleted_at = NULL, deleted_reason = NULL, updated_at = ? WHERE id = ?",
      )
      .run(nowLocalIso(), id);
    logActorAudit(actorOf(user), {
      action: "product.update",
      targetType: "product",
      targetId: id,
      details: { name: row.name, sku: row.sku, restored: true },
      before: { deleted: 1 },
      after: { deleted: 0 },
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

/**
 * The website's stock search writes its misses here too.
 *
 * Same table, same meaning, different door: a visitor typed a whole size into
 * the public site and the rack had none in stock. A NULL employee_id is the
 * mark of the web — every counter search arrives with a session behind it, so
 * no session is what tells "asked from a phone at home" apart from "asked at
 * the counter" without inventing a second table for the same fact. The "what
 * left" study reads the table without caring which door the question came in
 * through, which is the owner's instruction exactly: one study of what was
 * wanted and not had.
 *
 * Only misses, mirroring logSearch above. The migration's rule is that a
 * search that found stock is noise, and the website's yes-answers are the same
 * noise. The study's read side already collapses one visitor pressing Check
 * five times into one ask, the same way it collapses the counter re-searching
 * a size while the customer is still standing there.
 */
export function logWebSearchMiss(raw: string, normalized: string): void {
  getDb()
    .prepare(
      `INSERT INTO product_searches
         (query, normalized_query, result_count, in_stock,
          employee_id, business_date, created_at)
       VALUES (?, ?, 0, 0, NULL, ?, ?)`,
    )
    .run(raw, normalized, currentBusinessDate(), nowLocalIso());
}

/**
 * The raw archive of website stock searches — every one, whatever we answered.
 *
 * See migrations/048_web_searches.sql for what this table is and is not. This
 * function is the whole write path, and it carries the one filter the archive
 * has: the same normalized size is not written twice inside sixty seconds, so
 * a visitor mashing Check or a phone retrying a slow request cannot
 * manufacture rows. One row a minute per size still records every real
 * question — the handrail is against doubling, not against asking.
 */
export function logWebSearch(
  raw: string,
  normalized: string,
  answer: "yes" | "no" | "incomplete",
): void {
  const db = getDb();
  const recent = db
    .prepare(
      `SELECT 1 FROM web_searches
        WHERE size_norm = ?
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '-60 seconds')
        LIMIT 1`,
    )
    .get(normalized);
  if (recent) return;

  db.prepare(
    `INSERT INTO web_searches (query, size_norm, answer, business_date, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(raw, normalized, answer, currentBusinessDate(), nowLocalIso());
}

export type WebSearchSize = {
  sizeNorm: string;
  /** The commonest spelling somebody actually typed, for reading back. */
  query: string;
  times: number;
  /** How each ask was answered, so "wanted" and "had" can be told apart. */
  yes: number;
  no: number;
  incomplete: number;
  firstAsked: string;
  lastAsked: string;
  /** On the rack today. Null when the shop has never carried that size. */
  onHand: number | null;
};

/**
 * What the website has been asked for, grouped by size.
 *
 * The archive itself keeps every ask whatever the answer (see
 * migrations/048_web_searches.sql); this is the reading of it, and it keeps
 * the answers apart on the row rather than filtering to the misses. A size
 * asked for nine times and answered yes nine times is a popular tire, which is
 * a different fact from a size asked for nine times and not had — and both are
 * worth knowing when deciding what to stock.
 *
 * `onHand` is joined in for the same reason the counter's study joins it: a
 * size wanted repeatedly that now sits six deep on the rack is a size the shop
 * already fixed, and without this column it would head the list forever.
 *
 * Ranked by how many people asked, most first — this list answers "what are
 * people looking for", and the loudest answer belongs at the top.
 */
export function webSearchesBySize(from: string, to: string): WebSearchSize[] {
  return getDb()
    .prepare(
      `SELECT w.size_norm                        AS sizeNorm,
              COUNT(*)                           AS times,
              SUM(w.answer = 'yes')              AS yes,
              SUM(w.answer = 'no')               AS no,
              SUM(w.answer = 'incomplete')       AS incomplete,
              MIN(w.business_date)               AS firstAsked,
              MAX(w.business_date)               AS lastAsked,
              (SELECT r.query FROM web_searches r
                WHERE r.size_norm = w.size_norm
             GROUP BY r.query
             ORDER BY COUNT(*) DESC, MAX(r.id) DESC
                LIMIT 1)                         AS query,
              (SELECT SUM(mv.qty_delta)
                 FROM inventory_movements mv
                 JOIN products p ON p.id = mv.product_id
                WHERE p.deleted = 0 AND p.tire_size = w.size_norm) AS onHand
         FROM web_searches w
        WHERE w.business_date BETWEEN ? AND ?
     GROUP BY w.size_norm
     ORDER BY times DESC, lastAsked DESC`,
    )
    .all(from, to) as WebSearchSize[];
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

/**
 * Stocked products at or below their reorder point, worst first.
 *
 * Sold out sorts above merely thin, even when the thin one is further under its
 * own point. A size at zero is a customer being turned away today; three of a
 * six-deep size is a phone call this week. Sorting purely by how far below the
 * point each one sits would file the empties in among sizes the shop still has,
 * which is the one thing this order exists to prevent.
 */
/**
 * Everything the ledger says the shop has less than none of, deepest first.
 *
 * Separate from `listLowStock` because that one only looks at products with a
 * reorder point set, and most do not have one. A tire at minus two with no
 * reorder point was therefore invisible everywhere except as a red number on
 * its own row — which is a warning only for whoever happens to scroll past it.
 *
 * Below zero is never merely low. It means tires left on cars that the racks
 * did not have: either the count is wrong, or stock came in and was never
 * received, or something walked. All three want looking at today, and none of
 * them is answered by ordering more.
 */
export function listNegativeStock(): ProductWithStock[] {
  return withStock(listProducts().filter((p) => p.track_inventory))
    .filter((p) => p.on_hand < 0)
    .sort((a, b) => a.on_hand - b.on_hand || a.name.localeCompare(b.name));
}

export function listLowStock(): ProductWithStock[] {
  const products = listProducts().filter((p) => p.track_inventory && p.reorder_point > 0);
  return withStock(products)
    .filter((p) => p.on_hand <= p.reorder_point)
    .sort(
      (a, b) =>
        a.on_hand - b.on_hand ||
        b.reorder_point - a.reorder_point ||
        a.name.localeCompare(b.name),
    );
}
