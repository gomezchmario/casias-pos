import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale } from "@/lib/sales";
import {
  addTipAdjustment,
  listPayments,
  payOutPurchase,
  refund,
  takePayment,
} from "@/lib/payments";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("takePayment");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: {
    kind?: "payment" | "tip_adjustment" | "refund" | "purchase_payout";
    methodId?: number;
    amountCents?: number;
    tipCents?: number;
    commCents?: number | null;
    seq?: string | null;
    note?: string | null;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (!body.methodId) return jsonError("Pick a payment method");

  const kind = body.kind ?? "payment";
  const result =
    kind === "tip_adjustment"
      ? addTipAdjustment(auth.user, saleId, {
          methodId: body.methodId,
          tipCents: body.tipCents ?? 0,
          commCentsOverride: body.commCents ?? null,
          seq: body.seq ?? null,
          note: body.note ?? null,
        })
      : kind === "refund"
        ? refund(auth.user, saleId, {
            methodId: body.methodId,
            amountCents: body.amountCents ?? 0,
            reason: body.reason ?? "",
          })
        : kind === "purchase_payout"
          ? payOutPurchase(auth.user, saleId, {
              methodId: body.methodId,
              amountCents: body.amountCents ?? 0,
            })
          : takePayment(auth.user, saleId, {
              methodId: body.methodId,
              amountCents: body.amountCents ?? 0,
              tipCents: body.tipCents ?? 0,
              commCentsOverride: body.commCents ?? null,
              seq: body.seq ?? null,
              note: body.note ?? null,
            });

  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({
    payment: result.payment,
    sale: getSale(saleId),
    payments: listPayments(saleId),
  });
}
