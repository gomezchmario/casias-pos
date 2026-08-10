/**
 * A static preview of the trends page, built from the shop's real figures.
 *
 * Same looking glass as `preview-reports.mts` and for the same reason: the page
 * is a client component behind a PIN, and a chart is the one thing that cannot
 * be checked by reading its source. Every figure comes from `trends.ts` and
 * every shape from `Charts.tsx`, so anything wrong here is wrong on the page.
 *
 *   npx tsx --tsconfig scripts/tsconfig.preview.json scripts/preview-trends.mts
 */

import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BarChart,
  Bridge,
  LineChart,
  PairedBars,
  RankedBars,
  StackedBars,
  Stat,
  changePct,
} from "../src/components/pos/Charts.tsx";
import { shopTrends } from "../src/lib/trends.ts";
import { formatCents } from "../src/lib/money.ts";

const t = shopTrends(process.argv[2] ?? "2026-08-09");
const money = (n: number) => formatCents(n);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ml = (b: string) => `${MONTHS[Number(b.split("-")[1]) - 1].slice(0, 3)} ${b.slice(2, 4)}`;
const c = t.compare;
const labels = t.months.map((m) => ml(m.bucket));
const orNull = (m: { tradingDays: number }, v: number) => (m.tradingDays > 0 ? v : null);

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

const SEV: Record<string, string> = { serious: "Serious", watch: "Watch", steady: "Steady" };

