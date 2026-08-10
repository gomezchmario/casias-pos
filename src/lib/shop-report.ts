import { getDb } from "./db";
import { shopTrends, type ShopTrends } from "./trends";

/**
 * The evidence behind the written report, over and above what the Trends page
 * draws.
 *
 * A SCREEN AND A DOCUMENT ARE NOT THE SAME THING. The page answers a question
 * somebody already has; a report has to survive being handed to an accountant,
 * a landlord or a buyer six months from now, with nobody standing beside it to
 * explain. So it carries what a screen can leave out: where the figures came
 * from, how much of the history is missing, the check that proves the fall is
 * real rather than an artefact of the records, and the tables the charts were
 * drawn from.
 *
 * It reuses `shopTrends` rather than recomputing anything it already answers.
 * Two documents that disagree about the same shop are worse than one document.
 */

const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";

export type ReportExtras = {
  history: {
    firstDate: string;
    lastDate: string;
    tradingDays: number;
    tickets: number;
    takingsCents: number;
    /** Runs of four days or more with no record of the shop opening. */
    gaps: { from: string; to: string; days: number }[];
  };
  /**
   * The month the register and the old workbook were both running.
   *
   * THE REPORT'S LOAD-BEARING CHECK. Everything else rests on a history typed
   * into a spreadsheet by hand, and the obvious objection is that a workbook
   * kept less carefully in 2026 than in 2024 would manufacture a decline out of
   * nothing. For one month there are two independent records of the same shop:
   * if they agree, that objection is closed.
   */
  verification: {
    month: string;
    pos: { days: number; tickets: number; perDayCents: number; avgTicketCents: number };
    excel: { days: number; tickets: number; perDayCents: number; avgTicketCents: number };
  } | null;
  /** What the shop was actually doing, by description, then and now. */
  topLines: {
    earlyLabel: string;
    lateLabel: string;
    early: { label: string; lines: number; cents: number }[];
    late: { label: string; lines: number; cents: number }[];
  };
  buybacks: { tickets: number; cents: number; units: number };
  stock: {
    activeProducts: number;
    sizesWithStock: number;
    units: number;
    soldLast90: number;
    /** Days of cover at the current rate of sale. */
    daysOfCover: number | null;
  };
  control: {
    discountCents: number;
    discountTickets: number;
    voidedTickets: number;
    voidedCents: number;
    costCoveragePct: number;
  };
  /** The quarterly table the report prints as its appendix. */
  quarters: {
    bucket: string;
    days: number;
    tickets: number;
    perDayCents: number;
    ticketsPerDay: number;
    avgTicketCents: number;
    newPerDayCents: number;
    usedPerDayCents: number;
    servicePerDayCents: number;
    techDaysPerDay: number;
  }[];
};

export type ShopReport = ShopTrends & { extras: ReportExtras };

