/**
 * Every figure for the tire-business report, computed once, in one place.
 *
 * The report is prose; this is its ledger. Nothing in the document may cite a
 * number that is not in the JSON this produces, so that checking the report
 * means checking this file against the database and nothing else.
 *
 * THE ONE RULE, inherited from src/lib/trends.ts: divide by trading days on
 * record. The history has three stretches nobody wrote down, and a month with
 * a hole in it totals low without the business having done anything. The shop
 * is open seven days a week, so a missing day is a missing record, not a
 * closed door.
 *
 * "Start" and "now" are the first six and last six recorded months, averaged
 * per trading day — the same windows the Trends screen uses, so the report
 * agrees with what the app already says.
 */
import Database from "better-sqlite3";
import fs from "node:fs";

const db = new Database("data/timeclock.db", { readonly: true });
const SALE = "s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'";

// ── Trading days and the holes between them ────────────────────────────────
const allDays = (
  db.prepare(`SELECT DISTINCT s.business_date AS d FROM sales s WHERE ${SALE} ORDER BY d`).all() as { d: string }[]
).map((r) => r.d);

const gaps: { from: string; to: string; days: number }[] = [];
for (let i = 1; i < allDays.length; i++) {
  const prev = new Date(`${allDays[i - 1]}T12:00:00Z`).getTime();
  const cur = new Date(`${allDays[i]}T12:00:00Z`).getTime();
  const missing = Math.round((cur - prev) / 86_400_000) - 1;
  if (missing >= 3) {
    const from = new Date(prev + 86_400_000).toISOString().slice(0, 10);
    const to = new Date(cur - 86_400_000).toISOString().slice(0, 10);
    gaps.push({ from, to, days: missing });
  }
}

// ── The monthly series ─────────────────────────────────────────────────────
type MonthRow = {
  month: string;
  tradingDays: number;
  newU: number; newC: number;
  usedU: number; usedC: number;
  tickets: number;
  allC: number;          // every live line, the whole business
  sizes: number;         // distinct new-tire sizes that sold
  partial: boolean;      // a gap eats into it, or it is the current month
};

const monthly = db
  .prepare(
    `SELECT substr(s.business_date, 1, 7) AS month,
            COUNT(DISTINCT s.business_date) AS tradingDays,
            COUNT(DISTINCT s.id) AS tickets,
            COALESCE(SUM(CASE WHEN c.code = 'new_tire'  THEN i.qty ELSE 0 END), 0) AS newU,
            COALESCE(SUM(CASE WHEN c.code = 'new_tire'  THEN i.line_total_cents ELSE 0 END), 0) AS newC,
            COALESCE(SUM(CASE WHEN c.code = 'used_tire' THEN i.qty ELSE 0 END), 0) AS usedU,
            COALESCE(SUM(CASE WHEN c.code = 'used_tire' THEN i.line_total_cents ELSE 0 END), 0) AS usedC,
            COALESCE(SUM(i.line_total_cents), 0) AS allC,
            COUNT(DISTINCT CASE WHEN c.code = 'new_tire' THEN p.tire_size END) AS sizes
       FROM sales s
       JOIN sale_items i ON i.sale_id = s.id AND i.voided = 0
  LEFT JOIN service_categories c ON c.id = i.category_id
  LEFT JOIN products p ON p.id = i.product_id
      WHERE ${SALE}
   GROUP BY month ORDER BY month`,
  )
  .all() as MonthRow[];

const today = allDays[allDays.length - 1];
for (const m of monthly) {
  const inMonth = new Date(Date.UTC(+m.month.slice(0, 4), +m.month.slice(5, 7), 0)).getUTCDate();
  const isCurrent = m.month === today.slice(0, 7);
  m.partial = isCurrent || m.tradingDays < inMonth - 2; // open 7 days: fewer recorded days than the month has is a hole
}

