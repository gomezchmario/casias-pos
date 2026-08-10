import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { getSetting } from "./settings";
import { apportionCents, computeTipCommission, formatCents } from "./money";
import { logActorAudit, type Actor } from "./audit";
import { getSale, recalcMoney } from "./sales";
import { reverseSaleMovements } from "./inventory";
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
  /** Who the tip on this row was left for. Null when there is no tip, or when
   *  the ticket had no technician to attribute it to. */
  mechanic_id: number | null;
  seq: string | null;
  reverses_payment_id: number | null;
  taken_by: number;
  business_date: string;
  /** The till session this row belongs to. Null on rows written before shifts
   *  existed, and on a reversal that had no drawer open to land in. */
  shift_id: number | null;
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
 * The next card sequence number of the day.
 *
 * SEQ IS THE REGISTER'S OWN COUNTER, NOT SOMETHING ANYBODY TYPES.
 *
 * It is the Nth card charge of the business day: 1, 2, 3, restarting every
 * morning because the terminal is batched out every night. Nothing about that
 * needs a human, so nothing about it asks for one — it is handed out here, at
 * the moment a card payment is written, and the cashier never sees a SEQ box at
 * the register.
 *
 * The one thing a human does get to do is correct the ORDER, on Logs, and
 * only there. Charges taken on the terminal in one burst and keyed into the
 * register afterwards go in in whatever order somebody picked the slips up in,
 * and the numbers then need shuffling to match the batch. That is a renumbering
 * job, done once, on a screen listing the day's card charges — see
 * `setPaymentSeq`.
 *
 * The highest so far plus one, rather than the count of charges: after that
 * renumbering the next sale must not be handed a number already in use. A gap
 * is harmless — it is a number nothing points at — whereas a duplicate makes
 * two charges indistinguishable against the batch, which is the whole thing
 * this number exists to prevent.
 *
 * Only plain integers count toward it, so a stray value from before this was
 * automatic cannot poison the arithmetic. And only CARD rows count: a sequence
 * number on cash is by definition wrong, the terminal never saw that money, and
 * counting one would push every later charge past where the terminal actually
 * is.
 */
export function nextSeq(businessDate: string = currentBusinessDate()): string {
  const rows = getDb()
    .prepare(
      `SELECT p.seq AS seq FROM payments p
         JOIN payment_methods m ON m.id = p.method_id
       WHERE p.business_date = ? AND p.seq IS NOT NULL AND p.seq <> ''
         AND m.is_card = 1`,
    )
    .all(businessDate) as { seq: string }[];

  let highest = 0;
  for (const r of rows) {
    const trimmed = r.seq.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    highest = Math.max(highest, Number(trimmed));
  }
  return String(highest + 1);
}

/**
 * Renumber one card charge. THE ONLY WAY A SEQ IS EVER SET BY A PERSON.
 *
 * WHY THIS EXISTS AT ALL, WHEN THE NUMBER IS AUTOMATIC
 *
 * The register hands out sequence numbers in the order it is rung, and that is
 * usually the order the terminal charged the cards in. Usually. On a busy
 * afternoon the shop runs several cards on the terminal and keys the tickets in
 * afterwards, off a handful of slips, in whatever order they come off the
 * counter — and then the register's run and the terminal's batch disagree by a
 * permutation. Nothing is wrong with the money; the numbers are simply shuffled.
 * So the day's card charges can be renumbered where they are listed, and that
 * is the entire human involvement with SEQ.
 *
 * DUPLICATES ARE ALLOWED, DELIBERATELY. Renumbering is nearly always a swap,
 * and a swap passes through a state where two rows hold the same number. Barring
 * it would make the ordinary correction impossible without inventing a scratch
 * value first. `nextSeq` takes the highest plus one, so it stays correct
 * whatever intermediate state this passes through, and two rows sharing a number
 * are visible on the very screen the renumbering is done on.
 *
 * WHY THIS DOES NOT BREAK THE APPEND-ONLY RULE
 *
 * Payments are a ledger: no row is deleted and no amount is ever rewritten,
 * because the only honest way to undo money is a reversing row. SEQ is not
 * money. It is a pointer at a slip in the card batch, it moves no cents, and a
 * reversing row for a reference number would mean voiding and re-taking a real
 * payment — a far worse lie about the day than a mis-ordered pointer. So this
 * one field is correctable in place, and every correction is audited
 * before/after.
 *
 * Cards only. A sequence number on cash is by definition wrong — the terminal
 * never saw that money — and letting one in pushes `nextSeq` past where the
 * terminal actually is.
 */
