import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listQuickButtons } from "@/lib/quick-buttons";
import { listPaymentMethods } from "@/lib/payments";
import { getEmployeeState, listCounterStaff, listMechanics } from "@/lib/employees";
import { getSetting } from "@/lib/settings";
import { currentBusinessDate } from "@/lib/business-date";
import { getDb } from "@/lib/db";
import { USED_POOL_SKU } from "@/lib/tire-size";

/** Everything the register screen needs to render, in one round trip. */
export async function GET() {
  // The screen's furniture: shelf buttons, the service grid, the roster.
  // All of it a lookup.
  const auth = await requirePos("browseRegister");
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    quickButtons: listQuickButtons(),
    paymentMethods: listPaymentMethods(),
    // Only the floor. A line is credited to whoever did the work, and the
    // office staff never appear on one.
    /*
      Each technician's clock state, so the picker can show who is actually
      here. Read per person rather than joined: this is a handful of employees
      on a screen that already opens the database several times, and
      `getEmployeeState` is the one function that knows what "on break" means —
      duplicating that rule in a join here is how the two would come to
      disagree.
    */
    mechanics: listMechanics().map((e) => ({
      id: e.id,
      name: e.name,
      clock: getEmployeeState(e.id).state,
    })),
    /*
      The counter, sent apart from the floor rather than mixed into it.

      A tire is sold before it is fitted, and the person who sold it is on the
      other side of the counter from the person who fitted it. The register
      offers these names on the Inventory tab only — selling a tire is work
      somebody did, ringing a flat repair is not — so the split has to survive
      the trip to the browser. Merged here, the Services tab would have no way
      to tell them apart again.
    */
    counterStaff: listCounterStaff().map((e) => ({
      id: e.id,
      name: e.name,
      clock: getEmployeeState(e.id).state,
    })),
    businessDate: currentBusinessDate(),
    // The two category ids a product's condition maps onto, read rather than
    // hardcoded so the seed stays the single source of truth for them.
    tireCategories: Object.fromEntries(
      (
        getDb()
          .prepare("SELECT id, code FROM service_categories WHERE code IN ('new_tire','used_tire')")
          .all() as { id: number; code: string }[]
      ).map((c) => [c.code, c.id]),
    ) as { new_tire?: number; used_tire?: number },
    /*
      The general pool's row id, so the register can recognise a line already on
      the ticket as having come off the unsorted pile.

      The sku would do for a tire being picked — `USED_POOL_SKU` is imported
      straight into the browser for exactly that — but a line that has already
      been rung carries only `product_id`, and the note asking for the size has
      to survive the ticket being reopened later. Null until the shop opens a
      pool, which no line can match, which is correct.
    */
    usedPoolProductId:
      (
        getDb()
          .prepare("SELECT id FROM products WHERE sku = ? AND deleted = 0")
          .get(USED_POOL_SKU) as { id: number } | undefined
      )?.id ?? null,
    settings: {
      tipCommPerCents: Number(getSetting("tip_comm_per_cents")),
      tipCommChargeCents: Number(getSetting("tip_comm_charge_cents")),
      customerPromptThresholdCents: Number(getSetting("customer_prompt_threshold_cents")),
    },
  });
}
