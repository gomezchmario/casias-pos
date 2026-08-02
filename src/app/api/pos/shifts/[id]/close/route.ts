import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { closeShift, getShift, reconcileShift } from "@/lib/shifts";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  const shiftId = parseInt((await params).id, 10);
  if (!getShift(shiftId)) return jsonError("Not found", 404);

  let body: { counts?: { methodId: number; countedCents: number }[]; note?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = closeShift(auth.user, shiftId, {
    counts: body.counts ?? [],
    note: body.note ?? null,
  });
  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({
    shift: result.shift,
    reconciliation: reconcileShift(shiftId),
  });
}
