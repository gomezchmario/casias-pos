import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { dirLogin } from "@/lib/directory";

/**
 * A company signing into its own page.
 *
 * The only unauthenticated write in the application, which is why the throttle
 * and the identical-refusal rule both live inside `dirLogin` rather than here:
 * a route can be copied, and a guard that has to be remembered by whoever
 * copies it is a guard that eventually is not.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.pin) return jsonError("Type the code");

  const res = await dirLogin((await params).slug, body.pin);
  if (!res.ok) return jsonError(res.error, 401);
  return NextResponse.json({ name: res.name });
}
