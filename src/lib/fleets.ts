import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import { getCustomer, type Customer } from "./customers";
import type { PosUser } from "./pos-session";

/**
 * Fleets: a company tab with drivers charging against it.
 *
 * See `033_fleets.sql` for why a fleet is a customer rather than a table of its
 * own. This module owns the one rule that follows from it, and every balance in
 * the program is built on that rule:
 *
 *   A CHARGE IS BILLED TO THE MEMBER'S FLEET IF THEY HAVE ONE, ELSE TO THEM.
 *
 * Which is `BILL_TO` below, three lines of SQL that must have exactly one copy.
 * The alternative — each screen deciding for itself whether to follow the
 * parent — is how the customer list, the statement and the fleet's own sheet
 * end up quoting three different balances for one company, and there is no way
 * to tell from any of them which is right.
 *
 * WHAT DOES NOT MOVE is as important as what does. The sale keeps naming the
 * driver, the vehicle keeps belonging to the driver, the history stays where it
 * happened. Only the MONEY looks up to the parent. That is what makes the fleet
 * report possible: every charge on the company tab already knows which driver
 * made it, because nothing was ever rewritten to hide them.
 */

/**
 * The account a customer's money belongs to, given `c` in scope.
 *
 * Deliberately not recursive: a fleet cannot itself belong to a fleet — see
 * `setFleet`, which refuses it — so one COALESCE settles every case and no
 * query in the program has to walk a chain.
 */
export const BILL_TO = "COALESCE(c.fleet_id, c.id)";

export type FleetMember = {
  id: number;
  customerNo: string;
  name: string;
  phone: string | null;
  vehicles: number;
  /** Charged to the fleet by this driver, all time, net of reversals. */
  chargedCents: number;
  lastVisit: string | null;
};

export type FleetCharge = {
  saleId: number;
  saleNo: string;
  businessDate: string;
  /** The driver who was served. Null when the ticket was rung on the company itself. */
  driverId: number | null;
  driverName: string | null;
  vehicle: string | null;
  amountCents: number;
};

export type FleetReport = {
  fleet: { id: number; customerNo: string; name: string; phone: string | null; creditApproved: number };
  from: string;
  to: string;
  members: FleetMember[];
  charges: FleetCharge[];
  payments: {
    id: number;
    amountCents: number;
    businessDate: string;
    how: string | null;
    note: string | null;
    byName: string;
  }[];
  totals: {
    openingCents: number;
    chargedCents: number;
    paidCents: number;
    closingCents: number;
  };
};

