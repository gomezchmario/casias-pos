/**
 * Customers and their vehicles.
 *
 * Written for one job above all others: the counter. A tire shop's customer
 * record is not a CRM entry, it is the answer to "whose truck is that and what
 * is his number" — captured in the ten seconds while somebody is handing over
 * keys, or not captured at all.
 *
 * So the CAPTURE path has no create/edit/delete surface of its own. It has a
 * search and it has `attachToSale`, which takes the whole block of what the
 * cashier typed and works out for itself whether that is a new customer, an
 * existing one with a new car, or a regular who is standing in front of them for
 * the ninth time. Making the cashier answer that question first — "is this a new
 * customer? search before you type" — is how a field ends up filled in for one
 * ticket in five, and a database of near-duplicates that is worse than no
 * database.
 *
 * There IS an editing surface now, and it is a different thing used at a
 * different moment: the customer book, opened deliberately to correct something
 * already known to be wrong. That is why the edits below take explicit values
 * and overwrite, where `attachToSale` only ever fills blanks — the rule that a
 * blank means "I did not type this" is right for a ticket being rung and wrong
 * for a form somebody opened in order to clear a field.
 */

import { getDb } from "./db";
import { inTx } from "./tx";
import { nextCustomerNo } from "./counters";
import { nowLocalIso } from "./time";
import { diffRows, logActorAudit, type Actor } from "./audit";
import { properName } from "./names";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

