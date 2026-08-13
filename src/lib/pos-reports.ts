import { getDb } from "./db";
import { businessDateFor } from "./business-date";
import { deletedEntryIds, listEntryDeletions } from "./entry-deletions";
import { taxIncludedInCents } from "./money";
import { getSetting } from "./settings";
import type { FulfillmentStatus } from "./sales";

export type DayTotals = {
  businessDate: string;
  saleCount: number;
  voidedCount: number;
  /**
   * Goods rung on this day, off the sale headers, NET of anything taken off at
   * the counter. Excludes purchases.
   *
   * Net rather than list, because this figure's job is to be comparable with
   * what was collected — a $60 ticket discounted to $45 brought the shop $45,
   * and reporting $60 here would open a $15 hole against the drawer that nobody
   * could account for. What was given away is `discountsCents`, alongside.
   */
  goodsCents: number;
  /** Taken off tickets rung today. Reported separately because it is the number
   *  an owner wants to see at close, not one to be buried inside the takings. */
  discountsCents: number;
  discountedCount: number;
  /** Cash paid out over the counter for stock — used tires bought in. */
  purchasesCents: number;
  purchaseCount: number;
  /** Cashback paid out on this day, off the ledger. */
  tipCents: number;
  /** Cashback fees taken on this day, off the ledger. */
  commCents: number;
  /** What actually hit the drawer and the terminal on this day. */
  collectedCents: number;
  taxIncludedCents: number;
  /**
   * Ledger rows booked today against a ticket from another day — a late tip or
   * a refund. This is the reconciling item between goods sold and cash
   * collected, so it is reported rather than hidden.
   */
  priorDayAdjustmentCents: number;
  openTicketCount: number;
  /**
   * There is deliberately no `outstandingCents` here. There was, and it
   * disagreed with the outstanding panel sitting two inches below it on the
   * same screen — the header read $110 while the list of owing tickets added
   * up to $60.
   *
   * It disagreed twice over: it counted open tickets that had never taken a
   * cent (a ticket somebody is still building is not a debt), and it was
   * scoped to one business date while the panel lists what is owed across all
   * days. Two numbers with the same name have to come from the same query, so
   * the figure is now summed from `outstandingTickets()` at the one place that
   * shows it.
   */
};

export type MethodTotal = {
  code: string;
  label: string;
  isCard: number;
  amountCents: number;
  tipCents: number;
  commCents: number;
  count: number;
};

export type MechanicTotal = {
  employeeId: number | null;
  name: string;
  salesCents: number;
  lineCount: number;
};

/**
 * A day's money, counted along the two axes that actually differ: what was
 * SOLD that day (sale headers, bucketed by when the ticket was rung) and what
 * was COLLECTED that day (payment ledger, bucketed by when the money moved).
 *
 * They are deliberately not the same number. A tip added on Tuesday for
 * Monday's ticket is Monday's sale but Tuesday's money, and the drawer at
 * Tuesday close has to match Tuesday. `priorDayAdjustmentCents` is exactly
 * that difference.
 */
export function dayTotals(businessDate: string): DayTotals {
  const db = getDb();

  const sold = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(subtotal_cents - discount_cents), 0) AS goods,
              COALESCE(SUM(discount_cents), 0)                  AS discounts,
              COALESCE(SUM(CASE WHEN discount_cents > 0 THEN 1 ELSE 0 END), 0) AS discounted
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'completed'
         AND kind = 'sale'`,
    )
    .get(businessDate) as {
    n: number;
    goods: number;
    discounts: number;
    discounted: number;
  };

  // Goods bought over the counter. Held positive here — it is a cost, not
  // negative revenue, and netting it into sales would understate both.
  const bought = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(subtotal_cents), 0) AS cost
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'completed'
         AND kind = 'purchase'`,
    )
    .get(businessDate) as { n: number; cost: number };

  const collected = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total,
              COALESCE(SUM(tip_cents), 0)    AS tip,
              COALESCE(SUM(comm_cents), 0)   AS comm
       FROM payments
       WHERE business_date = ?`,
    )
    .get(businessDate) as { total: number; tip: number; comm: number };

  const priorDay = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE p.business_date = ? AND s.business_date <> ?`,
    )
    .get(businessDate, businessDate) as { total: number };

  const voided = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sales WHERE business_date = ? AND deleted = 0 AND status = 'voided'",
    )
    .get(businessDate) as { n: number };

  // A count, not a sum. What these tickets add up to is a question about debt
  // and is answered by `outstandingTickets()`; this is a nudge that some
  // tickets are still sitting on the screen unfinished, purchases included —
  // someone has to go back and close them.
  const open = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM sales
       WHERE business_date = ? AND deleted = 0 AND status = 'open'`,
    )
    .get(businessDate) as { n: number };

  return {
    businessDate,
    saleCount: sold.n,
    voidedCount: voided.n,
    goodsCents: sold.goods,
    discountsCents: sold.discounts,
    discountedCount: sold.discounted,
    purchasesCents: bought.cost,
    purchaseCount: bought.n,
    tipCents: collected.tip,
    commCents: collected.comm,
    collectedCents: collected.total,
    taxIncludedCents: taxIncludedInCents(sold.goods, Number(getSetting("tax_rate_bp"))),
    priorDayAdjustmentCents: priorDay.total,
    openTicketCount: open.n,
  };
}

export type TrendDay = {
  businessDate: string;
  saleCount: number;
  goodsCents: number;
};

/**
 * The run-up to the day being closed: this business date and the `back` days
 * before it, oldest first, every day present whether it traded or not.
 *
 * The zero-filling is the whole job. A GROUP BY returns only the days that have
 * rows, so a shop closed on Sunday produces a six-bar chart with no gap in it —
 * and a chart with no gap says the shop traded Sunday. Worse, the day either
 * side of a missed day sit next to each other and read as consecutive. So the
 * calendar is generated first and the takings are joined onto it.
 *
 * Counted exactly as `dayTotals` counts them — completed, undeleted, `kind =
 * 'sale'`, goods net of discount — so the last bar and the Sold figure at the
 * top of the same sheet can never tell different stories. That is a rule worth
 * stating: the bar for today IS the headline, drawn small.
 */
export function dayTrend(businessDate: string, back = 6): TrendDay[] {
  const db = getDb();

  const days: string[] = [];
  const cursor = new Date(`${businessDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return [];
  cursor.setUTCDate(cursor.getUTCDate() - back);
  for (let i = 0; i <= back; i++) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const rows = db
    .prepare(
      `SELECT business_date AS businessDate,
              COUNT(*)      AS saleCount,
              COALESCE(SUM(subtotal_cents - discount_cents), 0) AS goodsCents
         FROM sales
        WHERE deleted = 0 AND status = 'completed' AND kind = 'sale'
          AND business_date BETWEEN ? AND ?
     GROUP BY business_date`,
    )
    .all(days[0], days[days.length - 1]) as TrendDay[];

  const byDate = new Map(rows.map((r) => [r.businessDate, r]));
  return days.map(
    (d) => byDate.get(d) ?? { businessDate: d, saleCount: 0, goodsCents: 0 },
  );
}

