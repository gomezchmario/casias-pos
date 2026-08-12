import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

/**
 * What things cost the shop, and how a margin is worked out from it.
 *
 * THERE ARE THREE PLACES A COST CAN COME FROM, and they are consulted in this
 * order for every sale line on every report:
 *
 *   1. `sale_items.unit_cost_cents` — the snapshot taken when the line was
 *      rung. Authoritative where it exists, because it is what the tire
 *      actually cost on the day it was sold rather than what the next one
 *      costs now.
 *
 *   2. The product's `default_cost_cents`, when the line points at a product
 *      and carries no snapshot. That is every one of the forty thousand
 *      imported history lines: the old workbook recorded no costs at all, so
 *      the current cost is the only figure there is. It is an approximation and
 *      it is the honest one available.
 *
 *   3. `service_costs`, matched on the description. This is the half that never
 *      existed — a flat repair consumes a patch, a mount consumes a weight and
 *      a valve, and nothing in the register could say so.
 *
 * A line that finds nothing in all three has no cost, is excluded from every
 * margin, and is counted in the coverage figure printed beside it. That
 * counting is the point: a margin over a fifth of the revenue is a fact about a
 * fifth of the shop, and the reports say which fifth rather than implying a
 * whole.
 */

/**
 * The description as a key: upper-cased, runs of whitespace squeezed, trimmed.
 *
 * Used on BOTH sides — writing an entry and matching a line against one — so
 * the two cannot drift. Deliberately not a trigger in the database for the same
 * reason: SQL would have to repeat it on the read side and the repeat is what
 * would go stale.
 */
