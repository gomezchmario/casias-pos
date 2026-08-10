import { getDb } from "./db";

/**
 * Which way the shop is heading, and what is worth worrying about.
 *
 * A SEPARATE QUESTION FROM THE REPORTS PAGE, which is why it is a separate
 * module and a separate screen. Reports answers "how did we do over these
 * dates" — every figure on it covers the window at the top, and that promise is
 * what makes it trustworthy. This answers "which way is this going", which no
 * window can answer: a direction measured over whichever fortnight somebody
 * selected is not a direction. So nothing here takes a window at all. It always
 * covers everything on record, and says how much that is.
 *
 * THE RULE THAT GOVERNS EVERY FIGURE BELOW: divide by trading days.
 *
 * The shop's history was rebuilt from the old cashier workbooks and it has
 * holes in it — stretches nobody wrote down. A month with no record totals
 * zero, and zero against a full month a year earlier reads as the business
 * having collapsed. That is a fabricated finding, and a page whose entire
 * purpose is to spot real ones cannot afford to manufacture them. Dividing by
 * the days there is actually a record of turns a hole into a smaller sample
 * instead of a catastrophe. Where two periods are compared, any month missing
 * from either side is dropped from both and named on screen.
 *
 * It is also the fairer measure regardless: February is short, and a shop shut
 * for a week in July did not have a bad July.
 *
 * WHAT THE DATA CANNOT SAY, so that nothing here pretends otherwise. There is
 * no record of hours worked — the time clock holds a handful of entries against
 * two and a half years of sales — so "how many people were on the floor" is
 * counted as technicians credited with work that day, and everything derived
 * from it is per technician-DAY, never per hour. Who was at the counter is not
 * measured at all: every imported ticket names one cashier because the workbook
 * never recorded it.
 */

const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";

/** A month key, `n` months away: "2026-08" → "2025-08". */
function shiftMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Every month key from one to another, inclusive. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = shiftMonths(cur, 1);
  }
  return out;
}

const quarterOf = (col: string) =>
  `substr(${col}, 1, 4) || '-Q' || ((CAST(substr(${col}, 6, 2) AS INTEGER) + 2) / 3)`;

export type MonthPoint = {
  bucket: string;
  tradingDays: number;
  tickets: number;
  goodsCents: number;
  perDayCents: number;
  ticketsPerDay: number;
  avgTicketCents: number;
};

export type CapacityPoint = {
  bucket: string;
  /** Distinct technicians credited with work in the month. */
  techs: number;
  /** Technicians on the floor on an average trading day. */
  techDaysPerDay: number;
  ticketsPerTechDay: number;
  perTechDayCents: number;
};

export type CategoryPoint = {
  bucket: string;
  newCents: number;
  usedCents: number;
  serviceCents: number;
  newUnits: number;
};

export type AccessPoint = {
  bucket: string;
  /** How many different tire sizes went out of the door — the range on offer. */
  sizesSold: number;
  unitsPerDay: number;
  /** The share of all tickets that carried a new tire at all. */
  ticketSharePct: number;
  /** What one tire sold for, on average. */
  avgLineCents: number;
};

export type Concern = {
  key: string;
  severity: "serious" | "watch" | "steady";
  title: string;
  /** The arithmetic, with its figures. */
  finding: string;
  /** What it means, and what it does not mean. */
  meaning: string;
};

export type ShopTrends = {
  today: string;
  firstDate: string;
  monthsOnRecord: number;
  tradingDays: number;
  months: MonthPoint[];
  /** The trailing twelve months' daily rate, month by month — seasonality removed. */
  ttm: { bucket: string; perDayCents: number }[];
  compare: {
    label: string;
    priorLabel: string;
    comparedMonths: number;
    skippedMonths: string[];
    perDayNowCents: number;
    perDayBeforeCents: number;
    growthPct: number | null;
    ticketsPerDayNow: number;
    ticketsPerDayBefore: number;
    avgTicketNowCents: number;
    avgTicketBeforeCents: number;
    /** The per-day change split into its two causes. They sum to the whole. */
    fromVolumeCents: number;
    fromPriceCents: number;
  };
  capacity: CapacityPoint[];
  categories: CategoryPoint[];
  access: AccessPoint[];
  seasonality: { month: number; perDayCents: number; years: number }[];
  weekday: { weekday: number; earlyPerDayCents: number; latePerDayCents: number }[];
  weekdayLabels: { early: string; late: string };
  tender: { bucket: string; parts: { label: string; cents: number }[] }[];
  gapMonths: string[];
  concerns: Concern[];
};

// ─────────────────────────────────────────────────────────────────────────────

