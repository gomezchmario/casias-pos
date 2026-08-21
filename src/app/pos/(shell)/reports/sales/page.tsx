"use client";

import { useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import {
  BarChart,
  Donut,
  Heatmap,
  PairedBars,
  RankedBars,
  StackedBars,
  Stat,
  changePct,
} from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import {
  DAY_NAMES,
  ExperimentalNote,
  Panel,
  RangeBar,
  ReportsNav,
  Section,
  bucketLabel,
  hourLabel,
  useSuite,
} from "../shared";
import "../reports.css";

/**
 * Sales & Revenue: where the money comes from and when it walks in.
 *
 * The DEMAND side of the shop, whole and on one page — what sold, what the
 * take was made of, how it was paid, which hours and days it landed in, and
 * the orders rung before the goods were in the building. What the take COST
 * is deliberately not here: margin lives on Financial, because "are we busy"
 * and "are we making anything" are different questions asked in different
 * moods, and a page that answers both answers neither at a glance.
 */
export default function SalesReportPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const { data, error, win } = useSuite();
  const [sellersShown, setSellersShown] = useState(10);

  if (!can("viewBusinessReports"))
    return (
      <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>
    );
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  const h = data.headline;
  const totalRevenue = data.categories.reduce((n, c) => n + c.revenueCents, 0);
  const totalTender = data.tenders.reduce((n, t) => n + Math.max(0, t.amountCents), 0);

  // The hours the shop actually trades in, taken from the data rather than
  // assumed — a fixed 8–6 grid would cut off the evening somebody stayed late.
  const busyHours = data.heatmap.map((c) => c.hour);
  const loHour = busyHours.length ? Math.min(...busyHours) : 8;
  const hiHour = busyHours.length ? Math.max(...busyHours) : 18;
  const hours = Array.from({ length: hiHour - loHour + 1 }, (_, i) => loHour + i);

  const so = data.specialOrders;

  return (
    <div className="max-w-6xl mx-auto rp">
      <ExperimentalNote />
      <RangeBar
        title={tr("Sales & Revenue")}
        blurb={tr("What sold, when it sold, and how it was paid — over whatever window you ask for.")}
        data={data}
        win={win}
        printTitle={tr("Sales report")}
      />
      <ReportsNav win={win} />

      {/* ── THE TAKE ────────────────────────────────────────────────────── */}
      <Section
        id="take"
        title={tr("The take")}
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

      {/* ── WHAT SELLS ──────────────────────────────────────────────────── */}
      <Section
        id="sells"
        title={tr("What sells")}
        note={tr("The mix over the whole window, then the same mix bucket by bucket — a month where used tires quietly become half the take looks identical in the donut and unmissable in the bands.")}
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

        <Panel
          title={tr("The mix, over time")}
          note={tr("Each bar is one bucket of the window, scaled to its own total — the shape is the story, not the height.")}
        >
          <StackedBars
            columns={data.categoryTrend.columns.map((c) => ({
              label: bucketLabel(c.bucket, data.grain),
              parts: data.categoryTrend.labels.map((l, i) => ({
                label: l,
                value: c.values[i] ?? 0,
              })),
            }))}
            format={formatCents}
            emptyLabel={tr("Nothing sold in this window.")}
          />
        </Panel>

        <Panel title={tr("Best sellers")} note={tr("Units sold in this window.")}>
          <RankedBars
            data={data.bestSellers.slice(0, sellersShown).map((p) => ({
              label: p.name,
              value: p.units,
              note: ` · ${formatCents(p.revenueCents)}`,
            }))}
            max={data.bestSellers[0]?.units}
            format={(n) => String(n)}
            emptyLabel={tr("Nothing sold in this window.")}
          />
          {data.bestSellers.length > sellersShown && (
            <div className="rp-more rp-no-print">
              <button
                type="button"
                className="btn btn-outline"
                style={{ height: 30, fontSize: 12 }}
                onClick={() => setSellersShown((n) => n + 10)}
              >
                {tr("Show 10 more")}
              </button>
              <span>
                {tr("showing")} {Math.min(sellersShown, data.bestSellers.length)} {tr("of")}{" "}
                {data.bestSellers.length}
              </span>
            </div>
          )}
        </Panel>
      </Section>

      {/* ── SPECIAL ORDERS ──────────────────────────────────────────────── */}
      <Section
        id="orders"
        title={tr("Special orders")}
        note={tr("Rung before the goods were in the building. Open ones are promises the shop has made and not yet kept.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Ordered in")}
            value={String(so.count)}
            sub={formatCents(so.cents)}
          />
          <Stat
            label={tr("Still open")}
            value={String(so.open)}
            tone={so.open > 0 ? "warn" : undefined}
            sub={tr("waiting or on the way")}
          />
          <Stat
            label={tr("Called, no answer")}
            value={String(so.noAnswer)}
            tone={so.noAnswer > 0 ? "warn" : undefined}
            sub={tr("goods here, customer not")}
          />
          <Stat
            label={tr("Order to handover")}
            value={so.avgDaysToDeliver === null ? "—" : `${so.avgDaysToDeliver} ${tr("days")}`}
            sub={tr("averaged over the delivered ones")}
          />
        </div>
      </Section>

      {/* ── WHEN ────────────────────────────────────────────────────────── */}
      <Section
        id="when"
        title={tr("When the shop is busy")}
        note={tr("Blue is quiet, red is flat out. This is the one report that settles a rota argument — a shop can feel busy on a Saturday and take most of its money on a Thursday.")}
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
            quietLabel={tr("Quiet")}
            busyLabel={tr("Busiest")}
          />
        </Panel>

        <div className="rp-two">
          <Panel
            title={tr("Takings by day of the week")}
            note={tr("Averaged over how many of each day the window held.")}
          >
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
                  .map(([hour, n]) => ({ label: hourLabel(hour), value: n }));
              })()}
              format={(n) => `${n}`}
              emptyLabel={tr("No tickets in this window.")}
            />
          </Panel>
        </div>
      </Section>

      <p className="rp-foot">
        {tr("Every figure here covers")} {data.from} → {data.to}
        {tr(", is bucketed by the shop's own business day, and excludes voided tickets except where they are being counted.")}
      </p>
    </div>
  );
}
