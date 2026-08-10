"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import {
  BarChart,
  Donut,
  Heatmap,
  PairedBars,
  RankedBars,
  Stat,
  changePct,
} from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import type {
  AgingBucket,
  CategoryRow,
  ControlStats,
  CustomerStats,
  DeadStockRow,
  Headline,
  HourCell,
  LostRow,
  ProductRow,
  PurchaseSummary,
  ReorderRow,
  RestockRow,
  StockValueRow,
  TenderRow,
  TrendPoint,
  WeekdayRow,
} from "@/lib/reports-bi";
import "./reports.css";

/**
 * The management reports.
 *
 * WHAT THIS SCREEN IS FOR, stated first because it governs every choice below:
 * the close-out answers "did tonight come out right", the day screen answers
 * "how is today going", and neither of them answers "how is this business
 * doing". That question is asked once a week by one person, sitting down, and
 * it is the question that decides what to buy, who to roster and what to charge.
 *
 * SO IT IS ORGANISED BY THE DECISION IT FEEDS, not by where the data lives:
 *
 *   Money        — is the shop making any, and more or less than before
 *   What sells   — where the money comes from and where the margin is
 *   When         — the hours and days the shop actually earns in
 *   Who          — the technicians, over the same window as everything else
 *   The racks    — cash standing still, and cash about to run out
 *   Owed         — what is out there, by how old it is
 *   Customers    — who comes back, and who spends
 *   Missed       — what walked out of the door unsold
 *   Control      — the handful of things worth a second look
 *
 * EVERY FIGURE COVERS THE WINDOW AT THE TOP. That promise is the reason this
 * page can be trusted, and it is why the technician board here is built from
 * the window rather than borrowed from the close-out's calendar week.
 *
 * WHERE A NUMBER CANNOT BE HONEST IT SAYS SO. Margin is computed only over
 * lines that carry a cost — a flat repair has none and never should — and the
 * coverage is printed beside it rather than left to be assumed. The same
 * applies to the customer figures, which are bounded by how many tickets took a
 * name at all.
 */

type Data = {
  from: string;
  to: string;
  days: number;
  grain: "day" | "week" | "month";
  today: string;
  /** The earliest day the shop has any record of — see the route. */
  firstDate: string;
  headline: Headline;
  trend: TrendPoint[];
  categories: CategoryRow[];
  tenders: TenderRow[];
  heatmap: HourCell[];
  weekdays: WeekdayRow[];
  bestSellers: ProductRow[];
  stock: { totalUnits: number; totalCostCents: number; byBrand: StockValueRow[]; byRim: StockValueRow[] };
  dead: DeadStockRow[];
  reorder: ReorderRow[];
  restock: RestockRow[];
  aging: AgingBucket[];
  customers: CustomerStats;
  control: ControlStats;
  lost: { recorded: LostRow[]; searched: LostRow[] };
  purchases: PurchaseSummary;
  techs: {
    employeeId: number;
    name: string;
    newTires: number;
    usedTires: number;
    otherCount: number;
    ticketCount: number;
    incomeCents: number;
    tipCents: number;
    incomePct: number;
  }[];
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A window somebody would actually ask for, as a button. */
const PRESETS: { key: string; label: string; days: number }[] = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  // Everything the shop has ever recorded. Days are not fixed — the window
  // starts at the first day there is a record of, which the server sends,
  // because that answer moved by two years the day the old workbook came in.
  { key: "all", label: "All time", days: 0 },
];

