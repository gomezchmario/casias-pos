import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { setDirPin, clearDirPin, revokeDirSessions } from "@/lib/directory";

/** Set this company's code. Replacing one also signs out everybody using it. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageDirectory");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which company?");

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.pin) return jsonError("No code given");

  const res = setDirPin(auth.user, id, body.pin);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ slug: res.slug });
}

/** Close the page. The address survives; nothing behind it opens. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageDirectory");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which company?");

  const res = clearDirPin(auth.user, id);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ok: true });
}

/**
 * Sign the company out everywhere without changing its code.
 *
 * Separate from replacing the code because the two answer different worries.
 * "Somebody left the office computer signed in" wants this; "the code got out"
 * wants a new code, which does this as well.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("manageDirectory");
  if (!auth.ok) return auth.response;

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which company?");

  const res = revokeDirSessions(auth.user, id);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ended: res.ended });
}
