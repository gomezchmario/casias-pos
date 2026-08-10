"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import {
  BarChart,
  Bridge,
  LineChart,
  PairedBars,
  RankedBars,
  StackedBars,
  Stat,
  changePct,
} from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import type { ShopTrends } from "@/lib/trends";
import "../reports.css";

/**
 * Which way the shop is heading.
 *
 * ITS OWN PAGE RATHER THAN A SECTION, because it obeys a different rule from
 * everything on Reports. Every figure there covers the window at the top, and
 * that promise is what makes the page trustworthy; nothing here takes a window
 * at all. Sitting the two on one screen meant one section quietly disagreeing
 * with the date range above it, which is worse than a second page.
 *
 * IT IS ORGANISED AS AN ARGUMENT, not as a gallery of charts:
 *
 *   Worth knowing   — the conclusions, computed, at the top
 *   Where it stands — the headline rates, against a year ago
 *   Why            — the change split into customers and ticket size
 *   Tires          — whether there was anything on the racks to sell
 *   The crew       — how many people, and what each one gets through
 *   The long run   — month by month, and with the seasons taken out
 *   The year       — which months and which days the shop earns in
 *   How it is paid — the tender split over time
 *
 * The conclusions come FIRST and the evidence after. A dashboard that opens
 * with eight charts asks the reader to be an analyst; the person opening this
 * runs a tire shop. Every item in the first section names the figures it was
 * drawn from, and every one of those figures is somewhere below it.
 *
 * NOTHING HERE IS A WARNING LIGHT. Each conclusion says what it means AND what
 * it does not — half of them have an innocent explanation that has to be
 * offered at the same time as the alarming one, or the page becomes a machine
 * for frightening people with arithmetic.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-08" as "Aug 26". */
function monthLabel(bucket: string): string {
  const [y, m] = bucket.split("-");
  return `${MONTH_NAMES[Number(m) - 1]?.slice(0, 3) ?? bucket} ${y.slice(2)}`;
}

