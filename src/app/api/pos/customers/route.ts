import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { createCustomer, listVehicles, searchCustomers } from "@/lib/customers";

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
    creditApproved: c.credit_approved === 1,
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

/**
 * Add a person to the book directly — no ticket involved.
 *
 * `manageCustomers`, not `ringSale`: ringing a ticket and deciding the book
 * gains a row are different acts, and the second belongs to whoever keeps the
 * book — the accountant by name, managers by rank. The duplicate-phone refusal
 * lives in `createCustomer`, where it also protects any future caller.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("manageCustomers");
  if (!auth.ok) return auth.response;

  let body: { name?: string; phone?: string | null; notes?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.name?.trim()) return jsonError("A customer needs a name");

  const made = createCustomer(auth.user, {
    name: body.name,
    phone: body.phone ?? null,
    notes: body.notes ?? null,
  });
  if (!made.ok) return jsonError(made.error);

  return NextResponse.json({
    ok: true,
    customer: {
      id: made.customer.id,
      customerNo: made.customer.customer_no,
      name: made.customer.name,
      phone: made.customer.phone,
    },
  });
}
