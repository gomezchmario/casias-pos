import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { dirSession, dirUpdateDriver } from "@/lib/directory";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await dirSession();
  if (!session) return jsonError("Not signed in", 401);

  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return jsonError("Which driver?");

  let body: { name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  // Whether this driver is theirs is decided in the library, against the
  // session — an id in the path is a claim, not a permission.
  const res = dirUpdateDriver(session, id, body);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ ok: true });
}
