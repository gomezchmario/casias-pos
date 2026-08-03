import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { deleteProduct, getProduct, updateProduct } from "@/lib/products";
import { listLots, listMovements, stockOnHand } from "@/lib/inventory";
import { can } from "@/lib/roles";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("viewInventory");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  const product = getProduct(id);
  if (!product) return jsonError("Product not found", 404);

  const showCosts = can(auth.user.role, "viewCosts");
  return NextResponse.json({
    product: { ...product, default_cost_cents: showCosts ? product.default_cost_cents : null },
    onHand: stockOnHand(id),
    // Lots ARE costs — there is nothing left in one once the cost is stripped,
    // so it is cleaner to withhold the list than to send hollowed-out rows.
    lots: showCosts ? listLots(id, true) : [],
    movements: listMovements(id, 100),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageProducts");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  let body: {
    name?: string;
    brand?: string | null;
    model?: string | null;
    ply?: string | null;
    tireSize?: string | null;
    priceCents?: number;
    defaultCostCents?: number;
    reorderPoint?: number;
    active?: boolean;
    specialized?: boolean;
    supplier?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // `body` is passed whole: every key on it is an updateProduct argument, and
  // listing them again here would be one more place to forget a new field.
  const result = updateProduct(auth.user, id, body);
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ product: getProduct(id) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageProducts");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  const result = deleteProduct(auth.user, id, reason);
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ ok: true });
}