export function setPaymentSeq(
  user: PosUser,
  paymentId: number,
  seq: string | null,
): Result<{ payment: Payment }> {
  const db = getDb();
  const payment = db
    .prepare("SELECT * FROM payments WHERE id = ?")
    .get(paymentId) as Payment | undefined;
  if (!payment) return { ok: false, error: "Payment not found" };

  const next = seq?.trim() || null;
  // Digits, because that is what the terminal prints and what the counter
  // counts. Free text used to be accepted so a cashier could annotate an
  // oddity, and every one of those annotations then sat outside the arithmetic
  // in `nextSeq` — a number that is sometimes a number is not a sequence.
  if (next !== null && !/^\d{1,9}$/.test(next))
    return { ok: false, error: "A SEQ is a plain number off the terminal, like 14." };

  const method = db
    .prepare("SELECT is_card FROM payment_methods WHERE id = ?")
    .get(payment.method_id) as { is_card: number } | undefined;
  if (next && method?.is_card !== 1)
    return {
      ok: false,
      error: "Only card payments carry a SEQ — the terminal never saw this money.",
    };

  if (next === payment.seq) return { ok: true as const, payment };

  return inTx(() => {
    db.prepare("UPDATE payments SET seq = ? WHERE id = ?").run(next, paymentId);
    logActorAudit(actorOf(user), {
      action: "payment.seq_update",
      targetType: "sale",
      targetId: payment.sale_id,
      details: { payment_id: paymentId },
      before: { seq: payment.seq },
      after: { seq: next },
    });
    return {
      ok: true as const,
      payment: db
        .prepare("SELECT * FROM payments WHERE id = ?")
        .get(paymentId) as Payment,
    };
  });
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
 * Who a tip on this ticket belongs to, when nobody said.
 *
 * A tip is left for the person who did the work. If every line on the ticket
 * was worked by the same technician, that is not a guess — it is the only
 * answer the ticket admits, and making the cashier confirm it on the common
 * one-technician ticket would be friction for nothing.
 *
 * The moment two technicians are on the ticket it returns null and the caller
 * has to ask, because splitting it evenly or handing it to whoever happens to
 * be on the first line would be inventing an answer.
 */
export function soleMechanicOf(saleId: number): number | null {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT mechanic_id FROM sale_items
       WHERE sale_id = ? AND voided = 0 AND mechanic_id IS NOT NULL`,
    )
    .all(saleId) as { mechanic_id: number }[];
  return rows.length === 1 ? rows[0].mechanic_id : null;
}

/**
 * Take money. `amountCents` is the full amount that hits the card or drawer —
 * goods plus any tip the customer left plus the shop's charge on it.
 */
export function takePayment(
  user: PosUser,
  saleId: number,
  args: {
    methodId: number;
    amountCents: number;
    tipCents?: number;
    mechanicId?: number | null;
    commCentsOverride?: number | null;
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
    return { ok: false, error: "Tip amount is not valid" };

  // Only meaningful when there is a tip to attribute. Falls back to the
  // ticket's own technician when the caller didn't name one.
  const mechanicId = tip > 0 ? (args.mechanicId ?? soleMechanicOf(saleId)) : null;

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
    const businessDate = currentBusinessDate();
    // Inside the transaction, so the number is read and taken in one go and two
    // registers ringing at once cannot both be handed the same one.
    const seq = method.is_card === 1 ? nextSeq(businessDate) : null;
    const info = db
      .prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents, comm_overridden,
            mechanic_id, seq, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saleId,
        args.methodId,
        args.amountCents,
        tip,
        comm,
        overridden,
        mechanicId,
        seq,
        user.employeeId,
        businessDate,
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
        mechanic_id: mechanicId,
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

/** How a tip is to be divided when more than one technician worked the ticket. */
export type TipSplit = "equal" | "lines";

/**
 * Who shares a tip, and in what proportion.
 *
 * `equal` is one weight each — two technicians on the ticket, half and half,
 * regardless of who did what.
 *
 * `lines` weights by how many lines each of them worked, which is the shop's own
 * rough measure of effort: three mounts and one mount is three quarters and one
 * quarter. Deliberately NOT weighted by money. A technician who fitted one $200
 * tire while the other did three $8 flats did not earn 96% of the tip, and a
 * split that says so is the kind of arithmetic that starts arguments in the bay.
 * Line count is crude, but everybody can check it by looking at the ticket, and
 * a rule people can verify beats a rule that is subtly fairer and trusted by
 * nobody.
 *
 * Voided lines do not count. Work that was struck off the ticket is work the
 * customer did not pay for.
 */
export function tipSplitWeights(
  saleId: number,
  mode: TipSplit,
): { mechanicId: number; weight: number }[] {
  // ORDERED BY NAME, and that is load-bearing rather than cosmetic. An odd cent
  // has to land somewhere, and `apportionCents` breaks ties by position — so the
  // order of this list decides who gets it. The panel that previews the split
  // lists people by name, because that is how the ticket screen shows them, and
  // if this ordered by id instead the preview would name one person and the
  // ledger would credit another. One cent, which is exactly the size of bug
  // nobody investigates and everybody half-remembers as "the tips are wrong".
  const rows = getDb()
    .prepare(
      `SELECT i.mechanic_id AS mechanicId, COUNT(*) AS lineCount
         FROM sale_items i
         JOIN employees e ON e.id = i.mechanic_id
        WHERE i.sale_id = ? AND i.voided = 0
        GROUP BY i.mechanic_id, e.name
        ORDER BY e.name`,
    )
    .all(saleId) as { mechanicId: number; lineCount: number }[];
  return rows.map((r) => ({
    mechanicId: r.mechanicId,
    weight: mode === "equal" ? 1 : r.lineCount,
  }));
}

/**
 * The forgotten-tip fix. A tip that turns up after the ticket closed is an
 * adjustment row pointing at the original sale — never a second phantom sale,
 * which is what the spreadsheet forced them to do.
 *
 * SPLITTING, AND WHY THE COMMISSION IS WORKED OUT FIRST
 *
 * A split tip writes one adjustment row per technician, because the ledger's
 * whole job is to say who is owed what — a single row for $5 "shared somehow"
 * would push that question to payroll, where the answer is a memory.
 *
 * But the shop's cut is computed on the WHOLE tip before anything is divided,
 * and then divided too. Charging each row separately would quietly raise the
 * shop's take every time a tip was shared: at $1 per $5, a $5 tip costs $1 whole
 * and $2 if split in two, which is the same tip costing the customer more
 * because of an arrangement between two employees. Working it out first and
 * apportioning it means the customer is charged the same amount either way.
 */
export function addTipAdjustment(
  user: PosUser,
  saleId: number,
  args: {
    methodId: number;
    tipCents: number;
    mechanicId?: number | null;
    /** Divide between everyone who worked the ticket. Overrides `mechanicId`. */
    split?: TipSplit | null;
    commCentsOverride?: number | null;
    note?: string | null;
  },
): Result<{ payments: Payment[] }> {
  const sale = getSale(saleId);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided") return { ok: false, error: "This ticket is voided" };
  if (!Number.isInteger(args.tipCents) || args.tipCents <= 0)
    return { ok: false, error: "Tip amount is not valid" };

  const method = getDb()
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND active = 1")
    .get(args.methodId) as PaymentMethod | undefined;
  if (!method) return { ok: false, error: "Unknown payment method" };

  // The shares. One entry with a null mechanic is the un-split case, so the
  // insert below has exactly one shape to deal with.
  let shares: { mechanicId: number | null; weight: number }[];
  if (args.split) {
    const weights = tipSplitWeights(saleId, args.split);
    if (weights.length === 0)
      return {
        ok: false,
        error: "Nobody is named on this ticket's lines, so there is nothing to split between.",
      };
    shares = weights;
  } else {
    shares = [{ mechanicId: args.mechanicId ?? soleMechanicOf(saleId), weight: 1 }];
  }

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

  const weights = shares.map((s) => s.weight);
  const tipParts = apportionCents(args.tipCents, weights);
  const commParts = apportionCents(comm, weights);

  return inTx(() => {
    const db = getDb();
    const now = nowLocalIso();
    // Booked to TODAY's business date, not the sale's: the money moved today.
    const businessDate = currentBusinessDate();
    const shiftId = ensureShift(user).id;
    const ids: number[] = [];
    // One swipe, so one number, whatever it ends up divided into below.
    const seq = method.is_card === 1 ? nextSeq(businessDate) : null;

    shares.forEach((share, n) => {
      const info = db
        .prepare(
          `INSERT INTO payments
             (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents, comm_overridden,
              mechanic_id, seq, taken_by, business_date, shift_id, note, created_at)
           VALUES (?, ?, 'tip_adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          saleId,
          args.methodId,
          tipParts[n] + commParts[n],
          tipParts[n],
          commParts[n],
          overridden,
          share.mechanicId,
          // The SEQ goes on the first row only. All of these rows are one swipe
          // on the terminal, and repeating its sequence number on each would
          // make the batch look like it had three charges where it had one.
          n === 0 ? seq : null,
          user.employeeId,
          businessDate,
          shiftId,
          args.note?.trim() || null,
          now,
        );
      ids.push(Number(info.lastInsertRowid));
    });

    recalcMoney(saleId);

    logActorAudit(actorOf(user), {
      action: "payment.tip_adjustment",
      targetType: "sale",
      targetId: saleId,
      details: {
        payment_ids: ids,
        sale_no: sale.sale_no,
        sale_business_date: sale.business_date,
        tip_cents: args.tipCents,
        comm_cents: comm,
        split: args.split ?? null,
        shares: shares.map((s, n) => ({
          mechanic_id: s.mechanicId,
          tip_cents: tipParts[n],
          comm_cents: commParts[n],
        })),
      },
    });

    const payments = ids.map(
      (id) => db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Payment,
    );
    return { ok: true as const, payments };
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
            mechanic_id, reverses_payment_id, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'reversal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        saleId,
        p.method_id,
        -p.amount_cents,
        -p.tip_cents,
        -p.comm_cents,
        // The same technician as the row being reversed, so the negative lands
        // on the same person the positive did. Left null it would sum to a
        // technician keeping credit for a tip on a voided ticket, which is
        // exactly the kind of quiet payroll error this ledger exists to prevent.
        p.mechanic_id,
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

    // The tires come back on the rack. Mirrored return rows, not deletions --
    // the sale movements stay as the record that the stock did go out once.
    const returned = reverseSaleMovements(user, saleId, "void_return", `Void: ${reason.trim()}`);

    logActorAudit(actorOf(user), {
      action: "sale.void",
      targetType: "sale",
      targetId: saleId,
      details: {
        sale_no: sale.sale_no,
        reason: reason.trim(),
        reversed_payments: originals.length,
        returned_movements: returned.ok ? returned.returned : 0,
      },
      before: { status: sale.status, total_cents: sale.total_cents },
      after: { status: "voided" },
    });
    return { ok: true as const };
  });
}

