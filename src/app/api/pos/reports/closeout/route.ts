import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { closeoutV2, exceptionsFor } from "@/lib/day-report";
import { hiddenDrawerCents } from "@/lib/drawer";
import { can } from "@/lib/roles";

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

  /*
    The floor's copy hides the owner's cash-out INSIDE the customers line.

    Expected already carries every movement, hidden or not — that is what lets
    an honest count balance after the owner takes money off the sheet. But the
    close-out prints the arithmetic behind Expected, and arithmetic keeps no
    secrets: a "moved in / out" line that carried the hidden net would print
    the one figure the flag exists to withhold, and a line that did not would
    leave rows that no longer sum. The owner's chosen hiding place is the
    "Cash from customers" figure — the quiet amount is deducted there, without
    a word, and the floor's sheet adds up perfectly at every line. The owner's
    own copy stays literal: real takings, the full net, and the hidden rows
    with their reasons.

    The daily report is the other way around on purpose — the owner's copy
    there SAYS what was taken off the sheet, in the open. One document for the
    floor that never mentions it, one for the owner that always does.
  */
  const ownerEyes = can(auth.user.role, "hideDrawerMovement");
  const quietCents = ownerEyes ? 0 : hiddenDrawerCents({ businessDate: date });
  return NextResponse.json({
    ...report,
    exceptions: exceptionsFor(report.exceptions, auth.user.role),
    // Collected is folded for the same reason the customers line is, and it
    // has to be the same fold: the day's figures sit on the sheet a few
    // centimetres under the drawer arithmetic, so a Collected that still
    // carried the quiet money would sit beside a customers line that did not,
    // and the gap between the two would be the withdrawal, printed twice over.
    totals: { ...report.totals, collectedCents: report.totals.collectedCents + quietCents },
    drawer: {
      ...report.drawer,
      cashSalesCents: report.drawer.cashSalesCents + quietCents,
      movementsCents: report.drawer.movementsCents - quietCents,
      movements: ownerEyes
        ? report.drawer.movements
        : report.drawer.movements.filter((m) => m.hidden === 0),
    },
    today: currentBusinessDate(),
  });
}
