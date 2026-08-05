import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale, setWorkStatus, WORK_STATUSES, type WorkStatus } from "@/lib/sales";

/**
 * Where the car is. Its own route rather than another field on the ticket
 * PATCH, because it is the one thing on a ticket that gets changed by somebody
 * who is not editing the ticket — a hand reaching over to say the truck is
 * ready — and it should not have to pass through the same permission gate as
 * changing what a customer owes.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: { workStatus?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const next = body.workStatus ?? null;
  if (next !== null && !WORK_STATUSES.includes(next as WorkStatus))
    return jsonError("That is not one of the work statuses");

  const r = setWorkStatus(auth.user, saleId, next as WorkStatus | null);
  if (!r.ok) return jsonError(r.error);
  return NextResponse.json({ sale: getSale(saleId) });
}
