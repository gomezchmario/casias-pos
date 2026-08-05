import { getDb } from "./db";
import { taxIncludedInCents } from "./money";
import { getSetting } from "./settings";

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
};

/**
 * Every ticket anybody still owes money on, whatever day it was rung.
 *
 * Deliberately NOT scoped to the business date the screen is showing. A balance
 * is not a fact about a day, it is a fact about a customer, and one from three
 * weeks ago is the one most worth chasing — scoping it to today would hide
 * every debt the moment the clock rolls over, which is precisely how the
 * spreadsheet lost track of them.
 *
 * Oldest first for the same reason.
 *
 * Purchases are excluded: a buyback with a balance is money the SHOP owes, and
 * listing it beside money owed TO the shop under one heading is how a total
 * ends up meaning neither.
 *
 * An OPEN ticket with nothing paid on it is not a debt and is excluded. Nobody
 * owes anything yet — it is a ticket somebody is still building, or one left on
 * the screen at the end of a shift. Counting those here would fill the section
 * with tickets nobody is chasing and bury the two that matter, and it gets
 * worse the moment tickets can be staged deliberately: every staged ticket
 * would file itself as money owed the instant it was saved.
 *
 * An open ticket that HAS taken money stays, because that is a deposit — the
 * customer has paid something against work not yet finished, and the shop is
 * holding their money.
 */
export function outstandingTickets(): OutstandingTicket[] {
  return getDb()
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
              s.work_status   AS workStatus
         FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.deleted = 0
          AND s.kind = 'sale'
          AND s.status <> 'voided'
          AND s.balance_cents > 0
          AND (s.status = 'completed' OR s.paid_cents > 0)
     ORDER BY s.business_date ASC, s.id ASC`,
    )
    .all() as OutstandingTicket[];
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

export function dayEntries(businessDate: string): DayEntry[] {
  const db = getDb();

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
              e.name                        AS who,
              i.line_total_cents            AS amountCents,
              -- Scaled by qty so it is comparable to amountCents without the
              -- reader having to divide. Two line totals side by side is a
              -- subtraction anybody can do; a unit price beside a line total is
              -- the kind of near-miss comparison that gets misread.
              CASE WHEN i.list_price_cents IS NULL THEN NULL
                   ELSE i.list_price_cents * i.qty END AS listPriceCents,
              CASE WHEN i.voided = 1 OR s.status = 'voided' THEN 1 ELSE 0 END AS voided
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN employees e ON e.id = i.mechanic_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE s.business_date = ? AND s.deleted = 0`,
    )
    .all(businessDate) as (Omit<
    DayEntry,
    "key" | "kind" | "seq" | "voided" | "category" | "paymentId" | "isCard"
  > & {
    rowId: number;
    categoryCode: string | null;
    voided: number;
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
              e.name                        AS who,
              p.amount_cents                AS amountCents,
              p.seq                         AS seq,
              m.is_card                     AS isCard,
              NULL                          AS listPriceCents,
              CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END AS voided
         FROM payments p
         JOIN payment_methods m ON m.id = p.method_id
         JOIN sales s ON s.id = p.sale_id
    LEFT JOIN employees e ON e.id = p.taken_by
        WHERE p.business_date = ?`,
    )
    .all(businessDate) as (Omit<
    DayEntry,
    "key" | "kind" | "voided" | "category" | "paymentId" | "isCard"
  > & {
    rowId: number;
    isCard: number;
    voided: number;
  })[];

  return [
    ...lines.map((r) => ({
      ...r,
      key: `line-${r.rowId}`,
      kind: "line" as const,
      category: bucketFor(r.ticketKind, r.categoryCode),
      seq: null,
      paymentId: null,
      isCard: false,
      voided: !!r.voided,
    })),
    ...money.map((r) => ({
      ...r,
      key: `money-${r.rowId}`,
      kind: "money" as const,
      // Money against a sale has no category — nothing was done, something was
      // paid. Money against a purchase does: it IS the cashout.
      category: r.ticketKind === "purchase" ? "Cashout" : "",
      paymentId: r.rowId,
      isCard: r.isCard === 1,
      voided: !!r.voided,
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
 * Entries, which is the one place SEQ is shown at all.
 */
