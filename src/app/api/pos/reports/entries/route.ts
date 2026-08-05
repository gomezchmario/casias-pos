import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { dayEntries } from "@/lib/pos-reports";
import { currentBusinessDate } from "@/lib/business-date";
import { listPaymentMethods } from "@/lib/payments";
import { getSetting } from "@/lib/settings";
import { can } from "@/lib/roles";

/**
 * The day's consecutive ledger, for the Entries tab.
 *
 * Its own route rather than another field on the daily report, because the two
 * screens want opposite things: the day screen wants a dozen aggregates and the
 * last few lines, this wants every row and none of the aggregates. Bolting it
 * onto `daily` would make the shop pay for a full leaderboard every time
 * somebody sorted a column.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const date = req.nextUrl.searchParams.get("date") || currentBusinessDate();

  // Same gate as the daily report: what the shop paid out for stock is a
  // manager's business. Dropped here rather than hidden on the page, so the
  // rows never reach a browser that may not show them.
  const showsPurchases = can(auth.user.role, "cashPurchase");

  return NextResponse.json({
    businessDate: date,
    /**
     * What day it is right now, as opposed to the day being looked at.
     *
     * The two are usually the same and the page throws this away. They differ
     * in exactly the case worth handling: a screen left open across the 4am
     * roll. Only this side can answer it — the boundary hour is a setting in
     * the database, so no amount of client-side arithmetic gets there.
     */
    today: currentBusinessDate(),
    entries: dayEntries(date).filter((e) => showsPurchases || e.ticketKind !== "purchase"),
    // A row here opens the same ticket drawer the day screen uses, and the
    // drawer needs these to book a late tip or take a balance.
    paymentMethods: listPaymentMethods(),
    settings: {
      tipCommPerCents: Number(getSetting("tip_comm_per_cents")),
      tipCommChargeCents: Number(getSetting("tip_comm_charge_cents")),
    },
  });
}