export function costKey(description: string): string {
  return description.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * The SQL that resolves a line's unit cost, in the order above.
 *
 * A fragment rather than a view, because the three reports that need it each
 * join their own way and a view would force one shape on all of them. Exported
 * so there is exactly one copy of the precedence — the failure this guards
 * against is two reports disagreeing about what a margin is.
 *
 * `i` is the `sale_items` alias the caller uses; a `products p` join and a
 * `service_costs sc` join must be in scope.
 */
export const UNIT_COST_SQL = `
  COALESCE(
    NULLIF(i.unit_cost_cents, 0),
    NULLIF(p.default_cost_cents, 0),
    sc.cost_cents
  )`;

/** The joins `UNIT_COST_SQL` needs. */
export const COST_JOINS = `
  LEFT JOIN products p ON p.id = i.product_id
  LEFT JOIN service_costs sc
         ON sc.description_key = UPPER(TRIM(i.description))`;

export type ServiceCost = {
  key: string;
  costCents: number | null;
  note: string | null;
  /** What the shop has sold under this description, so the list ranks itself. */
  lines: number;
  revenueCents: number;
  /** What one of these typically sells for — revenue ÷ lines. The figure a
   *  margin percentage is meaningless without. */
  avgPriceCents: number;
  setByName: string | null;
  setAt: string | null;
};

/**
 * The services worth being asked about, most valuable first.
 *
 * Ranked by revenue rather than listed alphabetically, and cut short, because
 * the tail is enormous and worthless: this shop has 1,346 distinct descriptions
 * with no product behind them, and the top two — FLAT and MOUNT & BALANCE —
 * are 39% of the money. A screen listing all 1,346 is a screen nobody fills in;
 * a screen listing 30 gets most of the way in ten minutes.
 *
 * Anything already answered stays on the list whatever it earns, so a cost can
 * be corrected later without hunting for it.
 */
export function serviceCosts(limit = 30): ServiceCost[] {
  return getDb()
    .prepare(
      `SELECT UPPER(TRIM(i.description))            AS key,
              COUNT(*)                              AS lines,
              COALESCE(SUM(i.line_total_cents), 0)  AS revenueCents,
              CAST(COALESCE(SUM(i.line_total_cents), 0) /
                   NULLIF(COUNT(*), 0) AS INTEGER)      AS avgPriceCents,
              sc.cost_cents                         AS costCents,
              sc.note                               AS note,
              e.name                                AS setByName,
              sc.set_at                             AS setAt
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_costs sc ON sc.description_key = UPPER(TRIM(i.description))
    LEFT JOIN employees e ON e.id = sc.set_by
        WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
          AND i.voided = 0
          -- Only the lines that have no other way of finding a cost. A tire
          -- takes its cost from the product and does not belong on a list of
          -- questions about services.
          AND i.product_id IS NULL
     GROUP BY key
     ORDER BY sc.cost_cents IS NULL, revenueCents DESC
        LIMIT ?`,
    )
    .all(limit) as ServiceCost[];
}

/** How much of the shop's revenue can be given a cost at all. */
export function costCoverage(from: string, to: string): {
  revenueCents: number;
  costedCents: number;
  pct: number;
  linesWithout: number;
} {
  const r = getDb()
    .prepare(
      `SELECT COALESCE(SUM(i.line_total_cents), 0) AS revenueCents,
              COALESCE(SUM(CASE WHEN ${UNIT_COST_SQL} IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) AS costedCents,
              SUM(CASE WHEN ${UNIT_COST_SQL} IS NULL THEN 1 ELSE 0 END) AS linesWithout
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         ${COST_JOINS}
        WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
          AND i.voided = 0 AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as {
    revenueCents: number;
    costedCents: number;
    linesWithout: number;
  };
  return {
    ...r,
    pct: r.revenueCents > 0 ? Math.round((r.costedCents / r.revenueCents) * 100) : 0,
  };
}

/** Tires the shop sells and has never recorded a cost for. */
export function productsMissingCost(): {
  productId: number;
  name: string;
  lines: number;
  revenueCents: number;
}[] {
  return getDb()
    .prepare(
      `SELECT p.id AS productId, p.name,
              COUNT(i.id) AS lines,
              COALESCE(SUM(i.line_total_cents), 0) AS revenueCents
         FROM products p
    LEFT JOIN sale_items i ON i.product_id = p.id AND i.voided = 0
        WHERE p.deleted = 0 AND p.active = 1
          AND COALESCE(p.default_cost_cents, 0) = 0
     GROUP BY p.id
       HAVING lines > 0
     ORDER BY revenueCents DESC
        LIMIT 40`,
    )
    .all() as { productId: number; name: string; lines: number; revenueCents: number }[];
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Record what a service costs.
 *
 * Zero is accepted and stored. "This consumes nothing" is a real answer — it is
 * what makes an inspection read as pure margin rather than as unknown — and it
 * is a different fact from never having been asked, which is the row's absence.
 */
export function setServiceCost(
  user: PosUser,
  description: string,
  costCents: number | null,
  note?: string | null,
): Result {
  if (!can(user.role, "manageSettings"))
    return { ok: false, error: "Only the owner can set what things cost" };
  const key = costKey(description);
  if (!key) return { ok: false, error: "Which service?" };

  const db = getDb();
  return inTx(() => {
    if (costCents === null) {
      db.prepare("DELETE FROM service_costs WHERE description_key = ?").run(key);
    } else {
      if (!Number.isInteger(costCents) || costCents < 0)
        return { ok: false as const, error: "That is not an amount" };
      db.prepare(
        `INSERT INTO service_costs (description_key, cost_cents, note, set_by, set_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (description_key) DO UPDATE
           SET cost_cents = excluded.cost_cents,
               note       = excluded.note,
               set_by     = excluded.set_by,
               set_at     = excluded.set_at`,
      ).run(key, costCents, note?.trim() || null, user.employeeId, nowLocalIso());
    }

    logActorAudit(
      {
        type: "employee",
        employeeId: user.employeeId,
        name: user.name,
        role: user.role,
      } satisfies Actor,
      {
        action: "settings.update",
        targetType: "service_cost",
        targetId: key,
        after: { cost_cents: costCents },
      },
    );
    return { ok: true as const };
  });
}
