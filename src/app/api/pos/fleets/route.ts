import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { listFleets, setFleet, setIsFleet } from "@/lib/fleets";

/**
 * The fleets, and who is billed to them.
 *
 * GET is behind `ringSale`, not `manageCreditAccounts`, on purpose: the picker
 * that puts a new driver under a company is used at the counter mid-ticket, and
 * a list of company NAMES is the least sensitive thing in the customer book. No
 * balances are returned here — those live behind the account routes.
 */
export async function GET() {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ fleets: listFleets() });
}

/**
 * Two different acts on one route, told apart by what is sent.
 *
 * `{ customerId, fleetId }` bills somebody to a company — `manageCustomers`,
 * the same permission as correcting any other detail about them, because that
 * is what it is: a fact about the customer that somebody at the counter learns
 * when the driver says who he works for.
 *
 * `{ customerId, isFleet }` makes a customer INTO a company, which is a credit
 * decision — the shop is agreeing to carry an account other people can spend
 * against — so it takes `manageCreditAccounts`. Enforced in the library, not
 * here, so the rule holds for every future caller.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  let body: { customerId?: number; fleetId?: number | null; isFleet?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.customerId) return jsonError("Which customer?");

  if (body.isFleet !== undefined) {
    const done = setIsFleet(auth.user, Number(body.customerId), body.isFleet === true);
    if (!done.ok) return jsonError(done.error);
    return NextResponse.json({ ok: true, customer: done.customer });
  }

  const done = setFleet(
    auth.user,
    Number(body.customerId),
    body.fleetId === null || body.fleetId === undefined ? null : Number(body.fleetId),
  );
  if (!done.ok) return jsonError(done.error);
  return NextResponse.json({ ok: true, customer: done.customer });
}
