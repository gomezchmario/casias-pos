/**
 * A static preview of the reports page, built from the shop's real figures.
 *
 * The page itself is a client component behind a PIN, which makes it awkward to
 * look at while building it — and a dashboard is the one kind of screen that
 * cannot be checked by reading its source. So this renders the same chart
 * components against the same queries, with the same stylesheet, and writes an
 * HTML file to open.
 *
 * It is a LOOKING GLASS, not a second implementation: every figure comes from
 * `reports-bi.ts` and every shape from `Charts.tsx`, so anything wrong here is
 * wrong on the page.
 *
 *   npx --yes tsx scripts/preview-reports.mts
 */

import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BarChart,
  Donut,
  Heatmap,
  PairedBars,
  RankedBars,
  Spark,
  StackedBars,
  Stat,
  changePct,
} from "../src/components/pos/Charts.tsx";
import {
  categoryMix,
  controlStats,
  customerStats,
  deadStock,
  employeePerformance,
  employeeSparks,
  headline,
  hourHeatmap,
  lostDemand,
  productMovement,
  purchaseSummary,
  receivablesAging,
  reorderList,
  revenueTrend,
  stockValue,
  tenderMix,
  trends,
  weekdayProfile,
} from "../src/lib/reports-bi.ts";
import { formatCents } from "../src/lib/money.ts";

const to = process.argv[3] ?? "2026-08-09";
const from = process.argv[2] ?? "2026-07-11";

const money = (n: number) => formatCents(n);
const count = (n: number) => String(n);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const label = (b: string) => {
  const [, m, d] = b.split("-");
  return `${Number(m)}/${Number(d)}`;
};

const hl = headline(from, to);
const trend = revenueTrend(from, to, "day");
const cats = categoryMix(from, to);
const tenders = tenderMix(from, to);
const heat = hourHeatmap(from, to);
const week = weekdayProfile(from, to);
const best = productMovement(from, to).filter((p) => p.units > 0).slice(0, 12);
const stock = stockValue();
const dead = deadStock(to, 45).slice(0, 8);
const reorder = reorderList(to).slice(0, 8);
const aging = receivablesAging(to);
const cust = customerStats(from, to);
const ctl = controlStats(from, to);
const lost = lostDemand(from, to);
const buys = purchaseSummary(from, to);

const emp = employeePerformance(from, to);
const sparks = employeeSparks(to);
const tr = trends(to);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const mlabel = (b: string) => `${MONTHS[Number(b.split("-")[1]) - 1].slice(0, 3)} ${b.slice(2, 4)}`;
const dayRates = emp.rows.map((r) => r.perDayCents).sort((a, b) => a - b);
const medianPerDay = dayRates.length ? dayRates[Math.floor(dayRates.length / 2)] : 0;
const bestPerDay = emp.rows.reduce<(typeof emp.rows)[number] | null>(
  (best, r) => (!best || r.perDayCents > best.perDayCents ? r : best),
  null,
);
const sparkMax = Math.max(1, ...Object.values(sparks.byEmployee).flatMap((s) => s));

const hrs = heat.map((c) => c.hour);
const lo = hrs.length ? Math.min(...hrs) : 8;
const hi = hrs.length ? Math.max(...hrs) : 18;
const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

const totalRevenue = cats.reduce((n, c) => n + c.revenueCents, 0);
const totalTender = tenders.reduce((n, t) => n + Math.max(0, t.amountCents), 0);
const owedT = aging.reduce((n, b) => n + b.ticketCents, 0);
const owedA = aging.reduce((n, b) => n + b.accountCents, 0);

const Section = (title: string, note: string, ...kids: unknown[]) =>
  h("section", { className: "rp-section" }, [
    h("h2", { className: "rp-h2", key: "h" }, title),
    h("p", { className: "rp-note", key: "n" }, note),
    ...(kids as never[]),
  ]);

const Panel = (title: string, note: string | null, kid: unknown) =>
  h("div", { className: "rp-panel" }, [
    h("div", { className: "rp-panel-head", key: "h" }, [
      h("span", { key: "s" }, title),
      note ? h("em", { key: "e" }, note) : null,
    ]),
    kid as never,
  ]);

