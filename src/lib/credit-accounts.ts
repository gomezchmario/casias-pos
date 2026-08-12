import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

/**
 * House accounts: what customers owe on their tab, and what they have paid
 * against it.
 *
 * DELIBERATELY NOT THE OUTSTANDING LIST, and the difference is worth stating
 * because the two look alike from a distance.
 *
 * A ticket part-paid at the counter owes money against THAT TICKET. It is
 * chased by ringing the customer about that job, it appears on the close-out,
 * and it is settled by taking the rest at the register. That is
 * `outstandingTickets`, and none of it changes.
 *
 * An account is a running relationship. Charges accumulate over weeks, money
 * arrives against the TOTAL rather than against any one ticket, and it is
 * reconciled monthly by one person who is not on the floor. The register has
 * already finished with these tickets — they were settled against the
 * `credit_account` tender, so the till balanced and the ticket reads paid.
 *
 * THE CHARGE SIDE IS DERIVED, NOT STORED. It is the sum of `credit_account`
 * payment rows for that customer, and that is what makes this impossible to
 * drift: voiding a ticket writes a reversing row on the same tender, so a
 * voided charge nets itself out of the balance with no bookkeeping here at all.
 * A stored total would have needed maintaining from four different places and
 * would have been wrong within a month.
 */

