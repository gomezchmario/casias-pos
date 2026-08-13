import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { clockOut, hoursForDay } from "@/lib/hours";

/**
 * Hours worked, and the way to close the ones nobody closed.
 *
 * `closeShift` both ways: the person closing the day is who knows who has gone
 * home, and hours are what the close-out is now able to state rather than
 * guess. See `clockOut` for why this is deliberately not self-service.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewCloseout");
  if (!auth.ok) return auth.response;
  const asked = req.nextUrl.searchParams.get("date");
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : currentBusinessDate();
  return NextResponse.json(hoursForDay(date));
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  let body: { employeeId?: number; at?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.employeeId) return jsonError("Who is clocking out?");

  const done = clockOut(auth.user, Number(body.employeeId), body.at ?? "");
  if (!done.ok) return jsonError(done.error);
  return NextResponse.json({ ok: true, ...hoursForDay(currentBusinessDate()) });
}
