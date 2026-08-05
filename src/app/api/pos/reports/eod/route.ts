import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { can } from "@/lib/roles";
import {
  dayEntries,
  dayTotals,
  dayTrend,
  offRackLines,
  outstandingTickets,
} from "@/lib/pos-reports";
import {
  byCashier,
  currentShift,
  getShift,
  listShifts,
  reconcileDay,
  reconcileShift,
} from "@/lib/shifts";
import { registerChecksForDay, registerChecksForShift } from "@/lib/register-checks";
import { getSetting } from "@/lib/settings";
import { drawerMovementsForDay, drawerMovementsForShift } from "@/lib/drawer";
import type { PosUser } from "@/lib/pos-session";

/**
 * The end-of-day (or end-of-shift) close.
 *
 * Scope is either a whole business date or a single shift; the shape of the
 * response is identical either way so the page renders one report, not two.
 */
function build(
  user: PosUser,
  scope: { shiftId: number } | { businessDate: string },
  override?: Map<number, number>,
) {
  const shift = "shiftId" in scope ? getShift(scope.shiftId) : null;
  const businessDate = shift ? shift.business_date : (scope as { businessDate: string }).businessDate;

  const reconciliation =
    "shiftId" in scope
      ? reconcileShift(scope.shiftId, override)
      : reconcileDay(businessDate, override);

  const showsPurchases = can(user.role, "cashPurchase");
  const totals = dayTotals(businessDate);

  return {
    scope: "shiftId" in scope ? ("shift" as const) : ("day" as const),
    businessDate,
    // The real today, not the day being looked at. The page needs both: a
    // register log is a count of what is in the drawer right now, so the button
    // that takes one must not be offered while somebody is reading back
    // Tuesday's sheet.
    today: currentBusinessDate(),
    shift,
    shifts: listShifts(businessDate),
    currentShift: currentShift(),
    reconciliation,
    byCashier: byCashier(scope),
    // Only meaningful for a whole day; a shift's slice of the sale headers is
    // not well defined, because a ticket can be rung in one shift and paid in
    // the next. The page labels it accordingly.
    dayTotals: showsPurchases
      ? totals
      : { ...totals, purchasesCents: 0, purchaseCount: 0 },
    // Whole-day rather than per-shift: a price typed over
    // at the counter is a fact about the ticket, not about whose shift was on
    // when the money was taken, and splitting it by shift would let a line
    // vanish from both closes.
    offRack: offRackLines(businessDate),
    /**
     * Every ticket still owing money, on every date — the same list the day
     * screen leads with, and deliberately not filtered to this business date.
     *
     * A debt is not a fact about the day it was rung. Scoping this to tonight
     * would print a clean sheet on the night a three-week-old balance is at its
     * most forgotten, which is the opposite of what a close-out is for. The
     * whole point of putting it on paper is that the sheet gets filed and read
     * again, and the same names appearing on Monday, Tuesday and Wednesday's
     * sheets is how somebody finally picks up the phone.
     */
    outstanding: outstandingTickets(),
    /**
     * This day and the six before it, for the two small charts.
     *
     * Whole-day even when the scope is one shift. A shift's share of a week is
     * not a series anybody can read — shifts are not the same length, there are
     * not the same number of them each day, and a bar chart implies the bars
     * are comparable. Days are comparable. The chart is labelled as the day.
     */
    trend: dayTrend(businessDate, 6),
    /**
     * Everything rung today, in the order it happened — the same list the
     * Entries tab shows, printed on the back of the close-out.
     *
     * Sent whole rather than pre-split into tires and the rest. Which rows go
     * in which block is a decision about how the page reads, and a page is the
     * client's business; the server's job here is to say what happened.
     */
    entries: dayEntries(businessDate).filter(
      (e) => showsPurchases || e.ticketKind !== "purchase",
    ),
    // Scoped exactly like the count is, because these are the rows that explain
    // the drawer being light. Deliberately NOT folded into dayTotals -- moving
    // cash to the safe is not takings and must not read like it is.
    drawer:
      "shiftId" in scope
        ? drawerMovementsForShift(scope.shiftId)
        : drawerMovementsForDay(businessDate),
    // Scoped like the count is: a check taken at noon is a fact about the
    // drawer the noon shift was working out of, and rolling every shift's
    // checks into a single-shift close-out would print counts the person
    // signing it never took.
    registerChecks:
      "shiftId" in scope
        ? registerChecksForShift(scope.shiftId)
        : registerChecksForDay(businessDate),
    canSeePurchases: showsPurchases,
    shopName: getSetting("company_name") ?? "Casias Tire Shop",
  };
}

export async function GET(req: NextRequest) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  const shiftIdRaw = req.nextUrl.searchParams.get("shiftId");
  const date = req.nextUrl.searchParams.get("date") || currentBusinessDate();

  if (shiftIdRaw) {
    const shiftId = parseInt(shiftIdRaw, 10);
    if (!getShift(shiftId)) return jsonError("Not found", 404);
    return NextResponse.json(build(auth.user, { shiftId }));
  }
  return NextResponse.json(build(auth.user, { businessDate: date }));
}

/**
 * Try a set of counts without committing them. This is what makes the
 * mis-tendered-sale check usable: the cashier types what is actually in the
 * drawer, sees whether cash and card offset each other, and fixes the ticket
 * before anything is signed off.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  let body: {
    shiftId?: number | null;
    date?: string;
    counts?: { methodId: number; countedCents: number }[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const override = new Map<number, number>();
  for (const c of body.counts ?? []) {
    if (!Number.isInteger(c.countedCents) || c.countedCents < 0)
      return jsonError("Counted amounts are not valid");
    override.set(c.methodId, c.countedCents);
  }

  if (body.shiftId) {
    if (!getShift(body.shiftId)) return jsonError("Not found", 404);
    return NextResponse.json(build(auth.user, { shiftId: body.shiftId }, override));
  }
  return NextResponse.json(
    build(auth.user, { businessDate: body.date || currentBusinessDate() }, override),
  );
}
