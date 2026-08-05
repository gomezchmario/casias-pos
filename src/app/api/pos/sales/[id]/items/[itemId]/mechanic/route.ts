import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale, listSaleItems, reassignMechanic } from "@/lib/sales";

/**
 * Move one line to a different mechanic.
 *
 * Its own route rather than a `mechanicId`-only PATCH to the item, because the
 * two are guarded differently on purpose: editing an item can move the price
 * and is manager-only once the ticket is paid, while reassigning credit is a
 * cashier's job on any live ticket. Inferring which one was meant from which
 * keys happened to be present in the body would make that difference an
 * accident of the request rather than a decision, and the first time somebody
 * sent both it would silently pick the wrong rule.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const { id, itemId } = await params;
  const saleId = parseInt(id, 10);

  let body: { mechanicId?: number | null; mechanicName?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // Undefined and null mean different things here: null is "nobody did this",
  // which is a legitimate thing to set a line back to, so it must not be
  // treated as an omission.
  const mechanicId = body.mechanicId ?? null;
  if (mechanicId !== null && !Number.isInteger(mechanicId))
    return jsonError("That is not a valid mechanic");

  const result = reassignMechanic(
    auth.user,
    parseInt(itemId, 10),
    mechanicId,
    body.mechanicName ?? null,
  );
  if (!result.ok) return jsonError(result.error, 403);

  return NextResponse.json({ sale: getSale(saleId), items: listSaleItems(saleId) });
}
