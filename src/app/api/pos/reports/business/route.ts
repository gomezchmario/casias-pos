import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { currentBusinessDate } from "@/lib/business-date";
import { techPeriod, tipsByTech } from "@/lib/leaderboard";
import {
  categoryMix,
  controlStats,
  customerStats,
  deadStock,
  employeePerformance,
  employeeSparks,
  headline,
  hourHeatmap,
  staffingNeed,
  lostDemand,
  productMovement,
  purchaseSummary,
  receivablesAging,
  reorderList,
  restockAdvice,
  revenueTrend,
  stockValue,
  tenderMix,
  weekdayProfile,
  type Grain,
} from "@/lib/reports-bi";

/**
 * Everything the reports page draws, in one response.
 *
 * ONE ROUND TRIP RATHER THAN FIFTEEN, because the page is read as a whole and a
 * dashboard that fills in section by section is a dashboard somebody scrolls
 * while it is still moving. The cost is a couple of dozen indexed reads against
 * a local file; the alternative costs fifteen HTTP round trips and a page that
 * cannot be printed until it has finished settling.
 *
 * Owner-only, and gated on its own capability rather than on `viewReports`.
 * That one already governs the day screen's figures, which a manager needs to
 * run a shift. This is margin, stock value, what each customer spends and who
 * gives the discounts — the shape of the business rather than the state of the
 * day.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewBusinessReports");
  if (!auth.ok) return auth.response;

  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const today = currentBusinessDate();

  /**
   * The window, defaulting to the last thirty days INCLUDING today.
   *
   * A month is the span an owner thinks in, and ending today rather than at the
   * end of last month means the page answers "how are we doing" rather than
   * "how did we do", which is the question somebody opens it with.
   */
  const to = sp.get("to") || today;
  const fromParam = sp.get("from");
  const from =
    fromParam ||
    (() => {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 29);
      return d.toISOString().slice(0, 10);
    })();

  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

  /**
   * How finely to slice the trend.
   *
   * Chosen from the span rather than asked for, because there is one right
   * answer and making somebody pick it is making them do arithmetic to read a
   * chart. Sixty days of daily bars is unreadable; six weeks of monthly bars is
   * two bars.
   */
  const grainParam = sp.get("grain");
  const grain: Grain =
    grainParam === "day" || grainParam === "week" || grainParam === "month"
      ? grainParam
      : days <= 45
        ? "day"
        : days <= 200
          ? "week"
          : "month";

  const products = productMovement(from, to);

  return NextResponse.json({
    from,
    to,
    days,
    grain,
    today,
    /**
     * The first day the shop has any record of, so the page can offer an
     * All time window without guessing at one. Sent rather than assumed
     * because the answer changed by two years the day the workbook was
     * imported, and it will change again the day anything else is.
     */
    firstDate:
      (
        db
          .prepare(
            "SELECT MIN(business_date) d FROM sales WHERE deleted = 0 AND kind = 'sale'",
          )
          .get() as { d: string | null }
      ).d ?? today,
    headline: headline(from, to),
    trend: revenueTrend(from, to, grain),
    categories: categoryMix(from, to),
    tenders: tenderMix(from, to),
    heatmap: hourHeatmap(from, to),
    weekdays: weekdayProfile(from, to),
    // Where the week's work actually falls, and what that means for cover.
    // Rides on this endpoint because it is built from the same heatmap the
    // line above it is — one pass over the tickets, two answers.
    staffing: staffingNeed(from, to),
    /**
     * The sellers, deepest first, cut at a hundred.
     *
     * Deeper than the dozen the page draws, because the page draws them ten at
     * a time and somebody hunting for a size they think should be there will
     * press for more. A hundred rows is a few kilobytes and saves a round trip
     * per press; six hundred would be carrying the whole catalogue to show ten
     * of it.
     */
    bestSellers: products.filter((p) => p.units > 0).slice(0, 100),
    stock: stockValue(),
    /*
      The tile and the table part company here on purpose. The table shows the
      worst fifteen; the TILE claims to say how much money is standing still,
      and it was quietly reading the sliced list — "15 sizes, $12,543" on a day
      the racks held 133 sleeping sizes. The totals are computed over the whole
      list before the cut.
    */
    deadTotal: (() => {
      const all = deadStock(to, 45);
      return { sizes: all.length, costCents: all.reduce((n, d) => n + d.costCents, 0) };
    })(),
    dead: deadStock(to, 45).slice(0, 15),
    reorder: reorderList(to).slice(0, 20),
    // Deliberately not windowed — it measures a rate, and a rate taken over the
    // seven days somebody happened to pick is noise. See `restockAdvice`.
    restock: restockAdvice(to).slice(0, 15),
    aging: receivablesAging(to),
    customers: customerStats(from, to),
    control: controlStats(from, to),
    lost: lostDemand(from, to),
    purchases: purchaseSummary(from, to),
    /**
     * The technicians over the SAME window as everything else on the page.
     *
     * Built from `techPeriod` and `tipsByTech` — the same two functions the
     * close-out's board is built from — rather than from `standings`, which
     * snaps to a calendar day, week or month. On a page whose whole promise is
     * that every figure covers the window at the top, a board that quietly
     * covered a different one would be the first thing to mislead somebody.
     */
    techs: (() => {
      const period = techPeriod(from, to);
      const tips = new Map(tipsByTech(from, to).map((t) => [t.employeeId, t.tipCents]));
      const total = period.reduce((n, t) => n + t.incomeCents, 0);
      return period.map((t) => ({
        ...t,
        tipCents: tips.get(t.employeeId) ?? 0,
        incomePct: total > 0 ? (t.incomeCents / total) * 100 : 0,
      }));
    })(),
    /**
     * The same people again, measured rather than listed.
     *
     * `techs` above is the board: who did what, over this window. This is the
     * appraisal — days present, money per day present, the same figures over
     * the window before, and a year of shape behind each name. They are drawn
     * as two sections because they answer two different questions, and the one
     * that compares has to carry the caveats the one that lists does not.
     */
    employees: employeePerformance(from, to),
    sparks: employeeSparks(to),
  });
}
