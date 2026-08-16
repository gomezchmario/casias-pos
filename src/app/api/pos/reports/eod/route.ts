import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { can } from "@/lib/roles";
import {
  dayEntries,
  dayTotals,
  dayTrend,
  houseAccountChargesForDay,
  offRackLines,
  outstandingTickets,
  stockReceivedForDay,
  ticketEditsForDay,
  mechanicBaseline,
} from "@/lib/pos-reports";
import {
  byCashier,
  currentShift,
  getShift,
  listShifts,
  maskCashVariance,
  reconcileDay,
  reconcileShift,
} from "@/lib/shifts";
import { leaderboard } from "@/lib/leaderboard";
import { listLowStock } from "@/lib/products";
import {
  maskCashChecks,
  registerChecksForDay,
  registerChecksForShift,
} from "@/lib/register-checks";
import { getSetting } from "@/lib/settings";
import {
  drawerMovementsForDay,
  drawerMovementsForShift,
  hiddenDrawerCents,
} from "@/lib/drawer";
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

  const showsPurchases = can(user.role, "cashPurchase");
  // Only the person who can hide a movement is ever shown one.
  const seesHidden = can(user.role, "hideDrawerMovement");

  /**
   * Is the day being audited — has the owner taken cash out and kept it off the
   * sheet?
   *
   * Read from the ledger rather than passed in, so it cannot be got wrong by a
   * caller: the day either has a hidden movement in it or it does not.
   */
  const quietCents =
    "shiftId" in scope
      ? hiddenDrawerCents({ shiftId: scope.shiftId })
      : hiddenDrawerCents({ businessDate });
  const audited = quietCents !== 0;

  const raw =
    "shiftId" in scope
      ? reconcileShift(scope.shiftId, override)
      : reconcileDay(businessDate, override);

  /**
   * The floor is shown a cash line that balances — takings folded, variance
   * pinned; the owner is shown the truth. Masked on the SERVER rather than in
   * the page, so the real figure never reaches a browser that is not supposed
   * to have it. A number sent down and hidden in the markup is not hidden.
   */
  const reconciliation = audited && !seesHidden ? maskCashVariance(raw, quietCents) : raw;
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
     * Logs tab shows, printed on the back of the close-out.
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
    //
    // The owner's copy carries the hidden rows too — they are the only person
    // who can tell their own withdrawal apart from a genuine shortfall, and a
    // close-out that showed them a short they could not explain would be a
    // control aimed at the wrong person. Everyone else gets the day as the
    // floor is meant to see it.
    drawer:
      "shiftId" in scope
        ? drawerMovementsForShift(scope.shiftId, { includeHidden: seesHidden })
        : drawerMovementsForDay(businessDate, { includeHidden: seesHidden }),
    /**
     * What the owner has taken out of sight today, signed.
     *
     * Zero for everyone else, and zero is the honest answer for them: the
     * figure does not exist on their sheet, so there is nothing to reconcile
     * and nothing to wonder about. The close-out shows it to the owner beside
     * the count precisely because the count is short by it on purpose.
     */
    hiddenDrawerCents: seesHidden
      ? "shiftId" in scope
        ? hiddenDrawerCents({ shiftId: scope.shiftId })
        : hiddenDrawerCents({ businessDate })
      : 0,
    // Scoped like the count is: a check taken at noon is a fact about the
    // drawer the noon shift was working out of, and rolling every shift's
    // checks into a single-shift close-out would print counts the person
    // signing it never took.
    //
    // Masked for the floor on an audited day exactly as the count above is, and
    // this is the one that matters most: a midday check is where somebody sees
    // the drawer is over, and a surplus nobody can see is a surplus nobody
    // pockets.
    registerChecks: (() => {
      const checks =
        "shiftId" in scope
          ? registerChecksForShift(scope.shiftId)
          : registerChecksForDay(businessDate);
      return audited && !seesHidden ? maskCashChecks(checks) : checks;
    })(),
    /**
     * Money changed on a ticket that had already completed — see
     * `ticketEditsForDay`. On the sheet because a figure the day has already
     * counted moved after the fact, and the close-out is where that gets said.
     */
    edits: ticketEditsForDay(businessDate),
    /** Who went on account today, by name — see `houseAccountChargesForDay`. */
    houseAccount: houseAccountChargesForDay(businessDate),
    /**
     * What arrived on the van today — the other half of what left the racks.
     *
     * Whole-day rather than per-shift. A delivery is signed for once, by
     * whoever was at the door, and splitting it across the shifts that happened
     * to be on would let a twenty-tire drop vanish from both closes.
     */
    received: stockReceivedForDay(businessDate),
    /**
     * The week's board, moved here off the day screen.
     *
     * It belongs on the sheet that gets read sitting down rather than on the one
     * glanced at between customers: a week-to-date table with last week beside
     * it is a thing somebody studies, and on Main it pushed the day's own
     * numbers below the fold on the screen this is actually read on.
     *
     * Whole-week even when the scope is one shift, for the same reason the
     * charts are: a shift's slice of a week is not a series anybody can read.
     *
     * The dollar figures are blanked for anyone below owner exactly as they are
     * on the day screen — the share is everybody's business, the cents are close
     * to naming what somebody is paid, and this sheet gets left on a counter.
     */
    leaderboard: (() => {
      const board = leaderboard(businessDate);
      if (can(user.role, "viewTechIncomeCash")) return board;
      return {
        ...board,
        totalIncomeCents: 0,
        totalOtherIncomeCents: 0,
        techs: board.techs.map((t) => ({
          ...t,
          incomeCents: 0,
          otherIncomeCents: 0,
          prior: { ...t.prior, incomeCents: 0 },
        })),
      };
    })(),
    /** Whether the week table's dollars are real. See the gate above it. */
    canSeeTechIncomeCash: can(user.role, "viewTechIncomeCash"),
    canSeePurchases: showsPurchases,
    /**
     * What is at or below its reorder point, worst first.
     *
     * Deliberately NOT scoped to the day or the shift, like the debts above and
     * for the same reason: a size that ran out on Tuesday is still out on
     * Friday, and a close-out that only listed what emptied tonight would print
     * a clean sheet on the night an empty rack is at its most forgotten.
     *
     * On the close-out rather than only on the inventory sheet because of when
     * each is read. The inventory sheet is walked around the racks with a
     * clipboard, counting; what to reorder is decided afterwards, sitting down,
     * and this is the sheet somebody is sitting down with.
     */
    lowStock: listLowStock().map((p) => ({
      productId: p.id,
      name: p.name,
      onHand: p.on_hand,
      reorderPoint: p.reorder_point,
    })),
    /*
      What a normal day looks like for each technician, over the four weeks
      ending on this one.

      Four weeks because it is enough working days for one quiet Tuesday not to
      move somebody's average, and recent enough to still describe how they are
      working now. It ends ON the business date rather than the day before —
      today's own figures are taken back out where the comparison is drawn, so
      the window can be stated as a plain "the last four weeks" without having
      to explain an off-by-one to anybody reading the sheet.
    */
    mechanicBaseline: (() => {
      const start = new Date(`${businessDate}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 27);
      return mechanicBaseline(start.toISOString().slice(0, 10), businessDate);
    })(),
    shopName: getSetting("company_name") ?? "Casias Tire Shop",
  };
}

export async function GET(req: NextRequest) {
  const auth = await requirePos("viewCloseout");
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
