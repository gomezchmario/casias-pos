import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import {
  inventoryBySection,
  listBatteries,
  listLowStock,
  listProducts,
  withStock,
} from "@/lib/products";
import { lotIntegrityCheck } from "@/lib/inventory";
import { pricingFlags } from "@/lib/pricing-flags";
import { can } from "@/lib/roles";
import { costCode } from "@/lib/money";
import { getSetting, setSetting } from "@/lib/settings";
import { readInventoryCheck } from "@/lib/inventory-check";
import { currentBusinessDate } from "@/lib/business-date";
import { logActorAudit } from "@/lib/audit";
import { inTx } from "@/lib/tx";

/**
 * The rack. Grouped by size for the shop floor, flat for anyone editing.
 *
 * Costs are stripped unless the caller may see them — a cashier browsing stock
 * has no business knowing what the shop paid, and the cheapest place to enforce
 * that is before the number leaves the server.
 *
 * The coded cost ("P140") is a second, weaker grant: a cashier at the counter
 * needs to know how far down they can go on the tire in front of them. It is
 * computed here rather than in the browser precisely so that grant stays weak —
 * see `costCode` in money.ts.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewInventory");
  if (!auth.ok) return auth.response;

  const showCosts = can(auth.user.role, "viewCosts");
  const showCode = can(auth.user.role, "viewCostCode");
  // Zero is not a cost the shop ever paid, it is the absence of one — and "P0"
  // on a tire reads as "this cost us nothing", which is the single thing you
  // must not believe while haggling over it. So it is omitted, not printed.
  const codeFor = (cents: number | null) =>
    showCode && cents ? costCode(cents) : null;
  const includeOutOfStock = req.nextUrl.searchParams.get("all") === "1";
  const flat = req.nextUrl.searchParams.get("flat") === "1";

  if (flat) {
    const products = withStock(listProducts({ includeInactive: true })).map((p) => ({
      ...p,
      default_cost_cents: showCosts ? p.default_cost_cents : null,
    }));
    return NextResponse.json({ products, showCosts });
  }

  // Sections are rim diameters in rack order, with the eighteen-wheeler and
  // specialty block last. See `inventoryBySection`.
  const sections = inventoryBySection({ includeOutOfStock }).map((s) => ({
    ...s,
    groups: s.groups.map((g) => ({
      ...g,
      newTires: g.newTires.map((t) => ({
        ...t,
        default_cost_cents: showCosts ? t.default_cost_cents : null,
        cost_code: codeFor(t.default_cost_cents),
      })),
    })),
  }));

  return NextResponse.json({
    sections,
    // Their own block rather than a rim section, because they are not tires and
    // do not have a rim. They ride on this endpoint rather than one of their own
    // so the sheet is one request and cannot render half-loaded.
    // No `cost_code`. The P-code is a haggling tool, and a battery is not
    // haggled over — it is Large, Medium or Small at a fixed shelf price. A code
    // there would be noise on the sheet at best, and at worst it trains people
    // to read the suffix as part of the product name.
    batteries: listBatteries({ includeOutOfStock }).map((b) => ({
      ...b,
      default_cost_cents: showCosts ? b.default_cost_cents : null,
      cost_code: null,
    })),
    lastCheck: readInventoryCheck(),
    showCosts,
    // Manager and up only, and computed here rather than derived in the browser
    // from the rows above — a cashier's copy of this payload must not contain
    // the answer at all, and `sections` has already had costs stripped out of
    // it, so the page could not work it out even if it wanted to.
    pricing: can(auth.user.role, "reviewPricing")
      ? pricingFlags({ includeCosts: showCosts })
      : null,
    // Starting values for the quoter, not a quote. The arithmetic itself runs
    // in the browser from `quoteTire`, because the counter types a cost with a
    // customer on the phone and a round-trip per keystroke is how a tool stops
    // being used. Nothing here is derived from stock, so there is no cost to
    // leak: these are the shop's own posted markup and labour rate.
    quoteDefaults: can(auth.user.role, "quoteTire")
      ? {
          marginBp: Number(getSetting("quote_margin_bp")),
          taxRateBp: Number(getSetting("tax_rate_bp")),
          mountBalanceCents: Number(getSetting("quote_mount_balance_cents")),
          roundToCents: Number(getSetting("quote_round_to_cents")),
        }
      : null,
    lowStock: can(auth.user.role, "receiveInventory") ? listLowStock().length : 0,
    // Surfaced, never auto-repaired: a repair would destroy the evidence.
    integrityIssues: can(auth.user.role, "adjustInventory") ? lotIntegrityCheck() : [],
  });
}

export type LastCheck = { date: string; by: string };

function readLastCheck(): LastCheck {
  return {
    date: getSetting("last_inventory_check"),
    by: getSetting("last_inventory_check_by"),
  };
}

/**
 * "We counted the racks today."
 *
 * A statement, not a derivation — see the note on `last_inventory_check` in
 * settings.ts for why the ledger cannot answer this. Behind `adjustInventory`
 * rather than `viewInventory`, because the claim is only worth anything if the
 * person making it is someone who could have booked the differences they found.
 */
export async function POST() {
  const auth = await requirePos("adjustInventory");
  if (!auth.ok) return auth.response;

  const before = readLastCheck();
  // The business date, not the wall clock: a count finished at 9:40pm after a
  // 9pm close belongs to the day it was done on, like everything else here.
  const date = currentBusinessDate();

  inTx(() => {
    setSetting("last_inventory_check", date);
    setSetting("last_inventory_check_by", auth.user.name);
    // A real count spends the excuse. Leaving the "cleared" stamp behind would
    // leave the strip explaining why it is quiet on a day it is quiet because
    // the racks were just walked, which is the one day it needs no excuse.
    setSetting("inventory_alarm_cleared", "");
    setSetting("inventory_alarm_cleared_by", "");
    logActorAudit(auth.actor, {
      action: "settings.update",
      targetType: "setting",
      targetId: "last_inventory_check",
      before,
      after: { date, by: auth.user.name },
    });
  });

  return NextResponse.json(readInventoryCheck());
}
