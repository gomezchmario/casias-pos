import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { dirSession, dirAddVehicle, type VehicleFields } from "@/lib/directory";

export async function POST(req: NextRequest) {
  const session = await dirSession();
  if (!session) return jsonError("Not signed in", 401);

  let body: VehicleFields & { ownerId?: number };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!Number.isInteger(body.ownerId)) return jsonError("Whose truck is it?");

  const res = dirAddVehicle(session, body.ownerId!, body);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ id: res.id });
}
