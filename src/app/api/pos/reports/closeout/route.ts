import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { closeoutV2 } from "@/lib/day-report";

/**
 * Close-out V2 — the whole day, read rather than worked.
 *
 * `viewBusinessReports`: the owner by rank, and anyone the owner has handed the
 * reports grant to by name. Deliberately NOT `closeShift` — the original
 * close-out is a procedure the floor performs, while this is the day's books
 * being read, and the two audiences are different people. Nothing here writes;
 * the tab is view-only by construction, not by discipline.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewBusinessReports");
  if (!auth.ok) return auth.response;

  const asked = req.nextUrl.searchParams.get("date");
  const date =
    asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : currentBusinessDate();

  return NextResponse.json({ ...closeoutV2(date), today: currentBusinessDate() });
}
