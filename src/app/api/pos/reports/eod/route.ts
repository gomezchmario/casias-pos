import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { can } from "@/lib/roles";
import { dayTotals, seqReport } from "@/lib/pos-reports";
import {
  byCashier,
  currentShift,
  getShift,
  listShifts,
  reconcileDay,
  reconcileShift,
} from "@/lib/shifts";
import { getSetting } from "@/lib/settings";
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
    seq: seqReport(businessDate),
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
