import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { listCustomers } from "@/lib/customers";

/**
 * The customer book, for browsing rather than for picking.
 *
 * Its own route beside `/api/pos/customers`, which answers the register's
 * type-ahead: that one is capped at eight, needs two characters and puts phone
 * matches first, all of which are right mid-ticket and wrong for a directory
 * where an empty query means "show me everybody".
 *
 * `viewLog` rather than a capability of its own. This is the same class of
 * screen as the day's ledger — the shop's own records, laid out to be read —
 * and a cashier who can be asked "when was this man last in" needs to be able
 * to answer it.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("viewLog");
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const rows = listCustomers({
    q: sp.get("q") || undefined,
    owing: sp.get("owing") === "1",
    credit: sp.get("credit") === "1",
    notApproved: sp.get("notApproved") === "1",
    companies: sp.get("companies") === "1",
    limit: 500,
  });

  return NextResponse.json({
    customers: rows.map((c) => ({
      id: c.id,
      customerNo: c.customer_no,
      name: c.name,
      phone: c.phone,
      vehicles: c.vehicles,
      tickets: c.tickets,
      spentCents: c.spentCents,
      owedCents: c.owedCents,
      creditTickets: c.creditTickets,
      accountBalanceCents: c.accountBalanceCents,
      lastVisit: c.lastVisit,
      // Only whether there is one. The text is a sentence and the list is a
      // column of names — it belongs on the panel that has room to read it.
      hasNote: c.pinned_note !== null,
      creditApproved: c.credit_approved === 1,
    })),
  });
}
