import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { createVehicle } from "@/lib/customers";

/**
 * Put a car on this customer.
 *
 * Hangs off the customer rather than sitting at /api/pos/vehicles, because a
 * vehicle with no owner is not a thing this shop can do anything with — see the
 * same rule in `attachToSale`. The owner is in the path, so it cannot be
 * omitted or guessed from a body somebody forgot to fill in.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageCustomers");
  if (!auth.ok) return auth.response;

  const customerId = parseInt((await params).id, 10);
  if (!Number.isInteger(customerId)) return jsonError("Which customer?");

  let body: {
    year?: string | null;
    make?: string | null;
    model?: string | null;
    color?: string | null;
    plate?: string | null;
    vin?: string | null;
    tireSize?: string | null;
    notes?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const res = createVehicle(auth.user, customerId, {
    year: body.year,
    make: body.make,
    model: body.model,
    color: body.color,
    plate: body.plate,
    vin: body.vin,
    tire_size: body.tireSize,
    notes: body.notes,
  });
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ vehicle: res.vehicle });
}
