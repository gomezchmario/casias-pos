"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents } from "@/lib/money";
import "./movements.css";

/**
 * Every tire in and every tire out, in the order it happened.
 *
 * The stock ledger has always held this — `inventory_movements` is append-only
 * and nothing is ever edited in it — but the only way in was a single product's
 * history, reached from that product's row. That answers "what happened to this
 * tire", which you can only ask once you already suspect it. The question that
 * actually gets asked is the other one: the count is wrong and nobody knows
 * where to start.
 *
 * So: one row per movement, newest first, across everything. It is deliberately
 * a ledger and not a report — no totals, no grouping, no clever summary. The
 * number at the bottom of a summary is exactly what somebody would then have to
 * come here to explain.
 */

type Movement = {
  id: number;
  productId: number;
  productName: string;
  tireSize: string | null;
  condition: string;
  qtyDelta: number;
  reason: string;
  unitCostCents: number | null;
  saleId: number | null;
  saleNo: string | null;
  oversold: number;
  reviewedByName: string | null;
  note: string | null;
  businessDate: string;
  byName: string | null;
  at: string;
};

/** What each reason means in the words the shop uses, not the words the schema does. */
const REASON: Record<string, string> = {
  receive: "Received",
  sale: "Sold",
  void_return: "Back — ticket voided",
  refund_return: "Back — refunded",
  adjust: "Adjusted",
  count: "Counted",
  damage: "Damaged",
  opening: "Opening count",
};

const shortTime = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? String(at).slice(11, 16)
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

type MonthReport = {
  month: string;
  kind: "sold" | "received";
  rows: {
    businessDate: string;
    productName: string;
    tireSize: string | null;
    qty: number;
    saleNo: string | null;
    byName: string | null;
    grossCents: number;
    ordered: number;
  }[];
  qty: number;
  grossCents: number;
  taxCents: number;
  netCents: number;
  taxRateBp: number;
  seedMonth: string | null;
  orderedQty: number;
  stockQty: number;
};

