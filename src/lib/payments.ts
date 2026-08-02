import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { getSetting } from "./settings";
import { computeTipCommission } from "./money";
import { logActorAudit, type Actor } from "./audit";
import { getSale, recalcMoney } from "./sales";
import { can } from "./roles";
import { ensureShift } from "./shifts";
import type { PosUser } from "./pos-session";

export type PaymentKind =
  | "payment"
  | "tip_adjustment"
  | "refund"
  | "reversal"
  | "deposit";

export type Payment = {
  id: number;
  sale_id: number;
  method_id: number;
  kind: PaymentKind;
  amount_cents: number;
  tip_cents: number;
  comm_cents: number;
  comm_overridden: number;
  seq: string | null;
  reverses_payment_id: number | null;
  taken_by: number;
  business_date: string;
  note: string | null;
  created_at: string;
};

export type PaymentMethod = {
  id: number;
  code: string;
  label: string;
  kind: "cash" | "card" | "financing" | "house_account" | "other";
  is_card: number;
  allows_tip: number;
  sort_order: number;
  active: number;
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

export function listPaymentMethods(): PaymentMethod[] {
  return getDb()
    .prepare("SELECT * FROM payment_methods WHERE active = 1 ORDER BY sort_order")
    .all() as PaymentMethod[];
}

export function listPayments(saleId: number): Payment[] {
  return getDb()
    .prepare("SELECT * FROM payments WHERE sale_id = ? ORDER BY id")
    .all(saleId) as Payment[];
}

/**
 * The SEQ the card terminal will most likely print next: one past the last one
 * recorded. Deliberately ordered by insertion rather than by business date,
 * because the terminal's counter keeps climbing across a close — the number
 * after tonight's last sale is tomorrow's first.
 *
 * Zero-padding is preserved so "0042" begets "0043", not "43". Returns null
 * when there's nothing to count from or the last SEQ wasn't a plain number, so
 * the cashier types it rather than being handed a confident wrong guess.
 */
export function nextSeq(): string | null {
  const row = getDb()
    .prepare(
      `SELECT seq FROM payments
       WHERE seq IS NOT NULL AND seq <> ''
       ORDER BY id DESC LIMIT 1`,
    )
    .get() as { seq: string } | undefined;
  if (!row) return null;

  const trimmed = row.seq.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const next = String(Number(trimmed) + 1);
  return next.length < trimmed.length ? next.padStart(trimmed.length, "0") : next;
}

/** The shop's $1-per-$5 rule, with the rate read from settings so it can change
 *  without a deploy. */
export function defaultCommissionFor(tipCents: number): number {
  return computeTipCommission(
    tipCents,
    Number(getSetting("tip_comm_per_cents")),
    Number(getSetting("tip_comm_charge_cents")),
  );
}

function canOverrideCommission(user: PosUser): boolean {
  return user.role === "manager" || user.role === "owner";
}

/**
 * Take money. `amountCents` is the full amount that hits the card or drawer —
 * goods plus any cashback the customer took plus the fee for it.
 */
export function takePayment(
  user: PosUser,
  saleId: number,
  args: {
    methodId: number;
    amountCents: number;
    tipCents?: number;
    commCentsOverride?: number | null;
    seq?: string | null;
    note?: string | null;
  },
): Result<{ payment: Payment }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided")
    return { ok: false, error: "This ticket is voided" };

  const tip = args.tipCents ?? 0;
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
    return { ok: false, error: "Payment amount is not valid" };
  if (!Number.isInteger(tip) || tip < 0)
    return { ok: false, error: "Cashback amount is not valid" };

  const method = getDb()
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND active = 1")
    .get(args.methodId) as PaymentMethod | undefined;
  if (!method) return { ok: false, error: "Unknown payment method" };

  const defaultComm = defaultCommissionFor(tip);
  let comm = defaultComm;
  let overridden = 0;
  if (args.commCentsOverride != null && args.commCentsOverride !== defaultComm) {
    if (!canOverrideCommission(user))
      return { ok: false, error: "Only a manager can change the commission" };
    if (!Number.isInteger(args.commCentsOverride) || args.commCentsOverride < 0)
      return { ok: false, error: "Commission amount is not valid" };
    comm = args.commCentsOverride;
    overridden = 1;
  }

  return inTx(() => {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents, comm_overridden,
            seq, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        args.methodId,
        args.amountCents,
        tip,
        comm,
        overridden,
        args.seq?.trim() || null,
        user.employeeId,
        currentBusinessDate(),
        ensureShift(user).id,
        args.note?.trim() || null,
        nowLocalIso(),
      );
    const id = Number(info.lastInsertRowid);
    recalcMoney(saleId);

    logActorAudit(actorOf(user), {
      action: "payment.create",
      targetType: "sale",
      targetId: saleId,
      details: {
        payment_id: id,
        method: method.code,
        amount_cents: args.amountCents,
        tip_cents: tip,
        comm_cents: comm,
      },
    });
    if (overridden)
      logActorAudit(actorOf(user), {
        action: "payment.comm_override",
        targetType: "sale",
        targetId: saleId,
        before: { comm_cents: defaultComm },
        after: { comm_cents: comm, payment_id: id },
      });

    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
    return { ok: true as const, payment };
  });
}

