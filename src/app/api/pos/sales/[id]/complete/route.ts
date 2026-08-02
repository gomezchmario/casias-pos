import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { completeSale, getSale } from "@/lib/sales";
import { listPayments } from "@/lib/payments";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  const result = completeSale(auth.user, saleId);
  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({ sale: result.sale, payments: listPayments(saleId) });
}