const Table = (head: string[], rows: (string | number)[][]) =>
  h("table", { className: "rp-table" }, [
    h(
      "thead",
      { key: "t" },
      h(
        "tr",
        null,
        head.map((c, i) => h("th", { key: i, className: i ? "r" : undefined }, c)),
      ),
    ),
    h(
      "tbody",
      { key: "b" },
      rows.map((r, i) =>
        h(
          "tr",
          { key: i },
          r.map((c, j) => h("td", { key: j, className: j ? "r n" : undefined }, String(c))),
        ),
      ),
    ),
  ]);

const body = renderToStaticMarkup(
  h("div", { className: "rp", style: { maxWidth: 1100, margin: "0 auto" } }, [
    h("h1", { key: "t", style: { fontSize: 24, fontWeight: 600, color: "#0a2540", marginBottom: 4 } }, "Reports"),
    h("p", { key: "s", style: { color: "rgba(10,37,64,.5)", fontSize: 13, marginBottom: 24 } },
      `${from} → ${to} · preview built from the live database`),

    Section("Money",
      "Sold is what was charged for. Collected is what came in — a deposit today on last week's order is in one and not the other.",
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "Sold", value: money(hl.goodsCents), deltaPct: changePct(hl.goodsCents, hl.prior.goodsCents) ?? undefined, deltaLabel: "on the window before" }),
        h(Stat, { key: 2, label: "Collected", value: money(hl.collectedCents) }),
        h(Stat, { key: 3, label: "Tickets", value: String(hl.tickets), deltaPct: changePct(hl.tickets, hl.prior.tickets) ?? undefined, deltaLabel: "on the window before" }),
        h(Stat, { key: 4, label: "Average ticket", value: money(hl.avgTicketCents) }),
        h(Stat, { key: 5, label: "Gross margin", value: `${hl.marginPct.toFixed(0)}%`, sub: `${money(hl.marginCents)} · on the ${hl.costCoveragePct}% of sales with a cost` }),
        h(Stat, { key: 6, label: "Given away", value: money(hl.discountsCents), sub: `${ctl.discounts.count} tickets discounted`, tone: hl.discountsCents > 0 ? "warn" : undefined }),
      ]),
      h("div", { className: "rp-chart-wrap", key: "c" },
        h(PairedBars, {
          data: trend.map((p) => ({ label: label(p.bucket), a: p.goodsCents, b: p.collectedCents })),
          labels: ["Sold", "Collected"], format: money,
        })),
      h("div", { className: "rp-two", key: "two" }, [
        Panel("Tickets a day", null, h(BarChart, { data: trend.map((p) => ({ label: label(p.bucket), value: p.tickets })), format: count, height: 90 })),
        Panel("Average ticket", null, h(BarChart, { data: trend.map((p) => ({ label: label(p.bucket), value: p.avgTicketCents })), format: money, height: 90, color: "#1f7a8c" })),
      ]),
    ),

    Section("What sells",
      "Margin is worked out only on the lines that carry a cost, and the tax is taken out of the price first.",
      h("div", { className: "rp-two", key: "d" }, [
        Panel("Sales mix", null, h(Donut, { data: cats.map((c) => ({ label: c.label, value: c.revenueCents })), total: totalRevenue, totalLabel: "sold", format: money })),
        Panel("How it was paid", null, h(Donut, { data: tenders.filter((t) => t.amountCents > 0).map((t) => ({ label: t.label, value: t.amountCents })), total: totalTender, totalLabel: "collected", format: money })),
      ]),
      Panel("Margin by category", null, Table(
        ["Category", "Sold", "Units", "Cost", "Margin", "Margin %", "Costed"],
        cats.map((c) => {
          const base = c.marginCents + c.costCents;
          return [c.label, money(c.revenueCents), c.units, c.costCents ? money(c.costCents) : "—",
            c.costCoveragePct ? money(c.marginCents) : "—",
            base > 0 ? `${((c.marginCents / base) * 100).toFixed(0)}%` : "—", `${c.costCoveragePct}%`];
        }),
      )),
      Panel("Best sellers", "Units sold in this window.",
        h(RankedBars, { data: best.map((p) => ({ label: p.name, value: p.units, note: ` · ${money(p.revenueCents)}` })), format: count })),
    ),

    Section("When the shop is busy",
      "Blue is quiet, red is flat out. This is the one report that settles a rota argument.",
      Panel("Tickets by hour", null, h(Heatmap, {
        cells: heat.map((c) => ({ weekday: c.weekday, hour: c.hour, value: c.tickets })),
        hours, format: (n: number) => `${n} tickets`,
      })),
      h("div", { className: "rp-two", key: "w" }, [
        Panel("Takings by day of the week", "Averaged over how many of each day the window held.",
          h(RankedBars, {
            data: week.filter((w) => w.days > 0).map((w) => ({
              label: DAY_NAMES[w.weekday],
              value: Math.round(w.goodsCents / w.days),
              note: ` · ${Math.round((w.tickets / w.days) * 10) / 10} tickets a day`,
            })), format: money,
          })),
        Panel("Busiest hours", null, h(RankedBars, {
          data: (() => {
            const m = new Map<number, number>();
            for (const c of heat) m.set(c.hour, (m.get(c.hour) ?? 0) + c.tickets);
            return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
              .map(([hr, n]) => ({ label: hr < 12 ? `${hr} AM` : hr === 12 ? "12 PM" : `${hr - 12} PM`, value: n }));
          })(), format: count,
        })),
      ]),
    ),

    Section("How everyone is doing",
      "Measured per day they were actually here, against the same length of time before this window.",
      emp.priorTradingDays === 0
        ? h("div", { className: "rp-warn", key: "w" },
            `There is no record of the shop opening between ${emp.priorFrom} and ${emp.priorTo}, so there is nothing to compare this window against.`)
        : null,
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "On the floor", value: String(emp.rows.length), sub: "credited with work in this window" }),
        h(Stat, { key: 2, label: "Best day rate", value: money(bestPerDay?.perDayCents ?? 0), sub: bestPerDay ? `${bestPerDay.name} · ${bestPerDay.daysWorked} days here` : "—" }),
        h(Stat, { key: 3, label: "Typical day rate", value: money(medianPerDay), sub: "the middle of the crew" }),
        h(Stat, { key: 4, label: "Tips", value: money(emp.rows.reduce((n, r) => n + r.tipCents, 0)), sub: "what customers added" }),
      ]),
      Panel("Money brought in, per day here", "The fair comparison between people who work different amounts.",
        h(RankedBars, {
          data: emp.rows.slice().sort((a, b) => b.perDayCents - a.perDayCents)
            .map((r) => ({ label: r.name, value: r.perDayCents, note: ` · ${r.daysWorked} days` })),
          format: money,
        })),
      h("table", { className: "rp-table", key: "tb" }, [
        h("thead", { key: "h" }, h("tr", null,
          ["Technician", "Days here", "Tickets", "Per ticket", "Tip a ticket", "Per day here", "Brought in", "Last 12 months"]
            .map((c, i) => h("th", { key: i, className: i && i < 7 ? "r" : undefined }, c)))),
        h("tbody", { key: "b" }, emp.rows.map((r) => h("tr", { key: r.employeeId }, [
          h("td", { key: 0 }, r.name),
          h("td", { key: 1, className: "r n" }, String(r.daysWorked)),
          h("td", { key: 2, className: "r n" }, String(r.ticketCount)),
          h("td", { key: 3, className: "r n" }, money(r.perTicketCents)),
          h("td", { key: 4, className: "r n" }, r.tipCents ? money(r.tipPerTicketCents) : "—"),
          h("td", { key: 5, className: "r n" }, money(r.perDayCents)),
          h("td", { key: 6, className: "r n" }, `${money(r.incomeCents)} · ${r.incomePct.toFixed(0)}%`),
          h("td", { key: 7 }, h(Spark, {
            values: sparks.byEmployee[r.employeeId] ?? [], max: sparkMax,
            labels: sparks.months, format: money,
          })),
        ]))),
      ]),
    ),

    Section("Which way it is going",
      "The only section that ignores the window at the top — it always covers the last two years.",
      tr.gapMonths.length > 0
        ? h("div", { className: "rp-warn", key: "w" },
            `No records at all for ${tr.gapMonths.join(", ")}. Those months are left out of every comparison below rather than counted as zero.`)
        : null,
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "Takings a day", value: money(tr.summary.perDayNowCents),
          deltaPct: tr.summary.growthPct ?? undefined, deltaLabel: `on a year ago · ${tr.summary.comparedMonths} months compared` }),
        h(Stat, { key: 2, label: "Last 12 months", value: money(tr.summary.last12Cents), sub: `${tr.summary.ticketsLast12} tickets` }),
        h(Stat, { key: 3, label: "Average ticket", value: money(tr.summary.avgTicketLast12),
          deltaPct: changePct(tr.summary.avgTicketLast12, tr.summary.avgTicketPrev12) ?? undefined, deltaLabel: "on the 12 months before" }),
        h(Stat, { key: 4, label: "Best month", value: tr.summary.bestMonth ? mlabel(tr.summary.bestMonth.bucket) : "—",
          sub: tr.summary.bestMonth ? `${money(tr.summary.bestMonth.perDayCents)} a day` : undefined }),
      ]),
      Panel("Takings for every day open, month by month", "Per trading day, so a short February is not a bad February.",
        h(BarChart, {
          data: tr.months.map((m) => ({ label: mlabel(m.bucket), value: m.perDayCents, sub: m.tradingDays === 0 ? "no records" : undefined })),
          format: money, height: 150,
        })),
      h("div", { className: "rp-two", key: "y" }, [
        Panel("This year against last", "Each month beside the same month a year earlier.",
          h(PairedBars, {
            data: tr.yoy.map((y) => ({ label: mlabel(y.bucket), a: y.beforeCents, b: y.nowCents })),
            labels: ["A year ago", "This year"] as [string, string], format: money,
          })),
        Panel("The shop's year", "Every January averaged, every February averaged, and so on.",
          h(RankedBars, {
            data: tr.seasonality.map((s) => ({ label: MONTHS[s.month - 1], value: s.perDayCents, note: ` · ${s.years} years` })),
            format: money,
          })),
      ]),
      Panel("What the shop sells, quarter by quarter", "Watch for a band getting thicker across the page.",
        h(StackedBars, {
          columns: tr.mix.map((q) => ({ label: q.bucket.replace("-", " "), parts: q.parts.map((p) => ({ label: p.label, value: p.cents })) })),
          format: money,
        })),
    ),

    Section("The racks",
      "Stock is valued at what it actually cost — the weighted average of everything received.",
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "Stock on hand", value: money(stock.totalCostCents), sub: `${stock.totalUnits} units, at cost` }),
        h(Stat, { key: 2, label: "Standing still", value: money(dead.reduce((n, d) => n + d.costCents, 0)), sub: `${dead.length} sizes with no sale in 45 days`, tone: "warn" }),
        h(Stat, { key: 3, label: "At the reorder point", value: String(reorder.length), sub: "sizes to order", tone: reorder.length ? "warn" : undefined }),
        h(Stat, { key: 4, label: "Bought over the counter", value: money(buys.costCents), sub: `${buys.units} used tires taken in` }),
      ]),
      h("div", { className: "rp-two", key: "b" }, [
        Panel("Where the money is, by brand", null, h(RankedBars, { data: stock.byBrand.slice(0, 10).map((b) => ({ label: b.key, value: b.costCents, note: ` · ${b.units}` })), format: money })),
        Panel("By rim size", null, h(RankedBars, { data: stock.byRim.slice(0, 10).map((b) => ({ label: b.key, value: b.costCents, note: ` · ${b.units}` })), format: money })),
      ]),
      Panel("Money standing still", "On the racks, not sold in 45 days.", Table(
        ["Tire", "On hand", "Tied up", "Last sold", "On the shelf"],
        dead.map((d) => [d.name, d.onHand, money(d.costCents),
          d.daysSinceSale === null ? "never" : `${d.daysSinceSale} days ago`,
          d.daysOnShelf === null ? "—" : `${d.daysOnShelf} days`]),
      )),
      Panel("To order", "At or under the reorder point.", Table(
        ["Tire", "On hand", "Reorder at", "Sold in 90 days"],
        reorder.map((r) => [r.name, r.onHand, r.reorderPoint, r.sold90 || "—"]),
      )),
    ),

    Section("What is owed to the shop",
      "Two columns because they are chased by different people.",
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "On tickets", value: money(owedT), tone: owedT > 0 ? "warn" : undefined }),
        h(Stat, { key: 2, label: "On house accounts", value: money(owedA), tone: owedA > 0 ? "warn" : undefined }),
        h(Stat, { key: 3, label: "Owed altogether", value: money(owedT + owedA), tone: "warn" }),
      ]),
      Panel("How old the debt is", null, Table(
        ["Age", "On tickets", "On accounts", "Together"],
        aging.map((b) => [b.label, b.ticketCents ? money(b.ticketCents) : "—",
          b.accountCents ? money(b.accountCents) : "—",
          b.ticketCents + b.accountCents ? money(b.ticketCents + b.accountCents) : "—"]),
      )),
    ),

    Section("Customers",
      "Bounded by how many tickets took a name at all.",
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "Tickets with a name", value: String(cust.named), sub: `${cust.anonymous} without one` }),
        h(Stat, { key: 2, label: "New customers", value: String(cust.newCustomers), tone: "good" }),
        h(Stat, { key: 3, label: "Came back", value: String(cust.returningCustomers) }),
        h(Stat, { key: 4, label: "Repeat share", value: cust.named ? `${Math.round((cust.returningCustomers / Math.max(1, cust.newCustomers + cust.returningCustomers)) * 100)}%` : "—", sub: "of named customers had been in before" }),
      ]),
      Panel("Who spends the most", null, h(RankedBars, {
        data: cust.top.map((c) => ({ label: c.name, value: c.spentCents, note: ` · ${c.tickets} tickets` })), format: money,
      })),
    ),

    Section("What walked out",
      "Two different qualities of evidence, kept apart.",
      h("div", { className: "rp-two", key: "l" }, [
        Panel("Asked for and not in stock", "From the counter's study.", h(RankedBars, {
          data: lost.recorded.slice(0, 10).map((r) => ({ label: r.size, value: r.tires, color: !r.onHand ? "#b91c1c" : "#15803d" })),
          format: count, emptyLabel: "Nothing recorded in this window.",
        })),
        Panel("Searched for and not found", "Register searches that came back empty.", h(RankedBars, {
          data: lost.searched.slice(0, 10).map((r) => ({ label: r.size, value: r.asks })), format: count,
        })),
      ]),
    ),

    Section("Worth a second look",
      "None of these is wrong by itself. What matters is the shape.",
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "Voided tickets", value: String(ctl.voids.count), sub: money(ctl.voids.cents), tone: "warn" }),
        h(Stat, { key: 2, label: "Refunds", value: String(ctl.refunds.count), sub: money(ctl.refunds.cents) }),
        h(Stat, { key: 3, label: "Prices changed at the counter", value: String(ctl.overrides.count), sub: `over the rack by ${money(Math.abs(ctl.overrides.deltaCents))}` }),
        h(Stat, { key: 4, label: "Changed after completing", value: String(ctl.lateEdits), tone: "warn" }),
        h(Stat, { key: 5, label: "Sold below the count", value: String(ctl.oversells), tone: "bad" }),
        h(Stat, { key: 6, label: "Register logs that did not balance", value: String(ctl.badChecks.count), sub: `worst ${money(ctl.badChecks.worstCents)}`, tone: "bad" }),
      ]),
      h("div", { className: "rp-two", key: "w" }, [
        Panel("Who gave the discounts", null, h(RankedBars, { data: ctl.discounts.byName.map((d) => ({ label: d.name, value: d.cents, note: ` · ${d.count}` })), format: money, emptyLabel: "Nothing was discounted." })),
        Panel("Who voided tickets", null, h(RankedBars, { data: ctl.voids.byName.map((d) => ({ label: d.name, value: d.count, note: ` · ${money(d.cents)}` })), format: count })),
      ]),
    ),
  ]),
);

const css = fs.readFileSync(path.resolve("src/app/pos/(shell)/reports/reports.css"), "utf8");

const out = path.resolve("docs/reports-preview.html");
fs.writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Reports preview</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f4f6fa;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px;color:#0a2540}
button,table{font:inherit}
ul{list-style:none}
${css}
</style>
${body}`,
  "utf8",
);
console.log("wrote", out);
