"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import type { ProductCondition, ProductKind } from "@/lib/products";

export type FoundProduct = {
  id: number;
  sku: string;
  name: string;
  kind: ProductKind;
  tire_size: string | null;
  brand: string | null;
  model: string | null;
  condition: ProductCondition | null;
  price_cents: number;
  default_cost_cents: number | null;
  track_inventory: number;
  specialized: number;
  supplier: string | null;
  on_hand: number;
};

/**
 * A row under the matches that is a thing to DO rather than a thing to sell.
 *
 * The counter's two commonest tire questions have no product to find: a used
 * tire in that size, which may never have been given a row because used stock
 * turns up out of nowhere, and a new tire the shop does not carry and is about
 * to order in. Both used to be answered somewhere other than here — one not at
 * all, one by a link above the box — and both are asked at the exact moment the
 * search comes back short. So they are answered in the list, under the misses,
 * where somebody is already looking.
 */
export type SearchAction = {
  /** Stable per action, not per render: it keys the row and the cursor. */
  key: string;
  label: string;
  hint?: string;
  run: () => void;
};

/**
 * Type to find stock.
 *
 * Replaces a dropdown, which stopped being usable somewhere around the two
 * hundredth tire: the list is long, and the person using it already knows the
 * size they are holding. Typing "215 55 17" or "vantage" is how they think
 * about it, and the server already normalises tire sizes so any punctuation
 * finds the same row.
 *
 * Deliberately does not fire on the first keystroke. Every fruitless search is
 * logged as purchasing signal, and a request per character would fill that
 * table with the prefixes of successful searches rather than the sizes the shop
 * could not sell.
 */
export function ProductSearch({
  onPick,
  placeholder = "Search tires and stock…",
  autoFocus = false,
  showStock = true,
  filter,
  clearOnPick = true,
  actions,
}: {
  onPick: (p: FoundProduct) => void;
  placeholder?: string;
  autoFocus?: boolean;
  showStock?: boolean;
  /** Narrow the list — Receive stock only wants things it can receive, and the
   *  register can be told to leave out anything the racks are empty of.
   *  Applied when the list is drawn rather than when it is fetched, so flipping
   *  a filter re-cuts the results already on screen instead of needing a
   *  keystroke to take effect. */
  filter?: (p: FoundProduct) => boolean;
  clearOnPick?: boolean;
  /** Given what was typed and the rows actually on screen, so an action can
   *  stand down when a real product already covers it — offering "sell a used
   *  215-55-16" directly underneath the used 215-55-16 is two answers to one
   *  question, and the counter has to stop and work out which is which. */
  actions?: (query: string, shown: FoundProduct[]) => SearchAction[];
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoundProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = q.trim();
    if (raw.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Long enough that a fast typist sends one request per word, short enough
    // that the list feels like it is keeping up.
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pos/products?q=${encodeURIComponent(raw)}`);
        if (!res.ok) return;
        const d = (await res.json()) as { products: FoundProduct[] };
        setResults(d.products);
        setActive(0);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function pick(p: FoundProduct) {
    onPick(p);
    setOpen(false);
    if (clearOnPick) {
      setQ("");
      setResults([]);
    } else {
      setQ(p.name);
    }
  }

  const shown = filter ? results.filter(filter) : results;
  const acts = actions ? actions(q.trim(), shown) : [];
  // Products and actions are one list to the arrow keys. Anything else means a
  // second, invisible rule about where the cursor stops, and the only way to
  // learn it is to press Down and watch nothing happen.
  const rows = shown.length + acts.length;
  // Clamps rather than resets: hiding the row the cursor was on should leave it
  // on the last row, not fling it back to the top of a list someone is reading.
  const activeIndex = Math.min(active, Math.max(0, rows - 1));

  function runAction(a: SearchAction) {
    a.run();
    setOpen(false);
    setQ("");
    setResults([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || rows === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, rows - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex < shown.length) pick(shown[activeIndex]);
      else runAction(acts[activeIndex - shown.length]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input w-full"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => rows > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-300">
          …
        </div>
      )}

      {open && (
        <div
          className="absolute z-30 left-0 mt-1 bg-white rounded-xl shadow-lg overflow-y-auto"
          // Allowed to be wider than the box it hangs off. The register puts a
          // quantity and a mechanic next to this input, which leaves it narrow
          // enough to truncate "LANDSAIL LS588 215-35-19" down to a brand
          // fragment -- and a list of brand fragments is not a list you can pick
          // a tire from.
          style={{
            maxHeight: 320,
            minWidth: "min(420px, 90vw)",
            width: "100%",
            border: "1px solid rgba(10,37,64,0.1)",
          }}
        >
          {shown.length === 0 &&
            // Two different nothings. A search that genuinely found no such
            // product is purchasing signal and gets logged as such; a search
            // whose matches were all filtered off the screen is not, and saying
            // "noted for purchasing" there would be a lie about what was
            // recorded.
            (results.length > 0 ? (
              <div className="px-3 py-3 text-sm text-brand-300">
                {results.length} match{results.length === 1 ? "" : "es"}, all hidden.
              </div>
            ) : (
              <div className="px-3 py-3 text-sm text-brand-300">
                Nothing matches “{q.trim()}”. It has been noted for purchasing.
              </div>
            ))}

          {shown.map((p, i) => {
              const tracked = p.track_inventory === 1;
              const out = tracked && p.on_hand <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 flex items-center gap-3"
                  style={{ background: i === activeIndex ? "rgba(10,37,64,0.05)" : undefined }}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(p)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-brand-500 truncate">
                      {p.name}
                      {p.condition === "used" && (
                        <span className="ml-2 text-xs text-brand-300 uppercase">used</span>
                      )}
                      {p.specialized === 1 && (
                        <span className="ml-2 text-xs text-brand-300 uppercase">specialty</span>
                      )}
                    </div>
                    <div className="text-xs text-brand-300 truncate">
                      {p.tire_size ?? p.sku}
                      {p.supplier ? ` · ${p.supplier}` : ""}
                    </div>
                  </div>
                  {showStock && tracked && (
                    <div
                      className="text-xs tabular-nums whitespace-nowrap"
                      style={{ color: out ? "#b91c1c" : "#4f6e8e" }}
                    >
                      {out ? "none" : `${p.on_hand} left`}
                    </div>
                  )}
                  <div className="text-sm tabular-nums text-brand-500 whitespace-nowrap">
                    {/* A used size carries no price -- it is set at the counter
                        from the tire's condition, so there is nothing to show. */}
                    {p.price_cents > 0 ? formatCents(p.price_cents) : "—"}
                  </div>
                </button>
              );
            })}

          {/* Under the matches, never above them. Nine times in ten the tire is
              on the rack and the first row is the answer, and a list whose top
              row is a form to fill in is a list that has made the common case
              pay for the rare one. */}
          {acts.map((a, i) => {
            const idx = shown.length + i;
            return (
              <button
                key={a.key}
                type="button"
                className="w-full text-left px-3 py-2"
                style={{
                  background: idx === activeIndex ? "rgba(10,37,64,0.05)" : undefined,
                  // Dashed, and only above the first one: it fences the actions
                  // off from the tires as a group, so nothing in here can be
                  // mistaken for something already on the racks.
                  borderTop: i === 0 ? "1px dashed rgba(10,37,64,0.18)" : undefined,
                }}
                onMouseEnter={() => setActive(idx)}
                onClick={() => runAction(a)}
              >
                <div className="text-sm text-brand-500">
                  <span className="text-brand-300 mr-1.5">+</span>
                  {a.label}
                </div>
                {a.hint && <div className="text-xs text-brand-300">{a.hint}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
