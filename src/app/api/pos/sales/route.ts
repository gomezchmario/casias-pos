import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import { createSale, listOpenSales, listSalesForDate } from "@/lib/sales";
import { currentBusinessDate } from "@/lib/business-date";

export async function GET(req: NextRequest) {
  // Reading the open tickets, not creating one — so the read-only account may
  // ask. POST below still demands ringSale, which is what actually keeps a
  // viewer from putting a ticket in the ledger.
  const auth = await requirePos("browseRegister");
  if (!auth.ok) return auth.response;

  const scope = req.nextUrl.searchParams.get("scope") ?? "open";
  if (scope === "open") return NextResponse.json({ sales: listOpenSales() });

  const date = req.nextUrl.searchParams.get("date") || currentBusinessDate();
  return NextResponse.json({ sales: listSalesForDate(date), businessDate: date });
}

export async function POST(req: NextRequest) {
  const auth = await requirePos("ringSale");
  if (!auth.ok) return auth.response;

  let body: {
    isSpecialOrder?: boolean;
    customerId?: number | null;
    kind?: "sale" | "purchase";
  } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is the common case — ring a plain ticket.
  }

  // createSale gates 'purchase' on the manager capability itself, so a
  // cashier's ringSale permission cannot be used to open one.
  const result = createSale(auth.user, {
    isSpecialOrder: body.isSpecialOrder === true,
    customerId: body.customerId ?? null,
    kind: body.kind === "purchase" ? "purchase" : "sale",
  });
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json({ sale: result.sale });
}
