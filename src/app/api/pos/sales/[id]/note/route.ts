import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { setPinnedNote } from "@/lib/sales";

/**
 * The note the counter pins to a ticket for whoever is on it next.
 *
 * Its own route rather than a field on the details PATCH, because it is a
 * different kind of thing with a different audience — see `setPinnedNote`. The
 * details note describes the job and prints on the customer's receipt; this one
 * never leaves the building, and anybody who can ring a ticket can write it.
 *
 * `ringSale` here and again in the library. The route's copy stops a request
 * from somebody who has no business on a ticket at all; the library's is what
 * holds if this is ever called from anywhere else.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!Number.isInteger(saleId)) return jsonError("Not found", 404);

  let body: { note?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (body.note === undefined) return jsonError("Nothing to change");

  const r = setPinnedNote(auth.user, saleId, body.note);
  if (!r.ok) return jsonError(r.error);
  return NextResponse.json({ sale: r.sale });
}
