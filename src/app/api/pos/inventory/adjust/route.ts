import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { adjustStock, setCount, type MovementReason } from "@/lib/inventory";

const ADJUST_REASONS = ["adjust", "count", "damage", "opening"] as const;
type AdjustReason = (typeof ADJUST_REASONS)[number];

function isAdjustReason(v: unknown): v is AdjustReason {
  return typeof v === "string" && (ADJUST_REASONS as readonly string[]).includes(v);
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("adjustInventory");
  if (!auth.ok) return auth.response;

  let body: {
    productId?: number;
    qtyDelta?: number;
    countedQty?: number;
    reason?: MovementReason;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (!body.productId) return jsonError("Pick a product");

  // Two shapes on purpose. "Counted 6 on the rack" is what someone with a
  // clipboard actually has; "take 1 off, it was damaged" is what someone at the
  // counter has. Making the caller convert one into the other is where
  // off-by-one stock errors come from.
  if (body.countedQty !== undefined) {
    const result = setCount(auth.user, body.productId, body.countedQty, body.note ?? "");
    if (!result.ok) return jsonError(result.error);
    return NextResponse.json({ onHand: result.onHand });
  }

  if (!isAdjustReason(body.reason))
    return jsonError("Pick a reason: adjust, count, damage or opening");

  const result = adjustStock(auth.user, {
    productId: body.productId,
    qtyDelta: body.qtyDelta ?? 0,
    reason: body.reason,
    note: body.note ?? "",
  });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ onHand: result.onHand });
}
