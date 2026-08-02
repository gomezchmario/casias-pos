import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  getSale,
  listSaleItems,
  updatePo,
  updateSaleMeta,
  updateSeq,
} from "@/lib/sales";
import { listPayments } from "@/lib/payments";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("viewInventory");
  if (!auth.ok) return auth.response;

  const sale = getSale(parseInt((await params).id, 10));
  if (!sale) return jsonError("Not found", 404);
  return NextResponse.json({
    sale,
    items: listSaleItems(sale.id, true),
    payments: listPayments(sale.id),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editOwnOpenSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: {
    seq?: string | null;
    po?: string | null;
    customerId?: number | null;
    vehicleId?: number | null;
    notes?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.seq !== undefined) {
    const seqAuth = await requirePos("editSeq");
    if (!seqAuth.ok) return seqAuth.response;
    const r = updateSeq(auth.user, saleId, body.seq);
    if (!r.ok) return jsonError(r.error);
  }
  if (body.po !== undefined) {
    const r = updatePo(auth.user, saleId, body.po);
    if (!r.ok) return jsonError(r.error);
  }
  if (
    body.customerId !== undefined ||
    body.vehicleId !== undefined ||
    body.notes !== undefined
  ) {
    const r = updateSaleMeta(auth.user, saleId, {
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      notes: body.notes,
    });
    if (!r.ok) return jsonError(r.error);
  }

  return NextResponse.json({ sale: getSale(saleId) });
}
