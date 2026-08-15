import { getDb } from "./db";
import { currentBusinessDate } from "./business-date";
import { getSetting } from "./settings";
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

/**
 * The same cost, with a floor under the tires nobody priced.
 *
 * MOST OF THE SHOP'S TIRE MONEY HAS NO COST AGAINST IT. Nearly two thousand
 * new-tire lines were rung as free text — "NEW 11/22.5 TBB" and its like —
 * with no product row to carry what the shop paid, and that is $730k of
 * revenue the margin reports had to leave out entirely. A margin computed over
 * the third of the shop that happens to be priced is not a fact about the shop.
 *
 * So a tire with no recorded cost is assumed to have been sold at the shop's
 * posted markup and no better: at 20%, cost = price / 1.20. It is a FLOOR, not
 * an estimate — the real margin on these is very likely higher, and a figure
 * that understates is one an owner can act on, where an optimistic one is not.
 *
 * ONLY TIRES. A flat or a mount has no purchase price behind it and never did;
 * assuming a cost for one would be inventing a supplier. Those are what the
 * "What things cost" screen asks about, and they stay unanswered until somebody
 * answers them.
 *
 * `costCoverage` still reports what is KNOWN separately from what is assumed,
 * so this can never quietly turn a guess into a measurement. Set
 * `assumed_tire_markup_bp` to 0 to switch it off.
 */
/**
 * The imported years, told apart from the shop's own record.
 *
 * By ticket number rather than by date, because the two overlap: the workbook
 * import runs to 2026-08-07 and the register's first real ticket is 2026-08-03,
 * so any date cutover would either swallow live tickets or leak imported ones.
 * The prefix is unambiguous — H- was written by the importer and nothing else
 * writes it.
 */
export const IMPORTED = "s.sale_no LIKE 'H-%'";
export const LIVE = "s.sale_no NOT LIKE 'H-%'";

/** The day the shop's own record starts — the first ticket this register rang. */
export function liveFromDate(): string {
  // Written out rather than reusing LIVE with its alias stripped: that trick
  // holds only until somebody renames the alias, and this date is what every
  // coverage figure on the costs screen is measured from. Deleted tickets are
  // excluded so a struck test ticket cannot drag the start date backwards.
  const r = getDb()
    .prepare(
      `SELECT MIN(business_date) AS d FROM sales
        WHERE deleted = 0 AND sale_no NOT LIKE 'H-%'`,
    )
    .get() as { d: string | null };
  return r.d ?? currentBusinessDate();
}

