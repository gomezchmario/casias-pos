import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePos } from "@/lib/api-helpers";
import {
  getSale,
  listSaleItems,
  updatePo,
  updateSaleMeta,
} from "@/lib/sales";
import { listPayments } from "@/lib/payments";
import { listMechanics } from "@/lib/employees";
import { getDb } from "@/lib/db";
import { currentBusinessDate } from "@/lib/business-date";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("viewInventory");
  if (!auth.ok) return auth.response;

  const sale = getSale(parseInt((await params).id, 10));
  if (!sale) return jsonError("Not found", 404);
  const items = listSaleItems(sale.id, true);

  // The technicians on this ticket, resolved to names here rather than in the
  // browser. The line rows carry only ids, and the screen that attributes a tip
  // wants to offer only the people who actually worked the job.
  //
  // With how many lines each, because that is the shop's measure of effort when
  // a tip is split by work done — and the split panel has to be able to show the
  // proportions it is about to apply. A cashier will not trust "split by lines"
  // if it does not say out loud that it means three quarters and one quarter.
  const mechanics = getDb()
    .prepare(
      `SELECT e.id AS id, e.name AS name, COUNT(*) AS lineCount
         FROM sale_items i
         JOIN employees e ON e.id = i.mechanic_id
        WHERE i.sale_id = ? AND i.voided = 0
        GROUP BY e.id, e.name
        ORDER BY e.name`,
    )
    .all(sale.id) as { id: number; name: string; lineCount: number }[];

  /**
   * Who rang this ticket.
   *
   * The lines each name the technician who did the work, and the payments name
   * whoever took the money, but until now nothing on this screen said who
   * opened it — which is the one name you want when a ticket is wrong in a way
   * that is nobody's fault on the floor: a line rung against the wrong
   * category, a price typed over, a ticket left open all afternoon.
   *
   * Resolved from the id here rather than in the browser because the drawer has
   * no roster of cashiers, only of mechanics, and a cashier who has since left
   * would otherwise render as a number.
   */
  const cashier = getDb()
    .prepare("SELECT name FROM employees WHERE id = ?")
    .get(sale.cashier_id) as { name: string } | undefined;

  /**
   * Who the ticket is for, if anybody.
   *
   * Sent so the drawer's details panel opens with what is already known in it
   * rather than empty. An edit form that starts blank over a filled record is
   * not an edit form -- it is a trap: the cashier adding a phone number to a
   * ticket that already has a name sees no name, types only the number, and
   * the save looks to the server exactly like somebody meaning to clear it.
   */
  const customer = sale.customer_id
    ? (getDb()
        .prepare(
          "SELECT id, name, phone, credit_approved FROM customers WHERE id = ?",
        )
        .get(sale.customer_id) as
        | { id: number; name: string; phone: string | null; credit_approved: number }
        | undefined) ?? null
    : null;
  const vehicle = sale.vehicle_id
    ? (getDb()
        .prepare(
          "SELECT id, year, make, model, color, plate, vin FROM vehicles WHERE id = ?",
        )
        .get(sale.vehicle_id) as
        | {
            id: number;
            year: string | null;
            make: string | null;
            model: string | null;
            color: string | null;
            plate: string | null;
            vin: string | null;
          }
        | undefined) ?? null
    : null;

  /**
   * Which lines are tires.
   *
   * Only a tire can be credited to somebody for fitting it, and the line rows
   * carry a `category_id` and no code, so the drawer has no way of telling a
   * set of tires from a flat repair. Sent as ids rather than resolved in the
   * browser off a categories list, because this is the whole question the
   * drawer has -- "may I offer a fitter on this row" -- and shipping the
   * categories table so the client can re-derive it would put a second copy of
   * that rule somewhere it can disagree with the server's.
   */
  const tireItemIds = (
    getDb()
      .prepare(
        `SELECT i.id AS id
           FROM sale_items i
           JOIN service_categories c ON c.id = i.category_id
          WHERE i.sale_id = ? AND c.code IN ('new_tire', 'used_tire')`,
      )
      .all(sale.id) as { id: number }[]
  ).map((r) => r.id);

  return NextResponse.json({
    sale,
    // Which day the shop is on, so the drawer can tell a ticket from today
    // apart from one belonging to a day already counted. Sent rather than
    // worked out on the client, because the business day rolls on a rule that
    // lives in one place and must not be guessed at in a second.
    today: currentBusinessDate(),
    cashierName: cashier?.name ?? null,
    tireItemIds,
    customer,
    vehicle,
    items,
    payments: listPayments(sale.id),
    mechanics,
    // The whole floor, which is a different question from the one above and
    // needed for a different job: the tip panel offers who DID work the ticket,
    // while reassigning a line has to offer everybody who COULD have. The two
    // were the same list once and reassignment silently inherited the wrong
    // one -- on a ticket rung with nobody attached it was empty, so the one
    // case that most needs fixing was the one case that could not be.
    roster: listMechanics().map((e) => ({ id: e.id, name: e.name })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePos("editOwnOpenSale");
  if (!auth.ok) return auth.response;

  const saleId = parseInt((await params).id, 10);
  if (!getSale(saleId)) return jsonError("Not found", 404);

  let body: {
    po?: string | null;
    customerId?: number | null;
    vehicleId?: number | null;
    notes?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.po !== undefined) {
    const r = updatePo(auth.user, saleId, body.po);
    if (!r.ok) return jsonError(r.error);
  }
  if (
    body.customerId !== undefined ||
    body.vehicleId !== undefined ||
    body.notes !== undefined
  ) {
    const r = updateSaleMeta(auth.user, saleId, {
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      notes: body.notes,
    });
    if (!r.ok) return jsonError(r.error);
  }

  return NextResponse.json({ sale: getSale(saleId) });
}
