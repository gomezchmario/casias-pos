"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ProductSearch, type FoundProduct } from "@/components/pos/ProductSearch";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { TireQuote, type QuoteDefaults } from "@/components/pos/TireQuote";
import {
  ALARM_ICON,
  ALARM_STYLE,
  alarmLevel,
  daysSinceDate,
  formatCheckDate,
  type InventoryCheck,
} from "@/lib/inventory-alarm";
import { formatCents, parseCents } from "@/lib/money";
import { looksSpecialized } from "@/lib/tire-size";
import "./inventory.css";

type Tire = {
  id: number;
  name: string;
  sku: string;
  /** "tire" for everything in a rim section; "part" for the battery shelf. */
  kind: "tire" | "part" | "service" | "fee";
  brand: string | null;
  model: string | null;
  ply: string | null;
  condition: "new" | "used" | null;
  price_cents: number;
  /** Owner only. Null for everyone else — stripped server-side, not hidden here. */
  default_cost_cents: number | null;
  /**
   * The "P140" suffix, pre-rendered by the server for callers with
   * `viewCostCode`. Null when they may not see it, when the cost is zero, and
   * always for batteries. Never derived from `default_cost_cents` on this side.
   */
  cost_code: string | null;
  reorder_point: number;
  supplier: string | null;
  on_hand: number;
};

type SizeGroup = {
  size: string;
  newTires: Tire[];
  usedCount: number;
  usedProductId: number | null;
  total: number;
};

/** A rim heading — "15", "16" — or the specialty block at the end. */
type RimSection = {
  key: string;
  rim: number | null;
  specialized: boolean;
  groups: SizeGroup[];
  total: number;
};

type PricingFlag = {
  productId: number;
  name: string;
  size: string | null;
  onHand: number;
  priceCents: number;
  costCents: number | null;
};

type Data = {
  sections: RimSection[];
  batteries: Tire[];
  lastCheck: InventoryCheck;
  showCosts: boolean;
  lowStock: number;
  integrityIssues: { lotId: number; lotNo: string; issue: string }[];
  /** Null for anyone below manager — the server does not send it at all. */
  pricing: { noPrice: PricingFlag[]; belowCost: PricingFlag[] } | null;
  /** Null unless the caller may quote. Starting values only — see TireQuote. */
  quoteDefaults: QuoteDefaults | null;
};

type Sheet =
  | { mode: "receive"; product?: Tire; size?: string; used?: boolean }
  | { mode: "count"; product: Tire; size: string }
  | { mode: "edit"; product: Tire; size: string }
  | null;

