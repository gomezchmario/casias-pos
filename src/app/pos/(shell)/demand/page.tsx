"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ShopLogo } from "@/components/ui/ShopLogo";
import type { DemandReport } from "@/lib/tire-demand";
import "./demand.css";
import { useLang } from "@/components/pos/LangToggle";

/**
 * The tire study: what the shop was asked for and could not sell.
 *
 * A buying document, not a sales report, and it is built to be read by somebody
 * about to spend money. So the first table is ranked by TIRES rather than by how
 * often a size came up — four tires wanted once is a purchase, one tire wanted
 * four times is a conversation — and both figures are on the row so the reader
 * can tell which they are looking at.
 *
 * The column that stops it being read wrong is **On hand**. A size asked for
 * eleven times with six on the rack today is not a buying signal; it is a size
 * the shop already fixed. Without it that row would sit at the top of the list
 * for the rest of the year.
 *
 * Every entry is printed underneath, because a study whose raw rows are not
 * visible is a study nobody can argue with — and the argument is the point. The
 * counter's own note is on each one.
 */

type Data = DemandReport & { enabled: boolean; today: string };

/** "August 2026", or the whole span when it is not one month. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthWords(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? month} ${y}`;
}

function recentMonths(from: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}-01T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export default function TireDemandPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  /** Empty means everything, which is the default — see the route. */
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (month) {
      sp.set("from", `${month}-01`);
      // Day zero of the next month is the last day of this one — no month-length
      // table and no leap-year case.
      const d = new Date(`${month}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      sp.set("to", d.toISOString().slice(0, 10));
    }
    const res = await fetch(`/api/pos/tire-demand?${sp}`);
    if (!res.ok) return;
    setData(await res.json());
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("viewReports"))
    return <div className="text-brand-400">Your account can&apos;t see this report.</div>;

  const span = month ? monthWords(month) : "everything recorded so far";

  return (
    <div className="max-w-5xl mx-auto tdr">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 tdr-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">
            Tires we didn&apos;t have
          </h1>
          <p className="text-brand-400 text-sm">
            Sizes customers asked for and left without. Recorded at the counter,
            as it happened.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Month"
          >
            <option value="">Everything so far</option>
            {recentMonths(new Date().toISOString().slice(0, 7)).map((m) => (
              <option key={m} value={m}>
                {monthWords(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data}
            onClick={() => window.print()}
          >{tr("Print")}</button>
          <Link href="/pos/settings" className="btn btn-outline">
            ← Settings
          </Link>
        </div>
      </div>

      {/* On paper only. A sheet taken to a supplier has to say whose shop it
          came from and what period it covers; the screen says both in the
          controls above, and the page itself says neither. */}
      <div className="tdr-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            Tires asked for and not in stock
          </div>
          <div style={{ fontSize: "9pt" }}>
            {span} · printed {printedOn}
          </div>
        </div>
      </div>

      {data && !data.enabled && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 tdr-hide-on-print">
          The study is switched off, so nothing new is being recorded. What is
          below is what was collected while it was running.
        </div>
      )}

      {!data ? (
        <div className="text-brand-300 py-10 text-center">Adding it up…</div>
      ) : data.sizes.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-brand-300 tdr-block">
          Nothing has been recorded for {span}.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 tdr-block">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{tr("Most asked for")}</div>
            <table className="w-full text-sm tdr-table">
              <thead>
                <tr className="text-brand-300 text-xs uppercase tracking-wider">
                  <th className="text-left py-2 font-medium">{tr("Size")}</th>
                  <th className="text-right py-2 font-medium pl-4">{tr("Tires wanted")}</th>
                  <th className="text-right py-2 font-medium pl-4">{tr("Customers")}</th>
                  <th className="text-right py-2 font-medium pl-4">{tr("On hand now")}</th>
                  <th className="text-right py-2 font-medium pl-4">{tr("Last asked")}</th>
                </tr>
              </thead>
              <tbody>
                {data.sizes.map((s, i) => (
                  <tr
                    key={s.sizeNorm}
                    className="border-t border-black/5"
                    style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                  >
                    <td className="py-2 font-medium text-brand-500">
                      {s.sizeNorm}
                      {/* What somebody actually typed, when it differs. The
                          shop's own shorthand is worth reading back — it is how
                          the size gets asked for over the counter. */}
                      {s.sizeRaw && s.sizeRaw !== s.sizeNorm && (
                        <span className="text-brand-300 text-xs"> · &ldquo;{s.sizeRaw}&rdquo;</span>
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums font-semibold">{s.tires}</td>
                    <td className="py-2 pl-4 text-right tabular-nums text-brand-400">{s.asks}</td>
                    {/* The column that decides whether a row is a buying signal.
                        Stock since bought in reads green — the shop already
                        answered this one and it should stop shouting. */}
                    <td
                      className={`py-2 pl-4 text-right tabular-nums ${
                        s.onHand === null
                          ? "text-brand-300"
                          : s.onHand > 0
                            ? "text-green-700"
                            : "text-red-700 font-semibold"
                      }`}
                    >
                      {s.onHand === null ? "never carried" : s.onHand}
                    </td>
                    <td className="py-2 pl-4 text-right tabular-nums text-brand-300">
                      {s.lastAsked}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/20 font-semibold">
                  <td className="py-2">
                    {data.totals.sizes} size{data.totals.sizes === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 pl-4 text-right tabular-nums">{data.totals.tires}</td>
                  <td className="py-2 pl-4 text-right tabular-nums">{data.totals.asks}</td>
                  <td className="py-2 pl-4" colSpan={2} />
                </tr>
              </tfoot>
            </table>

            <p className="text-sm text-brand-400 mt-3 tdr-summary">
              {data.totals.tires} tire{data.totals.tires === 1 ? "" : "s"} across{" "}
              {data.totals.asks} customer{data.totals.asks === 1 ? "" : "s"} walked
              out over {span}
              {data.sizes.filter((s) => s.onHand === null || s.onHand <= 0).length > 0 && (
                <>
                  {" "}
                  ·{" "}
                  {data.sizes.filter((s) => s.onHand === null || s.onHand <= 0).length} of
                  these sizes still has nothing on the rack
                </>
              )}
              .
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 tdr-block">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
              Every one, as it was written
            </div>
            <table className="w-full text-sm tdr-table">
              <tbody>
                {data.entries.map((e, i) => (
                  <tr
                    key={e.id}
                    className="border-t border-black/5"
                    style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                  >
                    <td className="py-1.5 whitespace-nowrap tabular-nums text-brand-300">
                      {e.businessDate}
                    </td>
                    <td className="py-1.5 pl-4 text-brand-500 font-medium">
                      {e.qty > 1 ? `${e.qty}× ` : ""}
                      {e.sizeRaw}
                    </td>
                    <td className="py-1.5 pl-4 text-brand-400">
                      {e.note ?? ""}
                      <div className="text-xs text-brand-300">{e.byName}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tdr-note">
            This is what the counter wrote down, not everything that happened. It
            is a floor on lost demand, never a ceiling — the sizes nobody had time
            to record are missing from it.
          </div>
        </>
      )}
    </div>
  );
}
