import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { dirSession, dirAddDriver } from "@/lib/directory";

/**
 * A company adding one of its own drivers.
 *
 * The company comes from the session and is never read from the body — that
 * single rule is what keeps one company out of another's book, and it is
 * enforced in `dirAddDriver` where every write in the portal enforces it.
 */
export async function POST(req: NextRequest) {
  const session = await dirSession();
  if (!session) return jsonError("Not signed in", 401);

  let body: { name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const res = dirAddDriver(session, body);
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ id: res.id });
}
