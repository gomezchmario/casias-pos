import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { standings, type StandingsPeriod } from "@/lib/leaderboard";
import { can } from "@/lib/roles";

/**
 * The performance board on its own, over whichever period is asked for.
 *
 * ITS OWN ROUTE RATHER THAN A PARAMETER ON THE CLOSE-OUT, and the reason is the
 * close-out screen rather than the query. That page holds typed-in drawer counts
 * in local state; re-fetching the whole report to change a dropdown would either
 * throw away what somebody was in the middle of counting or need the page to
 * merge two sources of truth, and both of those are worse than one small extra
 * endpoint. It is also cheaper — the close-out builds a drawer, a batch, the
 * register checks and three ledgers, none of which change when the board does.
 *
 * The dollars are withheld from anyone who may not see them, exactly as the
 * close-out route withholds them, because this is the same table reached by a
 * different door.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const businessDate = sp.get("date") || currentBusinessDate();
  const asked = sp.get("period");
  // Anything unrecognised falls back to the week, which is what the sheet
  // prints and therefore the answer least likely to surprise anybody.
  const period: StandingsPeriod =
    asked === "day" || asked === "month" ? asked : "week";

  const canSeeTechIncomeCash = can(auth.user.role, "viewTechIncomeCash");
  const board = standings(businessDate, period);

  return NextResponse.json({
    canSeeTechIncomeCash,
    board: {
      ...board,
      // Blanked here rather than hidden on the page. A figure that reaches the
      // browser is a figure anybody can read out of the network tab, which
      // would make the whole withholding a styling choice.
      totalIncomeCents: canSeeTechIncomeCash ? board.totalIncomeCents : 0,
      techs: board.techs.map((t) => ({
        ...t,
        incomeCents: canSeeTechIncomeCash ? t.incomeCents : 0,
        otherIncomeCents: canSeeTechIncomeCash ? t.otherIncomeCents : 0,
        prior: {
          ...t.prior,
          incomeCents: canSeeTechIncomeCash ? t.prior.incomeCents : 0,
        },
      })),
    },
  });
}
