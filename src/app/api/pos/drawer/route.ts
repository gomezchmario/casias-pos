import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";
import {
  drawerAdjustmentCents,
  drawerMovementsForDay,
  recordDrawerMovement,
  reverseDrawerMovement,
} from "@/lib/drawer";

/** Every non-sale cash move for a business day, for the End of Day page. */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;

  const businessDate = req.nextUrl.searchParams.get("date") || currentBusinessDate();
  return NextResponse.json({
    businessDate,
    movements: drawerMovementsForDay(businessDate),
    netCents: drawerAdjustmentCents({ businessDate }),
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
  });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ movement: result.movement });
}
