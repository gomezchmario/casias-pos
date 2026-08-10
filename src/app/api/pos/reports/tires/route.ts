import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { tireMonth } from "@/lib/pos-reports";

/**
 * The month's new tires, sold or received.
 *
 * `viewReports` for both. The sold side is takings and the received side is
 * what the shop paid a supplier — the one figure the capability exists to keep
 * off the counter.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const month = sp.get("month") ?? "";
  const kind = sp.get("kind") === "received" ? "received" : "sold";

  if (!/^\d{4}-\d{2}$/.test(month)) return jsonError("Give a month as YYYY-MM");

  return NextResponse.json(tireMonth(month, kind));
}
