"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { BarChart, RankedBars, Stat, changePct } from "@/components/pos/Charts";
import { formatCents } from "@/lib/money";
import type { CloseoutV2 } from "@/lib/day-report";
import "../reports/reports.css";
import "./closeout.css";

/**
 * Close-out V2 — one business day, answered completely, touched never.
 *
 * THE ORIGINAL CLOSE-OUT IS A PROCEDURE; THIS IS A READING. Over there the
 * floor counts a drawer blind, logs it, settles the batch and signs paper —
 * every control on that page exists to keep that honest. This page is the
 * owner sitting down afterwards (or from home, or three Tuesdays later) and
 * asking the eighteen questions a day can be asked. Nothing here writes, which
 * is why nothing here needs a cover, a confirmation, or a signature line.
 *
 * ORGANISED VERDICT-FIRST. Exceptions and the checklist sit at the top because
 * they are the answer to "do I need to look harder"; every section after them
 * is the evidence. An owner who reads two lines and closes the tab on a clean
 * day is the page working, not the page being skipped.
 *
 * WHAT IT REFUSES TO SHOW: revenue per hour, technician efficiency against
 * book hours, comeback rate. All three need hours worked or repair-order
 * linkage this shop does not record, and a KPI computed from missing data is
 * noise wearing a suit. The section notes say so where an owner would expect
 * to find them.
 */

