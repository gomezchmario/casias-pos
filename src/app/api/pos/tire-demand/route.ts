import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { demandReport, recordDemand, tireDemandEnabled } from "@/lib/tire-demand";
import { can } from "@/lib/roles";

/**
 * The study: what the shop was asked for and could not sell.
 *
 * Writing one needs `ringSale`, which is deliberately the lowest bar that makes
 * sense — the person who watched the customer leave is whoever was at the
 * counter, and routing this through a manager means it gets written down an
 * hour later by somebody who was told about it, or not at all.
 *
 * Reading the report needs `viewReports`. It is a buying decision, and the
 * numbers behind one are a manager's business.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  // Refused when the study is off rather than merely hidden. A client that kept
  // a stale copy of the switch would otherwise keep writing rows into a study
  // the shop has closed.
  if (!tireDemandEnabled())
    return jsonError("The tire study is not switched on");

  let body: { size?: string; qty?: number; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const done = recordDemand(auth.user, {
    size: body.size ?? "",
    qty: body.qty,
    note: body.note ?? null,
  });
  if (!done.ok) return jsonError(done.error);
  return NextResponse.json({ entry: done.entry });
}

export async function GET(req: NextRequest) {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const today = currentBusinessDate();
  /**
   * The window, defaulting to everything.
   *
   * A study is read to decide what to buy, and that decision is made against
   * however long the study has been running rather than against a calendar
   * month. Defaulting to this month would quietly answer a narrower question
   * than the one being asked, with nothing on screen to say so.
   */
  const from = sp.get("from") || "0000-01-01";
  const to = sp.get("to") || today;

  return NextResponse.json({
    enabled: tireDemandEnabled(),
    canRecord: can(auth.user.role, "ringSale"),
    today,
    ...demandReport(from, to),
  });
}