/**
 * The customer paid, but the row says the wrong thing about it.
 *
 * Two mistakes, one shape. A ticket gets rung to Credit Account when the card
 * was actually swiped — the money is right and the bucket is wrong. Or $210 goes
 * in as $120 — the bucket is right and the money is wrong. Both are a record
 * that disagrees with what happened at the counter, and both are fixed the same
 * way. Either can be corrected on its own, or the two together.
 *
 * Left alone, a wrong TENDER breaks the drawer count and the card batch. A wrong
 * AMOUNT is worse: the ticket's balance is derived from what was collected, so a
 * mis-keyed figure invents a debt the customer does not owe, or settles one they
 * do — and the shop chases the wrong person or nobody at all.
 *
 * It does NOT edit the row. `setPaymentSeq` is the one field in this ledger that
 * is correctable in place, and the reason it is the only one is that a reference
 * number moves no money. These do. So this reverses the original and takes it
 * again saying the right thing, which is the same shape as every other undo here
 * — the wrong row stays as the record that the mistake was made, and the two new
 * rows say what was done about it.
 *
 * BOTH NEW ROWS KEEP THE ORIGINAL'S BUSINESS DATE AND SHIFT, and that is the
 * whole difference between this and a void. A void takes money back out of the
 * drawer now, so it belongs to the shift doing the voiding. Nothing moves here —
 * the customer paid once, on the day they paid, and the correction is to the
 * record rather than to the till. Landing them in today's shift would take $210
 * out of one day's card total and put it into another's.
 *
 * The consequence, said out loud: correcting a payment on a shift that has
 * already been counted changes what that shift expected. That is intended. The
 * count was taken against a number that was wrong, and the honest thing is for
 * it to move.
 *
 * Manager and up. A cashier fixing their own figures at the counter is how the
 * day's cash total becomes whatever the last person to touch it decided.
 */
