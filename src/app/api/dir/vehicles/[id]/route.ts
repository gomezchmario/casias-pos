import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { dirSession, dirUpdateVehicle, type VehicleFields } from "@/lib/directory";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await dirSession();
  if (!session) return jsonError("Not signed in", 401);

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which vehicle?");

  let body: VehicleFields;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const res = dirUpdateVehicle(session, id, body);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ok: true });
}
