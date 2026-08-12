import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { countOpeningFloat } from "@/lib/shifts";

/**
 * The morning count of the drawer.
 *
 * `closeShift` — the same people who count it at night count it in the
 * morning, and it is the same drawer. The library decides whether a RE-count
 * is allowed; see `countOpeningFloat`.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("closeShift");
  if (!auth.ok) return auth.response;

  let body: { countedCents?: number };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const done = countOpeningFloat(auth.user, Number(body.countedCents));
  if (!done.ok) return jsonError(done.error);
  return NextResponse.json({ ok: true, shift: done.shift });
}
