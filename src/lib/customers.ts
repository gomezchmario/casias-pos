/**
 * Customers and their vehicles.
 *
 * Written for one job above all others: the counter. A tire shop's customer
 * record is not a CRM entry, it is the answer to "whose truck is that and what
 * is his number" — captured in the ten seconds while somebody is handing over
 * keys, or not captured at all.
 *
 * So this module has no create/edit/delete surface of its own. It has a search
 * and it has `attachToSale`, which takes the whole block of what the cashier
 * typed and works out for itself whether that is a new customer, an existing one
 * with a new car, or a regular who is standing in front of them for the ninth
 * time. Making the cashier answer that question first — "is this a new customer?
 * search before you type" — is how a field ends up filled in for one ticket in
 * five, and a database of near-duplicates that is worse than no database.
 */

import { getDb } from "./db";
import { inTx } from "./tx";
import { nextCustomerNo } from "./counters";
import { nowLocalIso } from "./time";
import { diffRows, logActorAudit, type Actor } from "./audit";
import { properName } from "./names";
import type { PosUser } from "./pos-session";

export type Customer = {
  id: number;
  customer_no: string;
  name: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted: number;
};

export type Vehicle = {
  id: number;
  customer_id: number;
  year: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  plate: string | null;
  tire_size: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted: number;
};

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
 * Phone numbers, reduced to the digits that identify them.
 *
 * (210) 543-0909, 210-543-0909 and 2105430909 are one customer, and every one of
 * those spellings will get typed. The shop's own number is written three
 * different ways on three different documents in this repository, which is about
 * the level of consistency to design for.
 *
 * The digits are what gets MATCHED on; what the cashier typed is what gets
 * STORED, because a receipt reading 2105430909 is a receipt somebody has to
 * decode. The two jobs are different and conflating them loses the formatting
 * for no benefit.
 *
 * A leading 1 on an eleven-digit number is dropped -- 12105430909 is the same
 * line as 2105430909 -- and nothing else is normalised, because anything more
 * clever starts merging customers who are not the same person.
 */
