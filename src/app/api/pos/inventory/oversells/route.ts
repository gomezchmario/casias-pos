import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { listOversells, reviewOversell } from "@/lib/inventory";

export async function GET(req: NextRequest) {
  const auth = await requirePos("adjustInventory");
  if (!auth.ok) return auth.response;

  const includeReviewed = req.nextUrl.searchParams.get("all") === "1";
  return NextResponse.json({ oversells: listOversells(includeReviewed) });
}

/**
 * Clear a flag. Deliberately does not touch stock — someone who decides the
 * count was wrong should write an adjustment saying so. "A human looked at
 * this" and "the number was corrected" are different facts, and collapsing them
 * would let a review quietly rewrite the books.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("adjustInventory");
  if (!auth.ok) return auth.response;

  let body: { movementId?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.movementId) return jsonError("Which one?");

  const result = reviewOversell(auth.user, body.movementId, body.note);
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ ok: true });
}
