import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { addItem, getSale, listSaleItems } from "@/lib/sales";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: {
    description?: string;
    qty?: number;
    unitPriceCents?: number;
    productId?: number | null;
    categoryId?: number | null;
    mechanicId?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = addItem(auth.user, saleId, {
    description: body.description ?? "",
    qty: body.qty ?? 1,
    unitPriceCents: body.unitPriceCents ?? -1,
    productId: body.productId ?? null,
    categoryId: body.categoryId ?? null,
    mechanicId: body.mechanicId ?? null,
  });
  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({
    item: result.item,
    sale: getSale(saleId),
    items: listSaleItems(saleId),
  });
}
