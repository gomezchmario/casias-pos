import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import { can } from "@/lib/roles";
import {
  drawerAdjustmentCents,
  drawerMovementsForDay,
  recordDrawerMovement,
  reverseDrawerMovement,
} from "@/lib/drawer";

/** Every non-sale cash move for a business day, for the Close-out page. */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const businessDate = req.nextUrl.searchParams.get("date") || currentBusinessDate();
  // The owner sees what they hid; nobody else learns it exists. The net is
  // summed off the rows THIS response carries, not taken from
  // drawerAdjustmentCents — that figure now includes hidden movements, and a
  // list whose printed net disagrees with its own rows would hand a manager
  // the exact figure the flag exists to keep from them.
  const movements = drawerMovementsForDay(businessDate, {
    includeHidden: can(auth.user.role, "hideDrawerMovement"),
  });
  return NextResponse.json({
    businessDate,
    movements,
    netCents: movements.reduce((s, m) => s + m.amount_cents, 0),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("drawerCash");
  if (!auth.ok) return auth.response;

  let body: {
    amountCents?: number;
    kind?: "withdrawal" | "deposit";
    reason?: string;
    note?: string | null;
    reverseId?: number;
    hidden?: boolean;
    acknowledgeOverdraw?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.reverseId != null) {
    const undone = reverseDrawerMovement(auth.user, body.reverseId, body.reason ?? "");
    if (!undone.ok) return jsonError(undone.error);
    return NextResponse.json({ movement: undone.movement });
  }

  const result = recordDrawerMovement(auth.user, {
    amountCents: Number(body.amountCents),
    kind: body.kind ?? "withdrawal",
    reason: body.reason ?? "",
    note: body.note ?? null,
    // Refused inside recordDrawerMovement for anyone but the owner, so this
    // passing straight through is safe.
    hidden: body.hidden === true,
    acknowledgeOverdraw: body.acknowledgeOverdraw === true,
  });
  if (!result.ok)
    // The overdraw flag rides along so the screen can offer "record it anyway"
    // for exactly this refusal and no other.
    return NextResponse.json(
      { error: result.error, ...(result.overdraw ? { overdraw: true } : {}) },
      { status: 400 },
    );
  return NextResponse.json({ movement: result.movement });
}
