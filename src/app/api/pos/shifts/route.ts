import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { currentShift, listShifts, openShift } from "@/lib/shifts";

export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const date = req.nextUrl.searchParams.get("date") || currentBusinessDate();
  return NextResponse.json({ current: currentShift(), shifts: listShifts(date) });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  let body: { openingFloatCents?: number };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = openShift(auth.user, { openingFloatCents: body.openingFloatCents ?? 0 });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ shift: result.shift });
}
