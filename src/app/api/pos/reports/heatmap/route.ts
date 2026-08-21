import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { hourHeatmap, weekdayProfile } from "@/lib/reports-bi";

/**
 * The when-is-the-shop-busy grid, by itself, for the manager's printout.
 *
 * The full business report is the owner's — margin, stock value, what each
 * customer spends — and the manager's end-of-day carried a hole where its
 * heatmap should be, apologising that the grid lives behind the owner's
 * door. But the grid is TICKET COUNTS: how many people, hour by hour. Not a
 * dollar on it, and the owner's instruction was plain — a manager arguing a
 * rota deserves the one page that settles it.
 *
 * So this hands out exactly the two shapes that section draws, stripped
 * field by field on the server — with ONE dollar figure kept, by the owner's
 * second ruling: the weekday rows keep `goodsCents`, because they are what
 * the "+72% on the last 3 Fridays" line and the against-a-typical-day table
 * are computed from, and the owner asked for those on the manager's copy in
 * as many words. The document already prints the day's own takings; a
 * 28-day same-weekday average beside it is the owner's call to make, and it
 * was made. Margin, stock value and the long run stay behind the owner's
 * report, where they were.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const today = currentBusinessDate();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to")! : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "")
    ? sp.get("from")!
    : (() => {
        const d = new Date(`${to}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 27);
        return d.toISOString().slice(0, 10);
      })();

  return NextResponse.json({
    heatmap: hourHeatmap(from, to).map((c) => ({
      weekday: c.weekday,
      hour: c.hour,
      tickets: c.tickets,
    })),
    weekdays: weekdayProfile(from, to).map((w) => ({
      weekday: w.weekday,
      days: w.days,
      tickets: w.tickets,
      goodsCents: w.goodsCents,
    })),
  });
}
