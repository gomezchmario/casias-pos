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

type Data = DemandReport & {
  enabled: boolean;
  today: string;
  searched: {
    size: string;
    asks: number;
    onHand: number | null;
    complete: boolean;
  }[];
};

/** "August 2026", or the whole span when it is not one month. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthWords(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? month} ${y}`;
}

/**
 * The window the study is read over.
 *
 * Rolling windows first, then months. Ninety days is the default because that
 * is the span a tire order is decided against — long enough that a size asked
 * for twice is a pattern rather than a coincidence, short enough that it
 * describes the shop as it is now. "Everything so far" is kept for the
 * argument about whether a size has EVER been wanted, and the months are kept
 * because "what did we miss in June" is a real question with a real answer.
 */
const WINDOWS = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "Everything so far", days: 0 },
] as const;

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
  /** A WINDOWS key, or a "2026-08" month. Ninety days on arrival. */
  const [window_, setWindow] = useState<string>("90");
  const [data, setData] = useState<Data | null>(null);
  /** Whether the searched list shows the keystrokes too — off, like Reports. */
  const [showPartial, setShowPartial] = useState(false);
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    const rolling = WINDOWS.find((w) => w.key === window_);
    if (rolling && rolling.days > 0) {
      const d = new Date();
      d.setDate(d.getDate() - (rolling.days - 1));
      sp.set("from", d.toISOString().slice(0, 10));
    } else if (!rolling) {
      // A month. Day zero of the next month is the last day of this one — no
      // month-length table and no leap-year case.
      sp.set("from", `${window_}-01`);
      const d = new Date(`${window_}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      sp.set("to", d.toISOString().slice(0, 10));
    }
    // "all" sends nothing, and the route's own default is everything.
    const res = await fetch(`/api/pos/tire-demand?${sp}`);
    if (!res.ok) return;
    setData(await res.json());
  }, [window_]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("viewReports"))
    return <div className="text-brand-400">Your account can&apos;t see this report.</div>;

  const span =
    WINDOWS.find((w) => w.key === window_)?.label.toLowerCase() ??
    monthWords(window_);

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
            value={window_}
            onChange={(e) => setWindow(e.target.value)}
            aria-label="Window"
          >
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {tr(w.label)}
              </option>
            ))}
            <optgroup label={tr("One month")}>
              {recentMonths(new Date().toISOString().slice(0, 7)).map((m) => (
                <option key={m} value={m}>
                  {monthWords(m)}
                </option>
              ))}
            </optgroup>
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
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs uppercase tracking-wider text-brand-300">
                {tr("Searched for and not found")}
              </div>
              {/* The eye, exactly as it works on Reports: the register logs a
                  search per keystroke, so the debris is hidden until asked
                  for, and hidden from paper always. */}
              <button
                type="button"
                className="tdr-hide-on-print text-brand-300"
                aria-pressed={showPartial}
                title={
                  showPartial
                    ? tr("Showing half-typed searches as well as whole sizes")
                    : tr("Also show half-typed searches and other odd entries")
                }
                onClick={() => setShowPartial((v) => !v)}
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
                  <circle cx="12" cy="12" r="3.1" />
                  {!showPartial && <path d="M3.5 20.5 20.5 3.5" />}
                </svg>
              </button>
            </div>
            <p className="text-sm text-brand-400 mb-2">
              {tr("Sizes the register was asked for and could not show.")}
            </p>
            {data.searched.filter((r) => showPartial || r.complete).length === 0 ? (
              <div className="text-sm text-brand-300">{tr("Every search found a size we had.")}</div>
            ) : (
              <table className="w-full text-sm tdr-table" style={{ maxWidth: 560 }}>
                <thead>
                  <tr className="text-brand-300 text-xs uppercase tracking-wider">
                    <th className="text-left py-2 font-medium">{tr("Size")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Searches")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("On hand now")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.searched
                    .filter((r) => showPartial || r.complete)
                    .map((r, i) => (
                      <tr
                        key={r.size + i}
                        className={`border-t border-black/5${r.complete ? "" : " tdr-hide-on-print"}`}
                        style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                      >
                        <td className={`py-2 ${r.complete ? "font-medium text-brand-500" : "text-brand-300"}`}>
                          {r.size}
                          {!r.complete && (
                            <span className="text-xs"> · {tr("half-typed")}</span>
                          )}
                        </td>
                        <td className="py-2 pl-4 text-right tabular-nums">{r.asks}</td>
                        <td
                          className={`py-2 pl-4 text-right tabular-nums ${
                            r.onHand === null
                              ? "text-brand-300"
                              : r.onHand > 0
                                ? "text-green-700"
                                : "text-red-700 font-semibold"
                          }`}
                        >
                          {r.onHand === null ? tr("never carried") : r.onHand}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Screen only. The raw entries are what makes the study arguable —
              a summary whose rows cannot be inspected is one nobody can check —
              but the sheet that goes to a supplier is a buying document, and
              seventy-six lines of "who wrote this down and when" behind the
              two tables that answer the question is padding somebody has to
              flip past. It stays on screen, where arguing happens. */}
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 tdr-block tdr-hide-on-print">
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