export function phoneDigits(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/**
 * Find a customer by name or phone.
 *
 * Phone first and exact, because a phone number typed in full is somebody
 * saying "this exact person" and a fuzzy answer to that is noise. Name is a
 * contains-match, since half the shop's regulars are recorded by first name
 * only and searching "jose" has to find "Jose Ramirez".
 */
export function searchCustomers(query: string, limit = 8): Customer[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const db = getDb();
  const digits = phoneDigits(q);

  // Digits are matched by stripping the punctuation out of the stored value in
  // SQL rather than keeping a normalised column beside it. At this shop's scale
  // that is a scan of a few thousand short strings and it cannot be wrong,
  // whereas a denormalised column is one forgotten UPDATE away from a customer
  // who exists but cannot be found -- which presents as "the system lost him".
  const byPhone =
    digits.length >= 7
      ? (db
          .prepare(
            `SELECT * FROM customers
              WHERE deleted = 0
                AND replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ?
              ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(`%${digits}`, limit) as Customer[])
      : [];

  const byName = db
    .prepare(
      `SELECT * FROM customers
        WHERE deleted = 0 AND name LIKE ?
        ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(`%${q}%`, limit) as Customer[];

  // Phone hits ahead of name hits, de-duplicated. Somebody who typed a number
  // meant the number.
  const seen = new Set<number>();
  return [...byPhone, ...byName].filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, limit);
}

export function getCustomer(id: number): Customer | null {
  return (
    (getDb()
      .prepare("SELECT * FROM customers WHERE id = ? AND deleted = 0")
      .get(id) as Customer | undefined) ?? null
  );
}

export function listVehicles(customerId: number): Vehicle[] {
  return getDb()
    .prepare(
      "SELECT * FROM vehicles WHERE customer_id = ? AND deleted = 0 ORDER BY updated_at DESC",
    )
    .all(customerId) as Vehicle[];
}

export function getVehicle(id: number): Vehicle | null {
  return (
    (getDb()
      .prepare("SELECT * FROM vehicles WHERE id = ? AND deleted = 0")
      .get(id) as Vehicle | undefined) ?? null
  );
}

/**
 * What the counter typed. Every field optional -- most tickets fill in two.
 *
 * `po` and `notes` are along for the ride even though they belong to the sale
 * rather than to any customer, because on the screen they are part of the same
 * block and the same act: the cashier fills in who this is and what it is for,
 * and taps away. Splitting them across two requests would mean a ticket that
 * ends up with a P.O. and no name, or the reverse, whenever one call fails.
 */
export type TicketDetails = {
  customerId?: number | null;
  name?: string | null;
  phone?: string | null;
  vehicleId?: number | null;
  year?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  plate?: string | null;
  po?: string | null;
  notes?: string | null;
};

const clean = (v: string | null | undefined) => v?.trim() || null;
/** Plates are written in caps on the plate, so they are stored in caps here. */
const cleanPlate = (v: string | null | undefined) =>
  v?.trim().toUpperCase().replace(/\s+/g, "") || null;

/**
 * Reconcile a typed-in block of details against what the shop already knows,
 * and hang the result off a sale.
 *
 * THE MATCHING RULES, AND WHY THEY ARE THIS CONSERVATIVE
 *
 * A customer is matched only by an exact phone number, or by being picked
 * explicitly from the search. Not by name: this shop has more than one Jose, and
 * silently merging two of them puts one man's truck on another man's history
 * where nobody will ever look for it again. Two records for one person is a
 * nuisance somebody can fix; one record for two people is a lie that compounds.
 *
 * A vehicle is matched by plate within that customer, falling back to an exact
 * year/make/model when no plate was given. Plate first because it is the thing
 * that is actually unique, and only within the customer because plates get
 * transferred and the same plate on two customers is two different cars over
 * time -- which is the truth, and the alternative would rewrite one customer's
 * history when another one changes cars.
 *
 * NOTHING IS EVER OVERWRITTEN WITH NOTHING. A blank field means "I did not type
 * this", never "delete what you had". The register's panel starts empty on every
 * ticket, so any other rule would have the ninth visit wipe the phone number
 * collected on the first.
 */
export function attachToSale(
  user: PosUser,
  saleId: number,
  d: TicketDetails,
): Result<{ customer: Customer | null; vehicle: Vehicle | null }> {
  const name = d.name ? properName(d.name) : null;
  const phone = clean(d.phone);
  const plate = cleanPlate(d.plate);
  const year = clean(d.year);
  const make = clean(d.make);
  const model = clean(d.model);
  const color = clean(d.color);

  const po = clean(d.po);
  const notes = clean(d.notes);

  const hasVehicle = !!(plate || year || make || model || color);
  const hasCustomer = !!(name || phone || d.customerId);
  const hasSaleField = d.po !== undefined || d.notes !== undefined;

  // Nothing typed. Not an error -- the panel is optional and a cashier who opens
  // it and closes it again has not done anything wrong.
  if (!hasCustomer && !hasVehicle && !d.vehicleId && !hasSaleField)
    return { ok: true, customer: null, vehicle: null };

  // A car with nobody attached has nowhere to live: vehicles hang off a
  // customer, which is the right shape (a customer with three trucks is common;
  // a truck with no owner is not a thing the shop can phone). Saying so is
  // better than silently dropping what was typed.
  if (hasVehicle && !hasCustomer)
    return {
      ok: false,
      error: "Give a name or a phone number too — a vehicle has to belong to somebody.",
    };

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();

    // --- the customer ---
    let customer: Customer | null = null;
    if (d.customerId) customer = getCustomer(d.customerId);
    if (!customer && phone) {
      const digits = phoneDigits(phone);
      if (digits.length >= 7) {
        customer =
          (db
            .prepare(
              `SELECT * FROM customers
                WHERE deleted = 0
                  AND replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ?
                ORDER BY updated_at DESC LIMIT 1`,
            )
            .get(`%${digits}`) as Customer | undefined) ?? null;
      }
    }

    if (customer) {
      // Fill gaps, never blank anything. A regular recorded by phone alone gets
      // a name the day somebody bothers to ask for it.
      const next = {
        name: name ?? customer.name,
        phone: phone ?? customer.phone,
      };
      const diff = diffRows(customer as unknown as Record<string, unknown>, next);
      if (diff) {
        db.prepare("UPDATE customers SET name = ?, phone = ?, updated_at = ? WHERE id = ?").run(
          next.name,
          next.phone,
          now,
          customer.id,
        );
        logActorAudit(actorOf(user), {
          action: "customer.update",
          targetType: "customer",
          targetId: customer.id,
          before: diff.before,
          after: diff.after,
        });
        customer = getCustomer(customer.id);
      }
    } else {
      // `name` is NOT NULL in the schema and a phone-only customer is a real
      // thing at a counter, so the number stands in as the name until somebody
      // asks. Better than "Unknown", which sorts into a heap and tells you
      // nothing; the phone number at least identifies the person.
      const label = name ?? phone ?? "Walk-in";
      const customerNo = nextCustomerNo();
      const id = Number(
        db
          .prepare(
            `INSERT INTO customers (customer_no, name, phone, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(customerNo, label, phone, now, now).lastInsertRowid,
      );
      logActorAudit(actorOf(user), {
        action: "customer.create",
        targetType: "customer",
        targetId: id,
        details: { customer_no: customerNo, name: label, phone, sale_id: saleId },
      });
      customer = getCustomer(id);
    }

    // --- the vehicle ---
    let vehicle: Vehicle | null = null;
    if (d.vehicleId) vehicle = getVehicle(d.vehicleId);
    if (!vehicle && customer && hasVehicle) {
      if (plate) {
        vehicle =
          (db
            .prepare(
              "SELECT * FROM vehicles WHERE customer_id = ? AND deleted = 0 AND plate = ? LIMIT 1",
            )
            .get(customer.id, plate) as Vehicle | undefined) ?? null;
      }
      if (!vehicle && (year || make || model)) {
        vehicle =
          (db
            .prepare(
              `SELECT * FROM vehicles
                WHERE customer_id = ? AND deleted = 0
                  AND IFNULL(year,'') = ? AND IFNULL(make,'') = ? AND IFNULL(model,'') = ?
                LIMIT 1`,
            )
            .get(customer.id, year ?? "", make ?? "", model ?? "") as Vehicle | undefined) ?? null;
      }
    }

    if (vehicle) {
      const next = {
        year: year ?? vehicle.year,
        make: make ?? vehicle.make,
        model: model ?? vehicle.model,
        color: color ?? vehicle.color,
        plate: plate ?? vehicle.plate,
      };
      const diff = diffRows(vehicle as unknown as Record<string, unknown>, next);
      if (diff) {
        db.prepare(
          `UPDATE vehicles SET year = ?, make = ?, model = ?, color = ?, plate = ?, updated_at = ?
            WHERE id = ?`,
        ).run(next.year, next.make, next.model, next.color, next.plate, now, vehicle.id);
        logActorAudit(actorOf(user), {
          action: "vehicle.update",
          targetType: "vehicle",
          targetId: vehicle.id,
          before: diff.before,
          after: diff.after,
        });
        vehicle = getVehicle(vehicle.id);
      }
    } else if (customer && hasVehicle) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO vehicles (customer_id, year, make, model, color, plate, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(customer.id, year, make, model, color, plate, now, now).lastInsertRowid,
      );
      logActorAudit(actorOf(user), {
        action: "vehicle.create",
        targetType: "vehicle",
        targetId: id,
        details: { customer_id: customer.id, year, make, model, color, plate, sale_id: saleId },
      });
      vehicle = getVehicle(id);
    }

    // --- the sale ---
    //
    // Written here rather than through `updateSaleMeta` because that helper
    // treats undefined as "leave alone" against the sale's CURRENT values, and
    // this function has already done all of that reasoning against the customer
    // and vehicle rows themselves. Going through it would mean two different
    // pieces of code deciding what a blank field means.
    //
    // P.O. and the note are the exception to the never-blank-anything rule
    // above, and it is not an inconsistency. Those two live ON the sale and the
    // panel loads them from it, so what is in the box IS what is on the ticket
    // — clearing the box is the only way to take a wrong P.O. back off, and it
    // has to work. Name and phone are different because the panel starts empty
    // against a customer record that may be years old.
    const before = db
      .prepare("SELECT customer_id, vehicle_id, po, notes FROM sales WHERE id = ?")
      .get(saleId) as Record<string, unknown>;
    const next = {
      customer_id: customer?.id ?? (before.customer_id as number | null),
      vehicle_id: vehicle?.id ?? (before.vehicle_id as number | null),
      po: d.po === undefined ? (before.po as string | null) : po,
      notes: d.notes === undefined ? (before.notes as string | null) : notes,
    };
    const saleDiff = diffRows(before, next);
    if (saleDiff) {
      db.prepare(
        "UPDATE sales SET customer_id = ?, vehicle_id = ?, po = ?, notes = ?, updated_at = ? WHERE id = ?",
      ).run(next.customer_id, next.vehicle_id, next.po, next.notes, now, saleId);
      logActorAudit(actorOf(user), {
        action: "sale.update",
        targetType: "sale",
        targetId: saleId,
        before: saleDiff.before,
        after: saleDiff.after,
      });
    }

    return { ok: true as const, customer, vehicle };
  });
}

/** One line, the way a counter says it: "2014 Chevy Tahoe · Silver · ABC1234". */
export function describeVehicle(v: Vehicle | null): string {
  if (!v) return "";
  const head = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return [head, v.color, v.plate].filter(Boolean).join(" · ");
}
