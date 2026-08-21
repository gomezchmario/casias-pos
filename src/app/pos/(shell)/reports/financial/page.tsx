"use client";

import Link from "next/link";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { RankedBars, Stat, changePct } from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import {
  ExperimentalNote,
  Panel,
  RangeBar,
  ReportsNav,
  Section,
  useSuite,
} from "../shared";
import "../reports.css";

/**
 * Financial: what the take actually left behind, and where money leaks.
 *
 * The PROFIT side of the same window Sales shows the demand side of. Margin
 * first, then what is owed, then the register's own leaks — discounts, voids,
 * price changes, counts that did not balance. This page is deliberately not a
 * P&L: the records carry cost on tires and nearly nothing else, no rent, no
 * wages, no utilities. Every figure says what it covers rather than dressing
 * up as a statement of the whole business.
 */
export default function FinancialReportPage() {
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
  const owedTickets = data.aging.reduce((n, b) => n + b.ticketCents, 0);
  const owedAccounts = data.aging.reduce((n, b) => n + b.accountCents, 0);

  return (
    <div className="max-w-6xl mx-auto rp">
      <ExperimentalNote />
      <RangeBar
        title={tr("Financial")}
        blurb={tr("Margin where it can be known, what is owed, and the handful of things worth a second look.")}
        data={data}
        win={win}
        printTitle={tr("Financial report")}
      />
      <ReportsNav win={win} />

      {/* ── WHAT WAS LEFT ───────────────────────────────────────────────── */}
      <Section
        id="left"
        title={tr("What the window left behind")}
        note={tr("Margin is worked out only on the lines that carry a cost, and the tax is taken out of the price first — the shop never kept that part.")}
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
          <Stat
            label={tr("Bought over the counter")}
            value={formatCents(data.purchases.costCents)}
            sub={`${data.purchases.units} ${tr("used tires taken in")}`}
          />
          <Stat
            label={tr("On the racks, at cost")}
            value={formatCents(data.stock.totalCostCents)}
            sub={`${data.stock.totalUnits} ${tr("units, at cost")}`}
          />
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
                      <td className="r n">{c.costCents > 0 ? formatCents(c.costCents) : "—"}</td>
                      <td className="r n">
                        {c.costCoveragePct > 0 ? formatCents(c.marginCents) : "—"}
                      </td>
                      <td
                        className="r n"
                        style={{
                          color:
                            pct === null
                              ? undefined
                              : pct < 15
                                ? "#b91c1c"
                                : pct > 35
                                  ? "#15803d"
                                  : undefined,
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

        <div className="rp-no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            className="btn btn-outline"
            style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }}
            href="/pos/closeout-v3"
          >
            {tr("Tonight's close-out")}
          </Link>
          <Link
            className="btn btn-outline"
            style={{ height: 36, fontSize: 13, display: "inline-flex", alignItems: "center" }}
            href="/pos/eod"
          >
            {tr("The full day report")}
          </Link>
        </div>
      </Section>

      {/* ── OWED ────────────────────────────────────────────────────────── */}
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

      {/* ── CONTROL ─────────────────────────────────────────────────────── */}
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