export type DayDiscount = {
  saleId: number;
  saleNo: string;
  discountCents: number;
  reason: string | null;
  /** Who authorised it, which on a large one is the point of the whole row. */
  byName: string | null;
  /** What the ticket would have come to. Without it, "$15 off" reads the same
   *  on a $20 ticket as on a $400 one, and only one of those is a question. */
  subtotalCents: number;
  voided: boolean;
};

/**
 * Every ticket money came off today, listed rather than summed.
 *
 * A total alone is unreadable: $60 of discounts is four regulars getting $15
 * each or one ticket half given away, and those are completely different
 * conversations. Voided tickets stay in and are flagged, because "discount it,
 * then void it" is the shape a till tap takes and dropping them would hide
 * exactly the rows worth looking at.
 */
export function dayDiscounts(businessDate: string): DayDiscount[] {
  return getDb()
    .prepare(
      `SELECT s.id              AS saleId,
              s.sale_no         AS saleNo,
              s.discount_cents  AS discountCents,
              s.discount_reason AS reason,
              e.name            AS byName,
              s.subtotal_cents  AS subtotalCents,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS voided
         FROM sales s
    LEFT JOIN employees e ON e.id = s.discount_by
        WHERE s.business_date = ? AND s.deleted = 0 AND s.discount_cents > 0
     ORDER BY s.discount_cents DESC`,
    )
    .all(businessDate)
    .map((r) => {
      const row = r as Omit<DayDiscount, "voided"> & { voided: number };
      return { ...row, voided: !!row.voided };
    });
}

/** What actually hit each tender, straight off the ledger. */
export function dayByMethod(businessDate: string): MethodTotal[] {
  return getDb()
    .prepare(
      `SELECT m.code, m.label, m.is_card AS isCard,
              COALESCE(SUM(p.amount_cents), 0) AS amountCents,
              COALESCE(SUM(p.tip_cents), 0)    AS tipCents,
              COALESCE(SUM(p.comm_cents), 0)   AS commCents,
              COUNT(*)                         AS count
       FROM payments p
       JOIN payment_methods m ON m.id = p.method_id
       WHERE p.business_date = ?
       GROUP BY m.id
       ORDER BY m.sort_order`,
    )
    .all(businessDate) as MethodTotal[];
}

/**
 * A day's work split by who did it — three kinds of row, not two.
 *
 * A real employee gets their own row. Everything rung against Other collapses
 * into ONE row however many different names were written in, because those
 * names are typed by hand at a counter and "Miguel", "miguel" and "Miguel R"
 * are three strings and one person; ranking them separately would be inventing
 * precision the data does not have. Unassigned stays what it always was: lines
 * nobody claimed at all, which is a different fact from lines somebody claimed
 * who is not on the payroll, and the shop should be able to tell them apart.
 */
export function dayByMechanic(businessDate: string): MechanicTotal[] {
  return getDb()
    .prepare(
      `SELECT i.mechanic_id AS employeeId,
              COALESCE(e.name,
                       CASE WHEN i.mechanic_name IS NOT NULL THEN 'Other'
                            ELSE 'Unassigned' END) AS name,
              COALESCE(SUM(i.line_total_cents), 0) AS salesCents,
              COUNT(*) AS lineCount
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
       LEFT JOIN employees e ON e.id = i.mechanic_id
       WHERE s.business_date = ? AND s.deleted = 0 AND s.status = 'completed'
         AND s.kind = 'sale' AND i.voided = 0
       GROUP BY i.mechanic_id,
                CASE WHEN i.mechanic_id IS NULL AND i.mechanic_name IS NOT NULL
                     THEN 1 ELSE 0 END
       ORDER BY salesCents DESC`,
    )
    .all(businessDate) as MechanicTotal[];
}

export type OutstandingTicket = {
  saleId: number;
  saleNo: string;
  businessDate: string;
  status: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  /** Where the car is. NULL means nobody has said, which reads as Waiting. */
  workStatus: string | null;
  /** How far along, if this is a tire the shop promised to fetch. */
  fulfillmentStatus: FulfillmentStatus;
  /** What was rung, as one line — "2× 205/55R16, MOUNT & B". */
  what: string;
  /**
   * How many of this ticket's tire lines could be filled off the rack today.
   *
   * Zero on a ticket with no tire on it, and zero when the tire is one the shop
   * does not have — which is the normal state of a special order and the reason
   * it is a special order. Anything above zero on a ticket still waiting for a
   * tire means somebody could finish it this morning without ordering anything.
   */
  tiresOnRack: number;
  /**
   * Who worked it, from the ticket's own lines. Empty when nobody was named.
   *
   * Distinct, because a four-tire job is four lines with the same name on them
   * and "Luis, Luis, Luis, Luis" answers nothing.
   */
  techs: string;
};

/**
 * Every ticket the shop still owes something on, whatever day it was rung.
 *
 * SOMETHING, not money. Three different debts land in this one list and they
 * are deliberately not separated:
 *
 *   - a balance — the customer owes the shop,
 *   - an unfinished order — the shop owes the customer a tire, and
 *   - a car on the lot — the shop has somebody's vehicle.
 *
 * The last two are why this is not simply `balance_cents > 0`. A tire paid for in
 * full and not yet on the car is the single easiest thing in this business to
 * forget, precisely because the money side looks finished: the ticket is
 * completed, the balance is zero, and every screen that reads money says the
 * job is done. Five of the eight orders on the day this was written were paid
 * in full and would have disappeared from the shop's only warning panel the
 * moment they were rung.
 *
 * Deliberately NOT scoped to the business date the screen is showing. A debt is
 * not a fact about a day, it is a fact about a customer, and one from three
 * weeks ago is the one most worth chasing — scoping it to today would hide
 * every one the moment the clock rolls over, which is precisely how the
 * spreadsheet lost track of them.
 *
 * Oldest first for the same reason.
 *
 * Purchases are excluded: a buyback with a balance is money the SHOP owes, and
 * listing it beside money owed TO the shop under one heading is how a total
 * ends up meaning neither.
 *
 * An OPEN ticket with lines on it and nothing paid IS included. What the screens
 * do with it differs, and deliberately. Main splits this list on whether any
 * money has come in: everything that has collected nothing goes into a red
 * Pending box above the debts — a draft nobody completed and a ticket closed
 * with the customer owing the lot both land there, since both are work done and
 * not a cent taken, and only the drafts carry a pill. What is left is money
 * part-collected or a tire still owed, which is chased by phoning somebody
 * rather than by finishing a ticket. The EOD sheet drops the drafts altogether:
 * it is a signed record of the day's money, and a half-rung ticket nobody
 * completed is not money owed by anyone.
 *
 * They used to be excluded altogether, on the reasoning that nobody owes
 * anything until a cashier presses Complete, so a half-built ticket is not a
 * debt. The shop's ruling is the other way, and it is the right one: work that
 * has been rung and not paid for is exactly the thing that walks out of a tire
 * shop, and whether somebody remembered to press a button is a fact about the
 * register rather than about the money. A draft nobody chases is the failure
 * these panels exist to prevent, so a draft belongs in them.
 *
 * `balance_cents > 0` is what keeps that honest. A ticket with no lines on it
 * has no balance and never appears, so staging an empty ticket — or leaving one
 * open on the screen at the end of a shift — still costs the panel nothing. It
 * is only ever rung work that shows up.
 *
 * An open ticket that HAS taken money is here for a second reason: that is a
 * deposit — the customer has paid something against work not yet finished, and
 * the shop is holding their money.
 *
 * The clauses are written out separately below rather than sharing one gate,
 * because a status somebody has deliberately set is its own reason to be here:
 * if a cashier has said the customer left their car, the shop is holding a
 * vehicle whether or not a single line has been rung against it yet.
 */
