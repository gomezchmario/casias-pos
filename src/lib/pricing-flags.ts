import { getDb } from "./db";

/**
 * Two things wrong with a price that nobody would ever notice on their own.
 *
 * Both came out of the opening import and both will keep happening — a tire
 * gets received before anyone decides what to charge for it, and a supplier
 * raises a cost without the shelf price following. Neither announces itself:
 * the tire sits on the rack looking exactly like every other tire, and the only
 * moment either one surfaces is at the counter with a customer waiting, which
 * is the worst possible moment to be discovering it.
 *
 * SO WHY NOT JUST BLOCK THE SALE
 *
 * Because a block does not stop the tire leaving the shop, it stops the sale
 * being RUNG. The cashier takes the cash, writes it on a sticky note, and the
 * ticket never exists — turning a visible pricing problem into an invisible
 * inventory one. Same reasoning as the oversell override. Flag loudly, let the
 * shop decide.
 *
 * WHO SEES IT
 *
 * Managers and up, never the public sheet. Both flags are statements about
 * MARGIN, and margin is the shop's business: "priced below cost" tells anyone
 * reading it that this tire can be had for less than the shop paid, which is
 * precisely the sentence you do not want a customer reading over a shoulder,
 * and "no price" is an invitation to name one. The gate is enforced in the
 * route, not in the markup — a rule the browser applies is a rule devtools
 * undoes.
 *
 * The COST FIGURES inside the below-cost flag are a second, tighter gate:
 * `viewCosts` is owner-only, so a manager sees THAT a tire is underwater and
 * what it sells for, and only an owner sees the number it cost. That split is
 * deliberate. Knowing something is priced wrong is what you need to fix it;
 * knowing the shop's margin on it is a different question with a different
 * answer.
 */

export type PricingFlag = {
  productId: number;
  name: string;
  size: string | null;
  onHand: number;
  priceCents: number;
  /** Null unless the caller may see costs. See the note above. */
  costCents: number | null;
};

export type PricingFlags = {
  /** In stock, and the register does not know what to charge for it. */
  noPrice: PricingFlag[];
  /** The shelf price is under what the shop paid. */
  belowCost: PricingFlag[];
};

/**
 * Stock is summed from the movements ledger rather than read off the product,
 * for the same reason it always is: there is no count column, only the reasons
 * the count changed.
 */
const BASE = `
  SELECT p.id            AS productId,
         p.name          AS name,
         p.tire_size     AS size,
         p.price_cents   AS priceCents,
         p.default_cost_cents AS costCents,
         COALESCE((SELECT SUM(m.qty_delta)
                     FROM inventory_movements m
                    WHERE m.product_id = p.id), 0) AS onHand
    FROM products p
   WHERE p.deleted = 0 AND p.active = 1 AND p.track_inventory = 1
`;

export function pricingFlags(opts: { includeCosts: boolean }): PricingFlags {
  const db = getDb();

  const strip = (r: PricingFlag): PricingFlag => ({
    ...r,
    costCents: opts.includeCosts ? r.costCents : null,
  });

  // ON HAND > 0 is the whole point of this one. The catalogue is full of tires
  // the shop can order but does not stock, and those legitimately have no price
  // until somebody quotes one. A priceless tire only becomes a problem when it
  // is physically on the rack and somebody can walk up and ask for it.
  const noPrice = db
    .prepare(
      `${BASE} AND p.price_cents = 0
         AND COALESCE((SELECT SUM(m.qty_delta) FROM inventory_movements m
                        WHERE m.product_id = p.id), 0) > 0
       ORDER BY onHand DESC, p.name`,
    )
    .all() as PricingFlag[];

  // Out-of-stock rows are INCLUDED here, unlike above. A tire priced below cost
  // that the shop does not currently hold is still going to be ordered at that
  // price the next time somebody asks for it, so the mistake is live whether or
  // not one is sitting on the rack today.
  //
  // cost > price, strictly. Equal is a break-even the shop may well have chosen.
  const belowCost = db
    .prepare(
      `${BASE} AND p.price_cents > 0
         AND p.default_cost_cents > p.price_cents
       ORDER BY (p.default_cost_cents - p.price_cents) DESC`,
    )
    .all() as PricingFlag[];

  return { noPrice: noPrice.map(strip), belowCost: belowCost.map(strip) };
}

/** Just the counts, for a badge. Cheap enough to run on every inventory load. */
export function pricingFlagCount(): number {
  const f = pricingFlags({ includeCosts: false });
  return f.noPrice.length + f.belowCost.length;
}
