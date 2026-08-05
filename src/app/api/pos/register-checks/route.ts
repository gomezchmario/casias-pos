import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import {
  deleteRegisterCheck,
  recordRegisterCheck,
  registerChecksForDay,
} from "@/lib/register-checks";

/** Every midday count taken on a business day, oldest first. */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const businessDate = req.nextUrl.searchParams.get("date") || currentBusinessDate();
  return NextResponse.json({ businessDate, checks: registerChecksForDay(businessDate) });
}

/**
 * Log a count.
 *
 * `closeShift`, the same capability as counting down at the end of the night,
 * because it is the same act — somebody counting the box they are working out
 * of. Always logged against today: a count is a statement about what is
 * physically in the drawer right now, and there is no such thing as taking one
 * for last Tuesday.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  let body: {
    counts?: { methodId: number; countedCents: number }[];
    note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  for (const c of body.counts ?? []) {
    if (!Number.isInteger(c.countedCents) || c.countedCents < 0)
      return jsonError("Counted amounts are not valid");
  }

  const result = recordRegisterCheck(auth.user, {
    counts: body.counts ?? [],
    note: body.note ?? null,
  });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ check: result.check });
}

/** Owner only. See the note on `deleteRegisterCheck`. */
export async function DELETE(req: NextRequest) {
  const auth = await requirePos("deleteRegisterCheck");
  if (!auth.ok) return auth.response;

  let body: { id?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!Number.isInteger(body.id)) return jsonError("Which log?");

  const result = deleteRegisterCheck(auth.user, body.id!, body.reason ?? "");
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ check: result.check });
}