export function assumedCostSql(): string {
  const bp = Number(getSetting("assumed_tire_markup_bp"));
  /*
    THE IMPORTED YEARS, COSTED AT THE SHOP'S FLOOR MARKUP.

    The old cashier workbooks recorded what a customer paid and nothing about
    what the shop paid, so two and a half years of margin read as "not enough
    cost data" — true, and useless. 20% on cost is the floor this shop works to,
    which makes the assumed cost price ÷ 1.2.

    ONLY on imported lines. A line rung on this register with no cost against it
    is a question somebody can still answer, and covering it with a guess would
    hide the one kind of gap still worth chasing. That is the whole point of
    keeping the two apart: the past is estimated once and left alone, the
    present is measured.

    Reported separately from real costs wherever it is used — see
    \`costCoverage\`, which never folds an assumption into the covered figure.
  */
  const histBp = Number(getSetting("assumed_history_markup_bp"));
  const history =
    Number.isFinite(histBp) && histBp > 0
      ? `
      CASE WHEN ${IMPORTED} AND i.unit_price_cents > 0
           THEN CAST(i.unit_price_cents * 10000.0 / ${10000 + histBp} AS INTEGER)
      END,`
      : "";
  if (!Number.isFinite(bp) || bp <= 0)
    return history
      ? `COALESCE(NULLIF(i.unit_cost_cents, 0), NULLIF(p.default_cost_cents, 0), sc.cost_cents, ${history.replace(/,$/, "")})`
      : UNIT_COST_SQL;
  return `
    COALESCE(
      NULLIF(i.unit_cost_cents, 0),
      NULLIF(p.default_cost_cents, 0),
      sc.cost_cents,
      -- Looked up rather than joined. A join here would put a second
      -- service_categories in scope for every caller, and several of them
      -- already join their own as c and then GROUP BY a bare code — which
      -- SQLite cannot resolve once there are two. It took the whole Reports
      -- page down exactly that way. A correlated read on a primary key costs
      -- nothing and cannot collide with anything the caller has named.
      CASE WHEN (SELECT k.code FROM service_categories k WHERE k.id = i.category_id)
                  IN ('new_tire', 'used_tire')
                AND i.unit_price_cents > 0
           THEN CAST(i.unit_price_cents * 10000.0 / ${10000 + bp} AS INTEGER)
      END,
      ${history.replace(/,$/, "")}
    )`;
}

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
    LEFT JOIN service_categories c ON c.id = i.category_id
    LEFT JOIN employees e ON e.id = sc.set_by
        WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
          AND i.voided = 0
          -- Only the lines that have no other way of finding a cost. A tire
          -- takes its cost from the product and does not belong on a list of
          -- questions about services.
          AND i.product_id IS NULL
          -- And a tire rung as free text is still a tire. "NEW 11/22.5 TBB"
          -- was being asked for a per-unit cost on a screen of services, next
          -- to FLAT and ROTACION, which is a question about a supplier invoice
          -- dressed as a question about labour. Nearly two thousand lines of
          -- this shop's new-tire money arrives without a product row; it gets
          -- the assumed markup instead -- see assumedCostSql.
          /*
            PER ROW, and it was tried the other way first.

            Because this list groups by description, the obvious fix for "USED
            TIRE" appearing was to drop any description that has ANY tire line
            against it. That is far too blunt: FLAT has fifteen lines somebody
            filed under a tire category out of several hundred, so the rule
            deleted the single biggest service the shop sells from the list of
            services. MOUNT & BALANCE and ROTACION went with it — the list came
            back holding twelve rows, none of them the ones that matter.

            One stray mis-filing must not be able to hide a whole trade. So the
            category filter stays per row, and the handful of descriptions that
            genuinely do not belong are named below instead.
          */
          AND (c.code IS NULL OR c.code NOT IN ('new_tire', 'used_tire'))
          /*
            NOT EVERY LINE IS A THING WITH A COST.

            The rest of what was on this list is not labour the shop buys and
            not a part it stocks — it is money being moved. A CORRECTION, a TIP
            FIX, a DEPOSIT taken against a tire coming in, a FLAT MIX PAY: each
            of those is an adjustment on a ticket, and asking "what does a
            correction cost us" is a question with no answer. They were sitting
            among FLAT and MOUNT & BALANCE making the list look longer than the
            work actually is.

            Matched on the words rather than on a category because they have no
            category — they are free text somebody typed at the counter, which
            is exactly why they never got filed anywhere. Kept as a list rather
            than a clever pattern so that adding one is obvious, and so that
            nothing gets swept up by a rule nobody can see.
          */
          AND UPPER(TRIM(i.description)) NOT IN (
            'CORRECTION', 'TIP FIX', 'FLAT MIX PAY', 'MOVE TIRE', 'DISPOSAL FEE',
            -- A tire, rung as free text on tickets that were not all filed
            -- under the used-tire category — which is how it slipped past the
            -- rule above. Named here rather than chased with a cleverer
            -- category rule, because the words are the reliable part.
            'USED TIRE'
          )
          AND UPPER(TRIM(i.description)) NOT LIKE '%DEPOSIT%'
          -- Parts sold as free text. A sensor and a valve stem DO cost the shop
          -- money, but they are bought on an invoice like a tire is, not priced
          -- like labour — and a per-unit cost typed on a services screen is a
          -- question about a supplier bill wearing the wrong clothes. Same
          -- reasoning as the tire exclusion above.
          AND UPPER(TRIM(i.description)) NOT LIKE '%SENSOR%'
          AND UPPER(TRIM(i.description)) NOT LIKE '%VALVE STEM%'
          -- The shop's own record only. The imported years hold 1,346 distinct
          -- descriptions, most of them typed once by somebody who has left, and
          -- a list of questions about them is a list nobody can answer. What is
          -- rung on this register is what the shop still sells and still knows
          -- the cost of — and the old lines are already carried by the history
          -- assumption above.
          AND ${LIVE}
     GROUP BY key
     ORDER BY sc.cost_cents IS NULL, revenueCents DESC
        LIMIT ?`,
    )
    .all(limit) as ServiceCost[];
}

/** How much of the shop's revenue can be given a cost at all. */
export function costCoverage(from: string, to: string): {
  revenueCents: number;
  /** Revenue whose cost the shop actually recorded. */
  costedCents: number;
  pct: number;
  linesWithout: number;
  /**
   * Revenue covered only by the tire assumption — see `assumedCostSql`.
   *
   * Reported apart from `costedCents` and never folded into it. The whole
   * point of a coverage figure is to say how much of a margin is measured, and
   * a number that counted a guess as a measurement would destroy the one thing
   * it exists for.
   */
  assumedCents: number;
  assumedPct: number;
} {
  const assumed = assumedCostSql();
  const r = getDb()
    .prepare(
      `SELECT COALESCE(SUM(i.line_total_cents), 0) AS revenueCents,
              COALESCE(SUM(CASE WHEN ${UNIT_COST_SQL} IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) AS costedCents,
              -- Covered by the assumption and not by a real cost: the gap
              -- between the two expressions, which is exactly the tire lines
              -- nobody priced.
              COALESCE(SUM(CASE WHEN ${UNIT_COST_SQL} IS NULL
                                 AND ${assumed} IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) AS assumedCents,
              SUM(CASE WHEN ${assumed} IS NULL THEN 1 ELSE 0 END) AS linesWithout
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         ${COST_JOINS}
        WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
          AND i.voided = 0 AND s.business_date BETWEEN ? AND ?`,
    )
    .get(from, to) as {
    revenueCents: number;
    costedCents: number;
    assumedCents: number;
    linesWithout: number;
  };
  const pctOf = (n: number) =>
    r.revenueCents > 0 ? Math.round((n / r.revenueCents) * 100) : 0;
  return { ...r, pct: pctOf(r.costedCents), assumedPct: pctOf(r.assumedCents) };
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
    LEFT JOIN sales s ON s.id = i.sale_id
        WHERE p.deleted = 0 AND p.active = 1
          AND COALESCE(p.default_cost_cents, 0) = 0
          -- Sold on this register, not merely somewhere in the imported years.
          -- A tire the shop last moved in 2024 under a description nobody uses
          -- any more is not a question worth putting in front of anybody.
          AND ${LIVE}
     GROUP BY p.id
       HAVING lines > 0
     ORDER BY revenueCents DESC
        LIMIT 40`,
    )
    .all() as { productId: number; name: string; lines: number; revenueCents: number }[];
}

