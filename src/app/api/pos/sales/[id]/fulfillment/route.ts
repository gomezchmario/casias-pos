import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { FULFILLMENT_STAGES } from "@/lib/fulfillment";
import { getSale, type FulfillmentStatus } from "@/lib/sales";
import { markSpecialOrder, orderStockPreview, setFulfillment } from "@/lib/special-orders";

/**
 * Everything a caller may name, derived rather than typed out again.
 *
 * It used to be a hand-written list, which was a second place to remember when
 * the board's vocabulary changed — and the first time it did, this file still
 * accepted a stage the board no longer offered and rejected the two it had just
 * gained. `FULFILLMENT_STAGES` is the one list; the two answers that are not
 * stages are added here, where the difference is explained.
 *
 * 'installed' rides along even though the board has retired it. Old tickets sit
 * on it, and a route that refused the value would make them unmovable.
 */
const STATUSES: FulfillmentStatus[] = [
  ...FULFILLMENT_STAGES,
  "none",
  "cancelled",
  "installed",
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

  let body: { marked?: boolean; status?: string; alreadyStockedItemIds?: number[] };
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
    const r = setFulfillment(auth.user, saleId, body.status as FulfillmentStatus, {
      alreadyStockedItemIds: Array.isArray(body.alreadyStockedItemIds)
        ? body.alreadyStockedItemIds
        : undefined,
    });
    if (!r.ok) return jsonError(r.error);
  }

  return NextResponse.json({ sale: getSale(saleId) });
}

/**
 * What fulfilling this order would do to the racks.
 *
 * Read before the move, so the counter can be shown the tire, the count and its
 * history and asked the one question the data cannot answer for them: is this
 * already on the shelf?
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageSpecialOrders");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);
  return NextResponse.json({ lines: orderStockPreview(saleId) });
}