export default function InventoryPage() {
  const { can, user } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState("");
  const [checking, setChecking] = useState(false);
  const [confirmingCheck, setConfirmingCheck] = useState(false);
  // Shut on arrival every time, deliberately not remembered. See the panel.
  const [pricingOpen, setPricingOpen] = useState(false);
  const [quoting, setQuoting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/inventory?all=${showEmpty ? "1" : "0"}`);
    if (!res.ok) {
      setError("Could not load inventory");
      return;
    }
    setData(await res.json());
  }, [showEmpty]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stamped on the printout so a sheet found on a bench next week is not
  // mistaken for today's counts.
  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, [data]);

  // Search filters the sizes, then drops any rim heading left with nothing
  // under it — an empty "17" heading is a lie about what is on the rack.
  const sections = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.sections;
    return data.sections
      .map((s) => ({
        ...s,
        groups: s.groups.filter(
          (g) =>
            g.size.toLowerCase().includes(q) ||
            g.newTires.some((t) =>
              [t.name, t.brand, t.model, t.sku].some((v) => v?.toLowerCase().includes(q)),
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

  // Confirmed, because this button is a claim about the physical world: that
  // somebody walked the racks and counted them. Everything else on this screen
  // is a fact derived from the ledger and a stray click cannot make it lie —
  // this one can, and the resulting lie is invisible. A sheet reading "checked
  // today" when nobody checked is strictly worse than one reading "never", as
  // the second is honest about knowing nothing.
  //
  // Found the hard way: two accidental clicks during testing wrote two counts
  // that never happened, and the only reason they were caught is that someone
  // happened to read the audit log.
  async function markChecked() {
    setChecking(true);
    const res = await fetch("/api/pos/inventory", { method: "POST" });
    setChecking(false);
    setConfirmingCheck(false);
    if (!res.ok) {
      setError("Could not record the check");
      return;
    }
    void load();
  }

  const totals = useMemo(() => {
    const groups = sections.flatMap((s) => s.groups);
    const newCount = groups.reduce((s, g) => s + g.newTires.reduce((n, t) => n + t.on_hand, 0), 0);
    const usedCount = groups.reduce((s, g) => s + Math.max(0, g.usedCount), 0);
    return { newCount, usedCount, sizes: groups.length };
  }, [sections]);

  return (
    <div className="inv max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">Inventory</h1>
          <p className="text-sm text-brand-400">
            Everything on the racks, by size.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="input"
            placeholder="Size or brand…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-brand-400">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
            />
            Show sold out
          </label>
          {/* `btn` on its own has a transparent background and a transparent
              border, so on this white page it rendered as a word rather than
              something to press. These two are real actions and are styled as
              such. */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
          >
            Print
          </button>
          {/* Sits on the inventory page because "do we have it, and if not what
              would it cost" is one question asked in one breath. */}
          {data?.quoteDefaults && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setQuoting(true)}
            >
              Price a tire
            </button>
          )}
          {can("receiveInventory") && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setSheet({ mode: "receive" })}
            >
              + Receive stock
            </button>
          )}
        </div>
      </div>

      {/* The screen has a header; the printout needs its own. */}
      <div className="print-only mb-3">
        <div style={{ fontWeight: 700, fontSize: "13pt" }}>Casias Tire Shop — Inventory</div>
        <div style={{ fontSize: "9pt" }}>
          {printedAt} · {totals.sizes} sizes · {totals.newCount} new · {totals.usedCount} used
        </div>
      </div>

      {/*
        When the racks were last actually walked and counted.

        On the sheet as well as the screen, and that is the more important of
        the two: a printed inventory has no other way of saying how much to
        trust itself. "Counted three days ago" and "counted in March" are the
        same document otherwise, and only one of them is worth ordering from.
      */}
      {data && (
        <div
          className="inv-check flex items-center justify-between gap-3 mb-4 rounded-lg px-3 py-2 text-sm"
          // Green, then yellow, then red — see `alarmLevel`. The colour is the
          // only part of this line anybody reads from across the room, so it
          // carries the whole message: a sheet nobody has checked in a
          // fortnight should not look the same as one counted yesterday.
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
                {/* The age, spelled out. A date alone makes the reader do
                    subtraction, and the whole point of the line is the answer
                    to that subtraction. */}
                {(() => {
                  const n = daysSinceDate(data.lastCheck.date);
                  if (n <= 0) return " · today";
                  return ` · ${n} ${n === 1 ? "day" : "days"} ago`;
                })()}
              </>
            ) : (
              <span className="text-amber-800">never recorded</span>
            )}
            {/*
              No "alarm cleared" note here, deliberately. This line answers one
              question — how old is the number on this sheet — and the answer is
              the date, which clearing never moves. Who silenced the colour is a
              question about the shop, not about the stock, and it is answered on
              the settings page next to the button that did it, where somebody
              looking for it will actually look.
            */}
          </span>
          {can("adjustInventory") && (
            <button
              type="button"
              className="btn btn-ghost no-print whitespace-nowrap"
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
              onClick={() => setConfirmingCheck(true)}
              disabled={checking}
            >
              {checking ? "Saving…" : "Counted today"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 no-print">
          {error}
        </div>
      )}

      {data && data.integrityIssues.length > 0 && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-800 no-print">
          <strong>Stock records disagree with themselves.</strong> This is a bug, not
          something to fix by recounting — please report it.
          <ul className="mt-1 list-disc pl-5">
            {data.integrityIssues.map((i) => (
              <li key={i.lotId}>
                Lot {i.lotNo}: {i.issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Pricing warnings. Manager and up: `data.pricing` is null for everyone
        else because the server never sent it, so there is nothing here for a
        cashier to reveal by poking at the page.

        `no-print` on purpose, and it is the point rather than an oversight. The
        printable sheet is the one that gets carried around the racks and left
        on the counter, and "priced below cost" is the last line the shop wants
        a customer reading upside down. This lives on the screen, in the office.
      */}
      {data?.pricing && (data.pricing.noPrice.length > 0 || data.pricing.belowCost.length > 0) && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm no-print">
          {/*
            Shut by default, and the lists only render when it is open.

            The warning is a standing one — a shop of five hundred products has
            a handful priced wrong at any given moment, and fixing them is an
            afternoon's work somebody schedules, not something done between two
            customers. Left expanded, thirty lines of it sit above the stock
            sheet every single time the page loads, and within a week nobody
            reads past it; they scroll. A banner people scroll past is worse
            than no banner, because it also buries the thing underneath it.

            One line stays visible so the fact of it is never hidden. Opening it
            is the deliberate act of somebody who has decided to deal with it.
          */}
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left font-semibold text-amber-900"
            onClick={() => setPricingOpen((v) => !v)}
            aria-expanded={pricingOpen}
          >
            <span
              aria-hidden="true"
              className="inline-block transition-transform"
              style={{ transform: pricingOpen ? "rotate(90deg)" : "none" }}
            >
              ▶
            </span>
            Pricing needs a look
            <span className="font-normal text-amber-700"> · managers only</span>
          </button>

          {pricingOpen && (
          <div className="mt-2">

          {data.pricing.noPrice.length > 0 && (
            <div className="mb-2">
              <div className="text-amber-900">
                <strong>{data.pricing.noPrice.length}</strong> on the rack with no price. The
                register will ring these at $0 until somebody sets one.
              </div>
              <ul className="mt-1 list-disc pl-5 text-amber-800">
                {/* `name` already ends with the size for every tire — it is
                    built from brand + model + size — so prefixing p.size here
                    would print it twice. */}
                {data.pricing.noPrice.map((p) => (
                  <li key={p.productId}>
                    {p.name} — {p.onHand} on hand
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.pricing.belowCost.length > 0 && (
            <div>
              <div className="text-amber-900">
                <strong>{data.pricing.belowCost.length}</strong> priced below what they cost.
              </div>
              <ul className="mt-1 list-disc pl-5 text-amber-800">
                {data.pricing.belowCost.map((p) => (
                  <li key={p.productId}>
                    {p.name} — sells for {formatCents(p.priceCents)}
                    {/* The cost figure is a second gate: owner only. A manager
                        gets told the tire is underwater, which is what they need
                        to act; the number itself is the owner's book. */}
                    {p.costCents !== null && <> , cost {formatCents(p.costCents)}</>}
                    {p.onHand > 0 && <> · {p.onHand} on hand</>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          </div>
          )}
        </div>
      )}

      {data && (
        <div className="text-sm text-brand-400 mb-3 no-print">
          {totals.sizes} sizes · {totals.newCount} new · {totals.usedCount} used
        </div>
      )}

      {sections.map((s) => (
        <div key={s.key} className="inv-section">
          {/*
            The rim heading. The racks are organised this way and so is the old
            workbook, so someone counting walks one rim at a time instead of
            criss-crossing the shop.
          */}
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
              <section
                key={g.size}
                className="inv-group bg-white rounded-xl shadow-sm p-4 mb-3"
              >
                <div className="flex items-baseline justify-between mb-2">
              <h2 className="inv-size text-lg font-semibold text-brand-500 tabular-nums">
                {g.size}
              </h2>
              <span className="text-xs text-brand-300 no-print">{g.total} on hand</span>
            </div>

            {/*
              The `inv-c-*` cell classes are what the print stylesheet sizes the
              columns by. It cannot count positions instead: the cost column is
              rendered only for those allowed to see it, so an owner's rows and
              a cashier's rows have different shapes.
            */}
            {g.newTires.length > 0 && (
              <table className="inv-table w-full text-sm">
                <tbody>
                  {g.newTires.map((t) => (
                    <tr key={t.id} className="border-t border-black/5">
                      <td className="inv-c-name py-1">
                        <span className="inv-tire-name text-brand-500">
                          {[t.brand, t.model].filter(Boolean).join(" ") || t.name}
                          {/*
                            Part of the name, deliberately: same span, same
                            colour, same weight. Set apart in any way at all and
                            it stops being camouflage and starts being a label
                            that invites the question "what's the P for?".

                            Handed down ready-made by the server, which decides
                            both whether this caller may see it and whether
                            there is one worth showing. Nothing here reconstructs
                            it from a cost, because a browser entitled only to
                            the code is never sent the cost.
                          */}
                          {t.cost_code && ` ${t.cost_code}`}
                        </span>
                        {t.ply && <span className="text-brand-300 text-xs"> · {t.ply}</span>}
                        {/*
                          Who to call for more. Behind the same capability as
                          the cost, and off the printout for the same reason the
                          cost is disguised on it: this sheet ends up on the
                          counter, and who the shop buys from is not a customer's
                          business either.
                        */}
                        {t.supplier && data?.showCosts && (
                          <span className="text-brand-300 text-xs no-print"> · {t.supplier}</span>
                        )}
                        {t.reorder_point > 0 && t.on_hand <= t.reorder_point && (
                          <span className="text-amber-700 text-xs no-print"> · low</span>
                        )}
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
                      <td className="py-1 text-right w-32 no-print whitespace-nowrap">
                        {can("manageProducts") && (
                          <button
                            type="button"
                            className="text-xs text-brand-400 hover:text-brand-500 underline"
                            onClick={() => setSheet({ mode: "edit", product: t, size: g.size })}
                          >
                            Edit
                          </button>
                        )}
                        {can("adjustInventory") && (
                          <button
                            type="button"
                            className="text-xs text-brand-400 hover:text-brand-500 underline ml-3"
                            onClick={() => setSheet({ mode: "count", product: t, size: g.size })}
                          >
                            Count
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/*
              A used tire has no brand, no price and no cost, so it gets one
              line: how many. Rendered only when there is at least one, because
              a sheet padded with "Used: 0" is a sheet people learn to skim.
            */}
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
                  {can("receiveInventory") && (
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline no-print"
                      onClick={() => setSheet({ mode: "receive", size: g.size, used: true })}
                    >
                      Add
                    </button>
                  )}
                </span>
              </div>
            )}
              </section>
            ))}
          </div>
        </div>
      ))}

      {/*
        Batteries, last, and not pretending to be tires.

        Kept out of the rim sections on purpose: those headings are rack
        positions, and there is no such thing as a 15" battery. Three lines with
        a heading of their own is the honest shape, and it is also the shape the
        person walking the sheet expects — the batteries are on their own shelf.
      */}
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
                        {/* "BATTERY LARGE" under a heading that already says
                            Batteries is the word twice. The stored name keeps
                            the prefix because it is what shows up on a receipt
                            and in a search, where the context is gone. */}
                        {b.name.replace(/^BATTERY\s+/i, "")}
                      </span>
                      {b.reorder_point > 0 && b.on_hand <= b.reorder_point && (
                        <span className="text-amber-700 text-xs no-print"> · low</span>
                      )}
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
                    <td className="py-1 text-right w-32 no-print whitespace-nowrap">
                      {can("manageProducts") && (
                        <button
                          type="button"
                          className="text-xs text-brand-400 hover:text-brand-500 underline"
                          onClick={() => setSheet({ mode: "edit", product: b, size: b.name })}
                        >
                          Edit
                        </button>
                      )}
                      {can("adjustInventory") && (
                        <button
                          type="button"
                          className="text-xs text-brand-400 hover:text-brand-500 underline ml-3"
                          onClick={() => setSheet({ mode: "count", product: b, size: b.name })}
                        >
                          Count
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {data && totals.sizes === 0 && batteries.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-brand-300">
          {query
            ? `Nothing on the racks matches "${query}".`
            : showEmpty
              ? "No products yet."
              : "Nothing in stock. Tick “Show sold out” to see products with no stock."}
        </div>
      )}

      {sheet?.mode === "receive" && (
        <ReceiveModal
          initialSize={sheet.size}
          usedOnly={sheet.used}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
        />
      )}
      {sheet?.mode === "edit" && (
        <EditModal
          product={sheet.product}
          size={sheet.size}
          showCosts={data?.showCosts ?? false}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
        />
      )}
      {sheet?.mode === "count" && (
        <CountModal
          product={sheet.product}
          size={sheet.size}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
        />
      )}

      <ConfirmModal
        open={confirmingCheck}
        onCancel={() => setConfirmingCheck(false)}
        onConfirm={() => void markChecked()}
        busy={checking}
        title="Counted today?"
        // Naming the action rather than saying "OK", because "OK" answers a
        // question you have already stopped reading by the time you click it.
        confirmLabel="Yes, I counted them"
        cancelLabel="Not yet"
        acknowledge="Somebody walked the racks and counted them"
      >
        <p>
          This stamps the stock sheet as counted{" "}
          <strong className="text-brand-500">today</strong>, by{" "}
          <strong className="text-brand-500">{user.name}</strong>, and everyone who prints
          it will read it that way.
        </p>
      </ConfirmModal>

      {data?.quoteDefaults && (
        <TireQuote
          open={quoting}
          onClose={() => setQuoting(false)}
          defaults={data.quoteDefaults}
        />
      )}
    </div>
  );
}

/**
 * Booking stock in.
 *
 * Used tires are received by SIZE, not by picking a product: the person
 * unloading them knows "four 195/65R15", not which row of a table that is, and
 * a size the shop has never carried before must not be a dead end. New tires
 * still go through the product list, because their brand, cost and price all
 * have to come from somewhere.
 */
function ReceiveModal({
  initialSize,
  usedOnly,
  onClose,
  onSaved,
}: {
  initialSize?: string;
  usedOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // New is the default. Most receiving is a delivery of new tires off an
  // invoice; used trickles in a couple at a time on buybacks. The "Add" link on
  // a used line still opens straight into the used tab, so that path is no
  // longer for it either.
  const [tab, setTab] = useState<"used" | "new">(usedOnly ? "used" : "new");
  const [size, setSize] = useState(initialSize ?? "");
  const [qty, setQty] = useState("1");
  const [specialized, setSpecialized] = useState(false);
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The tire being received, once found. Held whole rather than as an id so the
  // form can show what was picked — size, price, what is already on the rack —
  // without a second lookup. Confirming you grabbed the right one out of five
  // near-identical sizes is the entire point of showing it back.
  const [picked, setPicked] = useState<FoundProduct | null>(null);

  // "It's not in the list." Off by default: on a normal delivery every tire is
  // already known, and a create form standing open invites a duplicate row for a
  // tire that was there all along under a slightly different spelling.
  const [adding, setAdding] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newPrice, setNewPrice] = useState("");

  async function submit() {
    setError(null);
    const n = parseInt(qty, 10);
    if (!Number.isInteger(n) || n < 1) {
      setError("How many?");
      return;
    }

    let body: Record<string, unknown>;
    if (tab === "used") {
      if (!size.trim()) {
        setError("Which size?");
        return;
      }
      body = { usedSize: size, qty: n, specialized };
    } else {
      const common = {
        qty: n,
        unitCostCents: parseCents(cost) ?? 0,
        supplier: supplier || null,
        reference: reference || null,
      };
      if (adding) {
        if (!newBrand.trim()) {
          setError("Which brand?");
          return;
        }
        if (!newSize.trim()) {
          setError("Which size?");
          return;
        }
        body = {
          ...common,
          newTire: {
            brand: newBrand.trim(),
            model: newModel.trim() || null,
            tireSize: newSize.trim(),
            priceCents: parseCents(newPrice) ?? 0,
            specialized,
          },
        };
      } else {
        if (!picked) {
          setError("Which tire?");
          return;
        }
        body = { ...common, productId: picked.id };
      }
    }

    setBusy(true);
    const res = await fetch("/api/pos/inventory/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not receive");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Receive stock"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Receive"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!usedOnly && (
          <div className="flex gap-1">
            {(["used", "new"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  tab === t ? "bg-brand-500 text-white" : "text-brand-400"
                }`}
                style={tab === t ? undefined : { border: "1px solid rgba(10,37,64,0.12)" }}
                onClick={() => setTab(t)}
              >
                {t === "used" ? "Used tires" : "New tires"}
              </button>
            ))}
          </div>
        )}

        {tab === "used" ? (
          <>
            <label className="text-sm text-brand-400">
              Size
              <input
                className="input mt-1 w-full tabular-nums"
                value={size}
                onChange={(e) => {
                  setSize(e.target.value);
                  // Half-inch rims (17.5, 19.5, 22.5, 24.5) are commercial
                  // without exception, so the box ticks itself. It stays
                  // editable — a suggestion, not a ruling.
                  if (looksSpecialized(e.target.value)) setSpecialized(true);
                }}
                placeholder="195-65-15"
                autoFocus
              />
              <span className="block mt-1 text-xs text-brand-300">
                Any way of writing it works — 195 65 15, 195/65R15, 1956515.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-brand-400">
              <input
                type="checkbox"
                className="mt-1"
                checked={specialized}
                onChange={(e) => setSpecialized(e.target.checked)}
              />
              <span>
                18-wheeler or specialty
                <span className="block text-xs text-brand-300">
                  Semi, trailer, tow truck, mower. Keeps it in its own section at the
                  end of the sheet instead of among the passenger sizes.
                </span>
              </span>
            </label>
            <p className="text-xs text-brand-300">
              A used tire is recorded by size only. No brand, price or cost — the
              price is set at the counter when it sells.
            </p>
          </>
        ) : (
          <>
            {/*
              Was a <select> of every tire the shop has ever carried — 557 rows
              by the time anyone tried to use it, in one scroll, with no way to
              type. Nobody unloading a truck is going to scroll to find
              "LANDSAIL LS588 215-35-19"; they know the size in their hand and
              want to type it. Same search the register uses, so the two screens
              behave identically and the tire-size normaliser means 195/65R15,
              195 65 15 and 1956515 all land on the same row.
            */}
            {!adding &&
              (picked ? (
                <div
                  className="rounded-lg px-3 py-2 flex items-center gap-3"
                  style={{ background: "rgba(10,37,64,0.04)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-brand-500 truncate">{picked.name}</div>
                    <div className="text-xs text-brand-300">
                      {picked.tire_size ?? picked.sku}
                      {picked.price_cents > 0 && ` · sells at ${formatCents(picked.price_cents)}`}
                      {` · ${picked.on_hand} on the rack`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-brand-400 underline whitespace-nowrap"
                    onClick={() => setPicked(null)}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <label className="text-sm text-brand-400">
                  Tire
                  <div className="mt-1">
                    <ProductSearch
                      autoFocus
                      placeholder="Type a size or a brand — 215 55 17, vantage…"
                      // Only things that can actually be received: no services,
                      // no fees, and not the used sizes, which have their own tab
                      // precisely because they are received differently.
                      filter={(p) => p.track_inventory === 1 && p.condition !== "used"}
                      clearOnPick
                      onPick={(p) => {
                        setPicked(p);
                        // Pre-fill from what the shop paid last time. It is the
                        // right answer often enough to save typing and is fully
                        // editable, because the whole reason to record a cost per
                        // lot is that it changes between deliveries.
                        if (!cost && p.default_cost_cents)
                          setCost((p.default_cost_cents / 100).toFixed(2));
                        if (!supplier && p.supplier) setSupplier(p.supplier);
                      }}
                    />
                  </div>
                </label>
              ))}

            {adding ? (
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <label className="text-sm text-brand-400 flex-1">
                    Brand
                    <input
                      className="input mt-1 w-full"
                      value={newBrand}
                      onChange={(e) => setNewBrand(e.target.value)}
                      placeholder="GOODYEAR"
                      autoFocus
                    />
                  </label>
                  <label className="text-sm text-brand-400 flex-1">
                    Model
                    <input
                      className="input mt-1 w-full"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      placeholder="TRAVEZA"
                    />
                  </label>
                </div>
                <div className="flex gap-3">
                  <label className="text-sm text-brand-400 flex-1">
                    Size
                    <input
                      className="input mt-1 w-full tabular-nums"
                      value={newSize}
                      onChange={(e) => {
                        setNewSize(e.target.value);
                        // Same self-ticking rule as the used tab: half-inch rims
                        // are commercial without exception.
                        if (looksSpecialized(e.target.value)) setSpecialized(true);
                      }}
                      placeholder="195-65-15"
                    />
                  </label>
                  <label className="text-sm text-brand-400 flex-1">
                    Sells at
                    <input
                      className="input mt-1 w-full tabular-nums"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="100.00"
                      inputMode="decimal"
                    />
                  </label>
                </div>
                {/*
                  Same note as the used tab, and it belongs here more, not less:
                  this field is the one that creates a product row. A size typed
                  in an unfamiliar shape here does not just look odd, it decides
                  which rim heading the tire prints under forever. Saying plainly
                  that every shape works is what stops someone hesitating and
                  inventing their own.

                  Outside the half-width Size column on purpose. In there the
                  line wraps mid-example — "195 65 / 15" — and a broken example
                  reads as two examples, which is worse than no note at all.
                  Left-aligned it still sits directly under the field it is
                  about; it just has room to say it once.
                */}
                <span className="-mt-1 text-xs text-brand-300">
                  Any way of writing it works — 195 65 15, 195/65R15, 1956515.
                </span>
                <button
                  type="button"
                  className="text-xs text-brand-400 underline self-start"
                  onClick={() => setAdding(false)}
                >
                  ← It is in the list after all
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-brand-400 underline self-start"
                onClick={() => {
                  setAdding(true);
                  setPicked(null);
                }}
              >
                Not in the list? Add a tire
              </button>
            )}

            {/*
              On the new tab as well as the used one. A semi or trailer tire is
              just as likely to arrive new, and if the box is missing here it
              lands among the passenger sizes on the printed sheet with no way to
              move it except editing the product afterwards — which nobody does.

              Only while creating: for a tire already in the list this is settled,
              and a ticked box next to an existing product would read as an offer
              to change which rack it lives on, which this is not.
            */}
            {adding && (
              <label className="flex items-start gap-2 text-sm text-brand-400">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={specialized}
                  onChange={(e) => setSpecialized(e.target.checked)}
                />
                <span>
                  18-wheeler or specialty
                  <span className="block text-xs text-brand-300">
                    Semi, trailer, tow truck, mower. Keeps it in its own section at
                    the end of the sheet instead of among the passenger sizes.
                  </span>
                </span>
              </label>
            )}

            <label className="text-sm text-brand-400">
              Cost each
              <input
                className="input mt-1 w-full tabular-nums"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="40.00"
                inputMode="decimal"
              />
            </label>
            <div className="flex gap-3">
              <label className="text-sm text-brand-400 flex-1">
                Supplier
                <input
                  className="input mt-1 w-full"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                />
              </label>
              <label className="text-sm text-brand-400 flex-1">
                Invoice
                <input
                  className="input mt-1 w-full"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </div>
          </>
        )}

        <label className="text-sm text-brand-400">
          How many
          <input
            className="input mt-1 w-full tabular-nums"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
          />
        </label>

        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}

/** "I counted the rack and there are 6." Books the difference, with a reason. */
function CountModal({
  product,
  size,
  onClose,
  onSaved,
}: {
  product: Tire;
  size: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [counted, setCounted] = useState(String(product.on_hand));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const n = parseInt(counted, 10);
  const delta = Number.isInteger(n) ? n - product.on_hand : 0;

  async function submit() {
    setError(null);
    if (!Number.isInteger(n) || n < 0) {
      setError("Enter the number you counted");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id, countedQty: n, note }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save the count");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Count ${size}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save count"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-brand-400">
          {[product.brand, product.model].filter(Boolean).join(" ") || product.name}
          {" — "}the system has <strong>{product.on_hand}</strong>.
        </p>
        <label className="text-sm text-brand-400">
          Counted on the rack
          <input
            className="input mt-1 w-full tabular-nums text-lg"
            value={counted}
            onChange={(e) => setCounted(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            autoFocus
          />
        </label>
        {delta !== 0 && (
          <p className="text-sm text-amber-800">
            This books {delta > 0 ? `+${delta}` : delta} — the difference is recorded as
            a stock movement with your name on it.
          </p>
        )}
        <label className="text-sm text-brand-400">
          Why the difference <span className="text-brand-300">(optional)</span>
          <input
            className="input mt-1 w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Miscount, damaged, sold off the books…"
          />
        </label>
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * Edit one tire.
 *
 * Deliberately not a stock screen: nothing here moves a count. Receiving and
 * counting are ledger events that need a reason and leave a movement behind,
 * and folding them into a form where someone is fixing a typo in a brand name
 * is how a stock level gets changed by accident.
 *
 * Cost and supplier are only rendered for those who may see them, and the
 * fields are simply absent otherwise -- so a manager's save cannot carry a cost
 * at all, and the server rejects one that somehow does.
 */
function EditModal({
  product,
  size,
  showCosts,
  onClose,
  onSaved,
}: {
  product: Tire;
  size: string;
  showCosts: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // A battery has no brand, model, ply or size — it is Large, Medium or Small
  // and that is the whole description. Rather than render four boxes that must
  // be left empty (and a "Brand is required" error when they are), the form
  // collapses to what a battery actually has: a name, a price and a cost.
  const simple = product.kind !== "tire";
  const [name, setName] = useState(product.name);
  const [brand, setBrand] = useState(product.brand ?? "");
  const [model, setModel] = useState(product.model ?? "");
  const [ply, setPly] = useState(product.ply ?? "");
  const [tireSize, setTireSize] = useState(size);
  const [price, setPrice] = useState(
    product.price_cents ? (product.price_cents / 100).toFixed(2) : "",
  );
  const [cost, setCost] = useState(
    product.default_cost_cents ? (product.default_cost_cents / 100).toFixed(2) : "",
  );
  const [supplier, setSupplier] = useState(product.supplier ?? "");
  const [reorder, setReorder] = useState(String(product.reorder_point ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const priceCents = parseCents(price);
  const costCents = parseCents(cost);

  async function submit() {
    setError(null);
    if (simple && !name.trim()) {
      setError("It needs a name");
      return;
    }
    if (!simple && !brand.trim()) {
      setError("A tire needs at least a brand");
      return;
    }
    if (priceCents == null || priceCents < 0) {
      setError("Enter a price, or 0 if it is priced at the counter");
      return;
    }
    if (showCosts && cost.trim() && (costCents == null || costCents < 0)) {
      setError("That cost is not a number");
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/pos/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(simple
          ? { name: name.trim() }
          : {
              brand: brand.trim(),
              model: model.trim() || null,
              ply: ply.trim() || null,
              tireSize,
            }),
        priceCents,
        reorderPoint: parseInt(reorder, 10) || 0,
        // Omitted entirely rather than sent as null: the route treats the key
        // being present at all as an attempt to write a cost, and refuses it
        // from anyone who cannot read one.
        ...(showCosts
          ? { defaultCostCents: costCents ?? 0, supplier: supplier.trim() || null }
          : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    onSaved();
  }

  const belowCost =
    showCosts &&
    priceCents != null &&
    priceCents > 0 &&
    costCents != null &&
    costCents > priceCents;

  return (
    <Modal
      open
      onClose={onClose}
      title={simple ? "Edit item" : "Edit tire"}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {simple ? (
          <label className="text-sm text-brand-400">
            Name
            <input
              className="input mt-1 w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-brand-400">
                Brand
                <input
                  className="input mt-1 w-full"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="text-sm text-brand-400">
                Model <span className="text-brand-300">(optional)</span>
                <input
                  className="input mt-1 w-full"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-brand-400">
                Size
                <input
                  className="input mt-1 w-full tabular-nums"
                  value={tireSize}
                  onChange={(e) => setTireSize(e.target.value)}
                  placeholder="195-65-15"
                />
              </label>
              <label className="text-sm text-brand-400">
                Ply <span className="text-brand-300">(optional)</span>
                <input
                  className="input mt-1 w-full"
                  value={ply}
                  onChange={(e) => setPly(e.target.value)}
                  placeholder="8PLY"
                />
              </label>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-brand-400">
            Price <span className="text-brand-300">(tax included)</span>
            <input
              className="input mt-1 w-full tabular-nums"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="100.00"
            />
          </label>
          {showCosts && (
            <label className="text-sm text-brand-400">
              Cost <span className="text-brand-300">(what we paid)</span>
              <input
                className="input mt-1 w-full tabular-nums"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                inputMode="decimal"
                placeholder="45.00"
              />
            </label>
          )}
        </div>

        {/*
          Warned, never blocked. The shop really does sell below cost sometimes
          to clear a tire that has sat too long, and a form that refuses would
          only get worked around. Thirteen rows arrived from the spreadsheet
          this way, so it is worth saying out loud when it happens.
        */}
        {belowCost && (
          <p className="text-sm text-amber-800">
            That is below cost — {formatCents(costCents!)} in, {formatCents(priceCents!)} out.
            Fine if you mean it.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          {showCosts && (
            <label className="text-sm text-brand-400">
              Supplier <span className="text-brand-300">(optional)</span>
              <input
                className="input mt-1 w-full"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Who to call for more"
              />
            </label>
          )}
          <label className="text-sm text-brand-400">
            Warn below <span className="text-brand-300">(0 = never)</span>
            <input
              className="input mt-1 w-full tabular-nums"
              value={reorder}
              onChange={(e) => setReorder(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
            />
          </label>
        </div>

        <p className="text-xs text-brand-300">
          This changes the {simple ? "item" : "tire"}, not the count —{" "}
          {product.on_hand} on the {simple ? "shelf" : "rack"}. Use Count for that.
        </p>
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
}
