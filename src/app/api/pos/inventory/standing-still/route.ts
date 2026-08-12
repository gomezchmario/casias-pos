import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { can } from "@/lib/roles";
import { deadStock } from "@/lib/reports-bi";

/**
 * Every size standing still — the full list behind the tile.
 *
 * The tile says "133 sizes"; the fold and the Reports page show the worst
 * fifteen; this is all of them, for the page that prints. `viewReports` to
 * read it, and WHAT EACH ONE COST IS STRIPPED SERVER-SIDE unless the reader
 * holds `viewCosts` — hiding a column on the screen while mailing the figures
 * in the JSON would be a curtain with the window open.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const today = currentBusinessDate();
  /*
    How asleep is asleep. Forty-five days is the shop's working definition and
    stays the default, but the question changes with the answer: at 45 days a
    tire is slow, at 120 it is money that is not coming back, and "all time"
    finds the sizes that have NEVER sold — which is a different conversation
    with a supplier than a slow one. A fixed window would keep answering only
    the first of the three.

    Zero is the fourth question and a different SHAPE of question: not "how
    long since this sold" but "this has never sold at all". Those are the rows
    with no last sale to measure from, and they are the hardest cases on the
    rack — a size that has never moved a single unit is a buying mistake rather
    than a slow season, and it is the list to take to a supplier.
  */
  const asked = Number(req.nextUrl.searchParams.get("days"));
  const days = [45, 90, 120, 0].includes(asked) ? asked : 45;
  const rows =
    days === 0
      ? deadStock(today, 0).filter((r) => r.daysSinceSale === null)
      : deadStock(today, days);
  const showCosts = can(auth.user.role, "viewCosts");

  return NextResponse.json({
    asOf: today,
    days,
    showCosts,
    totals: {
      sizes: rows.length,
      units: rows.reduce((n, r) => n + r.onHand, 0),
      costCents: showCosts ? rows.reduce((n, r) => n + r.costCents, 0) : null,
    },
    rows: rows.map((r) => ({
      productId: r.productId,
      name: r.name,
      size: r.size,
      onHand: r.onHand,
      costCents: showCosts ? r.costCents : null,
      daysSinceSale: r.daysSinceSale,
      daysOnShelf: r.daysOnShelf,
    })),
  });
}
