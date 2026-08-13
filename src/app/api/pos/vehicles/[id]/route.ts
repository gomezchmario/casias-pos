import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { deleteVehicle, updateVehicle } from "@/lib/customers";

/**
 * A customer's car, corrected or removed.
 *
 * Both are `manageCustomers` — manager. A car is a correction and a car
 * genuinely leaves, and the person told about either is standing at the
 * counter. Removing the OWNER is a different decision and lives on the customer
 * route at owner level.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageCustomers");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
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

  const res = updateVehicle(auth.user, id, {
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageCustomers");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  const res = deleteVehicle(auth.user, id, reason);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ok: true });
}
