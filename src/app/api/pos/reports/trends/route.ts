import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { shopTrends } from "@/lib/trends";

/**
 * Which way the shop is heading.
 *
 * NO PARAMETERS, and that is the point of the endpoint rather than an omission.
 * Every other report route takes a window; this one refuses to, because a
 * direction measured over whichever fortnight somebody picked is not a
 * direction. It always covers everything on record and tells the page how much
 * that is, so the page can say so.
 *
 * Behind `viewBusinessReports`, the same capability as the reports page it is
 * reached from — this is the shape of the business rather than the state of the
 * day, and a manager running a shift has no use for it.
 */
export async function GET() {
  const auth = await requirePos("viewBusinessReports");
  if (!auth.ok) return auth.response;

  return NextResponse.json(shopTrends(currentBusinessDate()));
}
