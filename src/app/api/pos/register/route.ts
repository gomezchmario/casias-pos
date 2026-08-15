import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listQuickButtons } from "@/lib/quick-buttons";
import { listPaymentMethods } from "@/lib/payments";
import { getEmployeeState, listMechanics } from "@/lib/employees";
import { getSetting } from "@/lib/settings";
import { currentBusinessDate } from "@/lib/business-date";
import { getDb } from "@/lib/db";

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
    settings: {
      tipCommPerCents: Number(getSetting("tip_comm_per_cents")),
      tipCommChargeCents: Number(getSetting("tip_comm_charge_cents")),
      customerPromptThresholdCents: Number(getSetting("customer_prompt_threshold_cents")),
    },
  });
}
