"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import type { WebSearchSize } from "@/lib/products";
import "../reports/reports.css";

/**
 * What people have looked for on the website.
 *
 * ITS OWN PAGE, not a panel on the reports screen, and that is the owner's
 * call: the reports page already carries the counter's two lists of what
 * walked out, and a third list of the same shape would blur three different
 * kinds of evidence into one wall. This is a different room, reached by a
 * link.
 *
 * WHAT MAKES IT DIFFERENT FROM THE COUNTER'S LISTS. Those are people standing
 * in the shop. This is people at home, at night, on a phone — a customer who
 * has not decided to come yet, and who never spoke to anybody. That is why
 * the sizes we DID have are kept on the page rather than filtered away: they
 * say what brings people to the website at all, which the counter's studies
 * cannot see.
 *
 * The archive behind it is described in migrations/048_web_searches.sql. It
 * holds no customer, no address and no session — a size, an answer and a date,
 * with the same size ignored if it is typed twice inside a minute.
 */

type Row = WebSearchSize;
type Data = {
  from: string;
  to: string;
  today: string;
  sizes: Row[];
  totals: { asks: number; sizes: number; yes: number; no: number; incomplete: number };
};

/** Business dates, `back` days ago — the windows this page is read over. */
function daysAgo(back: number): string {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}

const WINDOWS: { key: string; label: string; from: () => string | null }[] = [
  { key: "all", label: "Everything so far", from: () => null },
  { key: "90", label: "Last 90 days", from: () => daysAgo(90) },
  { key: "30", label: "Last 30 days", from: () => daysAgo(30) },
  { key: "7", label: "Last 7 days", from: () => daysAgo(7) },
];

export default function WebSearchesPage() {
  const { can } = usePosAuth();
  const { t: tr } = useLang();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [window_, setWindow] = useState("all");

  const load = useCallback(async () => {
    const w = WINDOWS.find((x) => x.key === window_);
    const from = w?.from() ?? null;
    const res = await fetch(`/api/pos/web-searches${from ? `?from=${from}` : ""}`);
    if (!res.ok) {
      setError("Could not load the searches");
      return;
    }
    setError(null);
    setData(await res.json());
  }, [window_]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("viewReports"))
    return <div className="rp-note">{tr("Your account does not read reports.")}</div>;

  return (
    <div className="max-w-5xl mx-auto rp">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">
            {tr("Looked for on the website")}
          </h1>
          <p className="text-brand-400 text-sm">
            {tr(
              "Sizes people typed into the stock search on the website, and what it told them.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={window_}
            onChange={(e) => setWindow(e.target.value)}
            aria-label={tr("Window")}
          >
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {tr(w.label)}
              </option>
            ))}
          </select>
          <Link href="/pos/reports" className="btn btn-outline">
            {tr("Back to reports")}
          </Link>
        </div>
      </div>

      {error && <div className="rp-note rp-note-warn">{error}</div>}

      {data && (
        <>
          <div className="rp-stats">
            <Stat label={tr("Times searched")} value={String(data.totals.asks)} />
            <Stat label={tr("Different sizes")} value={String(data.totals.sizes)} />
            {/* The two that decide whether this page is a shopping list. */}
            <Stat label={tr("We had it")} value={String(data.totals.yes)} />
            <Stat label={tr("We did not")} value={String(data.totals.no)} />
          </div>

          {data.sizes.length === 0 ? (
            <div className="rp-note">
              {tr(
                "Nobody has searched the website in this window. The box went up recently — give it a few days.",
              )}
            </div>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>{tr("Size")}</th>
                  <th className="num">{tr("Times")}</th>
                  <th className="num">{tr("We had it")}</th>
                  <th className="num">{tr("We did not")}</th>
                  <th className="num">{tr("On the rack now")}</th>
                  <th>{tr("Last asked")}</th>
                </tr>
              </thead>
              <tbody>
                {data.sizes.map((s) => (
                  <tr key={s.sizeNorm}>
                    <td>
                      {s.sizeNorm}
                      {/* Only when it differs from the tidy form, so the column
                          stays quiet on the ordinary rows and speaks up on
                          "2055516" — which is how somebody typed it, and worth
                          seeing once. */}
                      {s.query !== s.sizeNorm && (
                        <span className="rp-stat-sub"> {tr("typed")} “{s.query}”</span>
                      )}
                    </td>
                    <td className="num">{s.times}</td>
                    <td className="num">{s.yes || "—"}</td>
                    <td className="num">{s.no || "—"}</td>
                    <td className="num">
                      {/* Null means the shop has never carried the size at all,
                          which is a different answer from having none today. */}
                      {s.onHand === null ? tr("never carried") : s.onHand}
                    </td>
                    <td>{s.lastAsked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.totals.incomplete > 0 && (
            <p className="rp-note">
              {tr("Not counted above:")} {data.totals.incomplete}{" "}
              {tr(
                "searches where only part of a size was typed. The website refuses those rather than guessing, and they are kept because what people fail to type is worth reading too.",
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rp-stat">
      <div className="rp-stat-lab">{label}</div>
      <div className="rp-stat-val">{value}</div>
    </div>
  );
}
