import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  customerTickets,
  deleteCustomer,
  getCustomer,
  listVehicles,
  setCreditApproved,
  setCustomerNote,
  updateCustomer,
} from "@/lib/customers";

/** One customer: who they are, what they drive, and everything they have had done. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("viewLog");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  const customer = getCustomer(id);
  if (!customer) return jsonError("Customer not found", 404);

  // Narrowed to the house account when the list is, so a customer opened from
  // that filter cannot show a history with nothing on the account in it.
  const creditOnly = req.nextUrl.searchParams.get("credit") === "1";

  return NextResponse.json({
    customer: {
      id: customer.id,
      customerNo: customer.customer_no,
      name: customer.name,
      phone: customer.phone,
      notes: customer.notes,
      pinnedNote: customer.pinned_note,
      pinnedNoteBy: customer.pinned_note_by,
      pinnedNoteAt: customer.pinned_note_at,
      creditApproved: customer.credit_approved === 1,
      since: customer.created_at,
    },
    vehicles: listVehicles(id).map((v) => ({
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      color: v.color,
      plate: v.plate,
      tireSize: v.tire_size,
      notes: v.notes,
    })),
    tickets: customerTickets(id, { creditOnly }),
    creditOnly,
  });
}

/**
 * Correct the person, or write the note.
 *
 * Two different permissions on one route, decided by what is in the body: the
 * note is writable by anyone who can open the book, the details are a manager's
 * correction. Split by field rather than by route because they are edited from
 * the same panel and a caller should not have to know which of two URLs a given
 * box belongs to.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("viewLog");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  let body: {
    name?: string;
    phone?: string | null;
    notes?: string | null;
    pinnedNote?: string | null;
    creditApproved?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.creditApproved !== undefined) {
    const res = setCreditApproved(auth.user, id, body.creditApproved);
    if (!res.ok) return jsonError(res.error);
  }

  if (body.pinnedNote !== undefined) {
    const res = setCustomerNote(auth.user, id, body.pinnedNote);
    if (!res.ok) return jsonError(res.error);
  }

  if (body.name !== undefined || body.phone !== undefined || body.notes !== undefined) {
    const res = updateCustomer(auth.user, id, {
      name: body.name,
      phone: body.phone,
      notes: body.notes,
    });
    if (!res.ok) return jsonError(res.error);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("deleteCustomer");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  const res = deleteCustomer(auth.user, id, reason);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ok: true });
}