export function outstandingTickets(): OutstandingTicket[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id            AS saleId,
              s.sale_no       AS saleNo,
              s.business_date AS businessDate,
              s.status        AS status,
              s.total_cents   AS totalCents,
              s.paid_cents    AS paidCents,
              s.balance_cents AS balanceCents,
              c.name          AS customerName,
              c.phone         AS customerPhone,
              s.notes         AS notes,
              s.work_status   AS workStatus,
              s.fulfillment_status AS fulfillmentStatus,
              -- The lines, as one string, so the panel can unfold "what is this
              -- one?" without a second request per row. Voided lines are left
              -- out: a line struck off a ticket is not part of what was sold.
              COALESCE((SELECT GROUP_CONCAT(
                          CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                               ELSE i.description END, ', ')
                          FROM sale_items i
                         WHERE i.sale_id = s.id AND i.voided = 0), '') AS what,
              -- IS THE TIRE THIS TICKET IS WAITING FOR ACTUALLY ON THE RACK?
              --
              -- A ticket sits in Outstanding for one of two reasons: it owes
              -- money, or it owes a tire. For the second kind this is the whole
              -- question, and until now the only way to answer it was to write
              -- the size down, walk to Inventory, and search — for each ticket,
              -- every morning.
              --
              -- Counted off the movement ledger like every other stock figure,
              -- rather than a column somebody can typo. Correlated per ticket,
              -- which is fine: Outstanding is a handful of rows by design, and
              -- the day it is not, that is the problem worth looking at.
              (SELECT COUNT(*)
                 FROM sale_items i
                 JOIN products p ON p.id = i.product_id
                WHERE i.sale_id = s.id AND i.voided = 0
                  AND p.kind = 'tire' AND p.deleted = 0
                  AND (SELECT COALESCE(SUM(m.qty_delta), 0)
                         FROM inventory_movements m
                        WHERE m.product_id = p.id) >= i.qty) AS tiresOnRack,
              -- Whose hands were on it. The employee's own name where the line
              -- names one, the typed name where it does not, and nothing at all
              -- where neither -- GROUP_CONCAT drops the NULLs for free, so an
              -- unassigned ticket comes back empty rather than as a row of
              -- commas.
              (SELECT GROUP_CONCAT(DISTINCT COALESCE(e.name, i.mechanic_name))
                 FROM sale_items i
            LEFT JOIN employees e ON e.id = i.mechanic_id
                WHERE i.sale_id = s.id AND i.voided = 0) AS techs
         FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.deleted = 0
          AND s.kind = 'sale'
          AND s.status <> 'voided'
          AND (
                -- Money owed, whatever stage the ticket is at. Drafts included:
                -- see above.
                s.balance_cents > 0
                -- Still owed a tire, whatever the money says. 'delivered' and
                -- 'cancelled' are the two answers that mean the shop is done
                -- with it; every other stage is a promise outstanding.
                OR (s.is_special_order = 1
                    AND s.fulfillment_status NOT IN ('none', 'delivered', 'cancelled'))
                -- Somebody's car is here. 'picked_up' is the one answer that
                -- means it is not: the same role 'delivered' plays for a tire,
                -- and without it a car that went home would sit on the panel
                -- for good, because nothing else ever clears a work status.
                OR (s.work_status IS NOT NULL AND s.work_status <> 'picked_up')
              )
     ORDER BY s.business_date ASC, s.id ASC`,
    )
    .all() as (Omit<OutstandingTicket, "techs"> & { techs: string | null })[];

  // GROUP_CONCAT's separator is a bare comma and cannot be given one while it
  // is also being asked for DISTINCT, so the space goes on here.
  return rows.map((r) => ({
    ...r,
    techs: (r.techs ?? "").split(",").filter(Boolean).join(", "),
  }));
}

export type DayEntry = {
  /** Stable across reloads, and unique across the two halves of the union. */
  key: string;
  /** `line` is something rung onto a ticket; `money` is something that moved. */
  kind: "line" | "money";
  at: string;
  saleId: number;
  saleNo: string;
  saleStatus: string;
  /**
   * What is still owed on the ticket this row belongs to.
   *
   * The one measure of whether a ticket is finished. `saleStatus` sits above it
   * and is a different, weaker thing — it says whether somebody pressed the
   * button, not whether the shop has been paid. A ticket can be `completed` and
   * still owe $28 (a special order part-paid), and it can be `open` with the
   * full amount already on the card. Reading status as "settled" gets both of
   * those backwards, and the second one is the expensive direction.
   *
   * Zero on a voided ticket by construction — its payments are all reversed and
   * nobody owes it, which is handled in `recalcMoney` rather than here.
   */
  saleBalanceCents: number;
  /** `sale` or `purchase` — a buyback is money out and must not read as income. */
  ticketKind: string;
  /** The headline: a description for a line, the tender for a payment. */
  what: string;
  /**
   * The bucket, and one of exactly five: New Tire, Used Tire, Oil Change, Other
   * Service, Cashout. Empty on money moved against a sale, which is not work
   * done and belongs to no category.
   *
   * A closed list on purpose. This column is read by scanning down it for runs
   * of the same word, and that only works if the words are few and fixed —
   * every extra value halves how quickly the eye finds anything. So the
   * finer-grained categories the register rings against (Disposal, Battery)
   * report as Other Service here. Nothing is lost: what it actually was is
   * spelled out in the What column beside it, which already says DISPOSAL or
   * BATTERY LARGE.
   *
   * Cashout is not a service category at all — it is the ticket being a
   * buyback. It sits in this column because to the person reading the day it is
   * the same kind of fact as the other four: what sort of thing happened.
   */
  category: string;
  /** Everything that did not fit a column of its own: the quantity when it is
   *  more than one, the payment's kind when it is not a plain payment. */
  detail: string;
  /**
   * The ticket's own note — "DEPOSIT — BALANCE ON PICKUP", "customer says the
   * left rear keeps going down".
   *
   * Carried on every row of the ticket rather than fetched separately, because
   * the reader is scanning a list and the note is the sentence that explains
   * why a row looks odd. It is the same string the ticket itself shows and the
   * same one the day screen prints beside a debt; whoever writes it once must
   * see it everywhere, or it gets written twice in two places and the two
   * disagree.
   */
  saleNotes: string | null;
  /**
   * Why the TICKET was voided, when it was. Null on everything else, including
   * a voided line sitting on a live ticket — that is a different event with a
   * different cause and no reason recorded against it.
   */
  voidReason: string | null;
  /**
   * Who the ticket was for. NOT a column on the list — searched, never shown.
   *
   * The screen has no room for it and does not need it: every row already
   * carries a ticket number, and one click opens the drawer where the name and
   * the phone are. What was missing was the other direction — being handed a
   * name or half a phone number over the counter and finding every ticket that
   * belongs to it. So the fields ride along to be matched against and are
   * otherwise invisible.
   *
   * Null on the great majority of tickets, which take no name at all.
   */
  customerName: string | null;
  customerPhone: string | null;
  /** The technician on a line; the cashier who took a payment. */
  who: string | null;
  amountCents: number;
  seq: string | null;
  /** The payment behind a money row, so its SEQ can be corrected in place. Null
   *  on a line. */
  paymentId: number | null;
  /** Only a card has a sequence number, so only a card row offers to edit one. */
  isCard: boolean;
  /**
   * The shelf price this line was rung against, frozen at ring time, or null
   * when none applied — a service, a used tire, or any money row. When it is
   * set and differs from what was actually charged, somebody unlocked the price
   * at the counter, and that is worth seeing on a list of the day's events.
   */
  listPriceCents: number | null;
  /** Dead — a voided line, or any row on a voided ticket. */
  voided: boolean;
  /**
   * The TICKET was voided, as opposed to this one row being dead.
   *
   * They are different facts and the list draws them differently: a voided
   * ticket is a whole event that did not happen and is coloured as one, while a
   * line struck off a live ticket is a correction mid-sale and is hidden by
   * default. Reading `voided` for either gets one of the two wrong.
   */
  saleVoided: boolean;
  /**
   * Money has been given back on this ticket — and the ticket still stands.
   *
   * A THIRD STATE, not a shade of void, and the list colours it differently for
   * exactly that reason. A void means the sale did not happen; a refund means it
   * did happen and some of the money went back. They look alike from a distance
   * and they are opposite facts about the day: a voided ticket has no takings in
   * it at all, while a refunded one has takings AND money out, both real.
   */
  saleRefunded: boolean;
  /**
   * Struck off the log by the owner — see `entry-deletions.ts`. Null on every
   * row for everybody else, because they never receive one that is set.
   */
  deletedBy: string | null;
  deletedAt: string | null;
  deletedReason: string | null;
  /**
   * This row carries no live money, so the owner may strike it off the log.
   *
   * The same rule as `stillLive()` in `entry-deletions.ts`, said in SQL. That
   * function is the one that decides — this only governs whether the button is
   * drawn, and if the two ever disagree the server refuses and says why. A
   * button offered on a row the server would reject is a worse failure than a
   * button missing from one it would allow, so this errs toward not drawing it.
   */
  strikeable: boolean;
};

/**
 * Everything that happened today, in one consecutive list.
 *
 * The day screen deliberately shows a summary and the last few lines; this is
 * the other thing, the one you open when the drawer is short and the question
 * is "what actually happened at 2pm". So it is a union rather than two tables:
 * a line rung and the money taken against it are the same event to the person
 * reading, and interleaving them by time is what makes a sequence legible.
 * Two separate lists force the reader to do the merge in their head, which is
 * exactly the step that goes wrong at the end of a long day.
 *
 * Voids stay in and are flagged, never filtered. The entire reason to open a
 * consecutive list is to find the thing that went wrong, and the thing that
 * went wrong is very often the thing that was voided.
 *
 * Payments are selected on their OWN business date, not their ticket's, so
 * money collected today against last week's special order appears here — it
 * moved today, and the drawer it moved into is today's.
 */
/**
 * The five buckets, keyed by the register's own category codes.
 *
 * Anything not named here lands in Other Service, which is the point: the list
 * of categories a sale can be rung against grows (Disposal, Battery, whatever
 * comes next), and this column must not grow with it. A code missing from this
 * map is not a bug to fix, it is the default working.
 */
const CATEGORY_BUCKET: Record<string, string> = {
  new_tire: "New Tire",
  used_tire: "Used Tire",
  oil_change: "Oil Change",
};

function bucketFor(ticketKind: string, code: string | null): string {
  // A buyback outranks whatever the line was rung against — the money is going
  // the other way, and that is the first thing a reader needs to know about it.
  if (ticketKind === "purchase") return "Cashout";
  return CATEGORY_BUCKET[code ?? ""] ?? "Other Service";
}

/**
 * @param from  first business date, inclusive
 * @param to    last business date, inclusive. Defaults to `from`, which is the
 *              overwhelmingly common case — one day, the day being closed.
 *
 * A range rather than a day because the questions people bring to this list
 * outgrew it: "when did we last do a 245-45-20 for that fleet", "what did we
 * take on cards last week". Both are answerable one day at a time and nobody
 * does it that way — they give up, or they go back to the spreadsheet.
 */
export function dayEntries(
  from: string,
  to: string = from,
  opts?: {
    /**
     * Show the rows the owner has struck off, marked as struck.
     *
     * Off everywhere by default, including on the owner's close-out. "Deleted"
     * has to mean one simple thing or it means nothing, and the simple thing is
     * this: struck rows appear on the Logs tab, to the one person who can strike
     * them, and nowhere else at all.
     */
    includeDeleted?: boolean;
  },
): DayEntry[] {
  const db = getDb();
  const struck = deletedEntryIds();
  const strikeInfo = opts?.includeDeleted
    ? new Map(listEntryDeletions().map((d) => [`${d.entryKind}-${d.targetId}`, d]))
    : new Map();

  const lines = db
    .prepare(
      `SELECT i.id                          AS rowId,
              i.created_at                  AS at,
              s.id                          AS saleId,
              s.sale_no                     AS saleNo,
              s.status                      AS saleStatus,
              s.balance_cents               AS saleBalanceCents,
              s.kind                        AS ticketKind,
              i.description                 AS what,
              c.code                        AS categoryCode,
              CASE WHEN i.qty > 1 THEN '×' || i.qty ELSE '' END AS detail,
              s.notes                       AS saleNotes,
              s.void_reason                 AS voidReason,
              -- Who the ticket was for, carried on every row so the list can be
              -- searched by name or phone. Null on the great majority of
              -- tickets, which take no name at all.
              cu.name                       AS customerName,
              cu.phone                      AS customerPhone,
              e.name                        AS who,
              i.line_total_cents            AS amountCents,
              -- Scaled by qty so it is comparable to amountCents without the
              -- reader having to divide. Two line totals side by side is a
              -- subtraction anybody can do; a unit price beside a line total is
              -- the kind of near-miss comparison that gets misread.
              CASE WHEN i.list_price_cents IS NULL THEN NULL
                   ELSE i.list_price_cents * i.qty END AS listPriceCents,
              CASE WHEN i.voided = 1 OR s.status = 'voided' THEN 1 ELSE 0 END AS voided,
              -- Money given back on this ticket, which is not the same as the
              -- ticket being voided. See saleRefunded on DayEntry.
              CASE WHEN EXISTS (SELECT 1 FROM payments rf
                                 WHERE rf.sale_id = s.id AND rf.kind = 'refund')
                   THEN 1 ELSE 0 END AS saleRefunded
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN employees e ON e.id = i.mechanic_id
    LEFT JOIN customers cu ON cu.id = s.customer_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        -- A ticket the owner has struck WHOLE carries sales.deleted, which is
        -- what takes it out of every count. Its lines have to stay reachable to
        -- the one screen that can put it back, though, or the undo has nothing
        -- left to press. So the flag is honoured for everybody except the
        -- caller who has already asked to see struck rows.
        WHERE s.business_date BETWEEN ? AND ? AND (s.deleted = 0 OR ?)`,
    )
    .all(from, to, opts?.includeDeleted ? 1 : 0) as (Omit<
    DayEntry,
    "key" | "kind" | "seq" | "voided" | "category" | "paymentId" | "isCard" | "saleVoided" | "deletedBy" | "deletedAt" | "deletedReason" | "strikeable" | "saleRefunded"
  > & {
    rowId: number;
    categoryCode: string | null;
    voided: number;
    saleRefunded: number;
  })[];

  const money = db
    .prepare(
      `SELECT p.id                          AS rowId,
              p.created_at                  AS at,
              s.id                          AS saleId,
              s.sale_no                     AS saleNo,
              s.status                      AS saleStatus,
              s.balance_cents               AS saleBalanceCents,
              s.kind                        AS ticketKind,
              m.label                       AS what,
              CASE WHEN p.kind = 'payment' THEN '' ELSE REPLACE(p.kind, '_', ' ') END AS detail,
              s.notes                       AS saleNotes,
              s.void_reason                 AS voidReason,
              cu.name                       AS customerName,
              cu.phone                      AS customerPhone,
              e.name                        AS who,
              p.amount_cents                AS amountCents,
              p.seq                         AS seq,
              m.is_card                     AS isCard,
              NULL                          AS listPriceCents,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS voided,
              -- Dead money: the ticket was voided, this row IS a reversal, or
              -- something reversed it. Wider than the voided flag on purpose --
              -- a tender correction leaves a live-looking pair on a live ticket,
              -- and that pair is the commonest thing worth striking.
              CASE WHEN s.status = 'voided'
                     OR p.kind = 'reversal'
                     OR EXISTS (SELECT 1 FROM payments rv
                                 WHERE rv.reverses_payment_id = p.id)
                   THEN 1 ELSE 0 END AS strikeable,
              -- Money given back on this ticket, which is not the same as the
              -- ticket being voided. See saleRefunded on DayEntry.
              CASE WHEN EXISTS (SELECT 1 FROM payments rf
                                 WHERE rf.sale_id = s.id AND rf.kind = 'refund')
                   THEN 1 ELSE 0 END AS saleRefunded
         FROM payments p
         JOIN payment_methods m ON m.id = p.method_id
         JOIN sales s ON s.id = p.sale_id
    LEFT JOIN employees e ON e.id = p.taken_by
    LEFT JOIN customers cu ON cu.id = s.customer_id
        WHERE p.business_date BETWEEN ? AND ?`,
    )
    .all(from, to) as (Omit<
    DayEntry,
    "key" | "kind" | "voided" | "category" | "paymentId" | "isCard" | "saleVoided" | "deletedBy" | "deletedAt" | "deletedReason" | "strikeable" | "saleRefunded"
  > & {
    rowId: number;
    isCard: number;
    voided: number;
    strikeable: number;
    saleRefunded: number;
  })[];

  /** The strike, when the caller is allowed to be told about it. */
  const strike = (key: string) => {
    const d = strikeInfo.get(key);
    return {
      deletedBy: d?.byName ?? null,
      deletedAt: d?.deletedAt ?? null,
      deletedReason: d?.reason ?? null,
    };
  };

  return [
    ...lines
      .filter((r) => opts?.includeDeleted || !struck.lines.has(r.rowId))
      .map((r) => ({
        ...r,
        key: `line-${r.rowId}`,
        kind: "line" as const,
        category: bucketFor(r.ticketKind, r.categoryCode),
        seq: null,
        paymentId: null,
        isCard: false,
        voided: !!r.voided,
        saleVoided: r.saleStatus === "voided",
        saleRefunded: !!r.saleRefunded,
        // A line is strikeable exactly when it is dead, and dead is what
        // `voided` already means for a line. No second rule.
        strikeable: !!r.voided,
        ...strike(`line-${r.rowId}`),
      })),
    ...money
      .filter((r) => opts?.includeDeleted || !struck.money.has(r.rowId))
      .map((r) => ({
        ...r,
        key: `money-${r.rowId}`,
        kind: "money" as const,
        // Money against a sale has no category — nothing was done, something was
        // paid. Money against a purchase does: it IS the cashout.
        category: r.ticketKind === "purchase" ? "Cashout" : "",
        paymentId: r.rowId,
        isCard: r.isCard === 1,
        voided: !!r.voided,
        saleVoided: r.saleStatus === "voided",
        saleRefunded: !!r.saleRefunded,
        strikeable: !!r.strikeable,
        ...strike(`money-${r.rowId}`),
      })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export type OffRackLine = {
  saleId: number;
  saleNo: string;
  description: string;
  qty: number;
  who: string | null;
  /** The line total actually charged. */
  chargedCents: number;
  /** What the rack said, times qty, so the two are directly comparable. */
  listCents: number;
  /** Negative when the shop gave it away cheaper; positive when it charged more. */
  deltaCents: number;
};

/**
 * Lines where the price was unlocked at the counter and typed over.
 *
 * This is the day's discretion, gathered in one place. Individually each one is
 * defensible — a tire matched to the price down the road, ten dollars off for a
 * regular — but in aggregate it is the number that quietly explains a month of
 * thin margin, and nobody ever sees it because each decision was small and made
 * at a different hour by a different person.
 *
 * Only lines carrying a frozen rack price can appear: a service or a used tire
 * has no shelf figure and therefore nothing it could deviate from. Voided lines
 * and voided tickets are excluded — a price that was changed and then thrown
 * away cost the shop nothing, and listing it would pad the total with money
 * that never left.
 */
export function offRackLines(businessDate: string): OffRackLine[] {
  return getDb()
    .prepare(
      `SELECT s.id                              AS saleId,
              s.sale_no                         AS saleNo,
              i.description                     AS description,
              i.qty                             AS qty,
              e.name                            AS who,
              i.line_total_cents                AS chargedCents,
              i.list_price_cents * i.qty        AS listCents,
              i.line_total_cents - (i.list_price_cents * i.qty) AS deltaCents
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN employees e ON e.id = i.mechanic_id
        WHERE s.business_date = ?
          AND s.deleted = 0
          AND s.status <> 'voided'
          AND i.voided = 0
          AND i.list_price_cents IS NOT NULL
          AND i.unit_price_cents <> i.list_price_cents
     ORDER BY ABS(i.line_total_cents - (i.list_price_cents * i.qty)) DESC`,
    )
    .all(businessDate) as OffRackLine[];
}

/*
 * The SEQ reconciliation report used to live here: gaps in the run, duplicates,
 * and card charges with no number on them. All three were symptoms of the same
 * cause — a human typing sequence numbers at the counter. The register assigns
 * them now, so a card charge cannot arrive without one and cannot arrive with
 * somebody else's, and the report was left checking for faults the system no
 * longer has a way to commit.
 *
 * What is left is the ordinary case it never covered: the shop running several
 * cards on the terminal and keying the tickets in afterwards, out of order. No
 * report can spot that, because nothing about the data is wrong — only the
 * order is. It is fixed by eye, against the batch, on the card-charge list on
 * Logs, which is the one place SEQ is shown at all.
 */

export type TicketEdit = {
  at: string;
  by: string;
  saleId: number;
  saleNo: string;
  /** The ticket's own day, which is not always the day of the edit. */
  saleDate: string;
  what: string;
  beforeCents: number;
  afterCents: number;
  /** A line struck off entirely, rather than re-priced. */
  voided: boolean;
};

/**
 * Money changed on a ticket that was already finished.
 *
 * A cashier fixing a half-built ticket at the register is ordinary and is not
 * here. This is the other thing: a line re-priced or struck off AFTER the
 * ticket completed — a tire rung at 290 that was really 250, found an hour
 * later. That is a legitimate correction and a manager is allowed to make it,
 * but it moves a number the day has already counted, and a day's takings that
 * quietly disagree with the tickets somebody remembers ringing is how trust in
 * the whole report goes.
 *
 * So every one of them is named on the close-out: what changed, from what to
 * what, who did it and when. Not to accuse anybody — most are honest fixes —
 * but so the figure at the top of the sheet can always be accounted for.
 *
 * Read off `audit_log` rather than a flag column on the sale, and that is the
 * point rather than a shortcut. The audit row is written inside the same
 * transaction as the change; a separate flag is a second thing to remember to
 * set, and the first edit that forgot would be the one worth seeing.
 *
 * Scoped to the day the EDIT happened, not the day the ticket belongs to. The
 * close-out is a record of what was done today, and an edit reaching back into
 * last Tuesday is exactly the thing worth surfacing — so the ticket's own date
 * rides along and the sheet can say so.
 *
 * `audit_log` carries no business date, only a wall clock, so the bucketing is
 * done in `businessDateFor` rather than with `date(timestamp)` in the query. The
 * two disagree for every edit made between midnight and the 4am roll — which is
 * exactly when somebody fixing up the night's tickets is working — and putting
 * those on tomorrow's sheet would take them off the one being signed tonight.
 * SQL narrows to a three-day window first so this is not a scan of the whole
 * log; the helper decides the boundary.
 */
export function ticketEditsForDay(businessDate: string): TicketEdit[] {
  const rows = getDb()
    .prepare(
      `SELECT a.timestamp                        AS at,
              COALESCE(a.employee_name, 'system') AS by,
              s.id                               AS saleId,
              s.sale_no                          AS saleNo,
              s.business_date                    AS saleDate,
              a.action                           AS action,
              a.before_json                      AS beforeJson,
              a.after_json                       AS afterJson,
              i.description                      AS description,
              i.line_total_cents                 AS lineTotal
         FROM audit_log a
         JOIN sales s ON s.id = CAST(a.target_id AS INTEGER)
    LEFT JOIN sale_items i ON i.id = CAST(json_extract(a.details, '$.item_id') AS INTEGER)
        WHERE a.target_type = 'sale'
          AND a.action IN ('sale_item.update', 'sale_item.void')
          AND a.timestamp >= date(?, '-1 day')
          AND a.timestamp <  date(?, '+2 days')
          AND json_extract(a.details, '$.sale_status') = 'completed'
          -- Only where the money moved. A description tidied up or a line moved
          -- to another fitter changes nothing the day counted, and listing those
          -- here would bury the ones that did among the ones that did not.
          AND (a.action = 'sale_item.void' OR a.before_json LIKE '%line_total_cents%')
        ORDER BY a.id`,
    )
    .all(businessDate, businessDate) as {
    at: string;
    by: string;
    saleId: number;
    saleNo: string;
    saleDate: string;
    action: string;
    beforeJson: string | null;
    afterJson: string | null;
    description: string | null;
    lineTotal: number | null;
  }[];

  const cents = (json: string | null): number | null => {
    if (!json) return null;
    try {
      const v = (JSON.parse(json) as Record<string, unknown>).line_total_cents;
      return typeof v === "number" ? v : null;
    } catch {
      return null;
    }
  };

  return rows
    .filter((r) => businessDateFor(r.at) === businessDate)
    .map((r) => {
    const voided = r.action === "sale_item.void";
    return {
      at: r.at,
      by: r.by,
      saleId: r.saleId,
      saleNo: r.saleNo,
      saleDate: r.saleDate,
      what: r.description ?? "a line",
      // A struck line goes from whatever it was worth to nothing. The row is
      // still there, marked voided, so its total is still readable.
      beforeCents: voided ? (r.lineTotal ?? 0) : (cents(r.beforeJson) ?? 0),
      afterCents: voided ? 0 : (cents(r.afterJson) ?? 0),
      voided,
    };
  });
}

export type HouseAccountCharge = {
  paymentId: number;
  at: string;
  saleId: number;
  saleNo: string;
  /** The ticket's own day. A charge can be settled later than it was rung. */
  saleDate: string;
  customer: string | null;
  phone: string | null;
  po: string | null;
  what: string;
  methodLabel: string;
  amountCents: number;
};

/**
 * Every charge put on account today, by name.
 *
 * The tender table counts "Credit Account $360" and stops, which is the right
 * shape for cash and for a card: those are one pile and one batch, and no more
 * needs saying. A house account is not a pile. It is a list of people who owe
 * the shop money, and a single total is the one presentation that cannot be
 * acted on — nobody can ring a number.
 *
 * So the close-out names them. Who, which ticket, how much, and the reference
 * off the invoice if there is one, so the sheet that gets filed is the sheet
 * somebody chases from a week later.
 *
 * Scoped to when the MONEY moved, exactly like the tender total it sits under.
 * Both come off the payment ledger by business date, so the names below and the
 * figure above can never disagree — which is the whole reason to derive it here
 * rather than from the tickets rung today.
 */
export function houseAccountChargesForDay(businessDate: string): HouseAccountCharge[] {
  return getDb()
    .prepare(
      `SELECT p.id            AS paymentId,
              p.created_at    AS at,
              s.id            AS saleId,
              s.sale_no       AS saleNo,
              s.business_date AS saleDate,
              c.name          AS customer,
              c.phone         AS phone,
              s.po            AS po,
              m.label         AS methodLabel,
              p.amount_cents  AS amountCents,
              COALESCE((SELECT GROUP_CONCAT(
                          CASE WHEN i.qty > 1 THEN i.qty || '× ' || i.description
                               ELSE i.description END, ', ')
                          FROM sale_items i
                         WHERE i.sale_id = s.id AND i.voided = 0), '') AS what
         FROM payments p
         JOIN payment_methods m ON m.id = p.method_id
         JOIN sales s ON s.id = p.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
        WHERE p.business_date = ?
          AND m.kind = 'house_account'
          -- Reversals and their originals both drop out: a charge put on
          -- account and taken straight back off is not money anybody owes, and
          -- printing both halves under a heading of debts invites a phone call
          -- to somebody who paid.
          AND p.amount_cents <> 0
          AND p.reverses_payment_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM payments r WHERE r.reverses_payment_id = p.id
          )
        ORDER BY p.id`,
    )
    .all(businessDate) as HouseAccountCharge[];
}

export type StockReceived = {
  movementId: number;
  at: string;
  productId: number;
  name: string;
  qty: number;
  unitCostCents: number;
  by: string | null;
  supplier: string | null;
  reference: string | null;
  /** The ticket it came in for, when it was ordered for somebody by name. */
  saleNo: string | null;
};

/**
 * What came IN off the racks' point of view — the other half of "New tires out".
 *
 * The close-out has always been able to say what left the building. What
 * arrived was nowhere on it, which makes the sheet a record of half the day: a
 * morning delivery of twenty tires is the single largest thing that happens to
 * the stock some days, and the only place it showed was a count somebody would
 * have to go and compare against yesterday's.
 *
 * `reason = 'receive'` only, and that is the whole filter. An opening count is
 * the shop writing down what was already on the shelf, and an adjustment is
 * somebody correcting a number — neither is a delivery, and folding them in
 * would make this block answer "what changed" instead of "what turned up",
 * which is a different and much less useful question.
 *
 * Tires ordered in for one customer are included and say so. They arrive on the
 * same van as everything else, and a delivery note that quietly omitted them
 * would not reconcile against the supplier's invoice.
 *
 * Bucketed on the movement's own `business_date`, which the ledger stores, so
 * this needs none of the wall-clock care `ticketEditsForDay` does.
 */
export function stockReceivedForDay(businessDate: string): StockReceived[] {
  return getDb()
    .prepare(
      `SELECT m.id             AS movementId,
              m.created_at     AS at,
              p.id             AS productId,
              p.name           AS name,
              m.qty_delta      AS qty,
              m.unit_cost_cents AS unitCostCents,
              e.name           AS by,
              l.supplier       AS supplier,
              l.reference      AS reference,
              s.sale_no        AS saleNo
         FROM inventory_movements m
         JOIN products p ON p.id = m.product_id
    LEFT JOIN employees e ON e.id = m.created_by
    LEFT JOIN inventory_lots l ON l.id = m.lot_id
    LEFT JOIN sales s ON s.id = m.sale_id
        WHERE m.business_date = ?
          AND m.reason = 'receive'
        ORDER BY m.id`,
    )
    .all(businessDate) as StockReceived[];
}

// ---------------------------------------------------------------------------
// The month's new tires, in and out
// ---------------------------------------------------------------------------

export type TireMonthRow = {
  businessDate: string;
  productName: string;
  tireSize: string | null;
  qty: number;
  saleNo: string | null;
  byName: string | null;
  /** What was charged for the line, or paid for the receipt. Tax-inclusive. */
  grossCents: number;
  /**
   * Sold off a special order rather than off the rack. Meaningless on the
   * received side, where it is always 0.
   */
  ordered: number;
};

export type TireMonthReport = {
  month: string;
  kind: "sold" | "received" | "disposal";
  /**
   * The first month the stock ledger has anything in it — which is the month
   * the shop's existing racks were typed into the system.
   *
   * Every tire already on a rack on day one had to be entered as a receipt,
   * because a receipt is the only way stock exists here. That makes the first
   * month's "received" total the opening count plus whatever was genuinely
   * bought, with no way to tell the two apart after the fact: both are the same
   * row with the same reason. Reported so the sheet can say so rather than
   * present an opening balance as a month's buying.
   */
  seedMonth: string | null;
  rows: TireMonthRow[];
  qty: number;
  grossCents: number;
  taxCents: number;
  netCents: number;
  taxRateBp: number;
  /**
   * The split that says what kind of month it was: tires brought in for one
   * named customer against tires taken off the rack.
   *
   * Worth separating because they are different businesses wearing the same
   * number. A tire sold from stock is the shop's buying paying off; a tire
   * ordered in is a job the shop won without carrying the stock for it, and a
   * month that is mostly the second one is a month the racks were wrong.
   */
  orderedQty: number;
  stockQty: number;
};

/**
 * Every NEW tire that left the shop, or arrived at it, in one month.
 *
 * Two questions with one shape, which is why they share a function: how many
 * new tires went out and what they came to, and how many came in and what they
 * cost. Used tires are excluded from both on purpose — they have no cost and a
 * price decided at the counter, so putting them in either total would produce a
 * figure that is not true of anything.
 *
 * SOLD reads `sale_items`, not the stock ledger, because the price lives on the
 * line and the ledger only knows counts. RECEIVED reads the ledger, because the
 * cost lives on the movement and nothing else records it.
 *
 * Tax is backed OUT rather than added on. Prices in this shop are tax-inclusive
 * — see `tax_rate_bp` — so the gross is what changed hands and the net is what
 * it is worth once the state's share is removed. Each sold line is divided by
 * the rate ITS OWN ticket froze at completion, not by today's setting: a rate
 * change would otherwise quietly restate every month that came before it.
 */
export function tireMonth(
  month: string,
  kind: "sold" | "received" | "disposal",
): TireMonthReport {
  const db = getDb();
  const like = `${month}%`;
  const currentBp = Number(getSetting("tax_rate_bp"));

  /*
    The disposal sheet is the odd one out: it counts CASINGS, not stock.

    A disposal line is a fee for hauling a customer's dead tire away, so there
    is no product behind it and nothing in the inventory ledger — the tire being
    counted was never the shop's. Matched on the description because that is all
    a fee line has, and matched broadly (%DISPOSAL%) because the counter also
    rings "DISPOSAL FEE", "MOUNT & DISPOSAL" and the like. A combined line's
    money is the whole line — the fee cannot be split back out of a mount after
    the fact — and the sheet says so rather than pretending the split exists.

    The qty is the figure this sheet exists for: it is the number of casings
    accumulating out back, which is what the hauler charges against.
  */
  const rows =
    kind === "disposal"
      ? (db
          .prepare(
            `SELECT s.business_date            AS businessDate,
                    i.description              AS productName,
                    NULL                       AS tireSize,
                    i.qty                      AS qty,
                    s.sale_no                  AS saleNo,
                    e.name                     AS byName,
                    i.line_total_cents         AS grossCents,
                    0                          AS ordered,
                    COALESCE(s.tax_rate_bp, ?) AS taxRateBp
               FROM sale_items i
               JOIN sales s ON s.id = i.sale_id
          LEFT JOIN employees e ON e.id = i.mechanic_id
              WHERE s.business_date LIKE ?
                AND s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
                AND i.voided = 0
                AND UPPER(i.description) LIKE '%DISPOSAL%'
           ORDER BY s.business_date, i.id`,
          )
          .all(currentBp, like) as (TireMonthRow & { taxRateBp: number })[])
      : kind === "sold"
        ? (db
          .prepare(
            `SELECT s.business_date            AS businessDate,
                    i.description              AS productName,
                    p.tire_size                AS tireSize,
                    i.qty                      AS qty,
                    s.sale_no                  AS saleNo,
                    e.name                     AS byName,
                    i.line_total_cents         AS grossCents,
                    s.is_special_order         AS ordered,
                    COALESCE(s.tax_rate_bp, ?) AS taxRateBp
               FROM sale_items i
               JOIN sales s ON s.id = i.sale_id
               JOIN products p ON p.id = i.product_id
          LEFT JOIN employees e ON e.id = i.mechanic_id
              WHERE s.business_date LIKE ?
                AND s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
                AND i.voided = 0
                AND p.kind = 'tire' AND p.condition = 'new'
           ORDER BY s.business_date, i.id`,
          )
          .all(currentBp, like) as (TireMonthRow & { taxRateBp: number })[])
      : (db
          .prepare(
            `SELECT m.business_date       AS businessDate,
                    p.name                AS productName,
                    p.tire_size           AS tireSize,
                    m.qty_delta           AS qty,
                    s.sale_no             AS saleNo,
                    e.name                AS byName,
                    m.qty_delta * m.unit_cost_cents AS grossCents,
                    -- Stock received against a ticket is stock bought for one
                    -- named customer. receiveOrderedStock is what puts the sale
                    -- on the movement, so the flag is already here.
                    COALESCE(s.is_special_order, 0) AS ordered,
                    ?                     AS taxRateBp
               FROM inventory_movements m
               JOIN products p ON p.id = m.product_id
          LEFT JOIN employees e ON e.id = m.created_by
          LEFT JOIN sales s ON s.id = m.sale_id
              WHERE m.business_date LIKE ?
                AND m.reason = 'receive'
                AND p.kind = 'tire' AND p.condition = 'new'
           ORDER BY m.business_date, m.id`,
          )
          .all(currentBp, like) as (TireMonthRow & { taxRateBp: number })[]);

  // Per row, then summed. Backing the tax out of the total instead would round
  // once against a figure the rows do not add up to.
  let gross = 0;
  let tax = 0;
  let qty = 0;
  let orderedQty = 0;
  for (const r of rows) {
    gross += r.grossCents;
    tax += taxIncludedInCents(r.grossCents, r.taxRateBp);
    qty += r.qty;
    if (r.ordered) orderedQty += r.qty;
  }

  const seed = db
    .prepare("SELECT substr(MIN(business_date), 1, 7) AS m FROM inventory_movements")
    .get() as { m: string | null };

  return {
    month,
    kind,
    seedMonth: seed.m,
    rows: rows.map(({ taxRateBp: _drop, ...r }) => r),
    qty,
    grossCents: gross,
    taxCents: tax,
    netCents: gross - tax,
    taxRateBp: currentBp,
    orderedQty,
    stockQty: qty - orderedQty,
  };
}

// ---------------------------------------------------------------------------
// Tips, for the range on screen
// ---------------------------------------------------------------------------

export type TipRow = {
  at: string;
  businessDate: string;
  saleId: number;
  saleNo: string;
  /** `payment` took the tip with the sale; `tip_adjustment` came back later. */
  kind: string;
  method: string;
  /** Who it was for. Null when nobody was named on the ticket. */
  forName: string | null;
  takenBy: string | null;
  tipCents: number;
  /** The terminal fee charged on top of it. */
  commCents: number;
  saleVoided: number;
};

export type TipReport = {
  from: string;
  to: string;
  rows: TipRow[];
  tipCents: number;
  commCents: number;
  /** Tickets that carried a tip, not tip rows — a ticket can carry two. */
  ticketCount: number;
  byTech: { name: string; tipCents: number; count: number }[];
};

/**
 * Every tip in the range, who it was for, and what it came to.
 *
 * Off the payment ledger rather than the sale, because a tip is a thing that
 * MOVED and not a property of a ticket: it can arrive with the sale or turn up
 * two hours later as an adjustment, and the second kind is exactly the one that
 * gets forgotten. Both are rows here and neither is special.
 *
 * A tip on a voided ticket is kept and flagged rather than dropped. Its money
 * has been reversed and the totals below already net it out — but "the tip that
 * was on the ticket we voided" is a question somebody asks out loud, and a list
 * that silently omitted it would answer it wrongly.
 *
 * `byTech` is deliberately not `tipsByTech` from the leaderboard: that one is
 * scoped to a payroll week and skips anyone at zero, which is right for a board
 * on a wall and wrong for a day sheet where a technician who was named on a
 * ticket and got nothing is worth seeing.
 */
export function tipReport(from: string, to: string): TipReport {
  const rows = getDb()
    .prepare(
      `SELECT p.created_at            AS at,
              p.business_date         AS businessDate,
              s.id                    AS saleId,
              s.sale_no               AS saleNo,
              p.kind                  AS kind,
              m.label                 AS method,
              f.name                  AS forName,
              t.name                  AS takenBy,
              p.tip_cents             AS tipCents,
              p.comm_cents            AS commCents,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS saleVoided
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN payment_methods m ON m.id = p.method_id
    LEFT JOIN employees f ON f.id = p.mechanic_id
    LEFT JOIN employees t ON t.id = p.taken_by
        WHERE p.business_date BETWEEN ? AND ?
          AND p.tip_cents <> 0
          AND s.deleted = 0
     ORDER BY p.created_at, p.id`,
    )
    .all(from, to) as TipRow[];

  const byName = new Map<string, { tipCents: number; count: number }>();
  let tip = 0;
  let comm = 0;
  for (const r of rows) {
    tip += r.tipCents;
    comm += r.commCents;
    const key = r.forName ?? "Nobody named";
    const cur = byName.get(key) ?? { tipCents: 0, count: 0 };
    cur.tipCents += r.tipCents;
    cur.count += 1;
    byName.set(key, cur);
  }

  return {
    from,
    to,
    rows,
    tipCents: tip,
    commCents: comm,
    ticketCount: new Set(rows.map((r) => r.saleId)).size,
    byTech: [...byName]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.tipCents - a.tipCents || a.name.localeCompare(b.name)),
  };
}
