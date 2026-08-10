import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { tireMonth } from "@/lib/pos-reports";

/**
 * The month's new tires — sold, received, or hauled away as disposals.
 *
 * `viewReports` for all three. The sold side is takings, the received side is
 * what the shop paid a supplier — the one figure the capability exists to keep
 * off the counter — and the disposal side rides along: it is only fees, but it
 * prints from the same sheet and splitting the gate would mean two buttons on
 * one row behaving differently for the same person.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const month = sp.get("month") ?? "";
  const kindParam = sp.get("kind");
  const kind =
    kindParam === "received" ? "received" : kindParam === "disposal" ? "disposal" : "sold";

  if (!/^\d{4}-\d{2}$/.test(month)) return jsonError("Give a month as YYYY-MM");

  return NextResponse.json(tireMonth(month, kind));
}
