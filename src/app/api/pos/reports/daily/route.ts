import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import {
  dayByMechanic,
  dayByMethod,
  dayTotals,
  outstandingTickets,
} from "@/lib/pos-reports";
import { leaderboard, recentLines, standings, type Standings } from "@/lib/leaderboard";
import { currentBusinessDate } from "@/lib/business-date";
import { integrityCheck } from "@/lib/sales";
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

  // What an individual technician brought in splits in two.
  //
  // The SHARE — who is carrying the week — goes to everyone who can open this
  // screen. A cashier rang most of those tickets and watched the board fill up
  // all day; hiding the standings from them would be theatre.
  //
  // The DOLLARS are closer to naming what someone is paid, and this screen is
  // often left open on a counter anyone can walk past, so they stay owner-only
  // and are blanked here rather than merely hidden in the markup — a rule the
  // browser enforces is one a devtools panel undoes.
  //
  // Shares are computed server-side rather than by dividing on the page, since
  // handing the page the cents to divide would ship the exact number we are
  // withholding. Note what that does and does not buy: it is presentational
  // only, because the shop's own total is on this page several ways and
  // multiplying it by a share recovers the dollars. That is the intended
  // strength. The point is what a screen on a counter shows at a glance, not
  // secrecy from someone doing arithmetic.
  const showsTechIncomeCash = can(auth.user.role, "viewTechIncomeCash");
  const cash = (cents: number) => (showsTechIncomeCash ? cents : 0);
  const share = (cents: number, of: number) => (of > 0 ? (cents / of) * 100 : 0);

  /** The role gate, applied identically to whichever period is being sent. */
  const gate = <T extends Standings>(board: T): T => ({
    ...board,
    // Blanked for consistency with the column it foots, not for secrecy: the
    // shop's own week is not confidential and is on this page several other
    // ways. Anyone below owner sees that footer as "100%".
    totalIncomeCents: cash(board.totalIncomeCents),
    totalOtherIncomeCents: cash(board.totalOtherIncomeCents),
    techs: board.techs.map((t) => ({
      ...t,
      incomeCents: cash(t.incomeCents),
      otherIncomeCents: cash(t.otherIncomeCents),
      // Tips are deliberately NOT gated by role, only by the hide-money
      // toggle. A cashier is usually the one who took the tip off the customer
      // and handed it over — withholding a number they counted into someone's
      // hand an hour ago would be theatre, not privacy.
      prior: { ...t.prior, incomeCents: cash(t.prior.incomeCents) },
    })),
  });

  return NextResponse.json({
    /**
     * What day it is right now, as opposed to the day being looked at.
     *
     * `totals.businessDate` echoes whatever was asked for, which is right for
     * everything that reads it and useless for the one question the page needs
     * answered: has today moved on since this screen was drawn? Only this side
     * can answer that — the 4am boundary is a setting in the database.
     */
    today: currentBusinessDate(),
    totals: showsPurchases
      ? totals
      : { ...totals, purchasesCents: 0, purchaseCount: 0 },
    byMethod: dayByMethod(date),
    byMechanic: dayByMechanic(date).map((m) => ({
      ...m,
      salesCents: cash(m.salesCents),
      salesPct: share(m.salesCents, totals.goodsCents),
    })),
    // The weekly scoreboard and the day's line-by-line strip — what the shop's
    // old spreadsheet dashboard showed, and the reason anyone opens this page.
    leaderboard: gate(leaderboard(date)),
    // The day and the month are sent alongside the week rather than fetched
    // when the podium's period dropdown changes. These are indexed aggregates
    // over one shop's sales; paying for all three up front costs a few
    // milliseconds and buys a dropdown that switches instantly instead of one
    // that flashes a spinner.
    dayStandings: gate(standings(date, "day")),
    monthStandings: gate(standings(date, "month")),
    recentLines: recentLines(date),
    // Every debt on the books, not just this day's. Sent whatever date is being
    // viewed, because money owed is not a property of the day you happen to be
    // looking at and the shop needs it in front of them regardless.
    outstanding: outstandingTickets(),
    integrity: integrityCheck(date),
    canSeePurchases: showsPurchases,
    canSeeTechIncomeCash: showsTechIncomeCash,
    // Needed by the ticket drawer to book a late tip against a tender.
    paymentMethods: listPaymentMethods(),
    settings: {
      tipCommPerCents: Number(getSetting("tip_comm_per_cents")),
      tipCommChargeCents: Number(getSetting("tip_comm_charge_cents")),
    },
  });
}
