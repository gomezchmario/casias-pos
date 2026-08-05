import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { setPaymentSeq } from "@/lib/payments";

/**
 * The only thing editable on a payment, and deliberately so — see the note on
 * `setPaymentSeq`. Everything else about a ledger row is corrected by writing
 * another row, never by rewriting this one.
 *
 * Cashier and up: matching the card batch is counter work done by whoever is on
 * the register when the terminal slip does not line up, and making it a manager
 * job means it waits until close and gets done from memory.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editSeq");
  if (!auth.ok) return auth.response;

  const paymentId = parseInt((await params).id, 10);
  if (!Number.isInteger(paymentId)) return jsonError("Not found", 404);

  let body: { seq?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (body.seq === undefined) return jsonError("Nothing to change");

  const r = setPaymentSeq(auth.user, paymentId, body.seq);
  if (!r.ok) return jsonError(r.error);
  return NextResponse.json({ payment: r.payment });
}
