"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ALARM_ICON,
  ALARM_STYLE,
  alarmLevel,
  daysSinceDate,
  formatCheckDate,
  type InventoryCheck,
} from "@/lib/inventory-alarm";
import { TireQuote } from "@/components/pos/TireQuote";
import { formatCents } from "@/lib/money";
import { sizeMatches } from "@/lib/tire-size";
import "../pos/(shell)/inventory/inventory.css";

/**
 * The rack, for anybody, with no PIN.
 *
 * "Do we have a 215 55 17" is the most-asked question in the shop and the one
 * the old workbook answered worst. Putting it behind a login meant that in
 * practice it was answered by walking to the rack, so the answer people acted
 * on was whatever they remembered.
 *
 * Read-only in the strong sense: there is no write path on this page, and the
 * endpoint behind it hands out six fields per tire. What the shop paid, the
 * P-code and the supplier are not among them — see the whitelist in
 * `api/public/inventory/route.ts`, which is where that decision is enforced
 * rather than merely observed.
 *
 * Not a copy of the register's inventory screen, deliberately. That one carries
 * Edit, Count, Receive, low-stock flags and integrity warnings, all of which are
 * for people who can act on them. Here they would be furniture at best and an
 * invitation to go looking for the login at worst.
 */

type Tire = {
  id: number;
  name: string;
  brand: string | null;
  model: string | null;
  ply: string | null;
  price_cents: number;
  on_hand: number;
};

type Battery = { id: number; name: string; price_cents: number; on_hand: number };

type SizeGroup = { size: string; newTires: Tire[]; usedCount: number; total: number };

type RimSection = {
  key: string;
  rim: number | null;
  specialized: boolean;
  groups: SizeGroup[];
  total: number;
};

type Data = {
  sections: RimSection[];
  batteries: Battery[];
  /** Stock that is neither a tire nor a battery — TPMS sensors and the like. */
  misc: Battery[];
  lastCheck: InventoryCheck;
};