function shiftDays(from: string, n: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The bucket key as a chart label: "8/9", "wk 8/4", "Aug". */
function bucketLabel(bucket: string, grain: Data["grain"]): string {
  if (grain === "month") {
    const [, m] = bucket.split("-");
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
      Number(m) - 1
    ] ?? bucket;
  }
  const [, m, d] = bucket.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function ReportsPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [preset, setPreset] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedOn, setPrintedOn] = useState("");
  /**
   * Whether the searched-for list shows the keystrokes as well as the questions.
   *
   * Off by default. The search box logs every character, so one customer asking
   * for a 215/45/17 leaves half a dozen partial strings behind — those are the
   * register being used, not sizes anybody wanted.
   */
  const [showPartial, setShowPartial] = useState(false);
  /**
   * Reorder points set from this page, by product.
   *
   * Held here rather than reloading the whole report after each one. The page
   * is a few dozen queries and somebody setting eight reorder points in a row
   * should not wait for all of them eight times.
   */
  const [applied, setApplied] = useState<Record<number, number>>({});
  const [applying, setApplying] = useState<number | null>(null);

  async function applyReorder(productId: number, reorderPoint: number) {
    setApplying(productId);
    const res = await fetch(`/api/pos/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorderPoint }),
    });
    setApplying(null);
    if (!res.ok) {
      setError("Could not set that reorder point");
      return;
    }
    setApplied((a) => ({ ...a, [productId]: reorderPoint }));
  }

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    const res = await fetch(`/api/pos/reports/business?${sp}`);
    if (!res.ok) {
      setError("Could not load the reports");
      return;
    }
    setData(await res.json());
    setError(null);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Move to a preset window, ending today. */
  function choose(key: string) {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    // `to` is left empty so the server uses its own idea of today. The browser
    // and the shop can disagree about what day it is at four in the morning,
    // and the server's business date is the one everything else is bucketed by.
    setTo("");
    setFrom("");
    // All time starts where the records do. Everything else counts back from
    // the server's today, once it has told us what that is — until then the
    // default thirty-day window is what comes back, which is this page's
    // default anyway.
    if (key === "all") setFrom(data?.firstDate ?? "");
    else if (data?.today) setFrom(shiftDays(data.today, -(p.days - 1)));
  }

  if (!can("viewBusinessReports"))
    return (
      <div className="text-brand-400">
        {tr("Your account can't see the management reports.")}
      </div>
    );

  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  const h = data.headline;
  const totalRevenue = data.categories.reduce((n, c) => n + c.revenueCents, 0);
  const totalTender = data.tenders.reduce((n, t) => n + Math.max(0, t.amountCents), 0);
  const owedTickets = data.aging.reduce((n, b) => n + b.ticketCents, 0);
  const owedAccounts = data.aging.reduce((n, b) => n + b.accountCents, 0);

  // The hours the shop actually trades in, taken from the data rather than
  // assumed. A fixed 8–6 grid would cut off the evening the one week somebody
  // stayed late, which is exactly the week worth looking at.
  const busyHours = data.heatmap.map((c) => c.hour);
  const loHour = busyHours.length ? Math.min(...busyHours) : 8;
  const hiHour = busyHours.length ? Math.max(...busyHours) : 18;
  const hours = Array.from({ length: hiHour - loHour + 1 }, (_, i) => loHour + i);

  return (
    <div className="max-w-6xl mx-auto rp">
      {/* ── The window, and the way out of it ───────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 rp-no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Reports")}</h1>
          <p className="text-brand-400 text-sm">
            {tr("How the shop is doing, over whatever window you ask for.")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={preset === p.key ? "btn btn-primary" : "btn btn-outline"}
              style={{ height: 34, fontSize: 13 }}
              onClick={() => choose(p.key)}
            >
              {tr(p.label)}
            </button>
          ))}
          <button type="button" className="btn btn-outline" style={{ height: 34, fontSize: 13 }} onClick={() => window.print()}>
            {tr("Print")}
          </button>
        </div>
      </div>

      <div className="rp-range rp-no-print">
        <span>{tr("Between")}</span>
        <input
          type="date"
          className="input"
          value={from || data.from}
          max={to || data.to}
          onChange={(e) => {
            setPreset("custom");
            setFrom(e.target.value);
          }}
        />
        <span>{tr("and")}</span>
        <input
          type="date"
          className="input"
          value={to || data.to}
          min={from || data.from}
          max={data.today}
          onChange={(e) => {
            setPreset("custom");
            setTo(e.target.value);
          }}
        />
        <span className="rp-range-note">
          {data.days} {data.days === 1 ? tr("day") : tr("days")} ·{" "}
          {tr("compared with the same length before it")}
        </span>
      </div>

      {/* The way around a page that is four screens tall.
          Sticky rather than a list at the top, because the reason somebody
          wants it is that they are already halfway down and want a different
          section — which is exactly when a list at the top has scrolled away.
          Off the printed sheet: paper has its own way of finding a heading. */}
      <nav className="rp-index rp-no-print" aria-label={tr("Sections")}>
        {[
          ["money", tr("Money")],
          ["sells", tr("What sells")],
          ["when", tr("When")],
          ["who", tr("Who")],
          ["racks", tr("The racks")],
          ["owed", tr("Owed")],
          ["customers", tr("Customers")],
          ["missed", tr("Missed")],
          ["control", tr("Control")],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      {/* On paper only — a sheet taken to an accountant has to say whose shop
          it is and what period it covers. */}
      <div className="rp-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>{tr("Management report")}</div>
          <div style={{ fontSize: "9pt" }}>
            {data.from} → {data.to} · {tr("printed")} {printedOn}
          </div>
        </div>
      </div>

      {/* ── 1 · MONEY ───────────────────────────────────────────────────── */}
      <Section
        id="money"
        title={tr("Money")}
        note={tr("Sold is what was charged for. Collected is what came in — a deposit today on last week's order is in one and not the other.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Sold")}
            value={formatCents(h.goodsCents)}
            deltaPct={changePct(h.goodsCents, h.prior.goodsCents) ?? undefined}
            deltaLabel={tr("on the window before")}
          />
          <Stat label={tr("Collected")} value={formatCents(h.collectedCents)} />
          <Stat
            label={tr("Tickets")}
            value={String(h.tickets)}
            deltaPct={changePct(h.tickets, h.prior.tickets) ?? undefined}
            deltaLabel={tr("on the window before")}
          />
          <Stat
            label={tr("Average ticket")}
            value={formatCents(h.avgTicketCents)}
            deltaPct={changePct(h.avgTicketCents, h.prior.avgTicketCents) ?? undefined}
            deltaLabel={tr("on the window before")}
          />
          {/* Margin is shown only where enough of the revenue carries a cost to
              make it mean something. Under half coverage the figure would be a
              statement about tires printed as though it were a statement about
              the shop. */}
          <Stat
            label={tr("Gross margin")}
            value={
              h.costCoveragePct >= 20 ? `${h.marginPct.toFixed(0)}%` : tr("not enough cost data")
            }
            sub={
              h.costCoveragePct >= 20
                ? `${formatCents(h.marginCents)} · ${tr("on the")} ${h.costCoveragePct}% ${tr("of sales with a cost")}`
                : tr("costs are only recorded on tires")
            }
            tone={h.costCoveragePct >= 20 && h.marginPct < 15 ? "warn" : undefined}
          />
          <Stat
            label={tr("Given away")}
            value={formatCents(h.discountsCents)}
            sub={`${data.control.discounts.count} ${tr("tickets discounted")}`}
            tone={h.discountsCents > 0 ? "warn" : undefined}
          />
        </div>

        <div className="rp-chart-wrap">
          <PairedBars
            data={data.trend.map((p) => ({
              label: bucketLabel(p.bucket, data.grain),
              a: p.goodsCents,
              b: p.collectedCents,
            }))}
            labels={[tr("Sold"), tr("Collected")]}
            format={formatCents}
            emptyLabel={tr("Nothing in this window.")}
          />
        </div>

        <div className="rp-two">
          <Panel title={tr("Tickets a day")}>
            <BarChart
              data={data.trend.map((p) => ({
                label: bucketLabel(p.bucket, data.grain),
                value: p.tickets,
              }))}
              format={(n) => String(n)}
              height={90}
              emptyLabel={tr("Nothing in this window.")}
            />
          </Panel>
          <Panel title={tr("Average ticket")}>
            <BarChart
              data={data.trend.map((p) => ({
                label: bucketLabel(p.bucket, data.grain),
                value: p.avgTicketCents,
              }))}
              format={formatCents}
              height={90}
              color="#1f7a8c"
              emptyLabel={tr("Nothing in this window.")}
            />
          </Panel>
        </div>
      </Section>

      {/* ── 2 · WHAT SELLS ──────────────────────────────────────────────── */}
      <Section
        id="sells"
        title={tr("What sells")}
        note={tr("Margin is worked out only on the lines that carry a cost, and the tax is taken out of the price first — the shop never kept that part.")}
      >
        <div className="rp-two">
          <Panel title={tr("Sales mix")}>
            <Donut
              data={data.categories.map((c) => ({ label: c.label, value: c.revenueCents }))}
              total={totalRevenue}
              totalLabel={tr("sold")}
              format={formatCents}
              emptyLabel={tr("Nothing sold in this window.")}
            />
          </Panel>
          <Panel title={tr("How it was paid")}>
            <Donut
              data={data.tenders
                .filter((t) => t.amountCents > 0)
                .map((t) => ({ label: t.label, value: t.amountCents }))}
              total={totalTender}
              totalLabel={tr("collected")}
              format={formatCents}
              emptyLabel={tr("Nothing collected in this window.")}
            />
          </Panel>
        </div>

        <Panel title={tr("Margin by category")}>
          {data.categories.length === 0 ? (
            <div className="rp-empty">{tr("Nothing sold in this window.")}</div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Category")}</th>
                  <th className="r">{tr("Sold")}</th>
                  <th className="r">{tr("Units")}</th>
                  <th className="r">{tr("Cost")}</th>
                  <th className="r">{tr("Margin")}</th>
                  <th className="r">{tr("Margin %")}</th>
                  <th className="r">{tr("Costed")}</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => {
                  // The percentage is over the costed part only, which is what
                  // the Costed column is there to qualify.
                  const base = c.marginCents + c.costCents;
                  const pct = base > 0 ? (c.marginCents / base) * 100 : null;
                  return (
                    <tr key={c.code}>
                      <td>{c.label}</td>
                      <td className="r n">{formatCents(c.revenueCents)}</td>
                      <td className="r n">{c.units}</td>
                      <td className="r n">
                        {c.costCents > 0 ? formatCents(c.costCents) : "—"}
                      </td>
                      <td className="r n">
                        {c.costCoveragePct > 0 ? formatCents(c.marginCents) : "—"}
                      </td>
                      <td
                        className="r n"
                        style={{
                          color:
                            pct === null ? undefined : pct < 15 ? "#b91c1c" : pct > 35 ? "#15803d" : undefined,
                          fontWeight: pct === null ? undefined : 600,
                        }}
                      >
                        {pct === null ? "—" : `${pct.toFixed(0)}%`}
                      </td>
                      {/* The honesty column. A margin over 12% of a category is
                          a fact about a twelfth of it. */}
                      <td className="r n" style={{ color: "rgba(10,37,64,0.4)" }}>
                        {c.costCoveragePct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={tr("Best sellers")} note={tr("Units sold in this window.")}>
          <RankedBars
            data={data.bestSellers.map((p) => ({
              label: p.name,
              value: p.units,
              note: ` · ${formatCents(p.revenueCents)}`,
            }))}
            format={(n) => String(n)}
            emptyLabel={tr("Nothing sold in this window.")}
          />
        </Panel>
      </Section>

      {/* ── 3 · WHEN ────────────────────────────────────────────────────── */}
      <Section
        id="when"
        title={tr("When the shop is busy")}
        note={tr("Darker is more tickets. This is the one report that settles a rota argument — a shop can feel busy on a Saturday and take most of its money on a Thursday.")}
      >
        <Panel title={tr("Tickets by hour")}>
          <Heatmap
            cells={data.heatmap.map((c) => ({
              weekday: c.weekday,
              hour: c.hour,
              value: c.tickets,
            }))}
            hours={hours}
            format={(n) => `${n} ${n === 1 ? tr("ticket") : tr("tickets")}`}
            emptyLabel={tr("No tickets in this window.")}
          />
        </Panel>

        <div className="rp-two">
          <Panel title={tr("Takings by day of the week")} note={tr("Averaged over how many of each day the window held.")}>
            <RankedBars
              data={data.weekdays
                .filter((w) => w.days > 0)
                .map((w) => ({
                  label: DAY_NAMES[w.weekday],
                  value: w.days > 0 ? Math.round(w.goodsCents / w.days) : 0,
                  note: ` · ${w.days > 0 ? Math.round((w.tickets / w.days) * 10) / 10 : 0} ${tr("tickets a day")}`,
                }))}
              format={formatCents}
              emptyLabel={tr("Nothing in this window.")}
            />
          </Panel>
          <Panel title={tr("Busiest hours")}>
            <RankedBars
              data={(() => {
                const byHour = new Map<number, number>();
                for (const c of data.heatmap)
                  byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.tickets);
                return [...byHour.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([hour, n]) => ({
                    label:
                      hour === 0
                        ? "12 AM"
                        : hour < 12
                          ? `${hour} AM`
                          : hour === 12
                            ? "12 PM"
                            : `${hour - 12} PM`,
                    value: n,
                  }));
              })()}
              format={(n) => `${n}`}
              emptyLabel={tr("No tickets in this window.")}
            />
          </Panel>
        </div>
      </Section>

      {/* ── 4 · WHO ─────────────────────────────────────────────────────── */}
      <Section
        id="who"
        title={tr("Who did the work")}
        note={tr("Over the same window as everything else on this page — not the close-out's week.")}
      >
        {data.techs.length === 0 ? (
          <div className="rp-empty">{tr("Nobody has been credited with a line in this window.")}</div>
        ) : (
          <>
            <Panel title={tr("Share of what the shop took")}>
              <RankedBars
                data={data.techs.map((t) => ({
                  label: t.name,
                  value: t.incomeCents,
                  note: ` · ${t.incomePct.toFixed(0)}%`,
                }))}
                format={formatCents}
              />
            </Panel>
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Technician")}</th>
                  <th className="r">{tr("New tires")}</th>
                  <th className="r">{tr("Used tires")}</th>
                  <th className="r">{tr("Other work")}</th>
                  <th className="r">{tr("Tickets")}</th>
                  <th className="r">{tr("Tips")}</th>
                  <th className="r">{tr("Brought in")}</th>
                </tr>
              </thead>
              <tbody>
                {data.techs.map((t) => (
                  <tr key={t.employeeId}>
                    <td>{t.name}</td>
                    <td className="r n">{t.newTires || "—"}</td>
                    <td className="r n">{t.usedTires || "—"}</td>
                    <td className="r n">{t.otherCount || "—"}</td>
                    <td className="r n">{t.ticketCount}</td>
                    <td className="r n">{t.tipCents ? formatCents(t.tipCents) : "—"}</td>
                    <td className="r n" style={{ fontWeight: 600 }}>
                      {formatCents(t.incomeCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      {/* ── 5 · THE RACKS ───────────────────────────────────────────────── */}
      <Section
        id="racks"
        title={tr("The racks")}
        note={tr("Stock is valued at what it actually cost — the weighted average of everything received — not at what the next one is expected to cost.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Stock on hand")}
            value={formatCents(data.stock.totalCostCents)}
            sub={`${data.stock.totalUnits} ${tr("units, at cost")}`}
          />
          <Stat
            label={tr("Standing still")}
            value={formatCents(data.dead.reduce((n, d) => n + d.costCents, 0))}
            sub={`${data.dead.length} ${tr("sizes with no sale in 45 days")}`}
            tone={data.dead.length > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("At the reorder point")}
            value={String(data.reorder.length)}
            sub={tr("sizes to order")}
            tone={data.reorder.length > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Bought over the counter")}
            value={formatCents(data.purchases.costCents)}
            sub={`${data.purchases.units} ${tr("used tires taken in")}`}
          />
        </div>

        <div className="rp-two">
          <Panel title={tr("Where the money is, by brand")}>
            <RankedBars
              data={data.stock.byBrand.slice(0, 10).map((b) => ({
                label: b.key,
                value: b.costCents,
                note: ` · ${b.units}`,
              }))}
              format={formatCents}
              emptyLabel={tr("Nothing on the racks.")}
            />
          </Panel>
          <Panel title={tr("By rim size")}>
            <RankedBars
              data={data.stock.byRim.slice(0, 10).map((b) => ({
                label: b.key,
                value: b.costCents,
                note: ` · ${b.units}`,
              }))}
              format={formatCents}
              emptyLabel={tr("Nothing on the racks.")}
            />
          </Panel>
        </div>

        <Panel
          title={tr("Money standing still")}
          note={tr("On the racks, not sold in 45 days. Ranked by what it cost rather than by how long — the question is where the cash is.")}
        >
          {data.dead.length === 0 ? (
            <div className="rp-empty">{tr("Everything on the racks has moved recently.")}</div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Tire")}</th>
                  <th className="r">{tr("On hand")}</th>
                  <th className="r">{tr("Tied up")}</th>
                  <th className="r">{tr("Last sold")}</th>
                  <th className="r">{tr("On the shelf")}</th>
                </tr>
              </thead>
              <tbody>
                {data.dead.map((d) => (
                  <tr key={d.productId}>
                    <td>{d.name}</td>
                    <td className="r n">{d.onHand}</td>
                    <td className="r n" style={{ fontWeight: 600 }}>
                      {formatCents(d.costCents)}
                    </td>
                    <td className="r n">
                      {d.daysSinceSale === null ? (
                        <span style={{ color: "#b91c1c", fontWeight: 600 }}>{tr("never")}</span>
                      ) : (
                        `${d.daysSinceSale} ${tr("days ago")}`
                      )}
                    </td>
                    <td className="r n" style={{ color: "rgba(10,37,64,0.4)" }}>
                      {d.daysOnShelf === null ? "—" : `${d.daysOnShelf} ${tr("days")}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={tr("To order")} note={tr("At or under the reorder point, with how fast it has been going.")}>
          {data.reorder.length === 0 ? (
            <div className="rp-empty">{tr("Nothing is at its reorder point.")}</div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Tire")}</th>
                  <th className="r">{tr("On hand")}</th>
                  <th className="r">{tr("Reorder at")}</th>
                  <th className="r">{tr("Sold in 90 days")}</th>
                </tr>
              </thead>
              <tbody>
                {data.reorder.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td
                      className="r n"
                      style={{ color: r.onHand <= 0 ? "#b91c1c" : "#b45309", fontWeight: 600 }}
                    >
                      {r.onHand}
                    </td>
                    <td className="r n">{r.reorderPoint}</td>
                    <td className="r n">{r.sold90 || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* The mirror of the dead-stock list, and the gap it fills is real.
            "To order" above can only warn about tires that already have a
            reorder point set — a size nobody ever set one on is invisible to it
            however fast it sells, right up until a customer asks and it is not
            there. This starts from what is SELLING and asks whether the shop has
            arranged to keep having it. */}
        <Panel
          title={tr("Worth keeping in stock")}
          note={tr("Selling steadily, with no standing level set — or one set too low.")}
        >
          {data.restock.length === 0 ? (
            <div className="rp-empty">
              {tr("Everything that sells has a reorder point that fits it.")}
            </div>
          ) : (
            <>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>{tr("Tire")}</th>
                    <th className="r">{tr("On hand")}</th>
                    <th className="r">{tr("Sold")}</th>
                    <th className="r">{tr("Days of cover")}</th>
                    <th className="r">{tr("Reorder at")}</th>
                    <th className="r">{tr("Suggest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.restock.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td
                        className="r n"
                        style={{
                          color: r.onHand <= 0 ? "#b91c1c" : undefined,
                          fontWeight: r.onHand <= 0 ? 600 : undefined,
                        }}
                      >
                        {r.onHand}
                      </td>
                      <td className="r n">
                        {r.sold90}
                        <span style={{ color: "rgba(10,37,64,0.4)" }}>
                          {" "}
                          / {r.overDays}
                          {tr("d")}
                        </span>
                      </td>
                      {/* Nothing on the rack is not "infinite days of cover", it
                          is the worst case there is — so it says so in words
                          rather than leaving a dash to be read as fine. */}
                      <td
                        className="r n"
                        style={{
                          color:
                            r.daysOfCover === null
                              ? "#b91c1c"
                              : r.daysOfCover < 14
                                ? "#b45309"
                                : undefined,
                          fontWeight: r.daysOfCover === null ? 600 : undefined,
                        }}
                      >
                        {r.daysOfCover === null ? tr("none left") : `${r.daysOfCover}`}
                      </td>
                      <td className="r n" style={{ color: "rgba(10,37,64,0.4)" }}>
                        {applied[r.productId] ?? r.reorderPoint ?? "—"}
                      </td>
                      {/* The suggestion, and the one press that takes it.
                          A number somebody has to go and retype into another
                          screen is a number that mostly does not get typed —
                          and the point of the whole panel is that these tires
                          have no reorder point at all. */}
                      <td className="r n" style={{ fontWeight: 600 }}>
                        {applied[r.productId] === r.suggested ? (
                          <span style={{ color: "#15803d" }}>{tr("set")}</span>
                        ) : can("manageProducts") ? (
                          <button
                            type="button"
                            className="rp-apply"
                            disabled={applying === r.productId}
                            title={`${tr("Set the reorder point to")} ${r.suggested}`}
                            onClick={() => void applyReorder(r.productId, r.suggested)}
                          >
                            {applying === r.productId ? "…" : `${tr("set")} ${r.suggested}`}
                          </button>
                        ) : (
                          <span style={{ color: "#15803d" }}>{r.suggested}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rp-note" style={{ marginTop: 10, marginBottom: 0 }}>
                {tr(
                  "The suggestion is about a fortnight of sales at the rate above — a starting figure, not an answer. A fortnight is right only if the truck comes in a fortnight, which this cannot know. Set it on the tire in Inventory and it starts appearing in To order.",
                )}
              </p>
            </>
          )}
        </Panel>
      </Section>

      {/* ── 6 · OWED ────────────────────────────────────────────────────── */}
      <Section
        id="owed"
        title={tr("What is owed to the shop")}
        note={tr("Two columns because they are chased by different people. A ticket balance is settled at the register; a house account is settled monthly.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("On tickets")}
            value={formatCents(owedTickets)}
            tone={owedTickets > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("On house accounts")}
            value={formatCents(owedAccounts)}
            tone={owedAccounts > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Owed altogether")}
            value={formatCents(owedTickets + owedAccounts)}
            tone={owedTickets + owedAccounts > 0 ? "warn" : undefined}
          />
        </div>
        <Panel title={tr("How old the debt is")}>
          <table className="rp-table">
            <thead>
              <tr>
                <th>{tr("Age")}</th>
                <th className="r">{tr("On tickets")}</th>
                <th className="r">{tr("On accounts")}</th>
                <th className="r">{tr("Together")}</th>
              </tr>
            </thead>
            <tbody>
              {data.aging.map((b, i) => (
                <tr key={b.label}>
                  <td>{tr(b.label)}</td>
                  <td className="r n">{b.ticketCents ? formatCents(b.ticketCents) : "—"}</td>
                  <td className="r n">{b.accountCents ? formatCents(b.accountCents) : "—"}</td>
                  <td
                    className="r n"
                    style={{
                      fontWeight: 600,
                      // Anything past sixty days in a shop that sells to
                      // walk-ins is a conversation, not a receivable.
                      color: i >= 2 && b.ticketCents + b.accountCents > 0 ? "#b91c1c" : undefined,
                    }}
                  >
                    {b.ticketCents + b.accountCents
                      ? formatCents(b.ticketCents + b.accountCents)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>

      {/* ── 7 · CUSTOMERS ───────────────────────────────────────────────── */}
      <Section
        id="customers"
        title={tr("Customers")}
        note={tr("Bounded by how many tickets took a name at all — the figures below describe only those.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Tickets with a name")}
            value={`${data.customers.named}`}
            sub={`${data.customers.anonymous} ${tr("without one")}`}
          />
          <Stat label={tr("New customers")} value={String(data.customers.newCustomers)} tone="good" />
          <Stat label={tr("Came back")} value={String(data.customers.returningCustomers)} />
          <Stat
            label={tr("Repeat share")}
            value={
              data.customers.newCustomers + data.customers.returningCustomers > 0
                ? `${Math.round(
                    (data.customers.returningCustomers /
                      (data.customers.newCustomers + data.customers.returningCustomers)) *
                      100,
                  )}%`
                : "—"
            }
            sub={tr("of named customers had been in before")}
          />
        </div>
        <Panel title={tr("Who spends the most")}>
          <RankedBars
            data={data.customers.top.map((c) => ({
              label: c.name,
              value: c.spentCents,
              note: ` · ${c.tickets} ${c.tickets === 1 ? tr("ticket") : tr("tickets")}`,
            }))}
            format={formatCents}
            emptyLabel={tr("No named customers in this window.")}
          />
        </Panel>
      </Section>

      {/* ── 8 · MISSED ──────────────────────────────────────────────────── */}
      <Section
        id="missed"
        title={tr("What walked out")}
        note={tr("Two different qualities of evidence, kept apart. A recorded lost sale is somebody watching a customer leave; an empty search is a keystroke.")}
      >
        <div className="rp-two">
          <Panel title={tr("Asked for and not in stock")} note={tr("From the counter's study.")}>
            <RankedBars
              data={data.lost.recorded.slice(0, 10).map((r) => ({
                label: r.size,
                value: r.tires,
                note:
                  r.onHand === null || r.onHand <= 0
                    ? ` · ${tr("still none")}`
                    : ` · ${r.onHand} ${tr("now on hand")}`,
                color: r.onHand === null || r.onHand <= 0 ? "#b91c1c" : "#15803d",
              }))}
              format={(n) => `${n}`}
              emptyLabel={tr("Nothing recorded in this window.")}
            />
            <Link href="/pos/demand" className="rp-more rp-no-print">
              {tr("The whole study")} →
            </Link>
          </Panel>
          <Panel
            title={tr("Searched for and not found")}
            note={tr("Sizes the register was asked for and could not show.")}
          >
            {/* The eye, in the corner of this panel and nowhere else on the
                page, because this is the only list with debris in it: the
                search box logs on every keystroke, so one customer asking for a
                215/45/17 leaves "21545" and "215451" behind on the way there.

                Open when the half-typed ones are showing, struck through when
                they are not — the icon says what you are looking at, which is
                how every other toggle in this app reads. */}
            <button
              type="button"
              className="rp-eye rp-no-print"
              aria-pressed={showPartial}
              aria-label={tr("Show half-typed searches")}
              title={
                showPartial
                  ? tr("Showing half-typed searches as well as whole sizes")
                  : tr("Also show half-typed searches and other odd entries")
              }
              onClick={() => setShowPartial((v) => !v)}
            >
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
                <circle cx="12" cy="12" r="3.1" />
                {!showPartial && <path d="M3.5 20.5 20.5 3.5" />}
              </svg>
            </button>
            <RankedBars
              data={data.lost.searched
                .filter((r) => showPartial || r.complete)
                .slice(0, 10)
                .map((r) => ({
                  label: r.size,
                  value: r.asks,
                  note: r.complete ? undefined : ` · ${tr("half-typed")}`,
                  color: r.complete ? undefined : "rgba(10,37,64,0.3)",
                }))}
              format={(n) => `${n}`}
              emptyLabel={tr("Every search found a size we had.")}
            />
          </Panel>
        </div>
      </Section>

      {/* ── 9 · CONTROL ─────────────────────────────────────────────────── */}
      <Section
        id="control"
        title={tr("Worth a second look")}
        note={tr("None of these is wrong by itself. What matters is the shape — one name against most of them, or a month where the count doubles.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Voided tickets")}
            value={String(data.control.voids.count)}
            sub={formatCents(data.control.voids.cents)}
            tone={data.control.voids.count > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Refunds")}
            value={String(data.control.refunds.count)}
            sub={formatCents(data.control.refunds.cents)}
            tone={data.control.refunds.count > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Prices changed at the counter")}
            value={String(data.control.overrides.count)}
            sub={`${data.control.overrides.deltaCents <= 0 ? tr("under the rack by") : tr("over the rack by")} ${formatCents(Math.abs(data.control.overrides.deltaCents))}`}
            tone={data.control.overrides.deltaCents < 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Changed after completing")}
            value={String(data.control.lateEdits)}
            tone={data.control.lateEdits > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Sold below the count")}
            value={String(data.control.oversells)}
            tone={data.control.oversells > 0 ? "bad" : undefined}
          />
          <Stat
            label={tr("Register logs that did not balance")}
            value={String(data.control.badChecks.count)}
            sub={
              data.control.badChecks.count > 0
                ? `${tr("worst")} ${formatCents(data.control.badChecks.worstCents)}`
                : undefined
            }
            tone={data.control.badChecks.count > 0 ? "bad" : undefined}
          />
        </div>

        {(data.control.discounts.byName.length > 0 || data.control.voids.byName.length > 0) && (
          <div className="rp-two">
            <Panel title={tr("Who gave the discounts")}>
              <RankedBars
                data={data.control.discounts.byName.map((d) => ({
                  label: d.name,
                  value: d.cents,
                  note: ` · ${d.count}`,
                }))}
                format={formatCents}
                emptyLabel={tr("Nothing was discounted.")}
              />
            </Panel>
            <Panel title={tr("Who voided tickets")}>
              <RankedBars
                data={data.control.voids.byName.map((d) => ({
                  label: d.name,
                  value: d.count,
                  note: ` · ${formatCents(d.cents)}`,
                }))}
                format={(n) => `${n}`}
                emptyLabel={tr("Nothing was voided.")}
              />
            </Panel>
          </div>
        )}
      </Section>

      <p className="rp-foot">
        {tr("Every figure here covers")} {data.from} → {data.to}
        {tr(", is bucketed by the shop's own business day, and excludes voided tickets except where they are being counted.")}
      </p>
    </div>
  );
}

/** A titled block of the report, with the sentence that says how to read it. */
function Section({
  id,
  title,
  note,
  children,
}: {
  /** Anchor for the index strip. Also what the strip's link reads. */
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rp-section" id={id}>
      <h2 className="rp-h2">{title}</h2>
      {/* The sentence under the heading is not decoration. Every panel on this
          page can be read wrong, and the commonest way is assuming a figure
          covers something it does not. Saying it once at the top of the section
          is cheaper than qualifying every number in it. */}
      {note && <p className="rp-note">{note}</p>}
      {children}
    </section>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rp-panel">
      <div className="rp-panel-head">
        <span>{title}</span>
        {note && <em>{note}</em>}
      </div>
      {children}
    </div>
  );
}