export function shopReport(today: string): ShopReport {
  const t = shopTrends(today);
  const db = getDb();

  const head = db
    .prepare(
      `SELECT MIN(s.business_date) lo, MAX(s.business_date) hi,
              COUNT(DISTINCT s.business_date) days, COUNT(*) tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) takings
         FROM sales s WHERE ${SALE}`,
    )
    .get() as { lo: string; hi: string; days: number; tickets: number; takings: number };

  // ── The holes ─────────────────────────────────────────────────────────────
  const have = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT s.business_date d FROM sales s WHERE ${SALE} ORDER BY d`,
        )
        .all() as { d: string }[]
    ).map((r) => r.d),
  );
  const gaps: { from: string; to: string; days: number }[] = [];
  {
    const cur = new Date(`${head.lo}T00:00:00Z`);
    const end = new Date(`${head.hi}T00:00:00Z`);
    let run: string | null = null;
    let last = "";
    while (cur <= end) {
      const k = cur.toISOString().slice(0, 10);
      if (!have.has(k)) {
        run ??= k;
        last = k;
      } else if (run) {
        // Four days, because a shop can be shut for a long weekend and that is
        // not a hole in the records — it is a shop that was shut.
        const n = Math.round((Date.parse(last) - Date.parse(run)) / 86_400_000) + 1;
        if (n >= 4) gaps.push({ from: run, to: last, days: n });
        run = null;
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (run)
      gaps.push({
        from: run,
        to: last,
        days: Math.round((Date.parse(last) - Date.parse(run)) / 86_400_000) + 1,
      });
  }

  // ── Two records of one month ──────────────────────────────────────────────
  /*
    Imported rows carry an `H-` ticket number and rows rung on the register do
    not, so "which system wrote this down" is a prefix test. The month wanted is
    the most recent one that has both, which is whichever month the register
    went live in.
  */
  const both = db
    .prepare(
      `SELECT substr(s.business_date, 1, 7) mo,
              CASE WHEN s.sale_no LIKE 'H-%' THEN 'excel' ELSE 'pos' END src,
              COUNT(DISTINCT s.business_date) days, COUNT(*) tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) goods
         FROM sales s WHERE ${SALE}
     GROUP BY mo, src ORDER BY mo`,
    )
    .all() as { mo: string; src: string; days: number; tickets: number; goods: number }[];
  const months = new Map<string, Record<string, (typeof both)[number]>>();
  for (const r of both) {
    const row = months.get(r.mo) ?? {};
    row[r.src] = r;
    months.set(r.mo, row);
  }
  const overlap = [...months.entries()].filter(([, r]) => r.pos && r.excel).at(-1);
  const side = (r: (typeof both)[number]) => ({
    days: r.days,
    tickets: r.tickets,
    perDayCents: r.days > 0 ? Math.round(r.goods / r.days) : 0,
    avgTicketCents: r.tickets > 0 ? Math.round(r.goods / r.tickets) : 0,
  });
  const verification = overlap
    ? { month: overlap[0], pos: side(overlap[1].pos), excel: side(overlap[1].excel) }
    : null;

  // ── What the shop was doing, then and now ─────────────────────────────────
  const linesIn = (from: string, to: string) =>
    db
      .prepare(
        `SELECT UPPER(TRIM(i.description)) label, COUNT(*) lines,
                COALESCE(SUM(i.line_total_cents), 0) cents
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.product_id IS NULL
            AND s.business_date BETWEEN ? AND ?
       GROUP BY label ORDER BY lines DESC LIMIT 8`,
      )
      .all(from, to) as { label: string; lines: number; cents: number }[];

  // The first and last full quarters on record, so the two lists are the same
  // length of time and can be read against each other.
  const early = { from: head.lo, to: addMonths(head.lo, 3) };
  const late = { from: addMonths(head.hi, -3), to: head.hi };

  const buys = db
    .prepare(
      `SELECT COUNT(*) tickets, COALESCE(SUM(s.subtotal_cents), 0) cents,
              COALESCE((SELECT SUM(i.qty) FROM sale_items i JOIN sales s2 ON s2.id = i.sale_id
                         WHERE s2.kind = 'purchase' AND s2.deleted = 0
                           AND s2.status = 'completed' AND i.voided = 0), 0) units
         FROM sales s
        WHERE s.deleted = 0 AND s.status = 'completed' AND s.kind = 'purchase'`,
    )
    .get() as { tickets: number; cents: number; units: number };

  const stockRow = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM products WHERE deleted = 0 AND active = 1) activeProducts,
              (SELECT COUNT(*) FROM (
                 SELECT p.id FROM products p JOIN inventory_movements mv ON mv.product_id = p.id
                  WHERE p.deleted = 0 GROUP BY p.id HAVING SUM(mv.qty_delta) > 0)) sizesWithStock,
              (SELECT COALESCE(SUM(mv.qty_delta), 0) FROM inventory_movements mv
                 JOIN products p ON p.id = mv.product_id WHERE p.deleted = 0) units,
              (SELECT COUNT(DISTINCT i.product_id) FROM sale_items i JOIN sales s ON s.id = i.sale_id
                WHERE ${SALE} AND i.voided = 0 AND i.product_id IS NOT NULL
                  AND s.business_date >= date(?, '-90 days')) soldLast90`,
    )
    .get(today) as {
    activeProducts: number;
    sizesWithStock: number;
    units: number;
    soldLast90: number;
  };
  const tiresADay = t.access.at(-1)?.unitsPerDay ?? 0;

  const ctl = db
    .prepare(
      `SELECT COALESCE(SUM(s.discount_cents), 0) discountCents,
              SUM(CASE WHEN s.discount_cents > 0 THEN 1 ELSE 0 END) discountTickets
         FROM sales s WHERE ${SALE}`,
    )
    .get() as { discountCents: number; discountTickets: number };
  const voided = db
    .prepare(
      `SELECT COUNT(*) tickets, COALESCE(SUM(s.subtotal_cents), 0) cents
         FROM sales s
        WHERE s.deleted = 0 AND s.kind = 'sale' AND s.status = 'voided'`,
    )
    .get() as { tickets: number; cents: number };
  const cov = db
    .prepare(
      `SELECT COALESCE(SUM(i.line_total_cents), 0) total,
              COALESCE(SUM(CASE WHEN COALESCE(NULLIF(i.unit_cost_cents,0),
                                              NULLIF(p.default_cost_cents,0),
                                              sc.cost_cents) IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) costed
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN service_costs sc ON sc.description_key = UPPER(TRIM(i.description))
        WHERE ${SALE} AND i.voided = 0 AND s.business_date >= date(?, '-365 days')`,
    )
    .get(today) as { total: number; costed: number };

  // ── The quarterly appendix ────────────────────────────────────────────────
  const qRows = db
    .prepare(
      `SELECT substr(s.business_date,1,4) || '-Q' ||
                ((CAST(substr(s.business_date,6,2) AS INTEGER) + 2) / 3) bucket,
              COUNT(DISTINCT s.business_date) days, COUNT(DISTINCT s.id) tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) goods
         FROM sales s WHERE ${SALE}
     GROUP BY bucket ORDER BY bucket`,
    )
    .all() as { bucket: string; days: number; tickets: number; goods: number }[];

  const qCat = db
    .prepare(
      `SELECT substr(s.business_date,1,4) || '-Q' ||
                ((CAST(substr(s.business_date,6,2) AS INTEGER) + 2) / 3) bucket,
              -- Aliased "part" rather than "kind": sales has a real column of
              -- that name and SQLite would bind the GROUP BY to it instead.
              CASE WHEN c.code = 'new_tire'  THEN 'new'
                   WHEN c.code = 'used_tire' THEN 'used'
                   ELSE 'service' END part,
              COALESCE(SUM(i.line_total_cents), 0) cents
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0
     GROUP BY bucket, part`,
    )
    .all() as { bucket: string; part: string; cents: number }[];
  const catBy = new Map<string, Record<string, number>>();
  for (const r of qCat) {
    const row = catBy.get(r.bucket) ?? {};
    row[r.part] = r.cents;
    catBy.set(r.bucket, row);
  }

  const qCap = db
    .prepare(
      `SELECT bucket, COUNT(*) techDays FROM (
         SELECT substr(s.business_date,1,4) || '-Q' ||
                  ((CAST(substr(s.business_date,6,2) AS INTEGER) + 2) / 3) bucket,
                i.mechanic_id emp, s.business_date d
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id IS NOT NULL
          UNION
         SELECT substr(s.business_date,1,4) || '-Q' ||
                  ((CAST(substr(s.business_date,6,2) AS INTEGER) + 2) / 3),
                i.mount_mechanic_id, s.business_date
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.mount_mechanic_id IS NOT NULL
       ) GROUP BY bucket`,
    )
    .all() as { bucket: string; techDays: number }[];
  const capBy = new Map(qCap.map((r) => [r.bucket, r.techDays]));

  const quarters = qRows.map((r) => {
    const cat = catBy.get(r.bucket) ?? {};
    return {
      bucket: r.bucket,
      days: r.days,
      tickets: r.tickets,
      perDayCents: r.days > 0 ? Math.round(r.goods / r.days) : 0,
      ticketsPerDay: r.days > 0 ? r.tickets / r.days : 0,
      avgTicketCents: r.tickets > 0 ? Math.round(r.goods / r.tickets) : 0,
      newPerDayCents: r.days > 0 ? Math.round((cat.new ?? 0) / r.days) : 0,
      usedPerDayCents: r.days > 0 ? Math.round((cat.used ?? 0) / r.days) : 0,
      servicePerDayCents: r.days > 0 ? Math.round((cat.service ?? 0) / r.days) : 0,
      techDaysPerDay: r.days > 0 ? (capBy.get(r.bucket) ?? 0) / r.days : 0,
    };
  });

  return {
    ...t,
    extras: {
      history: {
        firstDate: head.lo,
        lastDate: head.hi,
        tradingDays: head.days,
        tickets: head.tickets,
        takingsCents: head.takings,
        gaps,
      },
      verification,
      topLines: {
        earlyLabel: `${early.from} → ${early.to}`,
        lateLabel: `${late.from} → ${late.to}`,
        early: linesIn(early.from, early.to),
        late: linesIn(late.from, late.to),
      },
      buybacks: buys,
      stock: {
        ...stockRow,
        daysOfCover: tiresADay > 0 ? Math.round(stockRow.units / tiresADay) : null,
      },
      control: {
        discountCents: ctl.discountCents,
        discountTickets: ctl.discountTickets,
        voidedTickets: voided.tickets,
        voidedCents: voided.cents,
        costCoveragePct: cov.total > 0 ? Math.round((cov.costed / cov.total) * 100) : 0,
      },
      quarters,
    },
  };
}

/** A date `n` months away, clamped to the end of the month it lands in. */
function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
