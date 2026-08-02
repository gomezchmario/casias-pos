import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listQuickButtons } from "@/lib/quick-buttons";
import { listPaymentMethods } from "@/lib/payments";
import { listEmployees } from "@/lib/employees";
import { getSetting } from "@/lib/settings";
import { currentBusinessDate } from "@/lib/business-date";

/** Everything the register screen needs to render, in one round trip. */
export async function GET() {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    quickButtons: listQuickButtons(),
    paymentMethods: listPaymentMethods(),
    mechanics: listEmployees().map((e) => ({ id: e.id, name: e.name })),
    businessDate: currentBusinessDate(),
    settings: {
      tipCommPerCents: Number(getSetting("tip_comm_per_cents")),
      tipCommChargeCents: Number(getSetting("tip_comm_charge_cents")),
      customerPromptThresholdCents: Number(getSetting("customer_prompt_threshold_cents")),
    },
  });
}