export type Customer = {
  id: number;
  customer_no: string;
  name: string;
  phone: string | null;
  /** Who they are. Stable, part of the record — see `024_customer_note.sql`. */
  notes: string | null;
  /** The message the counter leaves for the counter. Cleared with its author. */
  pinned_note: string | null;
  pinned_note_by: string | null;
  pinned_note_at: string | null;
  /** The shop has agreed to carry this person — see `025_credit_approved.sql`. */
  credit_approved: number;
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

/** A customer as the directory shows them: who they are and what they are worth. */
export type CustomerRow = Customer & {
  vehicles: number;
  tickets: number;
  spentCents: number;
  owedCents: number;
  lastVisit: string | null;
  /** Tickets with a STANDING charge on the house account. */
  creditTickets: number;
  /** What is still owed on the tab: charges less money paid against it. */
  accountBalanceCents: number;
};

/**
 * The whole book of customers, not the eight the register's picker returns.
 *
 * `searchCustomers` exists to put a name under a cursor mid-ticket, so it is
 * capped, needs two characters, and puts phone matches first. None of that is
 * right for a directory somebody opens to browse: an empty query there means
 * "show me everybody", not "show me nothing".
 *
 * The counts come from the same rows the close-out reads, so a customer's
 * history here and the day's takings can never disagree. Voided and deleted
 * tickets are excluded from the money but the customer still appears — someone
 * whose only ticket was voided is still someone who came in.
 */
export function listCustomers(args?: {
  q?: string;
  /** Only people carrying a balance. */
  owing?: boolean;
  /** Only people who have ever settled on the house account. */
  credit?: boolean;
  /**
   * Only people running an account WITHOUT having been approved for one.
   *
   * The accountant asks for this, and it is the shortest useful list in the
   * book: somebody has been letting these customers take work away on a tab
   * that nobody ever agreed to. Implies `credit` — a customer with no account
   * activity is not approved either, and listing all of them would bury the
   * handful that matter.
   */
  notApproved?: boolean;
  limit?: number;
}): CustomerRow[] {
  const q = args?.q?.trim() ?? "";
  const digits = phoneDigits(q);
  const where: string[] = ["c.deleted = 0"];
  const params: unknown[] = [];

  if (q) {
    // Name, phone, or the customer number off a receipt. Phone is compared with
    // the punctuation stripped for the same reason as in `searchCustomers`:
    // nobody types a number the way it was stored.
    where.push(
      `(c.name LIKE ? OR c.customer_no LIKE ?${
        digits.length >= 3
          ? " OR replace(replace(replace(replace(c.phone,'(',''),')',''),'-',''),' ','') LIKE ?"
          : ""
      })`,
    );
    params.push(`%${q}%`, `%${q}%`);
    if (digits.length >= 3) params.push(`%${digits}%`);
  }

  // Both tickboxes narrow rather than sort, and they compose: ticking each
  // asks for people who owe money AND have run an account, which is a
  // reasonable thing to want and the shortest list on the page.
  if (args?.owing) where.push("COALESCE(t.owedCents, 0) > 0");
  if (args?.credit || args?.notApproved) where.push("COALESCE(cr.creditTickets, 0) > 0");
  if (args?.notApproved) where.push("c.credit_approved = 0");

  params.push(args?.limit ?? 500);

  return getDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM vehicles v
                WHERE v.customer_id = c.id AND v.deleted = 0)          AS vehicles,
              COALESCE(t.tickets, 0)                                   AS tickets,
              COALESCE(t.spentCents, 0)                                AS spentCents,
              COALESCE(t.owedCents, 0)                                 AS owedCents,
              COALESCE(cr.creditTickets, 0)                            AS creditTickets,
              -- What is still on the tab, so the LIST can say it beside the
              -- name. Computed the same way the account panel computes it —
              -- charges off the ledger, less money paid against the account —
              -- because two screens showing one customer's debt differently is
              -- how somebody ends up ringing the wrong person.
              COALESCE(cr.accountChargedCents, 0) - COALESCE(acp.paid, 0)
                                                                       AS accountBalanceCents,
              t.lastVisit                                              AS lastVisit
         FROM customers c
    LEFT JOIN (
              SELECT s.customer_id,
                     COUNT(*)                    AS tickets,
                     SUM(s.total_cents)          AS spentCents,
                     SUM(s.balance_cents)        AS owedCents,
                     MAX(s.business_date)        AS lastVisit
                FROM sales s
               WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
               GROUP BY s.customer_id
              ) t ON t.customer_id = c.id
    LEFT JOIN (
              -- Off the payment ledger, not off the ticket. A ticket is not
              -- "on account" as a property of itself; it is on account because
              -- somebody settled it that way, and a split-tender ticket half on
              -- the account and half in cash is on the account for the half
              -- that is. The ledger is the only place that distinction lives.
              SELECT customer_id,
                     COUNT(*)     AS creditTickets,
                     SUM(net)     AS accountChargedCents
                FROM (
                     SELECT s.customer_id, s.id AS sale_id,
                            SUM(p.amount_cents) AS net
                       FROM payments p
                       JOIN sales s ON s.id = p.sale_id
                       JOIN payment_methods m ON m.id = p.method_id
                      WHERE m.code = 'credit_account' AND s.deleted = 0
                      GROUP BY s.customer_id, s.id
                     HAVING net <> 0
                     )
               GROUP BY customer_id
              ) cr ON cr.customer_id = c.id
    LEFT JOIN (
              SELECT customer_id, SUM(amount_cents) AS paid
                FROM account_payments GROUP BY customer_id
              ) acp ON acp.customer_id = c.id
        WHERE ${where.join(" AND ")}
     ORDER BY t.lastVisit IS NULL, t.lastVisit DESC, c.name
        LIMIT ?`,
    )
    .all(...params) as CustomerRow[];
}

export type CustomerTicket = {
  saleId: number;
  saleNo: string;
  businessDate: string;
  status: string;
  fulfillmentStatus: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  po: string | null;
  vehicle: string | null;
  /** What was rung, as one line. */
  what: string;
};

/**
 * One customer's tickets, newest first.
 *
 * Voided tickets are kept and marked rather than dropped. "You did this job in
 * March" is a conversation held at the counter with this screen open, and a
 * void is often exactly what happened to the ticket being asked about — a list
 * that hid them would have the shop insisting a visit never happened.
 */
export function customerTickets(
  customerId: number,
  args?: { creditOnly?: boolean; limit?: number },
): CustomerTicket[] {
  /*
    Tickets whose account charge is still STANDING, not merely ever made.

    EXISTS was wrong here, and wrong in a way that looked right: a ticket rung
    to the account and then corrected to the card keeps its original
    credit_account row and gains a reversal beside it. The pair nets to nothing
    and the customer never owed a cent of it — but EXISTS still matched, so a
    card sale sat in the middle of the account list looking exactly like a debt.

    Summing is exact. A reversed charge nets to zero and the ticket drops out; a
    live one does not. Same test as the list's tickbox, so a customer who appears
    under Credit Account cannot open to a history that disagrees with it.
  */
  const creditOnly = args?.creditOnly
    ? `AND (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p
              JOIN payment_methods m ON m.id = p.method_id
             WHERE p.sale_id = s.id AND m.code = 'credit_account') <> 0`
    : "";

  return getDb()
    .prepare(
      `SELECT s.id                    AS saleId,
              s.sale_no               AS saleNo,
              s.business_date         AS businessDate,
              s.status                AS status,
              s.fulfillment_status    AS fulfillmentStatus,
              s.total_cents           AS totalCents,
              s.paid_cents            AS paidCents,
              s.balance_cents         AS balanceCents,
              s.po                    AS po,
              TRIM(COALESCE(v.year,'') || ' ' || COALESCE(v.make,'') || ' ' ||
                   COALESCE(v.model,'')) AS vehicle,
              (SELECT GROUP_CONCAT(
                        CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                             ELSE i.description END, ', ')
                 FROM sale_items i
                WHERE i.sale_id = s.id AND i.voided = 0) AS what
         FROM sales s
    LEFT JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.customer_id = ? AND s.deleted = 0 AND s.kind = 'sale'
              ${creditOnly}
     ORDER BY s.business_date DESC, s.id DESC
        LIMIT ?`,
    )
    .all(customerId, args?.limit ?? 200) as CustomerTicket[];
}

// ---------------------------------------------------------------------------
// The book, corrected
// ---------------------------------------------------------------------------

/**
 * Fix what is known about a person.
 *
 * Overwrites, unlike `attachToSale`. A blank here means "make this empty",
 * because somebody opened a form in order to change something — where a blank
 * on a ticket means "I did not type this" and must never erase the phone number
 * collected on the first visit.
 *
 * The name goes through `properName` for the same reason it does on capture:
 * "JOSE MARTINEZ" typed in caps at the counter and "Jose Martinez" typed here
 * are the same man, and a book that renders him both ways teaches people to
 * search twice.
 */
export function updateCustomer(
  user: PosUser,
  id: number,
  args: { name?: string; phone?: string | null; notes?: string | null },
): Result<{ customer: Customer }> {
  if (!can(user.role, "manageCustomers"))
    return { ok: false, error: "Only a manager can correct a customer" };

  const before = getCustomer(id);
  if (!before) return { ok: false, error: "Customer not found" };

  const name = args.name !== undefined ? properName(args.name.trim()) : before.name;
  if (!name) return { ok: false, error: "A customer needs a name" };

  const phone = args.phone !== undefined ? clean(args.phone) : before.phone;
  const notes = args.notes !== undefined ? clean(args.notes) : before.notes;

  return inTx(() => {
    getDb()
      .prepare(
        "UPDATE customers SET name = ?, phone = ?, notes = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, phone, notes, nowLocalIso(), id);

    const after = getCustomer(id)!;
    const diff = diffRows(before, after);
    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "customer",
      targetId: id,
      details: { customer_no: before.customer_no, name },
      before: diff?.before ?? null,
      after: diff?.after ?? null,
    });
    return { ok: true as const, customer: after };
  });
}

/**
 * Take a person out of the book.
 *
 * Soft, and their tickets are deliberately left alone: every sale keeps its
 * `customer_id`, so a receipt printed next year still carries the name it was
 * rung under. What changes is that they stop being findable — which is the
 * whole point when the row is a duplicate of somebody who is still here.
 *
 * Their cars go with them. A vehicle whose owner has been removed is a record
 * with no way back to a person, and leaving it behind would put an orphaned
 * plate in the way of the next lookup for the same car.
 */
export function deleteCustomer(user: PosUser, id: number, reason: string): Result {
  if (!can(user.role, "deleteCustomer"))
    return { ok: false, error: "Only the owner can remove a customer" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };

  const customer = getCustomer(id);
  if (!customer) return { ok: false, error: "Customer not found" };

  return inTx(() => {
    const now = nowLocalIso();
    const db = getDb();
    db.prepare(
      `UPDATE customers
          SET deleted = 1, deleted_by = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
        WHERE id = ?`,
    ).run(user.employeeId, now, reason.trim(), now, id);
    db.prepare(
      `UPDATE vehicles
          SET deleted = 1, deleted_by = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
        WHERE customer_id = ? AND deleted = 0`,
    ).run(user.employeeId, now, `Owner removed: ${reason.trim()}`, now, id);

    logActorAudit(actorOf(user), {
      action: "customer.delete",
      targetType: "customer",
      targetId: id,
      details: { customer_no: customer.customer_no, name: customer.name, reason: reason.trim() },
      before: { deleted: 0 },
      after: { deleted: 1 },
    });
    return { ok: true as const };
  });
}

/**
 * The note the counter leaves for the counter.
 *
 * Written by anybody who can open the book, on purpose: the person who learns
 * that a customer is coming Friday is whoever happened to answer the phone, and
 * a note only a manager can write is a note that gets written on paper instead.
 *
 * The author is cleared with the text. A name left against an empty note puts
 * somebody's name on a message that is not there.
 */
export function setCustomerNote(
  user: PosUser,
  id: number,
  text: string | null,
): Result<{ customer: Customer }> {
  const before = getCustomer(id);
  if (!before) return { ok: false, error: "Customer not found" };

  const next = text?.trim() || null;
  if (next === (before.pinned_note ?? null)) return { ok: true as const, customer: before };
  if (next && next.length > 500) return { ok: false, error: "That note is too long" };

  return inTx(() => {
    const now = nowLocalIso();
    getDb()
      .prepare(
        `UPDATE customers
            SET pinned_note = ?, pinned_note_by = ?, pinned_note_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(next, next ? user.name : null, next ? now : null, now, id);

    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "customer",
      targetId: id,
      details: { customer_no: before.customer_no, change: "pinned_note" },
      before: { pinned_note: before.pinned_note },
      after: { pinned_note: next },
    });
    return { ok: true as const, customer: getCustomer(id)! };
  });
}