/**
 * The forgotten-tip fix. A tip that turns up after the ticket closed is an
 * adjustment row pointing at the original sale — never a second phantom sale,
 * which is what the spreadsheet forced them to do.
 */
export function addTipAdjustment(
  user: PosUser,
  saleId: number,
  args: {
    methodId: number;
    tipCents: number;
    commCentsOverride?: number | null;
    seq?: string | null;
    note?: string | null;
  },
): Result<{ payment: Payment }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (!Number.isInteger(args.tipCents) || args.tipCents <= 0)
    return { ok: false, error: "Cashback amount is not valid" };

  const method = getDb()
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND active = 1")
    .get(args.methodId) as PaymentMethod | undefined;
  if (!method) return { ok: false, error: "Unknown payment method" };

  const defaultComm = defaultCommissionFor(args.tipCents);
  let comm = defaultComm;
  let overridden = 0;
  if (args.commCentsOverride != null && args.commCentsOverride !== defaultComm) {
    if (!canOverrideCommission(user))
      return { ok: false, error: "Only a manager can change the commission" };
    if (!Number.isInteger(args.commCentsOverride) || args.commCentsOverride < 0)
      return { ok: false, error: "Commission amount is not valid" };
    comm = args.commCentsOverride;
    overridden = 1;
  }

  return inTx(() => {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents, comm_overridden,
            seq, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'tip_adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        args.methodId,
        args.tipCents + comm,
        args.tipCents,
        comm,
        overridden,
        args.seq?.trim() || null,
        user.employeeId,
        // Booked to TODAY's business date, not the sale's: the money moved today.
        currentBusinessDate(),
        ensureShift(user).id,
        args.note?.trim() || null,
        nowLocalIso(),
      );
    const id = Number(info.lastInsertRowid);
    recalcMoney(saleId);

    logActorAudit(actorOf(user), {
      action: "payment.tip_adjustment",
      targetType: "sale",
      targetId: saleId,
      details: {
        payment_id: id,
        sale_no: sale.sale_no,
        sale_business_date: sale.business_date,
        tip_cents: args.tipCents,
        comm_cents: comm,
      },
    });
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
    return { ok: true as const, payment };
  });
}

/** Money going back out on a sale that still happened. The sale stays
 *  completed — refunding is not the same as pretending it never occurred. */
