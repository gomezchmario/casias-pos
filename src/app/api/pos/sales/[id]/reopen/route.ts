import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { reopenSale } from "@/lib/sales";

/**
 * Put a finished ticket back into the open state so it can be added to.
 *
 * Guarded by `editCompletedSale` here and by `canEditCompleted` inside
 * `reopenSale` — the same manager-and-up rank that may change a paid ticket at
 * all, because this is that act with a wider opening.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editCompletedSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!Number.isInteger(saleId)) return jsonError("Which ticket?");

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const res = reopenSale(auth.user, saleId, body.reason ?? "");
  if (!res.ok) return jsonError(res.error);
  return NextResponse.json({ sale: res.sale });
}
