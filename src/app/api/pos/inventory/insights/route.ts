import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { deadStock, lostDemand, restockAdvice } from "@/lib/reports-bi";

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

  return NextResponse.json({
    from,
    to: today,
    dead: deadStock(today, 45).slice(0, 15),
    restock: restockAdvice(today).slice(0, 15),
    lost: lostDemand(from, today),
  });
}
