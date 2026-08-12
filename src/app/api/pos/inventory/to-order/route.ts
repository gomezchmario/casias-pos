import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { can } from "@/lib/roles";
import { reorderList, restockAdvice, tireQuantity } from "@/lib/reports-bi";

/**
 * What to buy — the other half of the racks, and the mirror of Standing still.
 *
 * That page answers "what is my money asleep in"; this one answers "what am I
 * about to run out of". They are the same decision from opposite ends and both
 * get carried to the racks on paper, which is why each has a full list rather
 * than the top fifteen a tile can show.
 *
 * TWO LISTS, NOT ONE, because they are found two different ways and a shop
 * that merges them stops trusting either:
 *
 *   AT THE REORDER POINT — a level somebody set on the tire, now breached. It
 *   is a promise the shop made to itself and the list is short and certain.
 *
 *   SELLING FASTER THAN IT IS STOCKED — worked out from the rate of sale
 *   whether or not anybody ever set a level. This is where the sizes nobody
 *   thought to watch turn up, and it is the list that grows the range back.
 *
 * Costs are stripped server-side without `viewCosts`, same as Standing still:
 * a manager can see what to order, the owner sees what ordering it costs.
 */
export async function GET() {
  const auth = await requirePos("viewReports");
  if (!auth.ok) return auth.response;

  const today = currentBusinessDate();
  const showCosts = can(auth.user.role, "viewCosts");
  const reorder = reorderList(today);
  const restock = restockAdvice(today);

  // A size on the reorder list does not need saying twice.
  const flagged = new Set(reorder.map((r) => r.productId));

  return NextResponse.json({
    asOf: today,
    showCosts,
    reorder: reorder.map((r) => ({
      ...r,
      // How many to buy, rounded to how tires are actually sold — never three.
      suggested: tireQuantity(Math.max(1, r.reorderPoint - r.onHand)),
    })),
    restock: restock.filter((r) => !flagged.has(r.productId)),
  });
}