export default function PublicInventoryPage() {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState("");
  const [quoting, setQuoting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/inventory?all=${showEmpty ? "1" : "0"}`);
    if (!res.ok) {
      setError("Could not load the inventory");
      return;
    }
    setData(await res.json());
  }, [showEmpty]);

  /**
   * The sheet keeps itself current.
   *
   * This page is left open — on the phone at the bay, on a second screen at the
   * counter — and stock moves under it every time somebody completes a ticket.
   * A number that was true when the tab was opened this morning is worse than no
   * number: it is the same wrong answer the shop already had from memory, only
   * now it looks authoritative.
   *
   * Paused while the tab is out of sight, and asked again the moment it comes
   * back, so a screen sitting behind the register overnight is not polling a
   * closed shop every half minute — and so somebody switching to it gets the
   * fresh figures before they have finished reading the first line, rather than
   * up to thirty seconds later.
   *
   * Nothing on screen is disturbed by a refresh: the search box and the sold-out
   * tick are separate state and the list re-renders under them.
   */
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, [data]);

  const sections = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.sections;
    return data.sections
      .map((s) => ({
        ...s,
        groups: s.groups.filter(
          (g) =>
            sizeMatches(g.size, q) ||
            g.newTires.some((t) =>
              [t.name, t.brand, t.model].some((v) => v?.toLowerCase().includes(q)),
            ),
        ),
      }))
      .filter((s) => s.groups.length > 0);
  }, [data, query]);

  const batteries = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.batteries;
    return data.batteries.filter((b) => b.name.toLowerCase().includes(q));
  }, [data, query]);

  const misc = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.misc;
    return data.misc.filter((b) => b.name.toLowerCase().includes(q));
  }, [data, query]);

  const totals = useMemo(() => {
    const groups = sections.flatMap((s) => s.groups);
    return {
      sizes: groups.length,
      newCount: groups.reduce((s, g) => s + g.newTires.reduce((n, t) => n + t.on_hand, 0), 0),
      usedCount: groups.reduce((s, g) => s + Math.max(0, g.usedCount), 0),
    };
  }, [sections]);

  return (
    <div style={{ background: "#f4f6fa", minHeight: "100vh" }}>
      <div className="inv inv-public max-w-5xl mx-auto p-6">
        <div className="flex items-end justify-between mb-5 gap-4 flex-wrap no-print">
          <div>
            {/* The way back, drawn on the page. On an iPhone opened full
                screen there is no browser chrome, and a public board with no
                door out of it strands whoever tapped in from the clock. */}
            <a href="/" className="text-sm text-brand-300 hover:text-brand-500 hover:underline">
              ← Time clock
            </a>
            <h1 className="text-2xl font-semibold text-brand-500 mt-1">Inventory</h1>
            <p className="text-sm text-brand-400">
              What is on the racks right now. Look only — to change anything, sign in at
              the register.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="input"
              placeholder="Size or brand…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <label className="flex items-center gap-2 text-sm text-brand-400">
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.target.checked)}
              />
              Show sold out
            </label>
            {/* The quoter, on the board anyone can reach.
                Half the reason somebody walks up to this screen is a size the
                racks do not hold, and until now the answer to that was "go and
                find the register". It runs in its discreet form — see the note
                on `discreet` — because the person asking is usually standing
                right there reading it. */}
            {/* Filled, not the bare `.btn` it started as — which draws a
                transparent border on no background and reads as a line of text
                somebody happened to make clickable. This is the one thing on
                the board that DOES something, and on a screen whose whole
                promise is "look only" it has to announce itself as the
                exception rather than blend into the controls beside it. */}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setQuoting(true)}
            >
              Price a tire
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>

        <div className="print-only mb-3">
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            Casias Tire Shop — Inventory
          </div>
          <div style={{ fontSize: "9pt" }}>
            {printedAt} · {totals.sizes} sizes · {totals.newCount} new · {totals.usedCount} used
          </div>
        </div>

        {/*
          How much to trust the numbers below. This copy gets read by whoever is
          nearest a screen, which makes it the copy most likely to be read by
          somebody with no idea when the racks were last walked — so the line
          matters here more than it does at the register, not less.
        */}
        {data && (
          <div
            className="inv-check flex items-center gap-3 mb-4 rounded-lg px-3 py-2 text-sm"
            style={ALARM_STYLE[alarmLevel(data.lastCheck)]}
          >
            <span className="text-brand-400">
              {ALARM_ICON[alarmLevel(data.lastCheck)] && (
                <span className="mr-1.5" aria-hidden="true">
                  {ALARM_ICON[alarmLevel(data.lastCheck)]}
                </span>
              )}
              <strong className="text-brand-500">Last physical inventory check:</strong>{" "}
              {data.lastCheck.date ? (
                <>
                  {formatCheckDate(data.lastCheck.date)}
                  {data.lastCheck.by && ` · ${data.lastCheck.by}`}
                  {(() => {
                    const n = daysSinceDate(data.lastCheck.date);
                    return n <= 0 ? " · today" : ` · ${n} ${n === 1 ? "day" : "days"} ago`;
                  })()}
                </>
              ) : (
                <span className="text-amber-800">never recorded</span>
              )}
              {/* No "alarm cleared" note — same reasoning as the register's
                  copy, and doubly so here: who silenced an internal alarm is
                  shop business, and this sheet is read by customers. */}
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 no-print">
            {error}
          </div>
        )}

        {data && (
          <div className="text-sm text-brand-400 mb-3 no-print">
            {totals.sizes} sizes · {totals.newCount} new · {totals.usedCount} used
          </div>
        )}

        {sections.map((s) => (
          <div key={s.key} className="inv-section">
            <div className="inv-rim flex items-baseline gap-3 mt-5 mb-2">
              <h2 className="text-xl font-bold text-brand-500 tabular-nums">
                {s.specialized ? "18-wheeler & specialty" : `${s.key}"`}
              </h2>
              <span className="text-xs text-brand-300">
                {s.groups.length} {s.groups.length === 1 ? "size" : "sizes"} · {s.total} on hand
              </span>
            </div>

            <div className="inv-groups">
              {s.groups.map((g) => (
                <section key={g.size} className="inv-group bg-white rounded-xl shadow-sm p-4 mb-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <h2 className="inv-size text-lg font-semibold text-brand-500 tabular-nums">
                      {g.size}
                    </h2>
                    <span className="text-xs text-brand-300 no-print">{g.total} on hand</span>
                  </div>

                  {g.newTires.length > 0 && (
                    <table className="inv-table w-full text-sm">
                      <tbody>
                        {g.newTires.map((t) => (
                          <tr key={t.id} className="border-t border-black/5">
                            <td className="inv-c-name py-1">
                              <span className="inv-tire-name text-brand-500">
                                {[t.brand, t.model].filter(Boolean).join(" ") || t.name}
                              </span>
                              {t.ply && <span className="text-brand-300 text-xs"> · {t.ply}</span>}
                            </td>
                            <td className="inv-c-price py-1 text-right tabular-nums text-brand-400 w-20">
                              {formatCents(t.price_cents)}
                            </td>
                            <td
                              className={`inv-c-qty py-1 text-right tabular-nums w-12 font-semibold ${
                                t.on_hand < 0 ? "text-red-700" : "text-brand-500"
                              }`}
                            >
                              {t.on_hand}
                            </td>
                            <td className="inv-c-note py-1 text-right w-8 print-only">
                              <span className="inv-count-box">&nbsp;</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* One line, no detail, and absent entirely at zero — a used
                      tire is a size and a count and nothing else. */}
                  {g.usedCount !== 0 && (
                    <div className="flex items-center justify-between text-sm border-t border-black/5 pt-1 mt-1">
                      <span className="text-brand-400">Used</span>
                      <span className="flex items-center gap-3">
                        <span
                          className={`tabular-nums font-semibold ${
                            g.usedCount < 0 ? "text-red-700" : "text-brand-500"
                          }`}
                        >
                          {g.usedCount}
                        </span>
                        <span className="print-only inv-count-box">&nbsp;</span>
                      </span>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        ))}

        {batteries.length > 0 && (
          <div className="inv-section">
            <div className="inv-rim flex items-baseline gap-3 mt-5 mb-2">
              <h2 className="text-xl font-bold text-brand-500">Batteries</h2>
              <span className="text-xs text-brand-300">
                {batteries.reduce((s, b) => s + b.on_hand, 0)} on hand
              </span>
            </div>

            <section className="inv-group bg-white rounded-xl shadow-sm p-4 mb-3">
              <table className="inv-table w-full text-sm">
                <tbody>
                  {batteries.map((b) => (
                    <tr key={b.id} className="border-t border-black/5 first:border-t-0">
                      <td className="inv-c-name py-1">
                        <span className="inv-tire-name text-brand-500">
                          {b.name.replace(/^BATTERY\s+/i, "")}
                        </span>
                      </td>
                      <td className="inv-c-price py-1 text-right tabular-nums text-brand-400 w-20">
                        {formatCents(b.price_cents)}
                      </td>
                      <td
                        className={`inv-c-qty py-1 text-right tabular-nums w-12 font-semibold ${
                          b.on_hand < 0 ? "text-red-700" : "text-brand-500"
                        }`}
                      >
                        {b.on_hand}
                      </td>
                      <td className="inv-c-note py-1 text-right w-8 print-only">
                        <span className="inv-count-box">&nbsp;</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {/* Miscellaneous, after the batteries. Same reasoning: stock that has
            no rim and belongs on no rack. Names print whole here — unlike the
            battery rows, which drop a "BATTERY" prefix the heading above
            already said. */}
        {misc.length > 0 && (
          <div className="inv-section">
            <div className="inv-rim flex items-baseline gap-3 mt-5 mb-2">
              <h2 className="text-xl font-bold text-brand-500">Miscellaneous</h2>
              <span className="text-xs text-brand-300">
                {misc.reduce((s, b) => s + b.on_hand, 0)} on hand
              </span>
            </div>

            <section className="inv-group bg-white rounded-xl shadow-sm p-4 mb-3">
              <table className="inv-table w-full text-sm">
                <tbody>
                  {misc.map((b) => (
                    <tr key={b.id} className="border-t border-black/5 first:border-t-0">
                      <td className="inv-c-name py-1">
                        <span className="inv-tire-name text-brand-500">{b.name}</span>
                      </td>
                      <td className="inv-c-price py-1 text-right tabular-nums text-brand-400 w-20">
                        {formatCents(b.price_cents)}
                      </td>
                      <td
                        className={`inv-c-qty py-1 text-right tabular-nums w-12 font-semibold ${
                          b.on_hand < 0 ? "text-red-700" : "text-brand-500"
                        }`}
                      >
                        {b.on_hand}
                      </td>
                      <td className="inv-c-note py-1 text-right w-8 print-only">
                        <span className="inv-count-box">&nbsp;</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {data && totals.sizes === 0 && batteries.length === 0 && misc.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-brand-300">
            {query
              ? `Nothing on the racks matches "${query}".`
              : showEmpty
                ? "No products yet."
                : "Nothing in stock. Tick “Show sold out” to see products with no stock."}
          </div>
        )}

        {!data && !error && <div className="text-brand-300">Loading…</div>}
      </div>

      <TireQuote
        open={quoting}
        onClose={() => setQuoting(false)}
        discreet
        defaults={null}
        remoteQuote={quotePublicly}
      />
    </div>
  );
}

/**
 * Ask the server what to charge.
 *
 * Module scope, not inside the component: a function rebuilt on every render
 * would be a new dependency for the quoter's debounce effect every time, which
 * restarts the timer on each keystroke and means the request never fires.
 */
async function quotePublicly(costCents: number, freightCents: number) {
  const res = await fetch("/api/public/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ costCents, freightCents }),
  });
  if (!res.ok) throw new Error("quote failed");
  return res.json();
}
