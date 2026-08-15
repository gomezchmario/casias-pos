import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import {
  costCoverage,
  fillProductCostsFromPrice,
  liveFromDate,
  productsMissingCost,
  serviceCosts,
  setServiceCost,
} from "@/lib/costs";

/**
 * What things cost the shop, and how much of the takings that accounts for.
 *
 * The Gross Margin panel reads "not enough cost data" whenever the answer would
 * be a fact about a fifth of the shop dressed as a fact about the shop. This is
 * the screen that fixes that, so it leads with the coverage figure — the number
 * being moved — rather than with the list of boxes that moves it.
 */
export async function GET() {
  const auth = await requirePos("manageSettings");
  if (!auth.ok) return auth.response;

  const today = currentBusinessDate();
  /*
    From the day this register started, not a rolling year.

    A year is mostly imported workbook, where no cost was ever recorded and the
    history assumption now covers everything — so a coverage figure over that
    window would sit near 100% and say nothing about the work of filling costs
    in. Measured from the first ticket this register rang, it answers the
    question the screen is for: how much of what we are doing NOW can be given
    a real cost.
  */
  const from = liveFromDate();

  return NextResponse.json({
    from,
    to: today,
    coverage: costCoverage(from, today),
    services: serviceCosts(30),
    productsMissing: productsMissingCost(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("manageSettings");
  if (!auth.ok) return auth.response;

  let body: {
    description?: string;
    costCents?: number | null;
    note?: string;
    /** Fill every listed tire's cost from its own selling price. */
    fillProducts?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // Checked before the service branch: a body carrying both would set a service
  // cost and silently ignore the thing that was actually pressed.
  if (body.fillProducts) {
    const done = fillProductCostsFromPrice(auth.user);
    if (!done.ok) return jsonError(done.error);
    const today = currentBusinessDate();
    return NextResponse.json({
      filled: done.filled ?? 0,
      from: liveFromDate(),
      to: today,
      coverage: costCoverage(liveFromDate(), today),
      services: serviceCosts(30),
      productsMissing: productsMissingCost(),
    });
  }

  if (!body.description) return jsonError("Which service?");

  const done = setServiceCost(
    auth.user,
    body.description,
    body.costCents === null || body.costCents === undefined ? null : Number(body.costCents),
    body.note,
  );
  if (!done.ok) return jsonError(done.error);

  const today = currentBusinessDate();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  // The new coverage comes back with the write, so the headline moves as each
  // box is filled in. That feedback is the only thing that makes a screen of
  // thirty boxes worth working through.
  return NextResponse.json({
    ok: true,
    coverage: costCoverage(d.toISOString().slice(0, 10), today),
  });
}