export function shopTrends(today: string): ShopTrends {
  const db = getDb();
  const firstDate =
    (
      db
        .prepare(`SELECT MIN(business_date) d FROM sales s WHERE s.deleted = 0 AND s.kind = 'sale'`)
        .get() as { d: string | null }
    ).d ?? today;

  /*
    Twenty-five buckets: two years of finished months plus the part-finished one
    we are standing in.

    The extra one is not decoration. The current month is excluded from every
    comparison — on the ninth it is a third of a month and would read as a
    collapse — so a range of twenty-four leaves only twenty-three finished
    months, and the older half of a twelve-against-twelve comparison comes up
    one short. Last August would have no August to be measured against and would
    be silently dropped.
  */
  const startMonth = shiftMonths(today.slice(0, 7), -24);
  const start = `${startMonth}-01` < firstDate ? firstDate : `${startMonth}-01`;

  const monthRows = db
    .prepare(
      `SELECT substr(s.business_date, 1, 7) AS bucket,
              COUNT(DISTINCT s.business_date) AS tradingDays,
              COUNT(*) AS tickets,
              COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS goods
         FROM sales s
        WHERE ${SALE} AND s.business_date BETWEEN ? AND ?
     GROUP BY bucket`,
    )
    .all(start, today) as {
    bucket: string;
    tradingDays: number;
    tickets: number;
    goods: number;
  }[];
  const byMonth = new Map(monthRows.map((r) => [r.bucket, r]));

  const months: MonthPoint[] = monthsBetween(start.slice(0, 7), today.slice(0, 7)).map((bucket) => {
    const r = byMonth.get(bucket);
    const d = r?.tradingDays ?? 0;
    const t = r?.tickets ?? 0;
    const g = r?.goods ?? 0;
    return {
      bucket,
      tradingDays: d,
      tickets: t,
      goodsCents: g,
      perDayCents: d > 0 ? Math.round(g / d) : 0,
      ticketsPerDay: d > 0 ? t / d : 0,
      avgTicketCents: t > 0 ? Math.round(g / t) : 0,
    };
  });

  /*
    The trailing twelve months, recomputed at every month.

    THE ONE LINE ON THIS PAGE WITH NO SEASONALITY IN IT. Every other series
    wobbles with the calendar — the cold snap, the tax refunds, the school run —
    and a wobble is exactly what an eye mistakes for a turn. A twelve-month
    window always contains one of every month, so when this line moves, the
    business moved. Weighted by trading days rather than averaging twelve
    monthly rates, so a short month cannot pull it about.
  */
  const ttm = months.map((_, i) => {
    const win = months.slice(Math.max(0, i - 11), i + 1);
    const g = win.reduce((n, w) => n + w.goodsCents, 0);
    const d = win.reduce((n, w) => n + w.tradingDays, 0);
    return { bucket: months[i].bucket, perDayCents: d > 0 ? Math.round(g / d) : 0 };
  });

  const thisMonth = today.slice(0, 7);
  const closed = months.filter((m) => m.bucket !== thisMonth);
  const last12 = closed.slice(-12);
  const prev12 = closed.slice(-24, -12);
  const prevBy = new Map(prev12.map((m) => [m.bucket, m]));

  // Like for like: each month against the same month a year earlier, and only
  // where both have a record. Anything missing is thrown out of both sides and
  // named, because counting it as zero is what makes a gap look like a crash.
  const skippedMonths: string[] = [];
  let nowG = 0;
  let nowD = 0;
  let nowT = 0;
  let befG = 0;
  let befD = 0;
  let befT = 0;
  for (const m of last12) {
    const b = prevBy.get(shiftMonths(m.bucket, -12));
    if (m.tradingDays === 0 || !b || b.tradingDays === 0) {
      skippedMonths.push(m.bucket);
      continue;
    }
    nowG += m.goodsCents;
    nowD += m.tradingDays;
    nowT += m.tickets;
    befG += b.goodsCents;
    befD += b.tradingDays;
    befT += b.tickets;
  }

  const perDayNowCents = nowD > 0 ? Math.round(nowG / nowD) : 0;
  const perDayBeforeCents = befD > 0 ? Math.round(befG / befD) : 0;
  const ticketsPerDayNow = nowD > 0 ? nowT / nowD : 0;
  const ticketsPerDayBefore = befD > 0 ? befT / befD : 0;
  const avgTicketNowCents = nowT > 0 ? Math.round(nowG / nowT) : 0;
  const avgTicketBeforeCents = befT > 0 ? Math.round(befG / befT) : 0;

  /*
    WHY the daily takings moved, split into the only two things that can move
    them: how many people were served, and what each of them spent.

      takings a day  =  tickets a day  ×  average ticket

    so the change decomposes exactly, with no remainder left over to argue
    about:

      from volume  =  (tickets now − tickets before) × average ticket before
      from price   =   tickets now × (average now − average before)

    The two sum to the whole change, always. This matters because the two have
    completely different answers. Fewer customers is a marketing and capacity
    problem; smaller tickets is a pricing and mix problem; and a shop that
    treats one as the other will spend a year fixing the wrong thing.
  */
  const fromVolumeCents = Math.round(
    (ticketsPerDayNow - ticketsPerDayBefore) * avgTicketBeforeCents,
  );
  const fromPriceCents = Math.round(
    ticketsPerDayNow * (avgTicketNowCents - avgTicketBeforeCents),
  );

  // ── Capacity ──────────────────────────────────────────────────────────────
  /*
    How many technicians were on the floor, counted as technicians credited with
    work that day. A UNION of both credit columns, because an ordered tire is
    sold by one person and fitted by another — a fitter who only ever mounted
    other people's tires would otherwise read as never having come in.
  */
  const capRows = db
    .prepare(
      `SELECT bucket, COUNT(DISTINCT emp) AS techs, COUNT(*) AS techDays FROM (
         SELECT substr(s.business_date, 1, 7) AS bucket, i.mechanic_id AS emp,
                s.business_date AS d
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.mechanic_id IS NOT NULL
            AND s.business_date BETWEEN ? AND ?
          UNION
         SELECT substr(s.business_date, 1, 7), i.mount_mechanic_id, s.business_date
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
          WHERE ${SALE} AND i.voided = 0 AND i.mount_mechanic_id IS NOT NULL
            AND s.business_date BETWEEN ? AND ?
       ) GROUP BY bucket`,
    )
    .all(start, today, start, today) as { bucket: string; techs: number; techDays: number }[];
  const capBy = new Map(capRows.map((r) => [r.bucket, r]));

  const capacity: CapacityPoint[] = months
    .filter((m) => m.tradingDays > 0)
    .map((m) => {
      const c = capBy.get(m.bucket);
      const techDays = c?.techDays ?? 0;
      return {
        bucket: m.bucket,
        techs: c?.techs ?? 0,
        techDaysPerDay: m.tradingDays > 0 ? techDays / m.tradingDays : 0,
        ticketsPerTechDay: techDays > 0 ? m.tickets / techDays : 0,
        perTechDayCents: techDays > 0 ? Math.round(m.goodsCents / techDays) : 0,
      };
    });

  // ── What sells, per trading day ───────────────────────────────────────────
  const catRows = db
    .prepare(
      `SELECT substr(s.business_date, 1, 7) AS bucket,
              -- NOT aliased "kind". The sales table has a real column of that
              -- name, and SQLite resolves a GROUP BY term to a real column in
              -- preference to an output alias — so GROUP BY bucket, kind
              -- silently grouped by s.kind, which the WHERE clause has already
              -- pinned to 'sale'. Every month collapsed to one row whose
              -- category was whichever SQLite happened to pick and whose total
              -- was the whole month. It drew a perfectly plausible chart, which
              -- is what makes it worth a comment.
              CASE WHEN c.code = 'new_tire'  THEN 'new'
                   WHEN c.code = 'used_tire' THEN 'used'
                   ELSE 'service' END AS part,
              COALESCE(SUM(i.line_total_cents), 0) AS cents,
              COALESCE(SUM(i.qty), 0) AS units
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN service_categories c ON c.id = i.category_id
        WHERE ${SALE} AND i.voided = 0 AND s.business_date BETWEEN ? AND ?
     GROUP BY bucket, part`,
    )
    .all(start, today) as { bucket: string; part: string; cents: number; units: number }[];
  const catBy = new Map<string, Record<string, { cents: number; units: number }>>();
  for (const r of catRows) {
    const row = catBy.get(r.bucket) ?? {};
    row[r.part] = { cents: r.cents, units: r.units };
    catBy.set(r.bucket, row);
  }
  const categories: CategoryPoint[] = months
    .filter((m) => m.tradingDays > 0)
    .map((m) => {
      const row = catBy.get(m.bucket) ?? {};
      const d = m.tradingDays;
      return {
        bucket: m.bucket,
        newCents: Math.round((row.new?.cents ?? 0) / d),
        usedCents: Math.round((row.used?.cents ?? 0) / d),
        serviceCents: Math.round((row.service?.cents ?? 0) / d),
        newUnits: (row.new?.units ?? 0) / d,
      };
    });

  /*
    ── Whether there were tires to sell ──────────────────────────────────────

    THE ONE THING THIS SHOP'S RECORDS CANNOT SHOW DIRECTLY. Stock levels were
    never written down before the register existed, so "what was on the racks in
    October 2024" is a question with no answer anywhere. Three things the sales
    can show stand in for it, and together they are hard to argue with:

      how many different SIZES went out in the month — the range actually on
      offer, which narrows before the volume does when buying stops;

      what share of all tickets carried a tire at all — how often somebody who
      walked in left with one;

      and the average price of a tire line, which is the control. If customers
      had simply stopped being able to afford tires, this would FALL as they
      bought cheaper ones. If the tires were not there to sell, it does not move
      at all: the ones still on the racks sell for what they always did, there
      are just fewer of them and fewer kinds.

    That third figure is what separates "nobody is buying" from "there was
    nothing to buy", and no amount of staring at a revenue chart will do it.
  */
  const accessRows = db
    .prepare(
      `SELECT substr(s.business_date, 1, 7) AS bucket,
              COUNT(DISTINCT s.id) AS tickets,
              COUNT(DISTINCT CASE WHEN c.code = 'new_tire' THEN s.id END) AS tireTickets,
              COUNT(DISTINCT CASE WHEN c.code = 'new_tire' THEN p.tire_size END) AS sizes,
              COALESCE(SUM(CASE WHEN c.code = 'new_tire' THEN i.qty ELSE 0 END), 0) AS units,
              COALESCE(SUM(CASE WHEN c.code = 'new_tire' THEN i.line_total_cents ELSE 0 END), 0) AS cents
         FROM sales s
         JOIN sale_items i ON i.sale_id = s.id AND i.voided = 0
    LEFT JOIN service_categories c ON c.id = i.category_id
    LEFT JOIN products p ON p.id = i.product_id
        WHERE ${SALE} AND s.business_date BETWEEN ? AND ?
     GROUP BY bucket`,
    )
    .all(start, today) as {
    bucket: string;
    tickets: number;
    tireTickets: number;
    sizes: number;
    units: number;
    cents: number;
  }[];
  const accessBy = new Map(accessRows.map((r) => [r.bucket, r]));
  const access: AccessPoint[] = months
    .filter((m) => m.tradingDays > 0)
    .map((m) => {
      const r = accessBy.get(m.bucket);
      return {
        bucket: m.bucket,
        sizesSold: r?.sizes ?? 0,
        unitsPerDay: (r?.units ?? 0) / m.tradingDays,
        ticketSharePct: r && r.tickets > 0 ? (r.tireTickets / r.tickets) * 100 : 0,
        avgLineCents: r && r.units > 0 ? Math.round(r.cents / r.units) : 0,
      };
    });

  // ── Seasonality, over everything on record ────────────────────────────────
  const seasonality = (
    db
      .prepare(
        `SELECT CAST(substr(s.business_date, 6, 2) AS INTEGER) AS month,
                COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS goods,
                COUNT(DISTINCT s.business_date) AS days,
                COUNT(DISTINCT substr(s.business_date, 1, 4)) AS years
           FROM sales s WHERE ${SALE}
       GROUP BY month ORDER BY month`,
      )
      .all() as { month: number; goods: number; days: number; years: number }[]
  ).map((r) => ({
    month: r.month,
    perDayCents: r.days > 0 ? Math.round(r.goods / r.days) : 0,
    years: r.years,
  }));

  /*
    The week's shape, then against now.

    Which day is busiest matters less than whether the BUSIEST day is still
    pulling away from the rest. A peak that flattens is the signature of a
    ceiling — a shop that cannot take any more work on its best day stops having
    a best day — and it is invisible in any single-period chart.
  */
  const earlyEnd = shiftMonths(firstDate.slice(0, 7), 11);
  const lateStart = closed.length ? closed[Math.max(0, closed.length - 12)].bucket : thisMonth;
  const weekAt = (from: string, to: string) =>
    new Map(
      (
        db
          .prepare(
            `SELECT CAST(strftime('%w', s.business_date) AS INTEGER) AS w,
                    COUNT(DISTINCT s.business_date) AS d,
                    COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS g
               FROM sales s WHERE ${SALE} AND s.business_date BETWEEN ? AND ?
           GROUP BY w`,
          )
          .all(from, to) as { w: number; d: number; g: number }[]
      ).map((r) => [r.w, r.d > 0 ? Math.round(r.g / r.d) : 0]),
    );
  const early = weekAt(firstDate, `${earlyEnd}-31`);
  const late = weekAt(`${lateStart}-01`, today);
  const weekday = Array.from({ length: 7 }, (_, w) => ({
    weekday: w,
    earlyPerDayCents: early.get(w) ?? 0,
    latePerDayCents: late.get(w) ?? 0,
  }));

  // ── How it is paid ────────────────────────────────────────────────────────
  const tenderRows = db
    .prepare(
      `SELECT ${quarterOf("p.business_date")} AS bucket, pm.label AS label,
              COALESCE(SUM(p.amount_cents), 0) AS cents
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         JOIN payment_methods pm ON pm.id = p.method_id
        WHERE s.deleted = 0 AND s.kind = 'sale' AND p.amount_cents > 0
          AND p.business_date BETWEEN ? AND ?
     GROUP BY bucket, pm.label ORDER BY bucket`,
    )
    .all(start, today) as { bucket: string; label: string; cents: number }[];
  const tenderBy = new Map<string, { label: string; cents: number }[]>();
  for (const r of tenderRows) {
    const row = tenderBy.get(r.bucket) ?? [];
    row.push({ label: r.label, cents: r.cents });
    tenderBy.set(r.bucket, row);
  }
  // One order for every column, taken from the biggest tenders overall, so a
  // band keeps its colour across the page and can be followed.
  const tenderOrder = [
    ...new Map(
      tenderRows
        .reduce((mp, r) => mp.set(r.label, (mp.get(r.label) ?? 0) + r.cents), new Map<string, number>())
        .entries(),
    ),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([l]) => l);
  const tender = [...tenderBy.entries()].map(([bucket, parts]) => ({
    bucket,
    parts: tenderOrder.map((label) => ({
      label,
      cents: parts.find((p) => p.label === label)?.cents ?? 0,
    })),
  }));

  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT s.business_date) AS days FROM sales s WHERE ${SALE}`,
    )
    .get() as { days: number };

  const out: ShopTrends = {
    today,
    firstDate,
    monthsOnRecord: closed.filter((m) => m.tickets > 0).length,
    tradingDays: totals.days,
    months,
    ttm,
    compare: {
      label: last12.length ? `${last12[0].bucket} → ${last12.at(-1)!.bucket}` : "",
      priorLabel: prev12.length ? `${prev12[0].bucket} → ${prev12.at(-1)!.bucket}` : "",
      comparedMonths: last12.length - skippedMonths.length,
      skippedMonths,
      perDayNowCents,
      perDayBeforeCents,
      growthPct:
        perDayBeforeCents > 0
          ? ((perDayNowCents - perDayBeforeCents) / perDayBeforeCents) * 100
          : null,
      ticketsPerDayNow,
      ticketsPerDayBefore,
      avgTicketNowCents,
      avgTicketBeforeCents,
      fromVolumeCents,
      fromPriceCents,
    },
    capacity,
    categories,
    access,
    seasonality,
    weekday,
    weekdayLabels: { early: `${firstDate.slice(0, 7)} → ${earlyEnd}`, late: `${lateStart} → ${thisMonth}` },
    tender,
    gapMonths: months.filter((m) => m.tradingDays === 0).map((m) => m.bucket),
    concerns: [],
  };
  out.concerns = findConcerns(out, db);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// What is worth worrying about
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The checks, run over the figures above.
 *
 * COMPUTED, NOT WRITTEN DOWN. Somebody has to look at eight charts and notice
 * that two of them together mean something; this does that part, every time the
 * page is opened, and will still be doing it next year when the numbers have
 * moved. A page of charts with no conclusions is a page that only helps the
 * person who already knew what they were looking for.
 *
 * EVERY ITEM SAYS WHAT IT MEANS AND WHAT IT DOES NOT. A falling figure with no
 * interpretation beside it gets interpreted anyway, usually by whoever is most
 * worried — and half of these have an innocent explanation that has to be
 * offered at the same time as the alarming one. The thresholds are deliberately
 * dull: a tenth either way is noise in a shop this size, and an alert that
 * fires on noise is an alert nobody reads.
 *
 * "Steady" items are kept rather than hidden. Knowing the cash share has not
 * moved is worth as much as knowing it has, and a page that only ever shows
 * problems teaches people that opening it is bad news.
 */
function findConcerns(t: ShopTrends, db: ReturnType<typeof getDb>): Concern[] {
  const out: Concern[] = [];
  const money = (c: number) =>
    `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(0)}%`;
  const c = t.compare;

  // ── 1 · The top line ──────────────────────────────────────────────────────
  if (c.growthPct !== null && Math.abs(c.growthPct) >= 10) {
    const down = c.growthPct < 0;
    out.push({
      key: "topline",
      severity: Math.abs(c.growthPct) >= 25 ? "serious" : "watch",
      title: down ? "Takings are well down on a year ago" : "Takings are well up on a year ago",
      finding: `${money(c.perDayNowCents)} for every day open, against ${money(c.perDayBeforeCents)} over the same twelve months a year earlier — ${pct(c.growthPct)}. Measured over ${c.comparedMonths} months that both years have records for.`,
      meaning: down
        ? "Per day open, so this is not explained by holidays or by days the shop was shut. Whatever is behind it, it is not the calendar."
        : "Per day open, so this is real growth rather than simply having been open more.",
    });
  } else if (c.growthPct !== null) {
    out.push({
      key: "topline",
      severity: "steady",
      title: "Takings are about where they were a year ago",
      finding: `${money(c.perDayNowCents)} a day against ${money(c.perDayBeforeCents)} — ${pct(c.growthPct)}.`,
      meaning: "Within the range a shop this size moves by month to month.",
    });
  }

  // ── 2 · Volume or price ───────────────────────────────────────────────────
  const total = c.fromVolumeCents + c.fromPriceCents;
  if (Math.abs(total) > 0 && Math.abs(c.growthPct ?? 0) >= 10) {
    const volShare = Math.abs(c.fromVolumeCents) / (Math.abs(c.fromVolumeCents) + Math.abs(c.fromPriceCents) || 1);
    const mostly = volShare >= 0.6 ? "volume" : volShare <= 0.4 ? "price" : "both";
    out.push({
      key: "why",
      severity: "watch",
      title:
        mostly === "volume"
          ? "It is customers, not prices"
          : mostly === "price"
            ? "It is the size of the ticket, not the number of them"
            : "Both the number of tickets and their size have moved",
      finding: `Tickets a day went ${c.ticketsPerDayBefore.toFixed(1)} → ${c.ticketsPerDayNow.toFixed(1)}, and the average ticket ${money(c.avgTicketBeforeCents)} → ${money(c.avgTicketNowCents)}. Of the ${money(total)} a day change, ${money(c.fromVolumeCents)} comes from the number of tickets and ${money(c.fromPriceCents)} from their size.`,
      meaning:
        mostly === "volume"
          ? "Fewer people are being served. That is a question about how many can be served and how many are coming — not about what is being charged."
          : mostly === "price"
            ? "Much the same number of people, spending less each. That points at what is being sold rather than at how many walk in."
            : "Neither one on its own explains it, so a fix aimed at only one of them will only get part of the way.",
    });
  }

  // ── 3 · Was there anything on the racks to sell ───────────────────────────
  /*
    THE CHECK THIS PAGE EXISTS FOR. Everything else here describes the fall;
    this one tests a reason for it, and it is the reason a tire shop is most
    likely to have. The flat average price is what carries the argument — see
    the long note where `access` is built.
  */
  const acc = t.access;
  if (acc.length >= 12) {
    const then = acc.slice(0, 6);
    const now = acc.slice(-6);
    const avg = (rows: AccessPoint[], pick: (r: AccessPoint) => number) =>
      rows.reduce((n, r) => n + pick(r), 0) / rows.length;
    const sizesThen = avg(then, (r) => r.sizesSold);
    const sizesNow = avg(now, (r) => r.sizesSold);
    const shareThen = avg(then, (r) => r.ticketSharePct);
    const shareNow = avg(now, (r) => r.ticketSharePct);
    const priceThen = avg(then, (r) => r.avgLineCents);
    const priceNow = avg(now, (r) => r.avgLineCents);
    const priceMoved = priceThen > 0 ? Math.abs(priceNow - priceThen) / priceThen : 0;

    if (sizesThen > 0 && sizesNow / sizesThen <= 0.8 && shareNow < shareThen) {
      const supplySide = priceMoved < 0.1;
      out.push({
        key: "access",
        severity: "serious",
        title: supplySide
          ? "There are fewer tires to sell, and that is what the fall is"
          : "The range of tires being sold has narrowed",
        finding: `${sizesThen.toFixed(0)} different sizes went out in an average month at the start of the record, ${sizesNow.toFixed(0)} now. The share of tickets carrying a tire at all went ${shareThen.toFixed(0)}% → ${shareNow.toFixed(0)}%. What one tire sold for went ${money(priceThen)} → ${money(priceNow)}${supplySide ? " — barely moved" : ""}.`,
        meaning: supplySide
          ? "That last figure is the whole argument. If customers had stopped being able to afford tires, the average tire sold would have fallen as they traded down; it has not moved. The tires that are on the racks still sell for what they always did — there are simply fewer of them, across a narrower range of sizes, and fewer people leaving with one. This is a supply problem, not a demand problem, and no amount of selling harder will fix it. What fixes it is stock: the reorder list and Worth keeping in stock on the Reports page already say which sizes, ranked by what the shop actually sells."
          : "Fewer sizes and fewer customers leaving with a tire, and the price has moved as well — so this is a mix of what is on offer and what people are willing to pay, and the two need separating before either is acted on.",
      });
    }
  }

  // ── 4 · The crew, read against the work ───────────────────────────────────
  const cap = t.capacity.filter((x) => x.techDaysPerDay > 0);
  if (cap.length >= 18) {
    const then = cap.slice(0, 6);
    const now = cap.slice(-6);
    const avg = (rows: CapacityPoint[], pick: (r: CapacityPoint) => number) =>
      rows.reduce((n, r) => n + pick(r), 0) / rows.length;
    const floorThen = avg(then, (r) => r.techDaysPerDay);
    const floorNow = avg(now, (r) => r.techDaysPerDay);
    const perThen = avg(then, (r) => r.perTechDayCents);
    const perNow = avg(now, (r) => r.perTechDayCents);
    const tkThen = avg(then, (r) => r.ticketsPerTechDay);
    const tkNow = avg(now, (r) => r.ticketsPerTechDay);

    if (floorThen > 0 && floorNow / floorThen <= 0.75) {
      const busier = tkThen > 0 && tkNow / tkThen >= 1.15;
      out.push({
        key: "capacity",
        severity: "watch",
        title: busier
          ? "Half the crew, each of them handling more tickets"
          : "The crew has shrunk",
        finding: `${floorThen.toFixed(1)} technicians on the floor on an average day at the start of the record, ${floorNow.toFixed(1)} now. Each went from ${tkThen.toFixed(1)} to ${tkNow.toFixed(1)} tickets a day, and from ${money(perThen)} to ${money(perNow)} brought in.`,
        meaning: busier
          ? "More tickets each but not much more money each, which is the shape of work that has changed rather than grown: a flat repair is quick and small, fitting a set of tires is slow and large. Swap one for the other and the ticket count per technician climbs while the takings do not. So this is not a crew that has become more productive, and not one that has become lazy — it is the same people doing different, smaller jobs."
          : "Fewer people, and less from each of them.",
      });
    }
  }

  // ── 5 · A category falling away ───────────────────────────────────────────
  const cats = t.categories.filter((x) => x.newCents + x.usedCents + x.serviceCents > 0);
  if (cats.length >= 12) {
    const then = cats.slice(0, 6);
    const now = cats.slice(-6);
    const mean = (rows: CategoryPoint[], pick: (r: CategoryPoint) => number) =>
      rows.reduce((n, r) => n + pick(r), 0) / rows.length;
    // New tires are deliberately absent. When the availability check above has
    // fired, a separate "new tires are down" item is the same finding printed
    // twice, and a list of conclusions that repeats itself is a list people
    // start skimming. The tire story is told once, where the evidence for it is.
    const told = out.some((x) => x.key === "access");
    const lines: [string, string, number, number][] = [
      ["New tires", "New tire sales", mean(then, (r) => r.newCents), mean(now, (r) => r.newCents)],
      ["Used tires", "Used tire sales", mean(then, (r) => r.usedCents), mean(now, (r) => r.usedCents)],
      ["Service", "Service work", mean(then, (r) => r.serviceCents), mean(now, (r) => r.serviceCents)],
    ];
    for (const [label, subject, was, is] of lines) {
      if (label === "New tires" && told) continue;
      if (was < 5000) continue; // under $50 a day it was never a business line
      const change = ((is - was) / was) * 100;
      if (change > -35) continue;
      const stopped = change <= -70;
      out.push({
        key: `cat-${label}`,
        severity: stopped ? "serious" : "watch",
        title: stopped ? `${subject} have all but stopped` : `${subject} is well down`,
        finding: `${money(was)} a day at the start of the record, ${money(is)} now — ${pct(change)}.`,
        meaning: stopped
          ? `A line of the business that has effectively closed.${label === "Used tires" ? " Used stock comes in over the counter, and the shop has recorded almost no buybacks — so this one has a supply of its own that has dried up too." : ""} Worth knowing whether that was a decision or something that simply happened.`
          : "Falling faster than the shop as a whole, so this is not only the general slowdown showing up here.",
      });
    }
    const newUnitsThen = mean(then, (r) => r.newUnits);
    const newUnitsNow = mean(now, (r) => r.newUnits);
    if (newUnitsThen >= 5 && newUnitsNow / newUnitsThen <= 0.7)
      out.push({
        key: "tire-units",
        severity: "watch",
        title: "Fewer tires are going out of the door",
        finding: `${newUnitsThen.toFixed(1)} new tires a day at the start of the record, ${newUnitsNow.toFixed(1)} now — ${pct(((newUnitsNow - newUnitsThen) / newUnitsThen) * 100)}.`,
        meaning:
          "Counted in tires rather than in money, so it is not price changes or mix. This is the physical volume of the main business.",
      });
  }

  // ── 6 · The peak day flattening ───────────────────────────────────────────
  const wkEarly = t.weekday.reduce((n, w) => n + w.earlyPerDayCents, 0) / 7;
  const wkLate = t.weekday.reduce((n, w) => n + w.latePerDayCents, 0) / 7;
  if (wkEarly > 0 && wkLate > 0) {
    const peakEarly = Math.max(...t.weekday.map((w) => w.earlyPerDayCents));
    const peakLate = Math.max(...t.weekday.map((w) => w.latePerDayCents));
    const premEarly = peakEarly / wkEarly - 1;
    const premLate = peakLate / wkLate - 1;
    if (premEarly >= 0.12 && premLate <= premEarly * 0.6) {
      const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const which = DAYS[t.weekday.findIndex((w) => w.earlyPerDayCents === peakEarly)];
      out.push({
        key: "peak",
        severity: "watch",
        title: "The best day of the week has flattened out",
        finding: `${which} used to take ${(premEarly * 100).toFixed(0)}% more than an average day. It now takes ${(premLate * 100).toFixed(0)}% more.`,
        meaning:
          "A busy day stops standing out when the shop cannot take any more work on it. On its own it proves nothing; alongside a crew that is running at its busiest, it is the same story told twice.",
      });
    }
  }

  // ── 7 · The cash share ────────────────────────────────────────────────────
  const cashShare = (row: (typeof t.tender)[number] | undefined) => {
    if (!row) return null;
    const tot = row.parts.reduce((n, p) => n + p.cents, 0);
    const cash = row.parts.find((p) => /cash/i.test(p.label))?.cents ?? 0;
    return tot > 0 ? (cash / tot) * 100 : null;
  };
  const cashThen = cashShare(t.tender[0]);
  const cashNow = cashShare(t.tender.at(-1));
  if (cashThen !== null && cashNow !== null) {
    const move = cashNow - cashThen;
    out.push({
      key: "cash",
      severity: Math.abs(move) >= 8 ? "watch" : "steady",
      title:
        Math.abs(move) < 8
          ? "The share paid in cash has not moved"
          : move > 0
            ? "More of the money is arriving as cash"
            : "Less of the money is arriving as cash",
      finding: `${cashThen.toFixed(0)}% of what was collected in ${t.tender[0].bucket}, ${cashNow.toFixed(0)}% in ${t.tender.at(-1)!.bucket}.`,
      meaning:
        Math.abs(move) < 8
          ? "Worth checking precisely because it is the figure that would move first if cash were going missing. It has not."
          : "The tender split is the figure that moves first if cash stops being rung up, so a shift of this size is worth an explanation — a new terminal, a change in what customers use, or something else.",
    });
  }

  // ── 8 · Can the margin even be seen ───────────────────────────────────────
  const cov = db
    .prepare(
      `SELECT COALESCE(SUM(i.line_total_cents), 0) AS total,
              COALESCE(SUM(CASE WHEN COALESCE(NULLIF(i.unit_cost_cents,0), NULLIF(p.default_cost_cents,0), sc.cost_cents) IS NOT NULL
                                THEN i.line_total_cents ELSE 0 END), 0) AS costed
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN service_costs sc ON sc.description_key = UPPER(TRIM(i.description))
        WHERE ${SALE} AND i.voided = 0 AND s.business_date >= date(?, '-365 days')`,
    )
    .get(t.today) as { total: number; costed: number };
  const covPct = cov.total > 0 ? (cov.costed / cov.total) * 100 : 0;
  if (covPct < 75)
    out.push({
      key: "coverage",
      severity: covPct < 50 ? "watch" : "steady",
      title: "Half the shop still has no cost against it",
      finding: `${covPct.toFixed(0)}% of the last year's takings can be given a cost. The rest is labour nobody has priced.`,
      meaning:
        "Every margin figure in this program is worked out over that share and no more, so it describes part of the shop rather than the shop. Settings → What things cost is where that gets fixed, and the three biggest jobs would take it most of the way.",
    });

  const rank = { serious: 0, watch: 1, steady: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
