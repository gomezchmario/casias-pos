import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { techPeriod, tipsByTech } from "@/lib/leaderboard";
import {
  categoryMix,
  controlStats,
  customerStats,
  deadStock,
  headline,
  hourHeatmap,
  lostDemand,
  productMovement,
  purchaseSummary,
  receivablesAging,
  reorderList,
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
    headline: headline(from, to),
    trend: revenueTrend(from, to, grain),
    categories: categoryMix(from, to),
    tenders: tenderMix(from, to),
    heatmap: hourHeatmap(from, to),
    weekdays: weekdayProfile(from, to),
    // Both ends of one ranked list. Sent already cut so the page does not have
    // to know the rule, and so the payload does not carry six hundred products
    // to draw twenty of them.
    bestSellers: products.filter((p) => p.units > 0).slice(0, 12),
    stock: stockValue(),
    dead: deadStock(to, 45).slice(0, 15),
    reorder: reorderList(to).slice(0, 20),
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
  });
}
