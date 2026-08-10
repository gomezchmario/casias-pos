import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale, listSaleItems, setMountMechanic } from "@/lib/sales";

/**
 * Name the technician who fitted an ordered tire.
 *
 * Its own route beside `mechanic` for the same reason that one sits apart from
 * a general item PATCH: these are two different facts about a line — who sold
 * it and who mounted it — and a body that carried both would leave the server
 * guessing which one a half-filled request meant.
 *
 * Guarded as `ringSale`, matching reassignment. Nothing here can move money:
 * the credit comes off one technician and lands on another, the customer is
 * charged exactly what they were charged before, and the cashier who watched
 * the tire go on is the person who knows the answer. Making them fetch a
 * manager is how the name stays wrong.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const { id, itemId } = await params;
  const saleId = parseInt(id, 10);

  let body: { mechanicId?: number | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const mechanicId = body.mechanicId ?? null;
  if (mechanicId !== null && !Number.isInteger(mechanicId))
    return jsonError("That is not a valid mechanic");

  const result = setMountMechanic(auth.user, parseInt(itemId, 10), mechanicId);
  if (!result.ok) return jsonError(result.error, 403);

  return NextResponse.json({ sale: getSale(saleId), items: listSaleItems(saleId) });
}