export function correctPayment(
  user: PosUser,
  paymentId: number,
  args: { methodId?: number; amountCents?: number; reason: string },
): Result<{ payment: Payment }> {
  const reason = args.reason;
  if (!can(user.role, "correctPayment"))
    return { ok: false, error: "Only a manager can correct a payment" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };

  const db = getDb();
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as
    | Payment
    | undefined;
  if (!payment) return { ok: false, error: "Payment not found" };

  // Only a plain payment. A reversal, a refund or a tip adjustment each mean
  // something specific about money that already moved, and correcting one would
  // be answering a question nobody asked.
  if (payment.kind !== "payment")
    return { ok: false, error: `A ${payment.kind.replace("_", " ")} cannot be corrected this way` };

  const methodId = args.methodId ?? payment.method_id;
  const amountCents = args.amountCents ?? payment.amount_cents;
  if (methodId === payment.method_id && amountCents === payment.amount_cents)
    return { ok: true as const, payment };

  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { ok: false, error: "The amount is not valid" };
  // The amount is the whole charge, tip and terminal tax included, so it cannot
  // be less than the part of itself that is not goods.
  if (amountCents < payment.tip_cents + payment.comm_cents)
    return {
      ok: false,
      error: `That is less than the ${formatCents(payment.tip_cents + payment.comm_cents)} of tip and terminal tax already on this payment`,
    };

  const already = db
    .prepare("SELECT 1 FROM payments WHERE reverses_payment_id = ? LIMIT 1")
    .get(paymentId);
  if (already)
    return { ok: false, error: "That payment has already been reversed" };

  const sale = getSale(payment.sale_id);
  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status === "voided")
    return { ok: false, error: "This ticket is voided — nothing to correct" };

  // Over the ticket is refused, the same rule the register follows when the
  // money is first taken: short is an ordinary afternoon and leaves a balance to
  // chase, over is arithmetic that went wrong. A deliberate overpayment is a
  // deposit and has its own path.
  const others = db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE sale_id = ? AND id <> ?",
    )
    .get(payment.sale_id, paymentId) as { n: number };
  if (others.n + amountCents > sale.total_cents)
    return {
      ok: false,
      error: `That would put ${formatCents(others.n + amountCents)} against a ${formatCents(sale.total_cents)} ticket`,
    };

  const method = db
    .prepare("SELECT * FROM payment_methods WHERE id = ? AND active = 1")
    .get(methodId) as PaymentMethod | undefined;
  if (!method) return { ok: false, error: "Unknown payment method" };

  // Named for what was actually wrong, so the ledger and the audit log read as
  // the sentence somebody would say about it rather than as one generic word
  // covering two different mistakes.
  const changedMethod = methodId !== payment.method_id;
  const changedAmount = amountCents !== payment.amount_cents;
  const what = changedMethod && changedAmount ? "Wrong tender and amount" : changedMethod ? "Wrong tender" : "Wrong amount";

  return inTx(() => {
    const now = nowLocalIso();

    db.prepare(
      `INSERT INTO payments
         (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents,
          mechanic_id, reverses_payment_id, taken_by, business_date, shift_id, note, created_at)
       VALUES (?, ?, 'reversal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      payment.sale_id,
      payment.method_id,
      -payment.amount_cents,
      -payment.tip_cents,
      -payment.comm_cents,
      payment.mechanic_id,
      payment.id,
      user.employeeId,
      payment.business_date,
      payment.shift_id,
      `${what}: ${reason.trim()}`,
      now,
    );

    /*
      The SEQ follows the CHARGE, not the row.

      A different tender is a different charge: money that was on the house
      account is now on the card, the terminal has a slip for it, and it needs a
      number of its own. So that takes a fresh one -- against the original day,
      because that is the batch it belongs to.

      Re-stating the SAME card at a corrected amount is not a second charge. The
      terminal ran one transaction and printed one slip; the register wrote the
      wrong figure down beside it. Handing the replacement a new number would put
      two numbered card charges in the register against one in the batch, which
      is precisely the disagreement SEQ exists to make findable. It carries the
      original's number instead.

      Duplicates are already allowed here -- see `setPaymentSeq` -- and the
      reversal carries none, so the batch still lines up one-to-one.
    */
    const seq =
      method.is_card === 1
        ? changedMethod
          ? nextSeq(payment.business_date)
          : payment.seq
        : null;

    const info = db
      .prepare(
        `INSERT INTO payments
           (sale_id, method_id, kind, amount_cents, tip_cents, comm_cents, comm_overridden,
            mechanic_id, seq, taken_by, business_date, shift_id, note, created_at)
         VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payment.sale_id,
        methodId,
        amountCents,
        payment.tip_cents,
        payment.comm_cents,
        payment.comm_overridden,
        payment.mechanic_id,
        seq,
        user.employeeId,
        payment.business_date,
        payment.shift_id,
        `Corrected: ${reason.trim()}`,
        now,
      );

    recalcMoney(payment.sale_id);

    const next = db
      .prepare("SELECT * FROM payments WHERE id = ?")
      .get(Number(info.lastInsertRowid)) as Payment;

    logActorAudit(actorOf(user), {
      action: "payment.correct",
      targetType: "sale",
      targetId: payment.sale_id,
      details: {
        sale_no: sale.sale_no,
        what,
        reason: reason.trim(),
        reversed_payment_id: payment.id,
        new_payment_id: next.id,
      },
      before: {
        method_id: payment.method_id,
        amount_cents: payment.amount_cents,
        seq: payment.seq,
      },
      after: { method_id: methodId, amount_cents: amountCents, seq },
    });

    return { ok: true as const, payment: next };
  });
}
