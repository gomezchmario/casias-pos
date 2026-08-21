import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { techDetail } from "@/lib/reports-suite";
import type { Grain } from "@/lib/reports-bi";

/**
 * One technician, up close — the drill-down behind a name on the crew board.
 *
 * Its own route rather than a slice of `business`, because it is asked for one
 * name at a time: shipping every technician's full history to everybody who
 * opens the crew page would be carrying eighteen reports to show one.
 *
 * Same capability as the rest of the suite. What one technician brought in is
 * exactly the figure the business report already prints per row — this is the
 * same number sliced finer, not a new secret.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewBusinessReports");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const id = Number(sp.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Which technician?" }, { status: 400 });
  }

  const today = currentBusinessDate();
  const to = sp.get("to") || today;
  const fromParam = sp.get("from");
  const from =
    fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? fromParam
      : (() => {
          const d = new Date(`${to}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - 29);
          return d.toISOString().slice(0, 10);
        })();

  // The same span-to-grain rule the business route uses, so the drill-down's
  // buckets line up with the page it opened from.
  const days =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const grain: Grain = days <= 45 ? "day" : days <= 200 ? "week" : "month";

  return NextResponse.json({ from, to, grain, detail: techDetail(id, from, to, grain) });
}
