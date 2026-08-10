import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { correctPayment, removeTip, setPaymentSeq } from "@/lib/payments";

/**
 * The two ways a payment gets corrected, and they are not the same kind of act.
 *
 * `seq` is edited in place — a reference number moves no money, and it is
 * cashier work: matching the card batch is done by whoever is on the register
 * when the terminal slip does not line up, and making it a manager job means it
 * waits until close and gets done from memory.
 *
 * `methodId` and `amountCents` are NOT edits. They reverse the payment and take
 * it again saying the right thing, because neither which pile the day expects
 * to find the money in nor how much of it there is is something to quietly
 * rewrite. Manager and up, enforced in `correctPayment` rather than here so the
 * rule holds for any caller.
 *
 * Everything else about a ledger row is still corrected by writing another row.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // The lower of the two bars, so a cashier can still fix a SEQ. The re-tender
  // path checks for itself.
  const auth = await requirePos("editSeq");
  if (!auth.ok) return auth.response;

  const paymentId = parseInt((await params).id, 10);
  if (!Number.isInteger(paymentId)) return jsonError("Not found", 404);

  let body: {
    seq?: string | null;
    methodId?: number;
    amountCents?: number;
    reason?: string;
    removeTip?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // Checked first, because taking the tip off is a different act from
  // re-tendering and a body carrying both would otherwise re-tender and leave
  // the tip on. `removeTip` enforces its own rank.
  if (body.removeTip) {
    const r = removeTip(auth.user, paymentId, body.reason ?? "");
    if (!r.ok) return jsonError(r.error);
    return NextResponse.json({ ok: true, removedCents: r.removedCents });
  }

  if (body.methodId !== undefined || body.amountCents !== undefined) {
    if (body.methodId !== undefined && !Number.isInteger(body.methodId))
      return jsonError("Pick a payment method");
    if (body.amountCents !== undefined && !Number.isInteger(body.amountCents))
      return jsonError("Enter an amount");
    const r = correctPayment(auth.user, paymentId, {
      methodId: body.methodId,
      amountCents: body.amountCents,
      reason: body.reason ?? "",
    });
    if (!r.ok) return jsonError(r.error);
    return NextResponse.json({ payment: r.payment });
  }

  if (body.seq === undefined) return jsonError("Nothing to change");

  const r = setPaymentSeq(auth.user, paymentId, body.seq);
  if (!r.ok) return jsonError(r.error);
  return NextResponse.json({ payment: r.payment });
}
