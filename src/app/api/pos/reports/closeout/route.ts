import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { closeoutV2 } from "@/lib/day-report";

/**
 * Close-out V2 — the whole day, read rather than worked.
 *
 * `closeShift` since V3 became the working close-out: whoever closes the day
 * needs this payload, which is everybody at the counter. Known and deferred by
 * the owner's instruction: the payload still carries owner-grade figures
 * (margin above all) to every caller — the page keeps them off the floor's
 * PRINTOUT, but the JSON does not discriminate yet. On the fix-later list.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewCloseout");
  if (!auth.ok) return auth.response;

  const asked = req.nextUrl.searchParams.get("date");
  const date =
    asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : currentBusinessDate();

  return NextResponse.json({ ...closeoutV2(date), today: currentBusinessDate() });
}