export function refund(
  user: PosUser,
  saleId: number,
  args: { methodId: number; amountCents: number; reason: string },
): Result<{ payment: Payment }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (user.role !== "manager" && user.role !== "owner")
    return { ok: false, error: "Only a manager can issue a refund" };
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
    return { ok: false, error: "Refund amount is not valid" };
  if (!args.reason.trim()) return { ok: false, error: "A reason is required" };

  return inTx(() => {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        args.methodId,
        -args.amountCents,
        user.employeeId,
        currentBusinessDate(),
        ensureShift(user).id,
        args.reason.trim(),
        nowLocalIso(),
      );
    const id = Number(info.lastInsertRowid);
    recalcMoney(saleId);
    logActorAudit(actorOf(user), {
      action: "payment.refund",
      targetType: "sale",
      targetId: saleId,
      details: {
        payment_id: id,
        amount_cents: -args.amountCents,
        reason: args.reason.trim(),
      },
    });
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
    return { ok: true as const, payment };
  });
}

/**
 * Cash out of the drawer for goods bought over the counter — usually a used
 * tire off a walk-in.
 *
 * The caller passes a positive amount and it is stored negative, because this
 * is money leaving. That single negative row is what makes the drawer count and
 * every tender total come out right with no special-casing downstream: a day's
 * cash is simply the sum of its ledger, sales up and purchases down.
 */
export function payOutPurchase(
  user: PosUser,
  saleId: number,
  args: { methodId: number; amountCents: number },
): Result<{ payment: Payment }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (!can(user.role, "cashPurchase"))
    return { ok: false, error: "Only a manager can buy over the counter" };
  if (sale.kind !== "purchase")
    return { ok: false, error: "That ticket is not a purchase" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
    return { ok: false, error: "Payout amount is not valid" };

  const method = getDb()
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND active = 1")
    .get(args.methodId) as PaymentMethod | undefined;
  if (!method) return { ok: false, error: "Unknown payment method" };
  if (method.kind !== "cash")
    return { ok: false, error: "A counter purchase is paid out in cash" };

  return inTx(() => {
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        args.methodId,
        -args.amountCents,
        user.employeeId,
        currentBusinessDate(),
        ensureShift(user).id,
        `Bought over the counter on ${sale.sale_no}`,
        nowLocalIso(),
      );
    const id = Number(info.lastInsertRowid);
    recalcMoney(saleId);

    logActorAudit(actorOf(user), {
      action: "payment.purchase_payout",
      targetType: "sale",
      targetId: saleId,
      details: {
        payment_id: id,
        sale_no: sale.sale_no,
        amount_cents: -args.amountCents,
      },
    });
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
    return { ok: true as const, payment };
  });
}

/**
 * Void a ticket.
 *
 * An open ticket has taken no money and moved no stock, so it just flips
 * status. A completed one gets a reversing payment for each original — the
 * originals are never touched, and the day's totals net to zero on their own.
 */
export function voidSale(user: PosUser, saleId: number, reason: string): Result {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (user.role !== "manager" && user.role !== "owner")
    return { ok: false, error: "Only a manager can void a ticket" };
  if (sale.status === "voided") return { ok: true };
  if (!reason.trim()) return { ok: false, error: "A reason is required to void" };

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    const businessDate = currentBusinessDate();
    const originals = listPayments(saleId).filter((p) => p.kind !== "reversal");
    // A reversal takes money back out of the drawer now, so it lands in the
    // shift doing the voiding -- not the one that originally took it, which may
    // already be counted and signed off.
    const shiftId = originals.length > 0 ? ensureShift(user).id : null;

    for (const p of originals) {
      db.prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents,
            reverses_payment_id, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'reversal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        saleId,
        p.method_id,
        -p.amount_cents,
        -p.tip_cents,
        -p.comm_cents,
        p.id,
        user.employeeId,
        businessDate,
        shiftId,
        `Void: ${reason.trim()}`,
        now,
      );
    }

    db.prepare(
      "UPDATE sales SET status = 'voided', voided_by = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?",
    ).run(user.employeeId, now, reason.trim(), now, saleId);
    recalcMoney(saleId);

    logActorAudit(actorOf(user), {
      action: "sale.void",
      targetType: "sale",
      targetId: saleId,
      details: {
        sale_no: sale.sale_no,
        reason: reason.trim(),
        reversed_payments: originals.length,
      },
      before: { status: sale.status, total_cents: sale.total_cents },
      after: { status: "voided" },
    });
    return { ok: true as const };
  });
}