type Data = CloseoutV2 & { today: string };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function CloseoutV2Page() {
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();
  const [date, setDate] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/reports/closeout${date ? `?date=${date}` : ""}`);
    if (!res.ok) {
      setError("Could not load the day");
      return;
    }
    setData(await res.json());
    setError(null);
  }, [date]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!can("viewReports"))
    return <div className="text-brand-400">{tr("Your account can't see the management reports.")}</div>;
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  const goodsWithDiscounts =
    data.totals.goodsCents + data.totals.discountsCents;
  const discountPct =
    goodsWithDiscounts > 0 ? (data.totals.discountsCents / goodsWithDiscounts) * 100 : 0;
  const refundCents = data.tickets.refunds.reduce((n, r) => n + Math.abs(r.amountCents), 0);
  const weekday = DAY_NAMES[new Date(`${data.businessDate}T12:00:00`).getDay()];
  /** The day's first live register log that counted CASH — see below. */
  const firstCashCheck =
    data.drawer.checks.find((c) => !c.deleted && c.lines.some((l) => l.isCard === 0)) ?? null;
  const showCash = can("skipBlindCount") || firstCashCheck !== null;
  const avgTicket =
    data.totals.saleCount > 0 ? Math.round(data.totals.goodsCents / data.totals.saleCount) : 0;

  return (
    <div className="max-w-6xl mx-auto rp cv2">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 rp-no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Daily Report")}</h1>
          <p className="text-brand-400 text-sm">
            {tr("The whole day, read rather than worked. Counting and signing still live on")}{" "}
            <Link href="/pos/eod" className="underline">
              {tr("Close-out")}
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="input"
            style={{ height: 34, fontSize: 13 }}
            value={date || data.businessDate}
            max={data.today}
            onChange={(e) => setDate(e.target.value)}
          />
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

      <div className="rp-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            Casias Muffler and Tire Shop · {tr("Daily Report")}
          </div>
          <div style={{ fontSize: "9pt" }}>
            {weekday} {data.businessDate} · {tr("printed")} {printedOn} · {user.name}
          </div>
        </div>
      </div>

      {/* ── 1 · The verdict ─────────────────────────────────────────────── */}
      <Section
        id="verdict"
        title={`${weekday} ${data.businessDate}`}
        note={tr("The judgements first — everything below them is the evidence.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Sold")}
            value={formatCents(data.totals.goodsCents)}
            deltaPct={changePct(data.totals.goodsCents, data.compare.avg7GoodsCents) ?? undefined}
            deltaLabel={tr("on the 7-day average")}
          />
          <Stat label={tr("Collected")} value={formatCents(data.totals.collectedCents)} />
          <Stat
            label={tr("Tickets")}
            value={String(data.totals.saleCount)}
            sub={`${tr("average")} ${formatCents(avgTicket)}`}
          />
          <Stat
            label={tr("Margin")}
            value={`${data.margin.marginPct.toFixed(0)}%`}
            sub={`${formatCents(data.margin.marginCents)} · ${tr("on the")} ${data.margin.coveragePct}% ${tr("of sales with a cost")}`}
          />
          <Stat
            label={tr("Tips")}
            value={formatCents(data.totals.tipCents)}
            sub={`${tr("fees")} ${formatCents(data.totals.commCents)}`}
          />
          <Stat
            label={tr("Given away")}
            value={formatCents(data.totals.discountsCents)}
            sub={`${discountPct.toFixed(1)}% · ${data.totals.discountedCount} ${tr("tickets")}`}
            tone={discountPct > 5 ? "warn" : undefined}
            invert
          />
        </div>

        {data.exceptions.length === 0 ? (
          <div className="cv2-clean">
            ✓ {tr("Nothing stands out. The rest of this page is the evidence for that sentence.")}
          </div>
        ) : (
          <div className="rp-concerns">
            {data.exceptions.map((x, i) => (
              <div key={i} className={`rp-concern ${x.severity}`}>
                <div className="rp-concern-head">
                  <span className="rp-concern-tag">
                    {x.severity === "serious" ? tr("Serious") : tr("Watch")}
                  </span>
                  <span className="rp-concern-find">{x.text}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* The checklist — states the database can verify, never promises. */}
        <div className="cv2-check">
          {data.checklist.map((c) => (
            <div key={c.label} className="cv2-check-row">
              <span
                className={`cv2-check-dot ${c.done === true ? "is-done" : c.done === false ? "is-open" : "is-na"}`}
                aria-hidden
              >
                {c.done === true ? "✓" : c.done === false ? "•" : "–"}
              </span>
              <span className="cv2-check-label">{tr(c.label)}</span>
              <span className="cv2-check-detail">{c.detail}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 2 · Against the week ────────────────────────────────────────── */}
      <Section
        id="week"
        title={tr("Against the week")}
        note={tr("The last bar is this day. Same-day-last-week is the fair fight; yesterday is just the neighbour.")}
      >
        <div className="rp-two">
          <Panel title={tr("The eight days to here")}>
            <BarChart
              data={data.trend.map((d) => ({
                label: d.businessDate.slice(5),
                value: d.goodsCents,
                sub: `${d.saleCount}`,
              }))}
              format={formatCents}
              height={110}
            />
          </Panel>
          <Panel title={tr("Read against")}>
            <table className="rp-table">
              <tbody>
                <tr>
                  <td>{tr("Yesterday")}</td>
                  <td className="r n">{formatCents(data.compare.yesterdayGoodsCents)}</td>
                  <td className="r n">
                    <DeltaWords now={data.totals.goodsCents} before={data.compare.yesterdayGoodsCents} />
                  </td>
                </tr>
                <tr>
                  <td>
                    {weekday} {tr("last week")}
                  </td>
                  <td className="r n">{formatCents(data.compare.sameDayLastWeekGoodsCents)}</td>
                  <td className="r n">
                    <DeltaWords
                      now={data.totals.goodsCents}
                      before={data.compare.sameDayLastWeekGoodsCents}
                    />
                  </td>
                </tr>
                <tr>
                  <td>{tr("7-day average")}</td>
                  <td className="r n">{formatCents(data.compare.avg7GoodsCents)}</td>
                  <td className="r n">
                    <DeltaWords now={data.totals.goodsCents} before={data.compare.avg7GoodsCents} />
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </div>
      </Section>

      {/* ── 3 · Where the money came from ───────────────────────────────── */}
      <Section
        id="money"
        title={tr("Where the money came from")}
        note={tr("Off the payment ledger, the same rows the drawer and the terminal answer to. Tax shown inside, because prices include it.")}
      >
        <table className="rp-table">
          <thead>
            <tr>
              <th>{tr("Tender")}</th>
              <th className="r">{tr("Payments")}</th>
              <th className="r">{tr("Taken")}</th>
              <th className="r">{tr("Tips")}</th>
            </tr>
          </thead>
          <tbody>
            {data.tenders
              .filter((t) => t.count > 0 || t.takingsCents !== 0)
              .map((t) => (
                <tr key={t.methodId}>
                  <td>{t.label}</td>
                  <td className="r n">{t.count}</td>
                  <td className="r n" style={{ fontWeight: 600 }}>
                    {formatCents(t.takingsCents)}
                  </td>
                  <td className="r n">{t.tipCents ? formatCents(t.tipCents) : "—"}</td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 600 }}>
              <td>{tr("Collected")}</td>
              <td className="r n">
                {data.tenders.reduce((n, t) => n + t.count, 0)}
              </td>
              <td className="r n">{formatCents(data.totals.collectedCents)}</td>
              <td className="r n">{formatCents(data.totals.tipCents)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="rp-note">
          {tr("Inside those figures: tax")} {formatCents(data.totals.taxIncludedCents)} ·{" "}
          {tr("disposal fees")} {formatCents(data.sold.disposalCents)} ({data.sold.disposalUnits}{" "}
          {tr("casings")}) · {tr("charged to house accounts")}{" "}
          {formatCents(data.owed.houseChargedTodayCents)}
          {data.customers.fleetChargesCents > 0 && (
            <>
              {" "}
              ({tr("of it, to fleets")} {formatCents(data.customers.fleetChargesCents)})
            </>
          )}
          {data.totals.priorDayAdjustmentCents !== 0 && (
            <>
              {" "}
              · {tr("booked today against other days' tickets")}{" "}
              {formatCents(data.totals.priorDayAdjustmentCents)}
            </>
          )}
        </p>
      </Section>

      {/* ── 4 · The drawer ──────────────────────────────────────────────── */}
      <Section
        id="drawer"
        title={tr("The drawer")}
        note={tr("What should physically be in it: the float, plus cash from customers, plus what moved in or out without being a sale.")}
      >
        <div className="rp-two">
          <Panel
            title={tr("The arithmetic")}
            note={
              showCash
                ? undefined
                : tr("Cash is covered until the drawer has been counted on the close-out.")
            }
          >
            <table className="rp-table">
              <tbody>
                <tr>
                  <td>{tr("Opening float")}</td>
                  <td className="r n">{formatCents(data.drawer.floatCents)}</td>
                </tr>
                <tr>
                  <td>{tr("Cash from customers")}</td>
                  <td className="r n">
                    {showCash ? (
                      <>+{formatCents(data.drawer.cashSalesCents)}</>
                    ) : (
                      <span className="text-brand-300" title={tr("Shown once the drawer has been counted")}>
                        – – –
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{tr("Moved in / out")}</td>
                  <td className="r n">
                    {data.drawer.movementsCents >= 0 ? "+" : "−"}
                    {formatCents(Math.abs(data.drawer.movementsCents))}
                  </td>
                </tr>
                <tr style={{ fontWeight: 700 }}>
                  <td>
                    {tr("Should be in the drawer")}
                    {/* Said as a sentence with a TIME in it, not a bare
                        figure. What a drawer "should hold" changes every time
                        money moves, so an expectation with no moment attached
                        is a number somebody will read an hour later and count
                        against. This is the expectation frozen at the count
                        that checked it. */}
                    {!can("skipBlindCount") && firstCashCheck && (
                      <div className="text-xs font-normal text-brand-400">
                        {tr("as counted at")} {firstCashCheck.checkedAt.slice(11, 16)}
                      </div>
                    )}
                  </td>
                  <td
                    className="r n"
                    style={data.drawer.expectedCents < 0 ? { color: "#b91c1c" } : undefined}
                  >
                    {showCash ? (
                      formatCents(
                        can("skipBlindCount")
                          ? data.drawer.expectedCents
                          : (firstCashCheck!.lines.find((l) => l.isCard === 0)?.expectedCents ??
                             data.drawer.expectedCents),
                      )
                    ) : (
                      <span className="text-brand-300">– – –</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>
          <Panel
            title={tr("Cash in and out")}
            note={tr("Every non-sale movement, with its reason.")}
          >
            {data.drawer.movements.length === 0 ? (
              <div className="rp-empty">{tr("None today.")}</div>
            ) : (
              <table className="rp-table">
                <tbody>
                  {data.drawer.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="n">{m.created_at.slice(11, 16)}</td>
                      <td>{m.reason}</td>
                      <td className="r n">
                        {m.amount_cents >= 0 ? "+" : "−"}
                        {formatCents(Math.abs(m.amount_cents))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        {data.drawer.checks.filter((c) => !c.deleted).length > 0 && (
          <p className="rp-note">
            {tr("Register logged")}{" "}
            {data.drawer.checks
              .filter((c) => !c.deleted)
              .map(
                (c) =>
                  `${c.checkedAt.slice(11, 16)} (${c.balanced ? tr("balanced") : tr("did not balance")})`,
              )
              .join(" · ")}
          </p>
        )}
      </Section>

      {/* ── 5 · Tickets ─────────────────────────────────────────────────── */}
      <Section
        id="tickets"
        title={tr("Tickets")}
        note={tr("Completed is the day's work; open is not counted anywhere yet; voided nets to zero by construction and is listed by name below.")}
      >
        <div className="rp-stats">
          <Stat label={tr("Completed")} value={String(data.tickets.completed)} />
          <Stat
            label={tr("Still open")}
            value={String(data.tickets.open)}
            tone={data.tickets.open > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Voided")}
            value={String(data.tickets.voided)}
            tone={data.tickets.voided > 0 ? "warn" : undefined}
          />
          <Stat
            label={tr("Unpaid balances")}
            value={formatCents(data.tickets.unpaid.reduce((n, u) => n + u.balanceCents, 0))}
            sub={`${data.tickets.unpaid.length} ${tr("tickets")}`}
            tone={data.tickets.unpaid.length > 0 ? "warn" : undefined}
            invert
          />
        </div>

        {data.tickets.unpaid.length > 0 && (
          <Panel title={tr("Completed but not fully paid")}>
            <table className="rp-table">
              <tbody>
                {data.tickets.unpaid.map((u) => (
                  <tr key={u.saleId}>
                    <td className="n">{u.saleNo}</td>
                    <td>{u.customerName ?? <span className="text-brand-300">{tr("no name")}</span>}</td>
                    <td className="r n">{formatCents(u.totalCents)}</td>
                    <td className="r n" style={{ color: "#b91c1c", fontWeight: 600 }}>
                      {tr("owes")} {formatCents(u.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {data.tickets.voids.length > 0 && (
          <Panel title={tr("Voids, by name")}>
            <table className="rp-table">
              <tbody>
                {data.tickets.voids.map((v) => (
                  <tr key={v.saleId}>
                    <td className="n">{v.saleNo}</td>
                    <td className="r n">{formatCents(v.totalCents)}</td>
                    <td>{v.voidedByName ?? "—"}</td>
                    <td className="text-brand-400">{v.reason ?? tr("no reason given")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {data.tickets.refunds.length > 0 && (
          <Panel title={tr("Refunds")}>
            <table className="rp-table">
              <tbody>
                {data.tickets.refunds.map((r) => (
                  <tr key={`${r.saleId}-${r.createdAt}`}>
                    <td className="n">{r.saleNo}</td>
                    <td className="r n" style={{ color: "#b91c1c" }}>
                      −{formatCents(Math.abs(r.amountCents))}
                    </td>
                    <td>{r.byName ?? "—"}</td>
                    <td className="text-brand-400">{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {data.tickets.discounts.length > 0 && (
          <Panel title={tr("Who gave the discounts")}>
            <table className="rp-table">
              <tbody>
                {data.tickets.discounts.map((d) => (
                  <tr key={d.saleId}>
                    <td className="n">{d.saleNo}</td>
                    <td className="r n">−{formatCents(d.discountCents)}</td>
                    <td>{d.byName ?? "—"}</td>
                    <td className="text-brand-400">{d.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {refundCents === 0 &&
          data.tickets.voids.length === 0 &&
          data.tickets.discounts.length === 0 && (
            <p className="rp-note">
              {tr("No voids, no refunds, no discounts — nothing left the day after being rung.")}
            </p>
          )}
      </Section>

      {/* ── 6 · Who did the work ────────────────────────────────────────── */}
      <Section
        id="people"
        title={tr("Who did the work")}
        note={tr("Per person, off the same lines the leaderboard reads. Revenue per hour is deliberately absent: the shop does not record hours, and a KPI computed from missing data is noise wearing a suit.")}
      >
        <div className="rp-two">
          <Panel title={tr("Technicians")}>
            {data.mechanics.length === 0 ? (
              <div className="rp-empty">{tr("Nobody credited yet.")}</div>
            ) : (
              <RankedBars
                data={data.mechanics.map((m) => ({
                  label: m.name,
                  value: m.salesCents,
                  note: ` · ${m.lineCount} ${tr("lines")}`,
                }))}
                format={formatCents}
              />
            )}
          </Panel>
          <Panel
            title={tr("At the register")}
            note={tr("Who took the money, per payment.")}
          >
            {data.cashiers.length === 0 ? (
              <div className="rp-empty">{tr("No payments yet.")}</div>
            ) : (
              <table className="rp-table">
                <tbody>
                  {data.cashiers.map((c) => (
                    <tr key={c.employeeId}>
                      <td>{c.name}</td>
                      <td className="r n">{c.count}</td>
                      <td className="r n">{formatCents(c.collectedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </Section>

      {/* ── 7 · What sold ───────────────────────────────────────────────── */}
      <Section
        id="sold"
        title={tr("What sold")}
        note={tr("Tires against service is this shop's parts-against-labor. The attachment rate is the day's best selling question: of everyone who came in, how many left on new tires?")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("New tires")}
            value={String(data.sold.newTires.units)}
            sub={formatCents(data.sold.newTires.cents)}
          />
          <Stat
            label={tr("Used tires")}
            value={String(data.sold.usedTires.units)}
            sub={formatCents(data.sold.usedTires.cents)}
          />
          <Stat
            label={tr("Service lines")}
            value={String(data.sold.service.lines)}
            sub={formatCents(data.sold.service.cents)}
          />
          <Stat
            label={tr("Tire attachment")}
            value={`${data.sold.attachmentPct.toFixed(0)}%`}
            sub={tr("of tickets carried a new tire")}
          />
        </div>
        <div className="rp-two">
          <Panel title={tr("Best sellers today")}>
            {data.sold.topProducts.length === 0 ? (
              <div className="rp-empty">{tr("No products sold.")}</div>
            ) : (
              <RankedBars
                data={data.sold.topProducts.map((p) => ({
                  label: p.label,
                  value: p.qty,
                  note: ` · ${formatCents(p.cents)}`,
                }))}
                format={(n) => String(n)}
              />
            )}
          </Panel>
          <Panel title={tr("Best services today")}>
            {data.sold.topServices.length === 0 ? (
              <div className="rp-empty">{tr("No service lines.")}</div>
            ) : (
              <RankedBars
                data={data.sold.topServices.map((p) => ({
                  label: p.label,
                  value: p.qty,
                  note: ` · ${formatCents(p.cents)}`,
                }))}
                format={(n) => String(n)}
              />
            )}
          </Panel>
        </div>
      </Section>

      {/* ── 8 · The racks ───────────────────────────────────────────────── */}
      <Section
        id="stock"
        title={tr("Did the racks move in step")}
        note={tr("A sold tire leaves a line on the ticket and a movement on the stock ledger, written by different code. When the two counts agree, no tire left the building unrecorded.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("Tires on tickets")}
            value={String(data.stock.unitsSoldOnTickets)}
          />
          <Stat
            label={tr("Tires off the racks")}
            value={String(data.stock.unitsOut)}
            tone={
              data.stock.unitsOut - data.stock.fulfilledForEarlierUnits !==
              data.stock.unitsSoldOnTickets - data.stock.awaitingFulfillmentUnits
                ? "bad"
                : "good"
            }
            sub={
              data.stock.unitsOut - data.stock.fulfilledForEarlierUnits ===
              data.stock.unitsSoldOnTickets - data.stock.awaitingFulfillmentUnits
                ? data.stock.fulfilledForEarlierUnits > 0 ||
                  data.stock.awaitingFulfillmentUnits > 0
                  ? tr("matches, counting the ordered tires")
                  : tr("matches the tickets")
                : tr("DOES NOT match the tickets")
            }
          />
          <Stat
            label={tr("Received today")}
            value={String(data.stock.received.reduce((n, r) => n + r.qty, 0))}
            sub={`${data.stock.received.length} ${tr("deliveries")}`}
          />
          <Stat
            label={tr("Oversells to review")}
            value={String(data.stock.unreviewedOversells)}
            tone={data.stock.unreviewedOversells > 0 ? "warn" : undefined}
          />
        </div>
        {(data.stock.fulfilledForEarlierUnits > 0 ||
          data.stock.awaitingFulfillmentUnits > 0) && (
          <p className="rp-note">
            {tr("Of the difference:")}{" "}
            {data.stock.fulfilledForEarlierUnits > 0 && (
              <>
                {data.stock.fulfilledForEarlierUnits}{" "}
                {tr("fitted today for tickets rung on earlier days")}
              </>
            )}
            {data.stock.fulfilledForEarlierUnits > 0 &&
              data.stock.awaitingFulfillmentUnits > 0 &&
              " · "}
            {data.stock.awaitingFulfillmentUnits > 0 && (
              <>
                {data.stock.awaitingFulfillmentUnits}{" "}
                {tr("sold today as orders, not yet fitted")}
              </>
            )}
            . {tr("That is the special-order cycle working, not stock walking.")}
          </p>
        )}
        {data.stock.adjustments > 0 && (
          <p className="rp-note">
            {data.stock.adjustments} {tr("manual stock adjustments today — each one is on the movements ledger with a name on it.")}
          </p>
        )}
      </Section>

      {/* ── 9 · Owed to the shop ────────────────────────────────────────── */}
      <Section
        id="owed"
        title={tr("Owed to the shop")}
        note={tr("Not just today's — everything standing, aged. Money owed for ninety days is a different fact from money owed since Tuesday.")}
      >
        <div className="rp-stats">
          <Stat
            label={tr("On tickets")}
            value={formatCents(data.owed.outstandingTicketCents)}
            sub={`${data.owed.outstandingTicketCount} ${tr("outstanding")}`}
            invert
          />
          {data.owed.aging.map((b) => (
            <Stat
              key={b.label}
              label={b.label}
              value={formatCents(b.ticketCents + b.accountCents)}
              invert
            />
          ))}
        </div>
      </Section>

      {/* ── 10 · Customers ──────────────────────────────────────────────── */}
      <Section id="customers" title={tr("Customers")}>
        <div className="rp-stats">
          <Stat label={tr("New today")} value={String(data.customers.newToday)} />
          <Stat
            label={tr("Tickets with a name")}
            value={String(data.customers.namedTickets)}
            sub={
              data.tickets.completed > 0
                ? `${((data.customers.namedTickets / data.tickets.completed) * 100).toFixed(0)}% ${tr("of the day")}`
                : undefined
            }
          />
          <Stat
            label={tr("Charged to fleets")}
            value={formatCents(data.customers.fleetChargesCents)}
          />
        </div>
      </Section>
    </div>
  );
}

function DeltaWords({ now, before }: { now: number; before: number }) {
  const pct = changePct(now, before);
  if (pct === null) return <span className="text-brand-300">—</span>;
  const up = pct >= 0;
  return (
    <span style={{ color: up ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
      {up ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
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