export default function TrendsPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [data, setData] = useState<ShopTrends | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/reports/trends");
      if (!res.ok) {
        setError("Could not load the trends");
        return;
      }
      setData(await res.json());
    })();
  }, []);

  if (!can("viewBusinessReports"))
    return <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>;
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Working it out…")}</div>;

  const c = data.compare;
  const drawn = data.months;
  const labels = drawn.map((m) => monthLabel(m.bucket));
  // Months with no record are drawn as a GAP in every line, never as a zero.
  const orNull = (m: { tradingDays: number }, v: number) => (m.tradingDays > 0 ? v : null);

  const SEVERITY: Record<string, string> = {
    serious: tr("Serious"),
    watch: tr("Watch"),
    steady: tr("Steady"),
  };

  return (
    <div className="max-w-6xl mx-auto rp">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 rp-no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Which way it is going")}</h1>
          <p className="text-brand-400 text-sm">
            {tr("Everything on record — no date range. A direction measured over a fortnight is not a direction.")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/pos/reports" className="btn btn-outline" style={{ height: 34, fontSize: 13 }}>
            {tr("Back to Reports")}
          </Link>
          <button
            type="button"
            className="btn btn-outline"
            style={{ height: 34, fontSize: 13 }}
            onClick={() => window.print()}
          >
            {tr("Print")}
          </button>
        </div>
      </div>

      <div className="rp-range rp-no-print">
        <span className="rp-range-note">
          {data.firstDate} → {data.today} · {data.tradingDays} {tr("trading days")} ·{" "}
          {data.monthsOnRecord} {tr("finished months on record")}
        </span>
      </div>

      <div className="rp-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>{tr("Which way it is going")}</div>
          <div style={{ fontSize: "9pt" }}>
            {data.firstDate} → {data.today} · {tr("printed")} {printedOn}
          </div>
        </div>
      </div>

      {data.gapMonths.length > 0 && (
        <div className="rp-warn">
          {tr("No records at all for")} {data.gapMonths.map(monthLabel).join(", ")}.{" "}
          {tr("Those months are left out of every comparison rather than counted as zero, which would read as a collapse that never happened.")}
        </div>
      )}

      {/* ── 1 · THE CONCLUSIONS ─────────────────────────────────────────── */}
      <Section
        id="worth"
        title={tr("Worth knowing")}
        note={tr("Worked out from the charts below every time this page is opened, not written down once. Each one says what it means and what it does not.")}
      >
        <div className="rp-concerns">
          {data.concerns.length === 0 ? (
            <div className="rp-empty">{tr("Nothing stands out. There is not enough history yet for most of these checks.")}</div>
          ) : (
            data.concerns.map((x) => (
              <div key={x.key} className={`rp-concern ${x.severity}`}>
                <div className="rp-concern-head">
                  <span className="rp-concern-tag">{SEVERITY[x.severity]}</span>
                  <span className="rp-concern-title">{tr(x.title)}</span>
                </div>
                <div className="rp-concern-find">{tr(x.finding)}</div>
                <div className="rp-concern-mean">{tr(x.meaning)}</div>
              </div>
            ))
          )}
        </div>
      </Section>

      {/* ── 2 · WHERE IT STANDS ─────────────────────────────────────────── */}
      <Section
        id="stands"
        title={tr("Where it stands")}
        note={`${tr("The last twelve finished months against the twelve before them")} · ${c.label} ${tr("against")} ${c.priorLabel} · ${c.comparedMonths} ${tr("months both years have records for")}`}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Takings a day")}
            value={formatCents(c.perDayNowCents)}
            deltaPct={c.growthPct ?? undefined}
            deltaLabel={tr("on a year ago")}
          />
          <Stat
            label={tr("Tickets a day")}
            value={c.ticketsPerDayNow.toFixed(1)}
            deltaPct={changePct(c.ticketsPerDayNow, c.ticketsPerDayBefore) ?? undefined}
            deltaLabel={tr("on a year ago")}
          />
          <Stat
            label={tr("Average ticket")}
            value={formatCents(c.avgTicketNowCents)}
            deltaPct={changePct(c.avgTicketNowCents, c.avgTicketBeforeCents) ?? undefined}
            deltaLabel={tr("on a year ago")}
          />
          <Stat
            label={tr("On the floor")}
            value={(data.capacity.at(-1)?.techDaysPerDay ?? 0).toFixed(1)}
            sub={tr("technicians on an average day")}
          />
        </div>
      </Section>

      {/* ── 3 · WHY ─────────────────────────────────────────────────────── */}
      <Section
        id="why"
        title={tr("Why it moved")}
        note={tr("Takings a day is tickets a day multiplied by the average ticket, so a change in it splits exactly between the two. There is no third cause and no remainder.")}
      >
        <Panel
          title={tr("From a year ago to now, one cause at a time")}
          note={tr("Green adds, red takes away. The two steps sum to the whole change.")}
        >
          <Bridge
            start={{ label: tr("A year ago"), value: c.perDayBeforeCents }}
            steps={[
              { label: tr("Number of tickets"), delta: c.fromVolumeCents },
              { label: tr("Size of each ticket"), delta: c.fromPriceCents },
            ]}
            end={c.perDayNowCents}
            endLabel={tr("Now")}
            format={formatCents}
          />
        </Panel>

        <div className="rp-two">
          <Panel title={tr("Tickets for every day open")}>
            <LineChart
              series={[
                {
                  name: tr("Tickets a day"),
                  values: drawn.map((m) => orNull(m, m.ticketsPerDay)),
                },
              ]}
              labels={labels}
              format={(n) => n.toFixed(0)}
            />
          </Panel>
          <Panel title={tr("Average ticket")}>
            <LineChart
              series={[
                {
                  name: tr("Average ticket"),
                  values: drawn.map((m) => orNull(m, m.avgTicketCents)),
                  color: "#1f7a8c",
                },
              ]}
              labels={labels}
              format={formatCents}
            />
          </Panel>
        </div>
      </Section>

      {/* ── 4 · TIRES ───────────────────────────────────────────────────── */}
      <Section
        id="tires"
        title={tr("Whether there were tires to sell")}
        note={tr("What was on the racks was never written down before the register existed, so these three stand in for it. The last one is the control: if customers had stopped affording tires it would fall as they traded down. If the tires were not there, it does not move at all.")}
      >
        <div className="rp-two">
          <Panel
            title={tr("Different sizes sold in the month")}
            note={tr("The range actually on offer. It narrows before the volume does.")}
          >
            <LineChart
              series={[{ name: tr("Sizes"), values: data.access.map((a) => a.sizesSold) }]}
              labels={data.access.map((a) => monthLabel(a.bucket))}
              format={(n) => n.toFixed(0)}
            />
          </Panel>
          <Panel
            title={tr("Tickets that carried a tire")}
            note={tr("How often somebody who walked in left with one.")}
          >
            <LineChart
              series={[
                {
                  name: tr("Share of tickets"),
                  values: data.access.map((a) => a.ticketSharePct),
                  color: "#b45309",
                },
              ]}
              labels={data.access.map((a) => monthLabel(a.bucket))}
              format={(n) => `${n.toFixed(0)}%`}
            />
          </Panel>
        </div>

        <div className="rp-two">
          <Panel title={tr("Tires out of the door, for every day open")}>
            <LineChart
              series={[{ name: tr("Tires a day"), values: data.access.map((a) => a.unitsPerDay) }]}
              labels={data.access.map((a) => monthLabel(a.bucket))}
              format={(n) => n.toFixed(1)}
            />
          </Panel>
          <Panel
            title={tr("What one tire sold for")}
            note={tr("The control. A flat line here rules out customers trading down.")}
          >
            <LineChart
              series={[
                {
                  name: tr("Average tire"),
                  values: data.access.map((a) => (a.avgLineCents > 0 ? a.avgLineCents : null)),
                  color: "#15803d",
                },
              ]}
              labels={data.access.map((a) => monthLabel(a.bucket))}
              format={formatCents}
            />
          </Panel>
        </div>

        <Panel
          title={tr("What the shop sells, for every day open")}
          note={tr("Three lines rather than shares, so a line that falls is seen falling rather than seen as another line growing.")}
        >
          <LineChart
            series={[
              { name: tr("New tires"), values: data.categories.map((x) => x.newCents) },
              { name: tr("Service"), values: data.categories.map((x) => x.serviceCents), color: "#b45309" },
              { name: tr("Used tires"), values: data.categories.map((x) => x.usedCents), color: "#1f7a8c" },
            ]}
            labels={data.categories.map((x) => monthLabel(x.bucket))}
            format={formatCents}
            height={150}
          />
        </Panel>
      </Section>

      {/* ── 5 · THE CREW ────────────────────────────────────────────────── */}
      <Section
        id="crew"
        title={tr("The crew, against the work")}
        note={tr("Counted as technicians credited with work that day — the time clock has too little in it to measure hours, so everything here is per technician-day and never per hour.")}
      >
        <div className="rp-two">
          <Panel
            title={tr("Technicians on the floor, on an average day")}
          >
            <LineChart
              series={[
                { name: tr("On the floor"), values: data.capacity.map((x) => x.techDaysPerDay) },
              ]}
              labels={data.capacity.map((x) => monthLabel(x.bucket))}
              format={(n) => n.toFixed(1)}
            />
          </Panel>
          <Panel
            title={tr("What one technician gets through in a day")}
            note={tr("Tickets against money. When tickets climb and money does not, the work got smaller rather than the person faster.")}
          >
            <LineChart
              series={[
                {
                  name: tr("Tickets"),
                  values: data.capacity.map((x) => x.ticketsPerTechDay),
                  color: "#b45309",
                },
              ]}
              labels={data.capacity.map((x) => monthLabel(x.bucket))}
              format={(n) => n.toFixed(1)}
            />
          </Panel>
        </div>
        <Panel title={tr("Money brought in per technician-day")}>
          <LineChart
            series={[
              { name: tr("Per technician-day"), values: data.capacity.map((x) => x.perTechDayCents), color: "#15803d" },
            ]}
            labels={data.capacity.map((x) => monthLabel(x.bucket))}
            format={formatCents}
          />
        </Panel>
      </Section>

      {/* ── 6 · THE LONG RUN ────────────────────────────────────────────── */}
      <Section
        id="long"
        title={tr("The long run")}
        note={tr("Per trading day throughout, so a short February and a week shut in July do not read as bad months.")}
      >
        <Panel
          title={tr("Takings for every day open, month by month")}
          note={tr("The last bar is the month we are standing in and is not finished.")}
        >
          <BarChart
            data={drawn.map((m) => ({
              label: monthLabel(m.bucket),
              value: m.perDayCents,
              sub: m.tradingDays === 0 ? tr("no records") : undefined,
            }))}
            format={formatCents}
            height={150}
          />
        </Panel>

        <Panel
          title={tr("The same figure with the seasons taken out")}
          note={tr("Each point is the twelve months up to it, so every point holds one of every month. When this line moves, the business moved — not the calendar.")}
        >
          <LineChart
            series={[
              {
                name: tr("Twelve months to here"),
                // The first eleven points are averaging fewer than twelve
                // months and would draw a ramp that is an artefact of the
                // window filling up, not of the shop.
                values: data.ttm.map((x, i) => (i >= 11 ? x.perDayCents : null)),
              },
            ]}
            labels={data.ttm.map((x) => monthLabel(x.bucket))}
            format={formatCents}
            height={150}
          />
        </Panel>

        <Panel
          title={tr("This year against last")}
          note={tr("Each month beside the same month a year earlier.")}
        >
          <PairedBars
            data={drawn.slice(-12).map((m, i) => ({
              label: monthLabel(m.bucket),
              a: drawn[drawn.length - 24 + i]?.perDayCents ?? 0,
              b: m.perDayCents,
            }))}
            labels={[tr("A year ago"), tr("This year")]}
            format={formatCents}
          />
        </Panel>
      </Section>

      {/* ── 7 · THE YEAR ────────────────────────────────────────────────── */}
      <Section
        id="year"
        title={tr("The shop's year, and its week")}
        note={tr("Which months and which days the shop actually earns in, over everything on record.")}
      >
        <div className="rp-two">
          <Panel
            title={tr("Every month, averaged")}
            note={tr("Per trading day, over every year on record.")}
          >
            <RankedBars
              data={data.seasonality.map((s) => ({
                label: tr(MONTH_NAMES[s.month - 1] ?? String(s.month)),
                value: s.perDayCents,
                note: ` · ${s.years} ${s.years === 1 ? tr("year") : tr("years")}`,
              }))}
              format={formatCents}
            />
          </Panel>
          <Panel
            title={tr("The week, then and now")}
            note={`${data.weekdayLabels.early} ${tr("against")} ${data.weekdayLabels.late}. ${tr("A best day that stops standing out is what a ceiling looks like.")}`}
          >
            <PairedBars
              data={data.weekday.map((w) => ({
                label: tr(DAY_NAMES[w.weekday]).slice(0, 3),
                a: w.earlyPerDayCents,
                b: w.latePerDayCents,
              }))}
              labels={[tr("Then"), tr("Now")]}
              format={formatCents}
            />
          </Panel>
        </div>
      </Section>

      {/* ── 8 · HOW IT IS PAID ──────────────────────────────────────────── */}
      <Section
        id="paid"
        title={tr("How it is paid")}
        note={tr("Shares of what was collected, quarter by quarter. This is the figure that would move first if cash stopped being rung up, which is why it is worth a glance even when it is dull.")}
      >
        <StackedBars
          columns={data.tender.map((q) => ({
            label: q.bucket.replace("-", " "),
            parts: q.parts.map((p) => ({ label: tr(p.label), value: p.cents })),
          }))}
          format={formatCents}
        />
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rp-section" id={id}>
      <h2 className="rp-h2">{title}</h2>
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