/**
 * Say whether the shop will carry this person.
 *
 * Its own function rather than a field on `updateCustomer`, because it is not a
 * correction — it is a decision, and it wants its own audit row saying who made
 * it and when. Six months on, "who said this man was good for it" has an answer.
 *
 * Manager, the same level as the rest of the book. Below that is the counter,
 * and the whole point of writing this down is that it stops being decided at the
 * counter by whoever happens to be standing there.
 */
export function setCreditApproved(
  user: PosUser,
  id: number,
  approved: boolean,
): Result<{ customer: Customer }> {
  if (!can(user.role, "manageCustomers"))
    return { ok: false, error: "Only a manager can approve store credit" };

  const before = getCustomer(id);
  if (!before) return { ok: false, error: "Customer not found" };

  const next = approved ? 1 : 0;
  if (next === before.credit_approved) return { ok: true as const, customer: before };

  return inTx(() => {
    getDb()
      .prepare("UPDATE customers SET credit_approved = ?, updated_at = ? WHERE id = ?")
      .run(next, nowLocalIso(), id);

    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "customer",
      targetId: id,
      details: {
        customer_no: before.customer_no,
        name: before.name,
        change: approved ? "credit approved" : "credit withdrawn",
      },
      before: { credit_approved: before.credit_approved },
      after: { credit_approved: next },
    });
    return { ok: true as const, customer: getCustomer(id)! };
  });
}

