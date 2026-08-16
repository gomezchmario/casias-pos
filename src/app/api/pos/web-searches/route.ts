import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { webSearchesBySize } from "@/lib/products";

/**
 * What the website has been asked for.
 *
 * `viewReports`, the same bar the counter's own study reads at: this is a
 * buying signal, and the numbers behind a buying decision are a manager's
 * business. Nothing here is about a person — the archive keeps no customer,
 * no address and no session, only the size somebody typed and what we said
 * back — so there is nothing to withhold from anyone allowed to read reports.
 *
 * The window is passed in and defaults to everything, because the archive is
 * young: asked to name a default span today it would answer for one week and
 * look empty. `from`/`to` are business dates, matching every other report.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams;
  const dated = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = dated(q.get("from")) ?? "0000-01-01";
  const to = dated(q.get("to")) ?? currentBusinessDate();

  const sizes = webSearchesBySize(from, to);
  return NextResponse.json({
    from,
    to,
    today: currentBusinessDate(),
    sizes,
    totals: {
      // Asks, not sizes: "people looked 40 times for 12 sizes" is two facts,
      // and the page prints both rather than making the reader add a column up.
      asks: sizes.reduce((n, s) => n + s.times, 0),
      sizes: sizes.length,
      // The three answers, kept apart. A size we HAD is not a buying signal,
      // and rolling them together would turn this page into a popularity list
      // that reads like a shopping list.
      yes: sizes.reduce((n, s) => n + s.yes, 0),
      no: sizes.reduce((n, s) => n + s.no, 0),
      incomplete: sizes.reduce((n, s) => n + s.incomplete, 0),
    },
  });
}
