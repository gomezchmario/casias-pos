import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale, type FulfillmentStatus } from "@/lib/sales";
import { markSpecialOrder, setFulfillment } from "@/lib/special-orders";

const STATUSES: FulfillmentStatus[] = [
  "none",
  "pending",
  "ordered",
  "arrived",
  "installed",
  "delivered",
  "cancelled",
];

/**
 * Two jobs on one route, because from the counter they are one job: this ticket
 * is being ordered in, or it is moving along.
 *
 * `marked` turns the flag on or off; `status` walks the lifecycle. Both are
 * gated inside the library rather than here — the route checks that somebody is
 * signed in and holds the capability at all, and the harder question (is this
 * move forwards or backwards?) is answered where the current status is known.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageSpecialOrders");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: { marked?: boolean; status?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.marked !== undefined) {
    const r = markSpecialOrder(auth.user, saleId, body.marked === true);
    if (!r.ok) return jsonError(r.error);
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as FulfillmentStatus))
      return jsonError("That is not a stage an order can be in");
    const r = setFulfillment(auth.user, saleId, body.status as FulfillmentStatus);
    if (!r.ok) return jsonError(r.error);
  }

  return NextResponse.json({ sale: getSale(saleId) });
}