export default function MovementsPage() {
  const { can, user } = usePosAuth();
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [showCosts, setShowCosts] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The month sheet. Null until asked for — this page is a ledger first, and a
  // report that draws itself on arrival would be a page nobody could read.
  const [month, setMonth] = useState("");
  const [report, setReport] = useState<MonthReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  // Defaulted in an effect rather than at mount, because the month depends on
  // the browser's clock and rendering it during the server pass would mismatch.
  useEffect(() => {
    const d = new Date();
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }, []);

  /**
   * Toggle, not just fetch.
   *
   * The two buttons are a view the page is IN, so the way out has to be the way
   * in pressed again — the alternative is a report that can be opened and never
   * closed, which is how a screen ends up with a Clear button nobody looks for.
   */
  async function runReport(kind: "sold" | "received") {
    if (reportBusy) return;
    if (report?.kind === kind) {
      setReport(null);
      return;
    }
    if (!month) return;
    setReportBusy(true);
    setError(null);
    const res = await fetch(`/api/pos/reports/tires?month=${month}&kind=${kind}`);
    const d = await res.json().catch(() => ({}));
    setReportBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not build that report");
      return;
    }
    setReport(d);
  }

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    const res = await fetch(`/api/pos/inventory/movements?${sp}`);
    if (!res.ok) {
      setError("Could not load the movements");
      return;
    }
    const d = await res.json();
    setRows(d.movements);
    setShowCosts(d.showCosts);
    setError(null);
  }, [q, from, to]);

  // Debounced, because the filter box is typed into and every keystroke is a
  // query over the whole ledger.
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  if (!can("viewInventory"))
    return <div className="text-brand-400">Your account can&apos;t see the stock ledger.</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 tm-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">Tire movements</h1>
          <p className="text-brand-400 text-sm">
            Every tire in and out, newest first. Nothing here is ever edited — a
            correction is another row.
          </p>
        </div>
        <Link href="/pos/entries" className="btn btn-outline">
          ← Logs
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {/*
        The month sheet, and the only part of this page that prints.

        New tires only, both ways. Used tires have no cost and a price decided
        at the counter, so a total that mixed them in would be a number that is
        not true of either half.
      */}
      {can("viewReports") && (
        <div className="bg-white rounded-2xl shadow-sm p-3 mb-4 tm-hide-on-print">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
            New tires, by month
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="input"
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setReport(null);
              }}
              aria-label="Month"
              style={{ width: 170 }}
            />
            {/* Lit while its report is the thing on screen — these are two
                views of the page rather than two actions, and a button that
                looks identical whether or not you are inside it is how somebody
                presses it twice wondering why nothing happened. */}
            <button
              type="button"
              className={report?.kind === "sold" ? "btn btn-primary" : "btn btn-outline"}
              aria-pressed={report?.kind === "sold"}
              onClick={() => void runReport("sold")}
              disabled={reportBusy || !month}
            >
              Sold this month
            </button>
            <button
              type="button"
              className={report?.kind === "received" ? "btn btn-primary" : "btn btn-outline"}
              aria-pressed={report?.kind === "received"}
              onClick={() => void runReport("received")}
              disabled={reportBusy || !month}
            >
              Stocked this month
            </button>
            {report && (
              <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                Print
              </button>
            )}
          </div>
        </div>
      )}

      {report && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 tm-sheet">
          {/* The printed letterhead. `priority` on the badge for the reason the
              close-out gives: this block is hidden until somebody prints, and an
              image that never displays is never fetched. */}
          <div className="tm-only tm-head">
            <ShopLogo size={44} priority />
            <div>
              <div style={{ fontWeight: 700, fontSize: "13pt" }}>
                Casias Muffler and Tire Shop
              </div>
              <div style={{ fontSize: "9pt" }}>
                New tires {report.kind === "sold" ? "sold" : "stocked"} · {report.month} ·
                printed by {user.name}
              </div>
            </div>
          </div>

          {/*
            The opening count, said out loud, on the one sheet it distorts.

            Only on `received`, and only for the first month the ledger has: the
            sold side is unaffected, because a tire entered onto a rack was not
            sold to anybody. It prints with the sheet deliberately — this is the
            page that gets filed and handed to whoever does the books, and the
            caveat is worth nothing if it only exists on the screen of the person
            who already knew.
          */}
          {report.kind === "received" && report.seedMonth === report.month && (
            <div className="mb-3 rounded-lg border-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>
                This is the month the shop&apos;s existing stock was entered into the
                system.
              </strong>{" "}
              Every tire already on a rack had to be recorded as a receipt, because
              a receipt is the only way stock comes to exist here — so the figures
              below are the opening count and this month&apos;s genuine purchases
              added together, and nothing distinguishes the two after the fact.
              Read this total as an opening stock valuation rather than as a
              month&apos;s buying, and do not compare it against later months.
              <div className="mt-1">
                If the shop genuinely opened for business in {report.month}, the
                figures are correct as they stand.
              </div>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3 mb-2 tm-hide-on-print">
            <h2 className="text-lg font-semibold text-brand-500">
              New tires {report.kind === "sold" ? "sold" : "stocked"} · {report.month}
            </h2>
            <span className="text-sm text-brand-300">
              {report.rows.length} {report.rows.length === 1 ? "line" : "lines"}
            </span>
          </div>

          {report.rows.length === 0 ? (
            <div className="text-brand-300 py-6 text-center">
              No new tires {report.kind === "sold" ? "sold" : "received"} that month.
            </div>
          ) : (
            <>
              <table className="w-full text-sm tm-table">
                <thead>
                  <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                    <th className="py-1 font-medium">Date</th>
                    <th className="py-1 font-medium">Tire</th>
                    {/* Every column that follows a right-aligned number is
                        indented off it. Without the gap "2" and "Mario" close
                        up into "2Mario" — the number ends hard against the next
                        column because one is pushed right and the other left,
                        so they meet in the middle with nothing between them. */}
                    <th className="py-1 font-medium text-right">Qty</th>
                    <th className="py-1 font-medium pl-4">
                      {report.kind === "sold" ? "Ticket" : "Received by"}
                    </th>
                    <th className="py-1 font-medium text-right pl-4">
                      {report.kind === "sold" ? "Charged" : "Paid"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r, i) => (
                    <tr key={i} className="border-t border-black/5">
                      <td className="py-1 tabular-nums whitespace-nowrap">{r.businessDate}</td>
                      <td className="py-1">
                        {r.productName}
                        {/* Only the ordered ones are badged.
                            Stock is what nearly every row is, and marking the
                            ordinary case badges most of the sheet — which is
                            the same as badging none of it, at the cost of
                            burying the handful of rows worth finding. The count
                            of unbadged rows is in the summary, so nothing is
                            lost by their silence. */}
                        {r.ordered === 1 && (
                          <span className="tm-pill tm-pill-ordered">
                            {report.kind === "sold" ? "ordered in" : "for an order"}
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right tabular-nums">{r.qty}</td>
                      <td className="py-1 pl-4 whitespace-nowrap text-brand-400">
                        {report.kind === "sold" ? (r.saleNo ?? "—") : (r.byName ?? "—")}
                      </td>
                      <td className="py-1 pl-4 text-right tabular-nums">
                        {formatCents(r.grossCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/*
                Three figures, and the middle one is the whole point of the
                sheet. Prices here are tax-inclusive, so the gross is what
                actually changed hands and the net is what is left once the
                state's share comes out — which is the number this gets filed
                for.
              */}
              <div className="tm-totals mt-3 pt-2 border-t-2 border-black/20">
                {/*
                  Inside the totals block and under its rule, not above it.
                  The rule separates the detail from the conclusion, and the
                  caveat belongs to the conclusion — it qualifies the figures
                  beneath it, so it sits on their side of the line.

                  Only on the stocked sheet, and it prints. What was sold is
                  checked twice by the world — the customer paid it and the
                  close-out balanced against it — so that total is corroborated
                  before it ever reaches this page. A receiving cost is typed
                  once, by one person, off an invoice, and nothing downstream
                  ever disagrees with it. That is the one number here that can
                  be quietly wrong, so the sheet says so.
                */}
                {report.kind === "received" && (
                  <div className="mb-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Assuming every cost was entered correctly when the stock was
                    received. Nothing downstream checks these figures, so they are
                    only as good as what was typed in at the time.
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>{report.qty} new tires</span>
                  <span className="tabular-nums">{formatCents(report.grossCents)}</span>
                </div>
                {/* The split, in words, because it is the sentence somebody
                    repeats out loud off this sheet — and because two numbers
                    side by side invite the reader to work out which is which. */}
                <div className="text-sm text-brand-400">
                  {report.kind === "sold" ? (
                    <>
                      {report.orderedQty} had to be ordered in, {report.stockQty} sold
                      from stock
                    </>
                  ) : (
                    <>
                      {report.orderedQty} came in for orders, {report.stockQty} went
                      onto the racks
                    </>
                  )}
                </div>
                <div className="flex justify-between text-sm text-brand-400">
                  <span>
                    Tax inside that, at {(report.taxRateBp / 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%
                  </span>
                  <span className="tabular-nums">−{formatCents(report.taxCents)}</span>
                </div>
                <div className="flex justify-between font-semibold text-brand-500 mt-1">
                  <span>{report.kind === "sold" ? "Net of tax" : "Net cost of tax"}</span>
                  <span className="tabular-nums">{formatCents(report.netCents)}</span>
                </div>

              </div>
            </>
          )}
        </div>
      )}

      {/* The ledger and its filters, put away while a month sheet is up.
          They are the day-to-day view and the report is a different question
          entirely; leaving five hundred rows under a sheet somebody is about to
          print means scrolling past the answer to reach nothing. */}
      {!report && (
        <>
      <div className="bg-white rounded-2xl shadow-sm p-3 mb-4 grid gap-3 tm-hide-on-print" style={{ gridTemplateColumns: "minmax(0,1fr) 150px 150px" }}>
        <input
          className="input"
          placeholder="Tire, size, brand or ticket…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4 tm-hide-on-print">
        {rows === null ? (
          <div className="text-brand-300">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-brand-300 py-8 text-center">Nothing moved.</div>
        ) : (
          <table className="w-full text-sm tm-table">
            <thead>
              <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Tire</th>
                <th className="py-2 font-medium">What happened</th>
                <th className="py-2 font-medium text-right">In / out</th>
                {showCosts && <th className="py-2 font-medium text-right pl-4">Cost each</th>}
                <th className="py-2 font-medium pl-4">Ticket</th>
                <th className="py-2 font-medium pl-4">Who</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.id} className="border-t border-black/5 align-top">
                  <td className="py-2 whitespace-nowrap">
                    <div className="tabular-nums">{m.businessDate}</div>
                    <div className="text-xs text-brand-300 tabular-nums">{shortTime(m.at)}</div>
                  </td>
                  <td className="py-2">
                    <div className="text-brand-500">{m.productName}</div>
                    {m.note && <div className="text-xs text-brand-300">{m.note}</div>}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    {REASON[m.reason] ?? m.reason}
                    {/* An oversell is the whole reason somebody opens this page,
                        so it is said on the row rather than left to be worked
                        out from a negative running total that is not shown. */}
                    {m.oversold === 1 && (
                      <div className="text-xs text-red-700 font-semibold">
                        sold below zero
                        {m.reviewedByName ? ` · reviewed by ${m.reviewedByName}` : ""}
                      </div>
                    )}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums font-semibold ${
                      m.qtyDelta < 0 ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                  </td>
                  {showCosts && (
                    <td className="py-2 pl-4 text-right tabular-nums text-brand-400">
                      {m.unitCostCents ? formatCents(m.unitCostCents) : "—"}
                    </td>
                  )}
                  <td className="py-2 pl-4 whitespace-nowrap text-brand-400">{m.saleNo ?? "—"}</td>
                  <td className="py-2 pl-4 whitespace-nowrap text-brand-400">{m.byName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
        </>
      )}
    </div>
  );
}
