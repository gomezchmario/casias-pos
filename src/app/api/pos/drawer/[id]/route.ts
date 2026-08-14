import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { deleteDrawerMovement, renameDrawerMovement } from "@/lib/drawer";

/**
 * Correct the words on a cash in/out row.
 *
 * Only the reason. The amount is not editable through here on purpose: money
 * that moved and then quietly became a different amount is exactly what the
 * append-only ledger exists to prevent, and undoing a real movement has its own
 * path in `reverseDrawerMovement`, which leaves both halves on the day.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editDrawerMovement");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which row?");

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const res = renameDrawerMovement(auth.user, id, body.reason ?? "");
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ movement: res.movement });
}

/**
 * Take a row off the day entirely — for cash that never moved.
 *
 * The ordinary undo is a reversal, which keeps the money going out and coming
 * back where anybody can see both. This is for a test entry or a double-tap,
 * where a reversal would leave two lines describing something that did not
 * happen. `deleteDrawerMovement` writes the amount and reason into the audit
 * log first, so the day can still be asked what came off it.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editDrawerMovement");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which row?");

  const res = deleteDrawerMovement(auth.user, id);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ok: true, removed: res.removed });
}
