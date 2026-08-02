import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale } from "@/lib/sales";
import { listPayments, voidSale } from "@/lib/payments";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("voidSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = voidSale(auth.user, saleId, body.reason ?? "");
  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({ sale: getSale(saleId), payments: listPayments(saleId) });
}
