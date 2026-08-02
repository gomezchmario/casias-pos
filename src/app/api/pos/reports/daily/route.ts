import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { dayByMechanic, dayByMethod, dayTotals, seqReport } from "@/lib/pos-reports";
import { currentBusinessDate } from "@/lib/business-date";
import { integrityCheck, listSalesForDate } from "@/lib/sales";
import { listPaymentMethods } from "@/lib/payments";
import { getSetting } from "@/lib/settings";
import { can } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const date = req.nextUrl.searchParams.get("date") || currentBusinessDate();

  // What the shop paid out for stock is a manager's business, not a cashier's,
  // so it's stripped server-side rather than merely hidden in the markup.
  const showsPurchases = can(auth.user.role, "cashPurchase");
  const totals = dayTotals(date);

  return NextResponse.json({
    totals: showsPurchases
      ? totals
      : { ...totals, purchasesCents: 0, purchaseCount: 0 },
    byMethod: dayByMethod(date),
    byMechanic: dayByMechanic(date),
    seq: seqReport(date),
    // Purchase tickets drop out of the list for the same reason as the totals.
    sales: listSalesForDate(date).filter((s) => showsPurchases || s.kind !== "purchase"),
    integrity: integrityCheck(date),
    canSeePurchases: showsPurchases,
    // Needed by the ticket drawer to book a late tip against a tender.
    paymentMethods: listPaymentMethods(),
    settings: {
      tipCommPerCents: Number(getSetting("tip_comm_per_cents")),
      tipCommChargeCents: Number(getSetting("tip_comm_charge_cents")),
    },
  });
}