/** Every fleet, for the picker. Approved ones first — those are the real ones. */
export function listFleets(): {
  id: number;
  customerNo: string;
  name: string;
  creditApproved: number;
  members: number;
}[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.customer_no AS customerNo, c.name,
              c.credit_approved AS creditApproved,
              (SELECT COUNT(*) FROM customers m
                WHERE m.fleet_id = c.id AND m.deleted = 0) AS members
         FROM customers c
        WHERE c.deleted = 0 AND c.is_fleet = 1
     ORDER BY c.credit_approved DESC, c.name`,
    )
    .all() as ReturnType<typeof listFleets>;
}

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

/**
 * Mark a customer as a fleet — a company other people can be billed under.
 *
 * Its own act rather than a side effect of adding the first member, because a
 * fleet exists before its drivers do: the shop agrees to carry Carrillo
 * Construction, and the drivers turn up afterwards.
 */
export function setIsFleet(user: PosUser, id: number, isFleet: boolean): Result<{ customer: Customer }> {
  if (!can(user.role, "manageCreditAccounts"))
    return { ok: false, error: "Only the owner or the accountant can set up a fleet" };

  const before = getCustomer(id);
  if (!before) return { ok: false, error: "Customer not found" };
  if (isFleet && before.fleet_id)
    return {
      ok: false,
      error: "This person is billed to a fleet already — take them out of it before making them one",
    };
  if (!isFleet) {
    const members = getDb()
      .prepare("SELECT COUNT(*) n FROM customers WHERE fleet_id = ? AND deleted = 0")
      .get(id) as { n: number };
    if (members.n > 0)
      return {
        ok: false,
        error: `${members.n} driver${members.n === 1 ? " is" : "s are"} still billed to this fleet — move them first`,
      };
  }

  return inTx(() => {
    getDb()
      .prepare("UPDATE customers SET is_fleet = ?, updated_at = ? WHERE id = ?")
      .run(isFleet ? 1 : 0, nowLocalIso(), id);
    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "customer",
      targetId: id,
      details: { customer_no: before.customer_no, name: before.name },
      before: { is_fleet: before.is_fleet },
      after: { is_fleet: isFleet ? 1 : 0 },
    });
    return { ok: true as const, customer: getCustomer(id)! };
  });
}

/**
 * Put a driver under a fleet, or take them out of one.
 *
 * THE REFUSALS ARE THE INTERESTING PART, and each closes a way of producing an
 * account whose balance cannot be computed:
 *
 *   a fleet cannot join a fleet — `BILL_TO` is one COALESCE deep on purpose,
 *   and a chain of parents would make every balance in the program a recursive
 *   query for a situation this shop does not have;
 *
 *   a customer with members cannot become a member, for the same reason from
 *   the other end;
 *
 *   the target has to BE a fleet, so that "billed to" always points at
 *   something the reports know how to draw a sheet for.
 *
 * Moving somebody between fleets is allowed and deliberately does not move
 * their past charges: history records where money actually went, and a driver
 * who changed employers in March did not retrospectively change who owed for
 * February's tires.
 */
export function setFleet(user: PosUser, id: number, fleetId: number | null): Result<{ customer: Customer }> {
  if (!can(user.role, "manageCustomers"))
    return { ok: false, error: "Your account can't change who a customer is billed to" };

  const before = getCustomer(id);
  if (!before) return { ok: false, error: "Customer not found" };

  if (fleetId !== null) {
    if (fleetId === id) return { ok: false, error: "Somebody can't be billed to themselves" };
    if (before.is_fleet)
      return { ok: false, error: "A fleet can't be billed to another fleet" };
    const parent = getCustomer(fleetId);
    if (!parent) return { ok: false, error: "That fleet doesn't exist" };
    if (!parent.is_fleet)
      return { ok: false, error: `${parent.name} is not set up as a fleet` };
  }

  if ((before.fleet_id ?? null) === fleetId) return { ok: true as const, customer: before };

  return inTx(() => {
    getDb()
      .prepare("UPDATE customers SET fleet_id = ?, updated_at = ? WHERE id = ?")
      .run(fleetId, nowLocalIso(), id);
    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "customer",
      targetId: id,
      details: { customer_no: before.customer_no, name: before.name },
      before: { fleet_id: before.fleet_id },
      after: { fleet_id: fleetId },
    });
    return { ok: true as const, customer: getCustomer(id)! };
  });
}

/** Everyone billed to a fleet, with what each has put on the tab. */
export function fleetMembers(fleetId: number): FleetMember[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.customer_no AS customerNo, c.name, c.phone,
              (SELECT COUNT(*) FROM vehicles v
                WHERE v.customer_id = c.id AND v.deleted = 0) AS vehicles,
              COALESCE((
                SELECT SUM(p.amount_cents)
                  FROM payments p
                  JOIN sales s ON s.id = p.sale_id
                  JOIN payment_methods m ON m.id = p.method_id
                 WHERE m.code = 'credit_account' AND s.deleted = 0
                   AND s.customer_id = c.id
              ), 0) AS chargedCents,
              (SELECT MAX(s.business_date) FROM sales s
                WHERE s.customer_id = c.id AND s.deleted = 0
                  AND s.status = 'completed') AS lastVisit
         FROM customers c
        WHERE c.fleet_id = ? AND c.deleted = 0
     ORDER BY chargedCents DESC, c.name`,
    )
    .all(fleetId) as FleetMember[];
}