/** Correct a car. Plate is upper-cased here exactly as it is on capture. */
export function updateVehicle(
  user: PosUser,
  id: number,
  args: {
    year?: string | null;
    make?: string | null;
    model?: string | null;
    color?: string | null;
    plate?: string | null;
    tire_size?: string | null;
    notes?: string | null;
  },
): Result<{ vehicle: Vehicle }> {
  if (!can(user.role, "manageCustomers"))
    return { ok: false, error: "Only a manager can correct a car" };

  const before = getVehicle(id);
  if (!before) return { ok: false, error: "Vehicle not found" };

  const pick = (k: keyof typeof args, fallback: string | null) =>
    args[k] !== undefined ? clean(args[k] as string | null) : fallback;

  const next = {
    year: pick("year", before.year),
    make: pick("make", before.make),
    model: pick("model", before.model),
    color: pick("color", before.color),
    plate: args.plate !== undefined ? cleanPlate(args.plate) : before.plate,
    tire_size: pick("tire_size", before.tire_size),
    notes: pick("notes", before.notes),
  };

  return inTx(() => {
    getDb()
      .prepare(
        `UPDATE vehicles
            SET year = ?, make = ?, model = ?, color = ?, plate = ?, tire_size = ?,
                notes = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        next.year, next.make, next.model, next.color, next.plate,
        next.tire_size, next.notes, nowLocalIso(), id,
      );

    const after = getVehicle(id)!;
    const diff = diffRows(before, after);
    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "vehicle",
      targetId: id,
      details: { customerId: before.customer_id, change: "vehicle" },
      before: diff?.before ?? null,
      after: diff?.after ?? null,
    });
    return { ok: true as const, vehicle: after };
  });
}

/**
 * Take a car off a customer.
 *
 * Manager rather than owner, unlike removing the person. A car genuinely leaves
 * — sold, written off, traded — and the person who is told about it is standing
 * at the counter. Tickets that named it keep naming it; only the lookup goes.
 */
export function deleteVehicle(user: PosUser, id: number, reason: string): Result {
  if (!can(user.role, "manageCustomers"))
    return { ok: false, error: "Only a manager can remove a car" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };

  const vehicle = getVehicle(id);
  if (!vehicle) return { ok: false, error: "Vehicle not found" };

  return inTx(() => {
    const now = nowLocalIso();
    getDb()
      .prepare(
        `UPDATE vehicles
            SET deleted = 1, deleted_by = ?, deleted_at = ?, deleted_reason = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(user.employeeId, now, reason.trim(), now, id);

    logActorAudit(actorOf(user), {
      action: "customer.update",
      targetType: "vehicle",
      targetId: id,
      details: { customerId: vehicle.customer_id, change: "removed", reason: reason.trim() },
      before: { deleted: 0 },
      after: { deleted: 1 },
    });
    return { ok: true as const };
  });
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
    } else if (hasCustomer) {
      // `hasCustomer`, and not a bare `else`, because a PO number and a note are
      // fields on the TICKET, not on a person. Without the guard, a cashier who
      // types a shop's PO and nothing else gets a nameless customer record
      // invented behind their back -- and the customer list fills with rows that
      // never described anybody. A day's import made 49 of them before this was
      // caught. The panel is allowed to set only sale fields; that is normal.
      //
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