export type AccountCharge = {
  paymentId: number;
  saleId: number;
  saleNo: string;
  businessDate: string;
  at: string;
  amountCents: number;
  /** A reversal, i.e. this charge was taken back off the account. */
  isReversal: number;
  /**
   * This charge has been taken back off — the id of the row that did it.
   *
   * The commonest cause is a tender correction: a ticket rung to the account
   * and then fixed to the card writes a reversal here and a fresh payment on
   * the card. The pair nets to nothing and the customer never owed it, but the
   * original row still LOOKS like a charge unless the screen says otherwise.
   */
  reversedById: number | null;
  saleVoided: number;
  what: string | null;
  /** Signed off by somebody — see `028_account_charge_review.sql`. */
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type AccountPayment = {
  id: number;
  customerId: number;
  amountCents: number;
  paidAt: string;
  businessDate: string;
  how: string | null;
  toAccount: string | null;
  note: string | null;
  reversesId: number | null;
  reversedById: number | null;
  byName: string;
  createdAt: string;
};

export type Account = {
  customerId: number;
  customerNo: string;
  name: string;
  phone: string | null;
  creditApproved: number;
  chargedCents: number;
  paidCents: number;
  balanceCents: number;
  chargeCount: number;
  lastChargeDate: string | null;
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
 * Everything charged to accounts and everything paid against them, per
 * customer.
 *
 * One query rather than a loop, because the accountant's screen wants the whole
 * book at once and a per-customer round trip over a few hundred rows is the
 * kind of thing that is fine until the shop has been open three years.
 */
export function listAccounts(args?: {
  /** Only accounts still carrying a balance. */
  owing?: boolean;
  /** Only customers who were never approved for credit — see `credit_approved`. */
  notApproved?: boolean;
}): Account[] {
  const where: string[] = ["c.deleted = 0"];
  if (args?.owing) where.push("(COALESCE(ch.charged, 0) - COALESCE(ap.paid, 0)) <> 0");
  // Unapproved AND still carrying something nobody has looked at. A customer
  // whose every charge has been signed off drops off the list until the next
  // one arrives — which is what stops it growing into forty rows nobody reads.
  if (args?.notApproved) where.push("c.credit_approved = 0 AND COALESCE(ch.unreviewed, 0) > 0");

  return getDb()
    .prepare(
      `SELECT c.id                          AS customerId,
              c.customer_no                 AS customerNo,
              c.name                        AS name,
              c.phone                       AS phone,
              c.credit_approved             AS creditApproved,
              COALESCE(ch.charged, 0)       AS chargedCents,
              COALESCE(ap.paid, 0)          AS paidCents,
              COALESCE(ch.charged, 0) - COALESCE(ap.paid, 0) AS balanceCents,
              COALESCE(ch.n, 0)             AS chargeCount,
              ch.lastDate                   AS lastChargeDate
         FROM customers c
         -- The charge side, straight off the payment ledger. Reversals are
         -- included and negative, so a voided ticket removes its own charge.
         JOIN (
              SELECT s.customer_id,
                     SUM(p.amount_cents)                       AS charged,
                     SUM(CASE WHEN p.kind = 'reversal' THEN 0 ELSE 1 END) AS n,
                     -- Real charges nobody has signed off. Reversals are
                     -- excluded: a charge taken back off the tab needs no
                     -- looking at, it is already undone.
                     SUM(CASE WHEN p.kind <> 'reversal' AND r.payment_id IS NULL
                              THEN 1 ELSE 0 END)               AS unreviewed,
                     MAX(s.business_date)                      AS lastDate
                FROM payments p
                JOIN sales s ON s.id = p.sale_id
                JOIN payment_methods m ON m.id = p.method_id
           LEFT JOIN account_charge_reviews r ON r.payment_id = p.id
               WHERE m.code = 'credit_account' AND s.deleted = 0
                 AND s.customer_id IS NOT NULL
               GROUP BY s.customer_id
              ) ch ON ch.customer_id = c.id
    LEFT JOIN (
              SELECT customer_id, SUM(amount_cents) AS paid
                FROM account_payments GROUP BY customer_id
              ) ap ON ap.customer_id = c.id
        WHERE ${where.join(" AND ")}
     ORDER BY balanceCents DESC, c.name`,
    )
    .all() as Account[];
}

/** One customer's account, or null when they have never been charged to one. */
export function getAccount(customerId: number): Account | null {
  return (
    listAccounts().find((a) => a.customerId === customerId) ?? null
  );
}

/** Every ticket that went onto this customer's account, newest first. */
export function accountCharges(customerId: number): AccountCharge[] {
  return getDb()
    .prepare(
      `SELECT p.id                AS paymentId,
              s.id                AS saleId,
              s.sale_no           AS saleNo,
              s.business_date     AS businessDate,
              p.created_at        AS at,
              p.amount_cents      AS amountCents,
              CASE WHEN p.kind = 'reversal' THEN 1 ELSE 0 END AS isReversal,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS saleVoided,
              (SELECT GROUP_CONCAT(
                        CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                             ELSE i.description END, ', ')
                 FROM sale_items i
                WHERE i.sale_id = s.id AND i.voided = 0) AS what,
              (SELECT rv.id FROM payments rv WHERE rv.reverses_payment_id = p.id)
                                  AS reversedById,
              e.name              AS reviewedByName,
              r.reviewed_at       AS reviewedAt
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN payment_methods m ON m.id = p.method_id
    LEFT JOIN account_charge_reviews r ON r.payment_id = p.id
    LEFT JOIN employees e ON e.id = r.reviewed_by
        WHERE m.code = 'credit_account' AND s.deleted = 0 AND s.customer_id = ?
     ORDER BY s.business_date DESC, p.id DESC`,
    )
    .all(customerId) as AccountCharge[];
}

/**
 * Sign off a charge on an unapproved account.
 *
 * Deliberately not the same act as approving the customer. Approving says "we
 * will carry this person from now on"; this says "somebody looked at this one
 * transaction and it is fine" — which is the answer most of the time, because
 * the usual cause is a regular whose approval was simply never recorded.
 *
 * Idempotent by primary key: reviewing twice is the same fact said again, and
 * the first reviewer keeps their name on it.
 */
export function reviewAccountCharge(
  user: PosUser,
  paymentId: number,
  note?: string | null,
): Result {
  if (!can(user.role, "manageCreditAccounts"))
    return { ok: false, error: "Only the owner or the accountant can sign this off" };

  const db = getDb();
  const charge = db
    .prepare(
      `SELECT p.id, p.amount_cents, s.sale_no, s.customer_id
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN payment_methods m ON m.id = p.method_id
        WHERE p.id = ? AND m.code = 'credit_account'`,
    )
    .get(paymentId) as
    | { id: number; amount_cents: number; sale_no: string; customer_id: number | null }
    | undefined;
  if (!charge) return { ok: false, error: "That charge doesn't exist" };

  return inTx(() => {
    db.prepare(
      `INSERT INTO account_charge_reviews (payment_id, reviewed_by, reviewed_at, note)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (payment_id) DO NOTHING`,
    ).run(paymentId, user.employeeId, nowLocalIso(), note?.trim() || null);

    logActorAudit(actorOf(user), {
      action: "account.payment",
      targetType: "payment",
      targetId: paymentId,
      details: {
        change: "charge audited",
        sale_no: charge.sale_no,
        amount_cents: charge.amount_cents,
      },
    });
    return { ok: true as const };
  });
}

/**
 * Take a sign-off back off.
 *
 * The sign-off row is DELETED rather than flagged, which is the one place in
 * this file that departs from the append-only rule — and deliberately, because
 * `account_charge_reviews` is not a ledger. It holds no money and no history; it
 * is a single fact about a charge, "somebody has looked at this", and the whole
 * job of the unapproved list is to show what still needs looking at. A flagged
 * row would have to be excluded from that query by every future caller, and the
 * first one to forget puts an unaudited charge behind a green tick forever.
 *
 * Nothing is lost. Both the sign-off and its undo are in `audit_log` with the
 * name and the minute against them, which is where the history of who decided
 * what belongs.
 */
export function unreviewAccountCharge(user: PosUser, paymentId: number): Result {
  if (!can(user.role, "manageCreditAccounts"))
    return { ok: false, error: "Only the owner or the accountant can undo this" };

  const db = getDb();
  const review = db
    .prepare(
      `SELECT r.payment_id, r.reviewed_at, e.name AS byName, s.sale_no
         FROM account_charge_reviews r
         JOIN payments p ON p.id = r.payment_id
         JOIN sales s ON s.id = p.sale_id
    LEFT JOIN employees e ON e.id = r.reviewed_by
        WHERE r.payment_id = ?`,
    )
    .get(paymentId) as
    | { payment_id: number; reviewed_at: string; byName: string | null; sale_no: string }
    | undefined;
  if (!review) return { ok: false, error: "That charge hasn't been signed off" };

  return inTx(() => {
    db.prepare("DELETE FROM account_charge_reviews WHERE payment_id = ?").run(paymentId);

    logActorAudit(actorOf(user), {
      action: "account.payment",
      targetType: "payment",
      targetId: paymentId,
      details: {
        change: "audit undone",
        sale_no: review.sale_no,
        was_audited_by: review.byName,
        was_audited_at: review.reviewed_at,
      },
    });
    return { ok: true as const };
  });
}

export function listAccountPayments(customerId: number): AccountPayment[] {
  return getDb()
    .prepare(
      `SELECT a.id, a.customer_id AS customerId, a.amount_cents AS amountCents,
              a.paid_at AS paidAt, a.business_date AS businessDate,
              a.how, a.to_account AS toAccount, a.note,
              a.reverses_id AS reversesId,
              (SELECT r.id FROM account_payments r WHERE r.reverses_id = a.id) AS reversedById,
              e.name AS byName, a.created_at AS createdAt
         FROM account_payments a
         JOIN employees e ON e.id = a.created_by
        WHERE a.customer_id = ?
     ORDER BY a.paid_at DESC, a.id DESC`,
    )
    .all(customerId) as AccountPayment[];
}

export type AccountMonthRow = {
  customerId: number;
  customerNo: string;
  name: string;
  phone: string | null;
  creditApproved: number;
  /** What they owed at the first of the month, before anything in it. */
  openingCents: number;
  /** Put on the tab during the month. Reversals net themselves out. */
  chargedCents: number;
  /** Paid against the tab during the month. */
  paidCents: number;
  /** What they owe at the end of it — opening + charged − paid, by construction. */
  closingCents: number;
};

export type AccountMonth = {
  month: string;
  start: string;
  end: string;
  rows: AccountMonthRow[];
  payments: (AccountPayment & { customerName: string; customerNo: string })[];
  totals: {
    openingCents: number;
    chargedCents: number;
    paidCents: number;
    closingCents: number;
  };
};

/**
 * A month of house accounts, as an accountant reads one.
 *
 * FOUR COLUMNS AND THEY MUST RECONCILE: what was owed at the start, what went
 * on, what came in, what is owed now. That is the shape of every statement of
 * account ever written, and the reason it is that shape is that the fourth
 * column is checkable against the other three — a month whose closing figure
 * does not equal opening plus charges minus payments has an error in it that
 * can be found. A page listing only "who owes what today" cannot be checked
 * against anything at all.
 *
 * It is computed as one signed movement ledger rather than four queries. A
 * charge is +, a payment is −, and every figure on the page is a sum over a
 * date window of the same rows — so the columns cannot disagree with each
 * other, because there is nothing for them to disagree about. Opening is
 * everything before the first; closing is everything up to the last; the two
 * middle columns are the month itself.
 *
 * Anybody with a balance or any movement is listed. Somebody who neither owed
 * anything nor moved anything is not on the page, because a statement full of
 * settled zero rows is a statement nobody reads to the bottom.
 */
export function accountMonth(month: string): AccountMonth {
  const start = `${month}-01`;
  // Last day of the month, via day zero of the next one — no month-length table
  // and no leap-year special case.
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  const end = next.toISOString().slice(0, 10);

  const db = getDb();
  const rows = db
    .prepare(
      `WITH mv AS (
              -- The charge side, off the payment ledger exactly as the balance
              -- is. A voided ticket's reversal is in here as a negative, so it
              -- removes its own charge from whichever month it was undone in.
              -- Billed TO, not rung under. A driver under a fleet has no
              -- statement of their own: their charges are the company's, and
              -- the company's sheet names the driver on every line. See
              -- BILL_TO in fleets.ts, which this must stay in step with.
              SELECT COALESCE(c.fleet_id, c.id) AS cid, s.business_date AS d,
                     p.amount_cents AS charge, 0 AS paid
                FROM payments p
                JOIN sales s ON s.id = p.sale_id
                JOIN payment_methods m ON m.id = p.method_id
                JOIN customers c ON c.id = s.customer_id
               WHERE m.code = 'credit_account' AND s.deleted = 0
                 AND s.customer_id IS NOT NULL
               UNION ALL
              SELECT COALESCE(c.fleet_id, c.id), a.business_date, 0, a.amount_cents
                FROM account_payments a
                JOIN customers c ON c.id = a.customer_id
            )
       SELECT c.id            AS customerId,
              c.customer_no   AS customerNo,
              c.name          AS name,
              c.phone         AS phone,
              c.credit_approved AS creditApproved,
              c.is_fleet      AS isFleet,
              (SELECT COUNT(*) FROM customers m
                WHERE m.fleet_id = c.id AND m.deleted = 0) AS fleetMembers,
              SUM(CASE WHEN mv.d <  ? THEN mv.charge - mv.paid ELSE 0 END) AS openingCents,
              SUM(CASE WHEN mv.d >= ? AND mv.d <= ? THEN mv.charge ELSE 0 END) AS chargedCents,
              SUM(CASE WHEN mv.d >= ? AND mv.d <= ? THEN mv.paid   ELSE 0 END) AS paidCents,
              SUM(CASE WHEN mv.d <= ? THEN mv.charge - mv.paid ELSE 0 END) AS closingCents
         FROM mv
         JOIN customers c ON c.id = mv.cid
        WHERE c.deleted = 0
     GROUP BY c.id
       HAVING openingCents <> 0 OR chargedCents <> 0 OR paidCents <> 0 OR closingCents <> 0
     ORDER BY closingCents DESC, c.name`,
    )
    .all(start, start, end, start, end, end) as AccountMonthRow[];

  const payments = db
    .prepare(
      `SELECT a.id, a.customer_id AS customerId, a.amount_cents AS amountCents,
              a.paid_at AS paidAt, a.business_date AS businessDate,
              a.how, a.to_account AS toAccount, a.note,
              a.reverses_id AS reversesId,
              (SELECT r.id FROM account_payments r WHERE r.reverses_id = a.id) AS reversedById,
              e.name AS byName, a.created_at AS createdAt,
              c.name AS customerName, c.customer_no AS customerNo
         FROM account_payments a
         JOIN employees e ON e.id = a.created_by
         JOIN customers c ON c.id = a.customer_id
        WHERE a.business_date BETWEEN ? AND ?
     ORDER BY a.paid_at, a.id`,
    )
    .all(start, end) as AccountMonth["payments"];

  return {
    month,
    start,
    end,
    rows,
    payments,
    // Footed off the rows on the page rather than queried again, so the total
    // line can never disagree with the column above it.
    totals: {
      openingCents: rows.reduce((s, r) => s + r.openingCents, 0),
      chargedCents: rows.reduce((s, r) => s + r.chargedCents, 0),
      paidCents: rows.reduce((s, r) => s + r.paidCents, 0),
      closingCents: rows.reduce((s, r) => s + r.closingCents, 0),
    },
  };
}

/**
 * Money in against an account.
 *
 * Not allocated to any ticket, on purpose — see the note at the top of this
 * file. `paidAt` is when the money arrived, which the accountant types and which
 * is frequently not today; `business_date` is derived from it so a cheque dated
 * the 3rd lands in the 3rd's figures rather than in the day it was keyed.
 */
export function recordAccountPayment(
  user: PosUser,
  args: {
    customerId: number;
    amountCents: number;
    paidAt: string;
    how?: string | null;
    toAccount?: string | null;
    note?: string | null;
  },
): Result<{ payment: AccountPayment }> {
  if (!can(user.role, "manageCreditAccounts"))
    return { ok: false, error: "Only the owner or the accountant can settle an account" };

  const amount = Math.round(args.amountCents);
  if (!Number.isInteger(amount) || amount === 0)
    return { ok: false, error: "Enter how much came in" };
  if (amount < 0) return { ok: false, error: "Enter a positive amount" };

  const paidAt = args.paidAt?.trim();
  if (!paidAt || !/^\d{4}-\d{2}-\d{2}/.test(paidAt))
    return { ok: false, error: "Say when it was paid" };

  const customer = getDb()
    .prepare("SELECT id, name, customer_no FROM customers WHERE id = ? AND deleted = 0")
    .get(args.customerId) as { id: number; name: string; customer_no: string } | undefined;
  if (!customer) return { ok: false, error: "Customer not found" };

  return inTx(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO account_payments
           (customer_id, amount_cents, paid_at, business_date, how, to_account,
            note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.customerId,
        amount,
        paidAt,
        paidAt.slice(0, 10),
        args.how?.trim() || null,
        args.toAccount?.trim() || null,
        args.note?.trim() || null,
        user.employeeId,
        nowLocalIso(),
      );
    const id = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: "account.payment",
      targetType: "customer",
      targetId: args.customerId,
      details: {
        customer_no: customer.customer_no,
        name: customer.name,
        amount_cents: amount,
        paid_at: paidAt,
        how: args.how?.trim() || null,
        to_account: args.toAccount?.trim() || null,
      },
      after: { account_payment_id: id },
    });

    return {
      ok: true as const,
      payment: listAccountPayments(args.customerId).find((p) => p.id === id)!,
    };
  });
}

