import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listOrderLog, listSpecialOrders, orderHistory } from "@/lib/special-orders";

/**
 * The orders, read one of two ways.
 *
 * `board` is the counter's screen: who is waiting on us, finished work falling
 * away after a fortnight, sorted by whose turn it is. `log` is the same rows as
 * history — everything ever taken, newest first, inside whatever window is
 * asked for — with the state changes of each one attached.
 *
 * Both on one route because they are one set of records seen from two distances,
 * and a second endpoint would be a second place for the shape of an order to
 * drift. Everything comes back in one response: a shop with enough special
 * orders to need pagination has a problem pagination will not help with.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const log = sp.get("view") === "log";

  const orders = log
    ? listOrderLog({
        from: sp.get("from") || undefined,
        to: sp.get("to") || undefined,
      })
    : listSpecialOrders();

  // Sent for both readings. It was the log's alone, on the theory that the
  // counter only cares about what happens next — but "when did this actually
  // arrive" and "who rang them last" get asked at the counter, with the
  // customer already on the phone, which is where the answer is worth the most.
  // It is one indexed read over a short list; withholding it saved nothing.
  return NextResponse.json({
    orders,
    history: Object.fromEntries(orderHistory(orders.map((o) => o.saleId))),
  });
}
