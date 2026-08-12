import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import {
  deadStock,
  lostDemand,
  productMovement,
  reorderList,
  restockAdvice,
  stockValue,
  tiresInOut,
} from "@/lib/reports-bi";

/**
 * The three rack questions, for the inventory page's fold.
 *
 * The same figures the management Reports page draws — money standing still,
 * what is worth keeping in stock, what walked out unsold — but behind
 * `viewReports` (manager) rather than `viewBusinessReports` (owner). That gap
 * is deliberate and this route is the bridge: the full Reports page carries
 * margins, customer spend and the shape of the business, which is the owner's
 * book, while these three are BUYING questions, and the person standing at the
 * racks deciding what to order on a Tuesday is the manager.
 *
 * Lost demand is measured over the last thirty days rather than all time,
 * because the question at the racks is "what are people asking for NOW" — a
 * size that walked out last winter is the reports' business, not tonight's
 * order.
 */
export async function GET() {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const today = currentBusinessDate();
  const from = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return d.toISOString().slice(0, 10);
  })();

  const dead = deadStock(today, 45);
  const weekStart = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const week = tiresInOut(weekStart, today);

  return NextResponse.json({
    from,
    to: today,
    /*
      The opening tiles, as COUNTS and nothing else — by instruction. The
      matching row on the Reports page prices all of this; here what the shop
      paid stays behind viewCosts, and a count answers the manager's actual
      questions anyway: how much is on the racks, how much of it is asleep,
      what needs ordering, and whether the week moved tires in and out.
    */
    counts: {
      stockUnits: stockValue().totalUnits,
      deadSizes: dead.length,
      reorderSizes: reorderList(today).length,
      weekSoldUnits: week.soldUnits,
      weekStockedUnits: week.receivedUnits,
    },
    // A hundred so Show-10-more never needs a round trip — the same depth
    // and the same reasoning as the Reports page it is lifted from.
    bestSellers: productMovement(from, today)
      .filter((m) => m.units > 0)
      .slice(0, 100),
    dead: dead.slice(0, 15),
    restock: restockAdvice(today).slice(0, 15),
    lost: lostDemand(from, today),
  });
}
