import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  accountCharges,
  getAccount,
  listAccountPayments,
  recordAccountPayment,
  reverseAccountPayment,
  reviewAccountCharge,
  unreviewAccountCharge,
} from "@/lib/credit-accounts";

/** One customer's account: the balance, what put it there, and what came in. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageCreditAccounts");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  return NextResponse.json({
    account: getAccount(id),
    charges: accountCharges(id),
    payments: listAccountPayments(id),
  });
}

/**
 * Money in, or a correction to money in.
 *
 * Both on one route because they are the same act from the caller's side: the
 * accountant is fixing the account either way, and which of the two it is
 * depends only on whether a row is being pointed at.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageCreditAccounts");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  let body: {
    amountCents?: number;
    paidAt?: string;
    how?: string | null;
    toAccount?: string | null;
    note?: string | null;
    reverseId?: number;
    reason?: string;
    reviewChargeId?: number;
    unreviewChargeId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // Before the sign-off, so a body carrying both is read as the undo. The tick
  // is one click away from the wrong row and this is how it gets taken back.
  if (body.unreviewChargeId != null) {
    const done = unreviewAccountCharge(auth.user, body.unreviewChargeId);
    if (!done.ok) return jsonError(done.error);
    return NextResponse.json({ ok: true });
  }

  if (body.reviewChargeId != null) {
    const done = reviewAccountCharge(auth.user, body.reviewChargeId, body.note ?? null);
    if (!done.ok) return jsonError(done.error);
    return NextResponse.json({ ok: true });
  }

  if (body.reverseId != null) {
    const undone = reverseAccountPayment(auth.user, body.reverseId, body.reason ?? "");
    if (!undone.ok) return jsonError(undone.error);
    return NextResponse.json({ payment: undone.payment });
  }

  const res = recordAccountPayment(auth.user, {
    customerId: id,
    amountCents: Number(body.amountCents),
    paidAt: body.paidAt ?? "",
    how: body.how ?? null,
    toAccount: body.toAccount ?? null,
    note: body.note ?? null,
  });
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ payment: res.payment });
}
