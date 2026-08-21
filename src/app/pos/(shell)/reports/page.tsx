"use client";

import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { BarChart, PairedBars, Stat, changePct } from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import {
  Door,
  ExperimentalNote,
  Panel,
  RangeBar,
  ReportsNav,
  Section,
  bucketLabel,
  useSuite,
} from "./shared";
import "./reports.css";

/**
 * The management reports — the front door.
 *
 * WHAT THIS SCREEN IS FOR: the close-out answers "did tonight come out right",
 * the day screen answers "how is today going", and neither answers "how is
 * this business doing". That question is asked once a week by one person,
 * sitting down, and it is the question that decides what to buy, who to roster
 * and what to charge.
 *
 * THE SUITE IS ORGANISED BY THE DECISION IT FEEDS, one area per page:
 *
 *   Sales & Revenue   — what sold, when, and how it was paid
 *   Inventory & Tires — the money on the racks, and the tires that were not there
 *   Technicians       — the crew, credited and compared fairly
 *   Customers & Fleet — who comes back, who stopped, the commercial accounts
 *   Financial         — margin, what is owed, and the leaks
 *   Trends            — which way it is going, over everything on record
 *
 * THIS PAGE IS THE MONEY AND THE DOORS. The money, because "is the shop making
 * any" is the question every visit starts with; the doors, because each one
 * carries the two or three figures that say whether its area needs opening
 * today. A door with a warm figure on it is the suite doing the scanning for
 * you.
 *
 * EVERY WINDOWED FIGURE COVERS THE DATES AT THE TOP, and the window follows
 * you through the doors — pick a fortnight here and Financial shows the same
 * fortnight. That promise is why the suite can be trusted at a glance.
 */
export default function ReportsPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const { data, error, win } = useSuite();

  if (!can("viewBusinessReports"))
    return (
      <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>
    );
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  const h = data.headline;
  const r = data.retention;
  const topCat = data.categories[0];
  const totalRevenue = data.categories.reduce((n, c) => n + c.revenueCents, 0);
  const owed =
    data.aging.reduce((n, b) => n + b.ticketCents, 0) +
    data.aging.reduce((n, b) => n + b.accountCents, 0);

  return (
    <div className="max-w-6xl mx-auto rp">
      <ExperimentalNote />
      <RangeBar
        title={tr("Reports")}
        blurb={tr("How the shop is doing, over whatever window you ask for.")}
        data={data}
        win={win}
        printTitle={tr("Management report")}
      />
      <ReportsNav win={win} />

      {/* ── MONEY ───────────────────────────────────────────────────────── */}
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
              make it mean something. */}
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

      {/* ── THE DOORS ───────────────────────────────────────────────────── */}
      <Section
        id="areas"
        title={tr("The rest of the suite")}
        note={tr("Each door carries the figures that say whether it needs opening today. The window follows you through.")}
      >
        <div className="rp-doors rp-no-print">
          <Door
            href="/pos/reports/sales"
            title={tr("Sales & Revenue")}
            blurb={tr("What sold, the mix over time, how it was paid, special orders, and the hours the money lands in.")}
            win={win}
            facts={[
              topCat
                ? {
                    label: tr("biggest seller"),
                    value: `${topCat.label} · ${totalRevenue > 0 ? Math.round((topCat.revenueCents / totalRevenue) * 100) : 0}%`,
                  }
                : { label: tr("biggest seller"), value: "—" },
              {
                label: tr("special orders open"),
                value: String(data.specialOrders.open),
                tone: data.specialOrders.open > 0 ? "warn" : undefined,
              },
            ]}
          />
          <Door
            href="/pos/reports/tires"
            title={tr("Inventory & Tires")}
            blurb={tr("The money on the racks, what is running out, the season, and the tires people asked for that were not there.")}
            win={win}
            facts={[
              { label: tr("on the racks, at cost"), value: formatCents(data.stock.totalCostCents) },
              {
                label: tr("standing still"),
                value: formatCents(data.deadTotal.costCents),
                tone: data.deadTotal.sizes > 0 ? "warn" : undefined,
              },
              {
                label: tr("sizes to order"),
                value: String(data.reorder.length),
                tone: data.reorder.length > 0 ? "warn" : undefined,
              },
            ]}
          />
          <Door
            href="/pos/reports/crew"
            title={tr("Technicians & Labor")}
            blurb={tr("Who did the work, everyone measured fairly, one name up close, and the cover the week needs.")}
            win={win}
            facts={[
              { label: tr("credited this window"), value: String(data.techs.length) },
              {
                label: tr("tips"),
                value: formatCents(data.techs.reduce((n, t) => n + t.tipCents, 0)),
              },
            ]}
          />
          <Door
            href="/pos/reports/customers"
            title={tr("Customers & Fleet")}
            blurb={tr("Who comes back, who went quiet and is worth a phone call, and the commercial accounts.")}
            win={win}
            facts={[
              {
                label: tr("came back, lifetime"),
                value: r.withVisit > 0 ? `${Math.round((r.repeat / r.withVisit) * 100)}%` : "—",
              },
              {
                label: tr("worth a phone call"),
                value: String(r.lapsed.length),
                tone: r.lapsed.length > 0 ? "warn" : undefined,
              },
              {
                label: tr("owed by fleets"),
                value: formatCents(data.fleet.owedCents),
                tone: data.fleet.owedCents > 0 ? "warn" : undefined,
              },
            ]}
          />
          <Door
            href="/pos/reports/financial"
            title={tr("Financial")}
            blurb={tr("Margin where it can be known, what is owed and how old it is, and the register's own leaks.")}
            win={win}
            facts={[
              {
                label: tr("gross margin"),
                value: h.costCoveragePct >= 20 ? `${h.marginPct.toFixed(0)}%` : "—",
              },
              {
                label: tr("owed altogether"),
                value: formatCents(owed),
                tone: owed > 0 ? "warn" : undefined,
              },
              {
                label: tr("voids and refunds"),
                value: String(data.control.voids.count + data.control.refunds.count),
                tone:
                  data.control.voids.count + data.control.refunds.count > 0 ? "warn" : undefined,
              },
            ]}
          />
          <Door
            href="/pos/reports/trends"
            title={tr("Trends")}
            blurb={tr("Which way it is going, over everything on record — no window, the seasons taken out, and the conclusions worked out at the top.")}
            win={win}
            facts={[]}
          />
        </div>
      </Section>

      <p className="rp-foot">
        {tr("Every figure here covers")} {data.from} → {data.to}
        {tr(", is bucketed by the shop's own business day, and excludes voided tickets except where they are being counted.")}
      </p>
    </div>
  );
}
