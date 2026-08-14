import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { closeoutV2, exceptionsFor } from "@/lib/day-report";

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

  /*
    Owner-only alarms are removed HERE rather than on the page, because the
    page is not where the secret is kept. A screen that declined to draw the
    row would still have been handed its text, and the text is the whole of
    what is being withheld — see Exception.ownerOnly.
  */
  const report = closeoutV2(date);
  return NextResponse.json({
    ...report,
    exceptions: exceptionsFor(report.exceptions, auth.user.role),
    today: currentBusinessDate(),
  });
}