/**
 * A fleet's statement: every charge over a window, and who made it.
 *
 * The driver column is the reason this report exists. A company tab that only
 * says "$4,200 in March" is a number the customer has to take on trust; one
 * that says which driver, which truck and which ticket is a document they can
 * check against their own records — and the shop can produce it because the
 * sale never stopped naming the driver.
 *
 * Opening and closing are computed over ALL time either side of the window, the
 * same way `accountMonth` does it, so a fleet sheet and the month statement
 * cannot quote different balances for the same company.
 */
export function fleetReport(fleetId: number, from: string, to: string): FleetReport | null {
  const db = getDb();
  const fleet = db
    .prepare(
      `SELECT id, customer_no AS customerNo, name, phone,
              credit_approved AS creditApproved
         FROM customers WHERE id = ? AND deleted = 0`,
    )
    .get(fleetId) as FleetReport["fleet"] | undefined;
  if (!fleet) return null;

  const charges = db
    .prepare(
      `SELECT s.id AS saleId, s.sale_no AS saleNo, s.business_date AS businessDate,
              s.customer_id AS driverId,
              CASE WHEN s.customer_id = ? THEN NULL ELSE d.name END AS driverName,
              CASE WHEN v.id IS NULL THEN NULL ELSE
                TRIM(COALESCE(v.year,'') || ' ' || COALESCE(v.make,'') || ' ' ||
                     COALESCE(v.model,'') ||
                     CASE WHEN v.plate IS NULL THEN '' ELSE ' · ' || v.plate END)
              END AS vehicle,
              SUM(p.amount_cents) AS amountCents
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN payment_methods m ON m.id = p.method_id
         JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customers d ON d.id = s.customer_id
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE m.code = 'credit_account' AND s.deleted = 0
          AND ${BILL_TO} = ?
          AND s.business_date BETWEEN ? AND ?
     GROUP BY s.id
       HAVING amountCents <> 0
     ORDER BY s.business_date, s.id`,
    )
    .all(fleetId, fleetId, from, to) as FleetCharge[];

  const payments = db
    .prepare(
      `SELECT a.id, a.amount_cents AS amountCents, a.business_date AS businessDate,
              a.how, a.note, e.name AS byName
         FROM account_payments a
         JOIN employees e ON e.id = a.created_by
         JOIN customers c ON c.id = a.customer_id
        WHERE ${BILL_TO} = ? AND a.business_date BETWEEN ? AND ?
     ORDER BY a.business_date, a.id`,
    )
    .all(fleetId, from, to) as FleetReport["payments"];

  // One signed ledger for the balances, exactly as `accountMonth` builds it —
  // charges positive, payments negative — so the two documents cannot disagree.
  const bal = db
    .prepare(
      `WITH mv AS (
              SELECT s.business_date AS d, p.amount_cents AS amt
                FROM payments p
                JOIN sales s ON s.id = p.sale_id
                JOIN payment_methods m ON m.id = p.method_id
                JOIN customers c ON c.id = s.customer_id
               WHERE m.code = 'credit_account' AND s.deleted = 0
                 AND ${BILL_TO} = ?
               UNION ALL
              SELECT a.business_date, -a.amount_cents
                FROM account_payments a
                JOIN customers c ON c.id = a.customer_id
               WHERE ${BILL_TO} = ?
            )
       SELECT COALESCE(SUM(CASE WHEN d <  ? THEN amt ELSE 0 END), 0) AS openingCents,
              COALESCE(SUM(CASE WHEN d <= ? THEN amt ELSE 0 END), 0) AS closingCents
         FROM mv`,
    )
    .get(fleetId, fleetId, from, to) as { openingCents: number; closingCents: number };

  return {
    fleet,
    from,
    to,
    members: fleetMembers(fleetId),
    charges,
    payments,
    totals: {
      openingCents: bal.openingCents,
      chargedCents: charges.reduce((n, c) => n + c.amountCents, 0),
      paidCents: payments.reduce((n, p) => n + p.amountCents, 0),
      closingCents: bal.closingCents,
    },
  };
}
