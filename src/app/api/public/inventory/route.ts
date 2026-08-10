import { NextRequest, NextResponse } from "next/server";
import { inventoryBySection, listBatteries, listMisc } from "@/lib/products";
import { readInventoryCheck } from "@/lib/inventory-check";

/**
 * The rack, with no login.
 *
 * The shop wanted a way to answer "do we have a 215 55 17" without stopping to
 * type a PIN — from the phone at the bay, from the second screen, from whoever
 * happens to be nearest. Everything here is what a customer standing at the
 * counter can already see by looking at the rack and asking the price.
 *
 * The whitelist below is the entire security model of this file, so it is
 * written out field by field rather than spread-and-delete. `{...t, cost: null}`
 * is one careless refactor away from leaking the next column somebody adds to
 * `products`; naming the six fields that may leave means a new column is
 * private until somebody deliberately types it here.
 *
 * Never on this endpoint, for three different reasons:
 *   - `default_cost_cents` — what the shop paid is not the customer's business.
 *   - `cost_code` — the P-code is the counter's haggling floor. Its whole value
 *     is that the person across the counter does not know it.
 *   - `supplier` — who the shop buys from is a competitor's question.
 */
export async function GET(req: NextRequest) {
  const includeOutOfStock = req.nextUrl.searchParams.get("all") === "1";

  const sections = inventoryBySection({ includeOutOfStock }).map((s) => ({
    key: s.key,
    rim: s.rim,
    specialized: s.specialized,
    total: s.total,
    groups: s.groups.map((g) => ({
      size: g.size,
      usedCount: g.usedCount,
      total: g.total,
      newTires: g.newTires.map((t) => ({
        id: t.id,
        name: t.name,
        brand: t.brand,
        model: t.model,
        ply: t.ply,
        price_cents: t.price_cents,
        on_hand: t.on_hand,
      })),
    })),
  }));

  const batteries = listBatteries({ includeOutOfStock }).map((b) => ({
    id: b.id,
    name: b.name,
    price_cents: b.price_cents,
    on_hand: b.on_hand,
  }));

  const misc = listMisc({ includeOutOfStock }).map((b) => ({
    id: b.id,
    name: b.name,
    price_cents: b.price_cents,
    on_hand: b.on_hand,
  }));

  // The count's age rides along for the same reason it is on the register's
  // sheet: a stock number with no idea how old it is invites more trust than it
  // has earned, and this copy is the one most likely to be read by somebody who
  // was not here when it was counted.
  return NextResponse.json({ sections, batteries, misc, lastCheck: readInventoryCheck() });
}
