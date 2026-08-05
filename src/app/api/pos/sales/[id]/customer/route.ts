import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { getSale } from "@/lib/sales";
import { attachToSale, type TicketDetails } from "@/lib/customers";

/**
 * Hang a customer and a vehicle off a ticket.
 *
 * ONE REQUEST FOR THE WHOLE BLOCK, deliberately. The obvious alternative is to
 * make the browser find-or-create a customer, then find-or-create a vehicle,
 * then PATCH the sale with the two ids — three calls, and the interesting
 * failure is the one in the middle: a customer created, a vehicle not, and a
 * sale still pointing at nobody. The cashier sees an error, retypes, and there
 * are now two of the same person in the book.
 *
 * Sending the raw text and letting the server work it out means the whole thing
 * is one transaction. It either all happened or none of it did, and the rules
 * for what a blank field means live in exactly one place.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editOwnOpenSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: TicketDetails;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = attachToSale(auth.user, saleId, body);
  if (!result.ok) return jsonError(result.error);

  return NextResponse.json({
    sale: getSale(saleId),
    customer: result.customer,
    vehicle: result.vehicle,
  });
}
