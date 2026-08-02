import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { nextSeq } from "@/lib/payments";

/**
 * Fetched fresh when a payment panel opens rather than bundled into the
 * register's initial load — the number moves with every card sale, and a stale
 * one is worse than none.
 */
export async function GET() {
  const auth = await requirePos("takePayment");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ nextSeq: nextSeq() });
}