const body = renderToStaticMarkup(
  h("div", { className: "rp", style: { maxWidth: 1100, margin: "0 auto" } }, [
    h("h1", { key: "t", style: { fontSize: 24, fontWeight: 600, color: "#0a2540", marginBottom: 4 } },
      "Which way it is going"),
    h("p", { key: "s", style: { color: "rgba(10,37,64,.5)", fontSize: 13, marginBottom: 24 } },
      `${t.firstDate} → ${t.today} · ${t.tradingDays} trading days · ${t.monthsOnRecord} finished months`),

    Section("Worth knowing",
      "Worked out from the charts below every time the page is opened.",
      h("div", { className: "rp-concerns", key: "c" },
        t.concerns.map((x) =>
          h("div", { className: `rp-concern ${x.severity}`, key: x.key }, [
            h("div", { className: "rp-concern-head", key: "h" }, [
              h("span", { className: "rp-concern-tag", key: "t" }, SEV[x.severity]),
              h("span", { className: "rp-concern-title", key: "n" }, x.title),
            ]),
            h("div", { className: "rp-concern-find", key: "f" }, x.finding),
            h("div", { className: "rp-concern-mean", key: "m" }, x.meaning),
          ]),
        )),
    ),

    Section("Where it stands",
      `${c.label} against ${c.priorLabel} · ${c.comparedMonths} months both years have records for`,
      h("div", { className: "rp-stats", key: "s" }, [
        h(Stat, { key: 1, label: "Takings a day", value: money(c.perDayNowCents), deltaPct: c.growthPct ?? undefined, deltaLabel: "on a year ago" }),
        h(Stat, { key: 2, label: "Tickets a day", value: c.ticketsPerDayNow.toFixed(1), deltaPct: changePct(c.ticketsPerDayNow, c.ticketsPerDayBefore) ?? undefined, deltaLabel: "on a year ago" }),
        h(Stat, { key: 3, label: "Average ticket", value: money(c.avgTicketNowCents), deltaPct: changePct(c.avgTicketNowCents, c.avgTicketBeforeCents) ?? undefined, deltaLabel: "on a year ago" }),
        h(Stat, { key: 4, label: "On the floor", value: (t.capacity.at(-1)?.techDaysPerDay ?? 0).toFixed(1), sub: "technicians on an average day" }),
      ]),
    ),

    Section("Why it moved",
      "Takings a day is tickets a day times the average ticket, so the change splits exactly between the two.",
      Panel("From a year ago to now, one cause at a time", "Green adds, red takes away.",
        h(Bridge, {
          start: { label: "A year ago", value: c.perDayBeforeCents },
          steps: [
            { label: "Number of tickets", delta: c.fromVolumeCents },
            { label: "Size of each ticket", delta: c.fromPriceCents },
          ],
          end: c.perDayNowCents,
          format: money,
        })),
      h("div", { className: "rp-two", key: "w" }, [
        Panel("Tickets for every day open", null, h(LineChart, {
          series: [{ name: "Tickets a day", values: t.months.map((m) => orNull(m, m.ticketsPerDay)) }],
          labels, format: (n: number) => n.toFixed(0),
        })),
        Panel("Average ticket", null, h(LineChart, {
          series: [{ name: "Average ticket", values: t.months.map((m) => orNull(m, m.avgTicketCents)), color: "#1f7a8c" }],
          labels, format: money,
        })),
      ]),
    ),

    Section("Whether there were tires to sell",
      "The last one is the control: if customers had stopped affording tires it would fall as they traded down.",
      h("div", { className: "rp-two", key: "a" }, [
        Panel("Different sizes sold in the month", "The range on offer.", h(LineChart, {
          series: [{ name: "Sizes", values: t.access.map((a) => a.sizesSold) }],
          labels: t.access.map((a) => ml(a.bucket)), format: (n: number) => n.toFixed(0),
        })),
        Panel("Tickets that carried a tire", null, h(LineChart, {
          series: [{ name: "Share", values: t.access.map((a) => a.ticketSharePct), color: "#b45309" }],
          labels: t.access.map((a) => ml(a.bucket)), format: (n: number) => `${n.toFixed(0)}%`,
        })),
      ]),
      h("div", { className: "rp-two", key: "b" }, [
        Panel("Tires out of the door, for every day open", null, h(LineChart, {
          series: [{ name: "Tires a day", values: t.access.map((a) => a.unitsPerDay) }],
          labels: t.access.map((a) => ml(a.bucket)), format: (n: number) => n.toFixed(1),
        })),
        Panel("What one tire sold for", "The control.", h(LineChart, {
          series: [{ name: "Average tire", values: t.access.map((a) => (a.avgLineCents > 0 ? a.avgLineCents : null)), color: "#15803d" }],
          labels: t.access.map((a) => ml(a.bucket)), format: money,
        })),
      ]),
      Panel("What the shop sells, for every day open", null, h(LineChart, {
        series: [
          { name: "New tires", values: t.categories.map((x) => x.newCents) },
          { name: "Service", values: t.categories.map((x) => x.serviceCents), color: "#b45309" },
          { name: "Used tires", values: t.categories.map((x) => x.usedCents), color: "#1f7a8c" },
        ],
        labels: t.categories.map((x) => ml(x.bucket)), format: money, height: 150,
      })),
    ),

    Section("The crew, against the work",
      "Per technician-day — the time clock has too little in it to measure hours.",
      h("div", { className: "rp-two", key: "c" }, [
        Panel("Technicians on the floor, on an average day", null, h(LineChart, {
          series: [{ name: "On the floor", values: t.capacity.map((x) => x.techDaysPerDay) }],
          labels: t.capacity.map((x) => ml(x.bucket)), format: (n: number) => n.toFixed(1),
        })),
        Panel("Tickets one technician gets through in a day", null, h(LineChart, {
          series: [{ name: "Tickets", values: t.capacity.map((x) => x.ticketsPerTechDay), color: "#b45309" }],
          labels: t.capacity.map((x) => ml(x.bucket)), format: (n: number) => n.toFixed(1),
        })),
      ]),
      Panel("Money brought in per technician-day", null, h(LineChart, {
        series: [{ name: "Per technician-day", values: t.capacity.map((x) => x.perTechDayCents), color: "#15803d" }],
        labels: t.capacity.map((x) => ml(x.bucket)), format: money,
      })),
    ),

    Section("The long run",
      "Per trading day throughout.",
      Panel("Takings for every day open, month by month", "The last bar is not a finished month.",
        h(BarChart, {
          data: t.months.map((m) => ({ label: ml(m.bucket), value: m.perDayCents, sub: m.tradingDays === 0 ? "no records" : undefined })),
          format: money, height: 150,
        })),
      Panel("The same figure with the seasons taken out", "Each point is the twelve months up to it.",
        h(LineChart, {
          series: [{ name: "Twelve months to here", values: t.ttm.map((x, i) => (i >= 11 ? x.perDayCents : null)) }],
          labels: t.ttm.map((x) => ml(x.bucket)), format: money, height: 150,
        })),
      Panel("This year against last", null, h(PairedBars, {
        data: t.months.slice(-12).map((m, i) => ({
          label: ml(m.bucket),
          a: t.months[t.months.length - 24 + i]?.perDayCents ?? 0,
          b: m.perDayCents,
        })),
        labels: ["A year ago", "This year"] as [string, string], format: money,
      })),
    ),

    Section("The shop's year, and its week",
      "Over everything on record.",
      h("div", { className: "rp-two", key: "y" }, [
        Panel("Every month, averaged", "Per trading day.", h(RankedBars, {
          data: t.seasonality.map((s) => ({ label: MONTHS[s.month - 1], value: s.perDayCents, note: ` · ${s.years} years` })),
          format: money,
        })),
        Panel("The week, then and now", `${t.weekdayLabels.early} against ${t.weekdayLabels.late}`, h(PairedBars, {
          data: t.weekday.map((w) => ({ label: DAYS[w.weekday].slice(0, 3), a: w.earlyPerDayCents, b: w.latePerDayCents })),
          labels: ["Then", "Now"] as [string, string], format: money,
        })),
      ]),
    ),

    Section("How it is paid",
      "Shares of what was collected, quarter by quarter.",
      h(StackedBars, {
        key: "s",
        columns: t.tender.map((q) => ({ label: q.bucket.replace("-", " "), parts: q.parts.map((p) => ({ label: p.label, value: p.cents })) })),
        format: money,
      }),
    ),
  ]),
);

const css = fs.readFileSync("src/app/pos/(shell)/reports/reports.css", "utf8");
const out = path.join(process.cwd(), "docs", "trends-preview.html");
fs.writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Trends preview</title>
<style>
  body { margin: 0; padding: 28px 20px; background: #f5f7fa; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .btn { display:inline-block; padding:0 12px; border-radius:8px; border:1px solid rgba(10,37,64,.15); }
  ${css}
</style>
${body}`,
);
console.log(`wrote ${out}`);
