import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { deleteEntry, restoreEntry, type EntryKind } from "@/lib/entry-deletions";

/**
 * Strike a dead row off the day's log, or put it back.
 *
 * Both on one route because they are the same decision seen from either side,
 * and because the button on the page is one button that changes its word. The
 * library refuses anything still carrying money — see `entry-deletions.ts` — so
 * this handler does no thinking of its own beyond reading the body.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePos("deleteEntry");
  if (!auth.ok) return auth.response;

  let body: { kind?: string; id?: number; reason?: string; restore?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.kind !== "line" && body.kind !== "money")
    return jsonError("Say whether it is a line or a payment");
  const kind = body.kind as EntryKind;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return jsonError("Which row?");

  if (body.restore) {
    const back = restoreEntry(auth.user, kind, id);
    if (!back.ok) return jsonError(back.error);
    return NextResponse.json({ ok: true, restored: back.restored });
  }

  const done = deleteEntry(auth.user, kind, id, body.reason ?? "");
  if (!done.ok) return jsonError(done.error);
  return NextResponse.json({ ok: true, struck: done.struck });
}
