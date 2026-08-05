import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listVehicles, searchCustomers } from "@/lib/customers";

/**
 * Look somebody up from the counter.
 *
 * Each hit comes back with its vehicles already attached rather than behind a
 * second request. A customer is almost never the thing being looked for — the
 * car is — and the cashier is picking from the list precisely so they do not
 * have to retype a plate. Two round trips to fill in one row would put a visible
 * stall between choosing a name and seeing the truck.
 *
 * `ringSale`, not `viewInventory`: this returns names and phone numbers, which
 * is the only customer data the shop holds, and a technician's login does not
 * need it.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const customers = searchCustomers(q).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    vehicles: listVehicles(c.id).map((v) => ({
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      color: v.color,
      plate: v.plate,
    })),
  }));

  return NextResponse.json({ customers });
}
