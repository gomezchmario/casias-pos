import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { receiveStock, stockOnHand } from "@/lib/inventory";
import { ensureUsedTire } from "@/lib/products";

export async function POST(req: NextRequest) {
  const auth = await requirePos("receiveInventory");
  if (!auth.ok) return auth.response;

  let body: {
    productId?: number;
    usedSize?: string;
    qty?: number;
    unitCostCents?: number;
    supplier?: string | null;
    reference?: string | null;
    note?: string | null;
    specialized?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // Receiving used tires by size rather than by product id: whoever is
  // unloading them knows the size, not which row of a table it maps to, and a
  // size the shop has never carried before should not be a dead end.
  let productId = body.productId;
  if (!productId && body.usedSize) {
    const used = ensureUsedTire(auth.user, body.usedSize, body.specialized);
    if (!used.ok) return jsonError(used.error);
    productId = used.product.id;
  }
  if (!productId) return jsonError("Pick a product or give a used tire size");

  const result = receiveStock(auth.user, {
    productId,
    qty: body.qty ?? 0,
    // A used tire has no cost to record — see ensureUsedTire.
    unitCostCents: body.usedSize ? 0 : (body.unitCostCents ?? 0),
    supplier: body.supplier ?? null,
    reference: body.reference ?? null,
    note: body.note ?? null,
  });
  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({
    lot: result.lot,
    productId,
    onHand: stockOnHand(productId),
  });
}
