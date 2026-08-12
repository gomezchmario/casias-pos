import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { fleetReport } from "@/lib/fleets";
import { getSetting } from "@/lib/settings";

/**
 * One fleet's statement — the sheet that gets sent to the company.
 *
 * `manageCreditAccounts`, matching the month statement: this is what a customer
 * owes over a period, which is the accountant's book and the owner's, and not
 * the counter's.
 *
 * The window defaults to the month we are in, because that is the invoice
 * period — but it takes any `from`/`to`, since the question "what has this
 * company run up since we last sent them a bill" rarely lands on a month
 * boundary.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePos("manageCreditAccounts");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const today = currentBusinessDate();
  const sp = req.nextUrl.searchParams;
  const month = sp.get("month");
  let from = sp.get("from") ?? "";
  let to = sp.get("to") ?? "";

  if (/^\d{4}-\d{2}$/.test(month ?? "")) {
    from = `${month}-01`;
    // Day zero of the next month is the last day of this one.
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    to = d.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = `${today.slice(0, 7)}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;

  const report = fleetReport(Number(id), from, to);
  if (!report) return NextResponse.json({ error: "No such fleet" }, { status: 404 });

  return NextResponse.json({
    ...report,
    today,
    shopName: getSetting("company_name") ?? "Casias Tire Shop",
  });
}
