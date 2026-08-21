"use client";

import { useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import {
  BarChart,
  Delta,
  Heatmap,
  RankedBars,
  Spark,
  Stat,
  changePct,
} from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import type { EmployeeRow } from "@/lib/reports-bi";
import type { TechDetail } from "@/lib/reports-suite";
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
 * Technicians & Labor: the people, over the same window as everything else.
 *
 * MEASURED BY CREDITED WORK AND NOTHING ELSE. The one attribution the records
 * carry honestly all the way back is which technician a line was credited to;
 * clocked hours only exist for the recent past and the imported history's
 * cashier column is who typed the ticket, not who earned it. So everything
 * here is built on credit — and the staffing section says out loud where a
 * question needs the hours the records do not have.
 *
 * The drill-down is the new part: pick a name and the same window opens up
 * for that one person — their pace over time, what kind of work they do, and
 * which days they earn on.
 */
export default function CrewReportPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const { data, error, win } = useSuite();

  /** The technician under the glass, or null for nobody. */
  const [techId, setTechId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    grain: "day" | "week" | "month";
    detail: TechDetail;
  } | null>(null);

  useEffect(() => {
    if (techId === null) {
      setDetail(null);
      return;
    }
    let stale = false;
    (async () => {
      const sp = new URLSearchParams({ id: String(techId) });
      if (win.from) sp.set("from", win.from);
      if (win.to) sp.set("to", win.to);
      const res = await fetch(`/api/pos/reports/tech?${sp}`);
      if (!res.ok || stale) return;
      setDetail(await res.json());
    })();
    return () => {
      stale = true;
    };
  }, [techId, win.from, win.to]);

  if (!can("viewBusinessReports"))
    return (
      <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>
    );
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  // The MIDDLE of the day rates rather than the average: one technician back
  // for a single busy Saturday drags a mean a long way.
  const dayRates = data.employees.rows.map((r) => r.perDayCents).sort((a, b) => a - b);
  const medianPerDay = dayRates.length ? dayRates[Math.floor(dayRates.length / 2)] : 0;
  const bestPerDay = data.employees.rows.reduce<EmployeeRow | null>(
    (best, r) => (!best || r.perDayCents > best.perDayCents ? r : best),
    null,
  );
  // One scale across every sparkline, so the rows read against each other.
  const sparkMax = Math.max(1, ...Object.values(data.sparks.byEmployee).flatMap((s) => s));

  const detailMixTotal = detail?.detail.mix.reduce((n, m) => n + m.cents, 0) ?? 0;

  return (
    <div className="max-w-6xl mx-auto rp">
      <ExperimentalNote />
      <RangeBar
        title={tr("Technicians & Labor")}
        blurb={tr("Who did the work, how everyone is doing, and the cover the week needs.")}
        data={data}
        win={win}
        printTitle={tr("Technician report")}
      />
      <ReportsNav win={win} />

      {/* ── WHO DID THE WORK ────────────────────────────────────────────── */}
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

      {/* ── ONE PERSON, UP CLOSE ────────────────────────────────────────── */}
      <Section
        id="lens"
        title={tr("One technician, up close")}
        note={tr("The same window, for one name — their pace over time, the kind of work they do, and which days they earn on.")}
      >
        <div className="rp-no-print" style={{ marginBottom: 12 }}>
          <select
            className="input"
            style={{ height: 36, fontSize: 13, maxWidth: 280 }}
            value={techId ?? ""}
            onChange={(e) => setTechId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{tr("Pick a technician…")}</option>
            {data.techs.map((t) => (
              <option key={t.employeeId} value={t.employeeId}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {techId === null ? (
          <div className="rp-empty">{tr("Pick a name above to open their window.")}</div>
        ) : !detail ? (
          <div className="text-brand-300">{tr("Adding it up…")}</div>
        ) : (
          <>
            <Panel
              title={`${detail.detail.name ?? "—"} · ${tr("brought in, over the window")}`}
            >
              <BarChart
                data={detail.detail.trend.map((p) => ({
                  label: bucketLabel(p.bucket, detail.grain),
                  value: p.incomeCents,
                }))}
                format={formatCents}
                height={110}
                emptyLabel={tr("Nothing credited in this window.")}
              />
            </Panel>
            <div className="rp-two">
              <Panel title={tr("What kind of work")}>
                <RankedBars
                  data={detail.detail.mix.map((m) => ({
                    label: m.label,
                    value: m.cents,
                    note:
                      detailMixTotal > 0
                        ? ` · ${Math.round((m.cents / detailMixTotal) * 100)}%`
                        : undefined,
                  }))}
                  format={formatCents}
                  emptyLabel={tr("Nothing credited in this window.")}
                />
              </Panel>
              <Panel
                title={tr("Which days they earn on")}
                note={tr("Per day they were credited, so one busy Saturday reads as one busy Saturday.")}
              >
                <RankedBars
                  data={detail.detail.weekdays
                    .filter((w) => w.days > 0)
                    .map((w) => ({
                      label: DAY_NAMES[w.weekday],
                      value: Math.round(w.incomeCents / w.days),
                      note: ` · ${w.days} ${w.days === 1 ? tr("day") : tr("days")}`,
                    }))
                    .sort((a, b) => b.value - a.value)}
                  format={formatCents}
                  emptyLabel={tr("Nothing credited in this window.")}
                />
              </Panel>
            </div>
          </>
        )}
      </Section>

      {/* ── HOW EVERYONE IS DOING ───────────────────────────────────────── */}
      <Section
        id="people"
        title={tr("How everyone is doing")}
        note={tr("Measured per day they were actually here, against the same length of time before this window. Somebody who works Saturdays is not a sixth of somebody who works six days.")}
      >
        {data.employees.rows.length === 0 ? (
          <div className="rp-empty">
            {tr("Nobody has been credited with a line in this window.")}
          </div>
        ) : (
          <>
            {data.employees.priorTradingDays === 0 && (
              <div className="rp-warn">
                {tr("There is no record of the shop opening between")} {data.employees.priorFrom}{" "}
                {tr("and")} {data.employees.priorTo}
                {tr(", so there is nothing to compare this window against. The arrows below are left off rather than showing everyone down 100%.")}
              </div>
            )}

            <div className="rp-stats">
              <Stat
                label={tr("On the floor")}
                value={String(data.employees.rows.length)}
                sub={tr("credited with work in this window")}
              />
              <Stat
                label={tr("Best day rate")}
                value={formatCents(bestPerDay?.perDayCents ?? 0)}
                sub={bestPerDay ? `${bestPerDay.name} · ${bestPerDay.daysWorked} ${tr("days here")}` : "—"}
              />
              <Stat
                label={tr("Typical day rate")}
                value={formatCents(medianPerDay)}
                sub={tr("the middle of the crew")}
              />
              <Stat
                label={tr("Tips")}
                value={formatCents(data.employees.rows.reduce((n, r) => n + r.tipCents, 0))}
                sub={tr("what customers added, this window")}
              />
            </div>

            <Panel
              title={tr("Money brought in, per day here")}
              note={tr("The fair comparison between people who work different amounts.")}
            >
              <RankedBars
                data={data.employees.rows
                  .slice()
                  .sort((a, b) => b.perDayCents - a.perDayCents)
                  .map((r) => ({
                    label: r.name,
                    value: r.perDayCents,
                    note: ` · ${r.daysWorked} ${r.daysWorked === 1 ? tr("day") : tr("days")}`,
                  }))}
                format={formatCents}
              />
            </Panel>

            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Technician")}</th>
                  <th className="r">{tr("Days here")}</th>
                  <th className="r">{tr("Tickets")}</th>
                  <th className="r">{tr("Per ticket")}</th>
                  <th className="r">{tr("Tip a ticket")}</th>
                  <th className="r">{tr("Per day here")}</th>
                  <th className="r">{tr("Brought in")}</th>
                  <th>{tr("Last 12 months")}</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.rows.map((r) => {
                  const delta =
                    data.employees.priorTradingDays === 0 || r.prior.perDayCents === 0
                      ? null
                      : changePct(r.perDayCents, r.prior.perDayCents);
                  return (
                    <tr key={r.employeeId}>
                      <td>
                        {r.name}
                        {/* Somebody who has left still owns their history and
                            still appears in an all-time window. */}
                        {r.active === 0 && (
                          <span className="rp-pill" style={{ marginLeft: 6 }}>
                            {tr("gone")}
                          </span>
                        )}
                      </td>
                      <td className="r n">{r.daysWorked}</td>
                      <td className="r n">{r.ticketCount}</td>
                      <td className="r n">{formatCents(r.perTicketCents)}</td>
                      <td className="r n">
                        {r.tipCents ? formatCents(r.tipPerTicketCents) : "—"}
                      </td>
                      <td className="r n">
                        {formatCents(r.perDayCents)}
                        {delta !== null && (
                          <span style={{ marginLeft: 6 }}>
                            <Delta pct={delta} />
                          </span>
                        )}
                      </td>
                      <td className="r n" style={{ fontWeight: 600 }}>
                        {formatCents(r.incomeCents)}
                        <span className="rp-rank-note"> · {r.incomePct.toFixed(0)}%</span>
                      </td>
                      <td>
                        <Spark
                          values={data.sparks.byEmployee[r.employeeId] ?? []}
                          max={sparkMax}
                          labels={data.sparks.months}
                          format={formatCents}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Section>

      {/* ── HOW MANY PEOPLE THE WEEK NEEDS ──────────────────────────────── */}
      <Section
        id="cover"
        title={tr("How many people the week needs")}
        note={tr("Customers to expect in each hour, and the cover that takes. The shape is counted off every ticket; the number of people needs one thing the tickets cannot say — how long a job takes — so pick the line that matches the bay.")}
      >
        <div className="rp-note rp-note-warn">
          <strong>{tr("These are the customers we served, not the ones who wanted serving.")}</strong>{" "}
          {tr("Somebody who saw the wait and drove off left no ticket, so they are in none of these squares. The busier an hour is the more it turns away, which means the busiest hours are the most understated — read every figure here as a floor rather than as demand.")}
        </div>

        {!data.staffing.paceFromData && (
          <div className="rp-note rp-note-warn">
            <strong>{tr("The shop cannot work out its own pace yet.")}</strong>{" "}
            {tr("Over this window the time clock recorded")}{" "}
            <strong>{data.staffing.techHours.toFixed(1)} {tr("technician hours")}</strong>
            {tr(", which is not enough to divide")} {data.staffing.tickets.toLocaleString()}{" "}
            {tr("customers by. Everything below is still counted from real tickets — only the last table needs you to pick a line rather than being told one. If the technicians clocked in and out, this would answer itself.")}
          </div>
        )}

        <div
          className="no-print"
          style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <a
            className="btn btn-outline"
            style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }}
            href={`/pos/reports/staffing?from=${win.from || data.from}&to=${win.to || data.to}`}
          >
            {tr("Open the printable staffing report")}
          </a>
        </div>

        <Panel
          title={tr("Customers to expect, hour by hour")}
          note={tr("Averages over the window, not totals — what to expect in that hour on that day.")}
        >
          <Heatmap
            cells={data.staffing.slots
              .filter((x) => x.avgTickets >= 0.05)
              .map((x) => ({
                weekday: x.weekday,
                hour: x.hour,
                value: Math.round(x.avgTickets * 10) / 10,
              }))}
            hours={data.staffing.hours}
            format={(n) => `${n} ${n === 1 ? tr("customer") : tr("customers")} ${tr("an hour")}`}
            emptyLabel={tr("No tickets in this window.")}
            quietLabel={tr("Quiet")}
            busyLabel={tr("Busiest")}
            showValues
          />
        </Panel>

        <div className="rp-two">
          <Panel
            title={tr("Technicians needed at the busiest hour")}
            note={tr("Rounded up — half a technician cannot fit a tire, and the cost of rounding down is a customer in the lobby.")}
          >
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("If one handles")}</th>
                  {DAY_NAMES.map((d) => (
                    <th key={d} className="num">
                      {d.slice(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.staffing.atPace.map((row) => (
                  <tr key={row.perHour}>
                    <td>
                      <strong>
                        {row.perHour} {tr("an hour")}
                      </strong>
                      <div className="rp-sub">{tr(row.label)}</div>
                    </td>
                    {row.peak.map((c) => (
                      <td key={c.weekday} className="num">
                        <strong>{c.techs || "—"}</strong>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            fill
            title={tr("Busiest days first")}
            note={tr("The order to staff them in. The gap top to bottom is the argument for moving somebody's day off.")}
          >
            <RankedBars
              data={[...data.staffing.days]
                .sort((a, b) => b.tickets - a.tickets)
                .map((d) => ({
                  label: DAY_NAMES[d.weekday],
                  value: Math.round(d.tickets),
                  note: ` · ${tr("busiest at")} ${hourLabel(d.peakHour)}`,
                }))}
              format={(n) => `${n} ${tr("customers")}`}
              emptyLabel={tr("Nothing in this window.")}
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
