import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listAllMovements } from "@/lib/inventory";
import { can } from "@/lib/roles";

/**
 * Every stock movement there has been.
 *
 * `viewInventory` because it is the stock ledger and anyone allowed to look at
 * the racks is allowed to look at how they got that way. The cost on each
 * movement is the exception and is stripped below for everyone under a manager
 * — what the shop paid is the one figure on this row that is nobody else's
 * business, and it rides along on every receive.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewInventory");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const rows = listAllMovements({
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    q: sp.get("q") || undefined,
    limit: Math.min(2000, parseInt(sp.get("limit") ?? "500", 10) || 500),
  });

  const showCosts = can(auth.user.role, "viewReports");

  // Named field by field rather than spread, so a column added to
  // `inventory_movements` next year cannot quietly reach the counter.
  return NextResponse.json({
    showCosts,
    movements: rows.map((m) => ({
      id: m.id,
      productId: m.product_id,
      productName: m.productName,
      tireSize: m.tireSize,
      condition: m.condition,
      qtyDelta: m.qty_delta,
      reason: m.reason,
      unitCostCents: showCosts ? m.unit_cost_cents : null,
      saleId: m.sale_id,
      saleNo: m.saleNo,
      oversold: m.oversold,
      reviewedByName: m.reviewedByName,
      note: m.note,
      businessDate: m.business_date,
      byName: m.byName,
      at: m.created_at,
    })),
  });
}