/**
 * Undo one, by writing its opposite.
 *
 * The original row stays. A cheque recorded against the wrong customer really
 * was recorded, and the account it was wrongly credited to really did read low
 * for however long it took somebody to notice — a trail that erases that is
 * worth less than no trail.
 */
export function reverseAccountPayment(
  user: PosUser,
  id: number,
  reason: string,
): Result<{ payment: AccountPayment }> {
  if (!can(user.role, "manageCreditAccounts"))
    return { ok: false, error: "Only the owner or the accountant can undo this" };
  const why = reason.trim();
  if (!why) return { ok: false, error: "Say why it is being undone" };

  const db = getDb();
  const original = db
    .prepare("SELECT * FROM account_payments WHERE id = ?")
    .get(id) as
    | { id: number; customer_id: number; amount_cents: number; paid_at: string; reverses_id: number | null }
    | undefined;
  if (!original) return { ok: false, error: "That payment doesn't exist" };
  if (original.reverses_id) return { ok: false, error: "A reversal can't itself be reversed" };
  if (db.prepare("SELECT 1 FROM account_payments WHERE reverses_id = ?").get(id))
    return { ok: false, error: "That payment has already been undone" };

  return inTx(() => {
    const now = nowLocalIso();
    const info = db
      .prepare(
        `INSERT INTO account_payments
           (customer_id, amount_cents, paid_at, business_date, how, to_account,
            note, reverses_id, created_by, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        original.customer_id,
        -original.amount_cents,
        // The day it is being undone, not the day of the row it undoes. Money
        // coming back off an account changes the account today.
        now,
        currentBusinessDate(),
        `Undoes #${original.id}: ${why}`,
        original.id,
        user.employeeId,
        now,
      );
    const newId = Number(info.lastInsertRowid);

    logActorAudit(actorOf(user), {
      action: "account.reversal",
      targetType: "customer",
      targetId: original.customer_id,
      details: { reverses: original.id, amount_cents: -original.amount_cents, reason: why },
    });

    return {
      ok: true as const,
      payment: listAccountPayments(original.customer_id).find((p) => p.id === newId)!,
    };
  });
}
