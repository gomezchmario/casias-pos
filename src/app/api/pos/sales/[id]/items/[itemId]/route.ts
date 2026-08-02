import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale, listSaleItems, updateItem, voidItem } from "@/lib/sales";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const { id, itemId } = await params;
  const saleId = parseInt(id, 10);

  let body: {
    description?: string;
    qty?: number;
    unitPriceCents?: number;
    mechanicId?: number | null;
    categoryId?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = updateItem(auth.user, parseInt(itemId, 10), body);
  if (!result.ok) return jsonError(result.error, 403);

  return NextResponse.json({ sale: getSale(saleId), items: listSaleItems(saleId) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const { id, itemId } = await params;
  const saleId = parseInt(id, 10);
  const reason = req.nextUrl.searchParams.get("reason") ?? "Removed at register";

  const result = voidItem(auth.user, parseInt(itemId, 10), reason);
  if (!result.ok) return jsonError(result.error, 403);

  return NextResponse.json({ sale: getSale(saleId), items: listSaleItems(saleId) });
}
