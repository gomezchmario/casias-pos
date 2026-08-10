import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { cashierDiscountMaxCents, setDiscount } from "@/lib/sales";

/**
 * Money taken off a ticket.
 *
 * The library has been able to do this since the beginning and nothing ever
 * called it: there was a report naming who gave the discounts and no way in the
 * app to give one. So the figure was always zero and the report always read as
 * a shop that never discounts anything, which is not true of any tire shop.
 *
 * Gated on `discountSale`, which a cashier holds — the ceiling on how much is a
 * SETTING rather than a role, and `setDiscount` enforces it. That split is the
 * point: "may you discount at all" and "may you discount this much" are
 * different questions with different answers.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("discountSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!Number.isInteger(saleId)) return jsonError("Not found", 404);

  let body: { amountCents?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const done = setDiscount(auth.user, saleId, Number(body.amountCents), body.reason ?? "");
  if (!done.ok) return jsonError(done.error);
  return NextResponse.json({ sale: done.sale });
}

/** What this person may take off without a manager. Drawn on the control. */
export async function GET() {
  const auth = await requirePos("discountSale");
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    maxCents: auth.user.role === "cashier" ? cashierDiscountMaxCents() : null,
  });
}
