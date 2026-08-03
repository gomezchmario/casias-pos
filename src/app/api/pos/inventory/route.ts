import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { inventoryBySection, listLowStock, listProducts, withStock } from "@/lib/products";
import { lotIntegrityCheck } from "@/lib/inventory";
import { can } from "@/lib/roles";

/**
 * The rack. Grouped by size for the shop floor, flat for anyone editing.
 *
 * Costs are stripped unless the caller may see them — a cashier browsing stock
 * has no business knowing what the shop paid, and the cheapest place to enforce
 * that is before the number leaves the server.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewInventory");
  if (!auth.ok) return auth.response;

  const showCosts = can(auth.user.role, "viewCosts");
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
      })),
    })),
  }));

  return NextResponse.json({
    sections,
    showCosts,
    lowStock: can(auth.user.role, "receiveInventory") ? listLowStock().length : 0,
    // Surfaced, never auto-repaired: a repair would destroy the evidence.
    integrityIssues: can(auth.user.role, "adjustInventory") ? lotIntegrityCheck() : [],
  });
}
