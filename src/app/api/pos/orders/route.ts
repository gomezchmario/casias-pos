import { NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listSpecialOrders } from "@/lib/special-orders";

/**
 * The board. Everything on one response, because it is a short list by nature —
 * a shop with two hundred outstanding special orders has a problem no amount of
 * pagination will help with.
 */
export async function GET() {
  const auth = await requirePos("viewDay");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ orders: listSpecialOrders() });
}