/**
 * Give every un-costed tire on the list a cost, worked back from its own
 * selling price at the shop's floor markup.
 *
 * WHY THIS IS ALLOWED TO BE A GUESS. A tire's real cost is on a supplier
 * invoice, and for the ones on this list nobody typed it in — often years ago,
 * often for a size the shop no longer stocks. The alternative to a worked-back
 * figure is not a better figure, it is no margin at all on that line forever.
 *
 * WHY IT IS STILL HONEST. It is worked from what each tire ACTUALLY SOLD FOR,
 * not from a flat rate applied to everything: a $340 tire gets a $283 cost and
 * a $45 one gets $37, so the answer is at least the right size. And it is
 * written to `default_cost_cents`, which is the same field somebody types into
 * — so the moment a real invoice arrives it is one edit to correct, and the
 * next receipt of that tire records its true cost against the lot anyway.
 *
 * Skips anything already costed, so it can be pressed twice without undoing
 * work somebody did by hand. Audited per product, with the price it was worked
 * from, so "where did that cost come from" has an answer.
 */
export function fillProductCostsFromPrice(
  user: PosUser,
  markupBp?: number,
): Result & { filled?: number } {
  if (!can(user.role, "manageSettings"))
    return { ok: false, error: "Only a manager can set what things cost" };

  const bp = Number.isFinite(markupBp as number) && (markupBp as number) > 0
    ? (markupBp as number)
    : Number(getSetting("assumed_history_markup_bp"));
  if (!Number.isFinite(bp) || bp <= 0) return { ok: false, error: "No markup to work from" };

  const db = getDb();
  const targets = productsMissingCost();
  if (targets.length === 0) return { ok: true, filled: 0 };

  return inTx(() => {
    let filled = 0;
    for (const t of targets) {
      // The average of what it has actually sold for, off the same lines the
      // list ranked it by. A tire sold once at $340 and once at $300 gets its
      // cost from $320, which is the best the record can say.
      const avg = db
        .prepare(
          `SELECT CAST(AVG(NULLIF(i.unit_price_cents, 0)) AS INTEGER) AS p
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
            WHERE i.product_id = ? AND i.voided = 0
              AND s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'`,
        )
        .get(t.productId) as { p: number | null };
      if (!avg.p || avg.p <= 0) continue;

      const cost = Math.round((avg.p * 10000) / (10000 + bp));
      if (cost <= 0) continue;

      db.prepare("UPDATE products SET default_cost_cents = ? WHERE id = ?").run(cost, t.productId);
      logActorAudit({
        type: "employee",
        employeeId: user.employeeId,
        name: user.name,
        role: user.role,
      } satisfies Actor, {
        action: "product.update",
        targetType: "product",
        targetId: t.productId,
        details: {
          why: "cost worked back from the selling price at the shop's floor markup",
          markup_bp: bp,
          from_avg_price_cents: avg.p,
        },
        before: { default_cost_cents: 0 },
        after: { default_cost_cents: cost },
      });
      filled += 1;
    }
    return { ok: true as const, filled };
  });
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