// ── The windows the app uses: first six months, last six months ───────────
// The current partial month is left out of "now" so a half-month cannot drag
// the average; a partial month at the start is kept because that is where the
// record simply begins.
const usable = monthly.filter((m) => m.tradingDays > 0);
const first6 = usable.slice(0, 6);
const last6full = usable.filter((m) => !(m.month === today.slice(0, 7))).slice(-6);

function windowStats(rows: MonthRow[]) {
  const days = rows.reduce((n, r) => n + r.tradingDays, 0);
  const sum = (pick: (r: MonthRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const tickets = sum((r) => r.tickets);
  return {
    months: rows.map((r) => r.month),
    tradingDays: days,
    perDay: {
      allC: sum((r) => r.allC) / days,
      newC: sum((r) => r.newC) / days,
      usedC: sum((r) => r.usedC) / days,
      newU: sum((r) => r.newU) / days,
      usedU: sum((r) => r.usedU) / days,
      tickets: tickets / days,
    },
    avgTicketC: tickets > 0 ? sum((r) => r.allC) / tickets : 0,
    avgNewPriceC: sum((r) => r.newU) > 0 ? sum((r) => r.newC) / sum((r) => r.newU) : 0,
    avgUsedPriceC: sum((r) => r.usedU) > 0 ? sum((r) => r.usedC) / sum((r) => r.usedU) : 0,
    sizesPerMonth: rows.length ? rows.reduce((n, r) => n + r.sizes, 0) / rows.length : 0,
  };
}
const start = windowStats(first6);
const now = windowStats(last6full);

// ── Volume vs price decomposition, as trends.ts does it ────────────────────
const dTickets = now.perDay.tickets - start.perDay.tickets;
const dAvg = now.avgTicketC - start.avgTicketC;
const fromVolumeC = dTickets * start.avgTicketC;
const fromPriceC = now.perDay.tickets * dAvg;

// ── What the used-tire line's silence costs ────────────────────────────────
// Ganancia at the shop's minimum 20% markup on cost: profit = price − price/1.2
// = 1/6 of the sale. Stated as the floor it is.
const PROFIT_SHARE = 1 - 1 / 1.2;
const usedGapPerDayC = start.perDay.usedC - now.perDay.usedC;

// Cumulative: for every recorded trading day after the first window, what the
// used line actually did against what it did at the start.
let usedCumLostC = 0;
let afterDays = 0;
for (const m of usable) {
  if (first6.includes(m)) continue;
  usedCumLostC += start.perDay.usedC * m.tradingDays - m.usedC;
  afterDays += m.tradingDays;
}

// Same arithmetic for the whole business.
let allCumLostC = 0;
for (const m of usable) {
  if (first6.includes(m)) continue;
  allCumLostC += start.perDay.allC * m.tradingDays - m.allC;
}

// ── Buybacks: where used stock comes from ──────────────────────────────────
const buybacks = db
  .prepare(
    `SELECT substr(business_date, 1, 7) AS month, COUNT(*) AS n,
            COALESCE(SUM(total_cents), 0) AS cents
       FROM sales WHERE deleted = 0 AND kind = 'purchase' AND status = 'completed'
   GROUP BY month ORDER BY month`,
  )
  .all() as { month: string; n: number; cents: number }[];

// ── Demand the shop recorded and could not serve (recent, live-POS only) ──
// The table's presence is checked by name rather than by catching everything:
// the first draft caught a wrong column name as if the table were missing and
// reported 76 real rows of unmet demand as an empty list. A guard that cannot
// tell "not there" from "asked wrongly" hides exactly the bugs it should throw.
let demand: { size: string; asks: number; units: number }[] = [];
let demandTotal = 0;
if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='tire_demand'`).get()) {
  demand = db
    .prepare(
      `SELECT size_norm AS size, COUNT(*) AS asks, COALESCE(SUM(qty), 0) AS units
         FROM tire_demand GROUP BY size_norm ORDER BY asks DESC, units DESC LIMIT 8`,
    )
    .all() as { size: string; asks: number; units: number }[];
  demandTotal = (db.prepare(`SELECT COUNT(*) AS n FROM tire_demand`).get() as { n: number }).n;
}

// ── Projection base: the last three FULL months, per trading day ──────────
const base3 = usable.filter((m) => !m.partial).slice(-3);
const base = windowStats(base3);

// ── The app's own two comparisons, replicated exactly ─────────────────────
// The Trends screen makes two different measurements and the report must
// agree with both. Category concerns ("used tires have all but stopped") are
// the mean of MONTHLY per-day values, first six months of the series against
// the last six INCLUDING the current partial month. The tickets/avg-ticket
// decomposition is the last twelve CLOSED months against the same months a
// year earlier, any month missing on either side dropped from both.
const meanOf = (rows: MonthRow[], pick: (r: MonthRow) => number) =>
  rows.reduce((n, r) => n + pick(r) / r.tradingDays, 0) / rows.length;
const appThen = usable.slice(0, 6);
const appNow = usable.slice(-6);
const appWindows = {
  thenMonths: appThen.map((m) => m.month),
  nowMonths: appNow.map((m) => m.month),
  usedPerDayThenC: meanOf(appThen, (r) => r.usedC),
  usedPerDayNowC: meanOf(appNow, (r) => r.usedC),
  newPerDayThenC: meanOf(appThen, (r) => r.newC),
  newPerDayNowC: meanOf(appNow, (r) => r.newC),
  newUnitsThen: meanOf(appThen, (r) => r.newU),
  newUnitsNow: meanOf(appNow, (r) => r.newU),
  sizesThen: appThen.reduce((n, r) => n + r.sizes, 0) / appThen.length,
  sizesNow: appNow.reduce((n, r) => n + r.sizes, 0) / appNow.length,
};

const thisMonth = today.slice(0, 7);
const closed = usable.filter((m) => m.month !== thisMonth);
const last12 = closed.slice(-12);
const prev12 = closed.slice(-24, -12);
const prevBy = new Map(prev12.map((m) => [m.month, m]));
const shift12 = (month: string) => `${+month.slice(0, 4) - 1}${month.slice(4)}`;
let nowG = 0, nowD = 0, nowT = 0, befG = 0, befD = 0, befT = 0;
const skipped: string[] = [];
for (const m of last12) {
  const b = prevBy.get(shift12(m.month));
  if (!b) { skipped.push(m.month); continue; }
  nowG += m.allC; nowD += m.tradingDays; nowT += m.tickets;
  befG += b.allC; befD += b.tradingDays; befT += b.tickets;
}
const yoy = {
  skipped,
  perDayNowC: nowG / nowD,
  perDayBeforeC: befG / befD,
  ticketsPerDayNow: nowT / nowD,
  ticketsPerDayBefore: befT / befD,
  avgTicketNowC: nowG / nowT,
  avgTicketBeforeC: befG / befT,
  fromVolumeC: (nowT / nowD - befT / befD) * (befG / befT),
  fromPriceC: (nowT / nowD) * (nowG / nowT - befG / befT),
};

const out = {
  generatedFor: today,
  record: { firstDay: allDays[0], lastDay: today, tradingDays: allDays.length },
  gaps,
  monthly,
  windows: { start, now },
  appWindows,
  yoy,
  decomposition: {
    perDayChangeC: now.perDay.allC - start.perDay.allC,
    fromVolumeC,
    fromPriceC,
  },
  used: {
    startPerDayC: start.perDay.usedC,
    nowPerDayC: now.perDay.usedC,
    gapPerDayC: usedGapPerDayC,
    gapPerMonthC: usedGapPerDayC * 30.4,
    profitShare: PROFIT_SHARE,
    profitLostPerMonthC: usedGapPerDayC * 30.4 * PROFIT_SHARE,
    cumulativeLostC: usedCumLostC,
    cumulativeLostProfitC: usedCumLostC * PROFIT_SHARE,
    daysMeasured: afterDays,
  },
  wholeBusiness: { cumulativeLostC: allCumLostC },
  buybacks,
  demand,
  demandTotal,
  projectionBase: base,
};

fs.writeFileSync("scripts/informe-data.json", JSON.stringify(out, null, 1));

// ── The summary a person checks ────────────────────────────────────────────
const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
console.log(`record ${out.record.firstDay} → ${out.record.lastDay} · ${out.record.tradingDays} trading days`);
console.log(`gaps: ${gaps.map((g) => `${g.from}→${g.to} (${g.days}d)`).join(" · ")}`);
console.log(`\nstart (${start.months[0]}…${start.months[5]})  vs  now (${now.months[0]}…${now.months[5]}), per trading day:`);
console.log(`  whole business  ${$(start.perDay.allC)} → ${$(now.perDay.allC)}`);
console.log(`  new tires       ${$(start.perDay.newC)} → ${$(now.perDay.newC)}   units ${start.perDay.newU.toFixed(1)} → ${now.perDay.newU.toFixed(1)}`);
console.log(`  used tires      ${$(start.perDay.usedC)} → ${$(now.perDay.usedC)}   units ${start.perDay.usedU.toFixed(1)} → ${now.perDay.usedU.toFixed(1)}`);
console.log(`  tickets/day     ${start.perDay.tickets.toFixed(1)} → ${now.perDay.tickets.toFixed(1)} · avg ticket ${$(start.avgTicketC)} → ${$(now.avgTicketC)}`);
console.log(`  sizes/month     ${start.sizesPerMonth.toFixed(0)} → ${now.sizesPerMonth.toFixed(0)}`);
console.log(`\ndecomposition of ${$(out.decomposition.perDayChangeC)}/day: volume ${$(fromVolumeC)} + ticket size ${$(fromPriceC)}`);
console.log(`used line: gap ${$(usedGapPerDayC)}/day = ${$(out.used.gapPerMonthC)}/month sales, ${$(out.used.profitLostPerMonthC)}/month profit at 20% markup`);
console.log(`used cumulative since start window: ${$(usedCumLostC)} sales · ${$(out.used.cumulativeLostProfitC)} profit`);
console.log(`whole business cumulative vs start pace: ${$(allCumLostC)}`);
console.log(`buybacks ever recorded: ${buybacks.reduce((n, b) => n + b.n, 0)} totalling ${$(buybacks.reduce((n, b) => n + b.cents, 0))}`);
console.log("\napp-style (first6 vs last6 incl current):");
console.log(
  `  used/day ${$(appWindows.usedPerDayThenC)} → ${$(appWindows.usedPerDayNowC)} · new units/day ${appWindows.newUnitsThen.toFixed(1)} → ${appWindows.newUnitsNow.toFixed(1)} · sizes ${appWindows.sizesThen.toFixed(0)} → ${appWindows.sizesNow.toFixed(0)}`,
);
console.log("year-over-year (last 12 closed vs same months prior):");
console.log(
  `  ${$(yoy.perDayBeforeC)}/day → ${$(yoy.perDayNowC)}/day · tickets ${yoy.ticketsPerDayBefore.toFixed(1)} → ${yoy.ticketsPerDayNow.toFixed(1)} · avg ${$(yoy.avgTicketBeforeC)} → ${$(yoy.avgTicketNowC)}`,
);
console.log(
  `  decomposition: volume ${$(yoy.fromVolumeC)}/day + ticket size ${$(yoy.fromPriceC)}/day · skipped: ${yoy.skipped.join(", ") || "none"}`,
);
console.log(`projection base (${base3.map((m) => m.month).join(", ")}): ${$(base.perDay.allC)}/day whole · new ${$(base.perDay.newC)} · used ${$(base.perDay.usedC)}`);
db.close();
