import { NextResponse } from "next/server";
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
export async function GET() {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const today = currentBusinessDate();
  const rows = deadStock(today, 45);
  const showCosts = can(auth.user.role, "viewCosts");

  return NextResponse.json({
    asOf: today,
    days: 45,
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
