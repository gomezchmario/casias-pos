"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ProductSearch, type FoundProduct } from "@/components/pos/ProductSearch";
import { BackToTop } from "@/components/ui/BackToTop";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ShopLogo } from "@/components/ui/ShopLogo";
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
import { RankedBars, Stat } from "@/components/pos/Charts";
import { formatCents, parseCents } from "@/lib/money";
import "../reports/reports.css";
import { looksSpecialized, sizeMatches } from "@/lib/tire-size";
import { quoteTire } from "@/lib/tire-quote";
import "./inventory.css";
import { useLang } from "@/components/pos/LangToggle";

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
  /** Priced under cost on purpose — see 020_discount_flag.sql. */
  discounted: number;
  on_hand: number;
  /**
   * 1 when the row has been taken off the list. Only ever non-zero while the
   * owner has "Show removed" ticked — for everybody else the server does not
   * send these rows at all.
   */
  deleted?: number;
};

type SizeGroup = {
  size: string;
  newTires: Tire[];
  usedCount: number;
  usedProductId: number | null;
  /** The used row itself — Count and Remove need the product, not its id. */
  usedProduct: Tire | null;
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

type LowStockFlag = {
  productId: number;
  name: string;
  size: string | null;
  onHand: number;
  /** The "warn below" number somebody set on the product. Always > 0 here. */
  reorderPoint: number;
};

type Data = {
  sections: RimSection[];
  batteries: Tire[];
  misc: Tire[];
  lastCheck: InventoryCheck;
  showCosts: boolean;
  /** The server's answer on whether removed rows are in this payload. */
  showingDeleted?: boolean;
  /** Worst first, and including rows the sheet is currently hiding. */
  lowStock: LowStockFlag[];
  /** Below zero — deepest first. Its own list; see `listNegativeStock`. */
  negativeStock: {
    productId: number;
    name: string;
    size: string | null;
    onHand: number;
    condition: string;
  }[];
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

/** The three rack questions, shaped by `/api/pos/inventory/insights`. */
type Insights = {
  from: string;
  to: string;
  bestSellers: { productId: number; name: string; units: number; revenueCents: number }[];
  /** The opening tiles — counts only; money stays behind viewCosts. */
  counts: {
    stockUnits: number;
    deadSizes: number;
    reorderSizes: number;
    weekSoldUnits: number;
    weekStockedUnits: number;
  };
  dead: {
    productId: number;
    name: string;
    size: string | null;
    onHand: number;
    costCents: number;
    daysSinceSale: number | null;
    daysOnShelf: number | null;
  }[];
  restock: {
    productId: number;
    name: string;
    size: string | null;
    onHand: number;
    sold90: number;
    overDays: number;
    reorderPoint: number;
    suggested: number;
    daysOfCover: number | null;
  }[];
  lost: {
    recorded: { size: string; tires: number; asks: number; onHand: number | null }[];
    searched: {
      size: string;
      tires: number;
      asks: number;
      onHand: number | null;
      complete: boolean;
    }[];
  };
};

export default function InventoryPage() {
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  // Owner only, and off every time the page loads: the normal state of this
  // sheet is the racks as they are, not the racks plus their history.
  const [showDeleted, setShowDeleted] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState("");
  const [checking, setChecking] = useState(false);
  const [confirmingCheck, setConfirmingCheck] = useState(false);
  // Shut on arrival every time, deliberately not remembered. See the panel.
  const [pricingOpen, setPricingOpen] = useState(false);
  const [lowOpen, setLowOpen] = useState(false);
  /**
   * The rack questions fold — dead money, what to keep stocked, what walked
   * out. Shut on arrival like the close-out's week, and for the same reason:
   * this page is a counter tool first, and the person looking up one tire
   * mid-sale should skip past a line, not scroll past three tables.
   *
   * Fetched only when opened. The three queries sweep the whole sales history,
   * and the counter pays that cost never; the manager pays it on click.
   */
  /** Whether the searched list shows the keystrokes too — off, like Reports. */
  const [showPartial, setShowPartial] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // Ten at a time, like the Reports panel this is lifted from: ten is what a
  // ranked chart can carry, and the next press is the manager hunting for a
  // size they believe should be on the list.
  const [sellersShown, setSellersShown] = useState(10);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  const [applied, setApplied] = useState<Record<number, number>>({});

  /**
   * True only for the duration of the fold's own print. The state must be IN
   * the DOM before the print dialog reads it, so the button sets it and this
   * effect — which runs after the class is committed — is what actually calls
   * print, then clears itself when the dialog closes.
   */
  const [printingInsights, setPrintingInsights] = useState(false);
  useEffect(() => {
    if (!printingInsights) return;
    const done = () => setPrintingInsights(false);
    window.addEventListener("afterprint", done);
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [printingInsights]);

  async function toggleInsights() {
    const opening = !insightsOpen;
    setInsightsOpen(opening);
    if (!opening || insights) return;
    const res = await fetch("/api/pos/inventory/insights");
    if (!res.ok) {
      setError("Could not load the rack questions");
      setInsightsOpen(false);
      return;
    }
    setInsights(await res.json());
  }

  /** The same one-press reorder the Reports page has, against the same route. */
  async function applyReorder(productId: number, reorderPoint: number) {
    setApplying(productId);
    const res = await fetch(`/api/pos/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorderPoint }),
    });
    setApplying(null);
    if (!res.ok) {
      setError("Could not set that reorder point");
      return;
    }
    setApplied((a) => ({ ...a, [productId]: reorderPoint }));
  }
  const [quoting, setQuoting] = useState(false);
  // The row somebody is about to remove, held so the confirm can name it.
  const [removing, setRemoving] = useState<Tire | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  /**
   * Whether this row can be taken off the list by the person looking at it.
   *
   * The owner may remove anything; a manager may remove a row with nothing on
   * it. Mirrors `deleteProduct` in products.ts, which is where the rule is
   * actually enforced — this only decides whether to draw the word, so that a
   * manager is not offered a button that will come back refused. An already
   * removed row offers nothing, because removing it twice is not a thing.
   */
  const [restoring, setRestoring] = useState<number | null>(null);

  /**
   * Undo a removal.
   *
   * The counterpart to `removeProduct`, and the reason removals are soft. It
   * clears the flag and nothing else — the stock, the price and the history
   * were never touched, so the row comes back exactly as it left. Owner only,
   * on both sides.
   */
  async function restoreProduct(p: Tire) {
    if (restoring !== null) return;
    setRestoring(p.id);
    setError(null);
    const res = await fetch(`/api/pos/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: true }),
    });
    const d = await res.json().catch(() => ({}));
    setRestoring(null);
    if (!res.ok) {
      setError(d.error || "Could not put that product back");
      return;
    }
    await load();
  }

  const canRemove = (p: Tire | null | undefined) =>
    !!p &&
    !p.deleted &&
    (can("deleteProduct") || (can("deleteEmptyProduct") && p.on_hand === 0));

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/pos/inventory?all=${showEmpty ? "1" : "0"}&deleted=${showDeleted ? "1" : "0"}`,
    );
    if (!res.ok) {
      setError("Could not load inventory");
      return;
    }
    setData(await res.json());
  }, [showEmpty, showDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Take a product off the list.
   *
   * Soft, like everything else here: the row keeps its history and every ticket
   * it ever sold still reads correctly, it simply stops appearing on the racks
   * and in search. The reason is not optional and goes into the audit row —
   * "removed by the owner" answers nothing six months later, and the question
   * this gets asked with is always "where did that size go".
   */
  async function removeProduct(p: Tire) {
    if (removeBusy) return;
    setRemoveBusy(true);
    setError(null);
    const reason = `Removed from the stock list by ${user.name}`;
    const res = await fetch(
      `/api/pos/products/${p.id}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" },
    );
    const d = await res.json().catch(() => ({}));
    setRemoveBusy(false);
    setRemoving(null);
    if (!res.ok) {
      setError(d.error || "Could not remove that product");
      return;
    }
    await load();
  }

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
            sizeMatches(g.size, q) ||
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

  const misc = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.misc;
    return data.misc.filter((b) => b.name.toLowerCase().includes(q));
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
    // `inv-mode-insights` flips which of the page's two printables comes out
    // of the printer: the rack sheet by default, the fold's three panels while
    // its own Print is running. Screen appearance never changes.
    <div className={`inv max-w-5xl mx-auto${printingInsights ? " inv-mode-insights" : ""}`}>
      {/* gap-8 rather than gap-4: the controls are already hard against the
          right edge, so the only thing that can un-cram them is a wider gutter
          between them and the heading on the left. */}
      <div className="flex items-end justify-between mb-5 gap-8 flex-wrap no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Inventory")}</h1>
          <p className="text-sm text-brand-400">{tr("Everything on the racks, by size.")}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="input ml-1"
            placeholder={tr("Size or brand…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-brand-400 whitespace-nowrap">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
            />{tr("Show sold out")}</label>
          {/*
            Only the owner is offered this, and only the owner is served it —
            see the `deleted` flag on the inventory route. It is how a row
            removed by mistake gets found again.
          */}
          {can("deleteProduct") && (
            <label className="flex items-center gap-2 text-sm text-brand-400 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
              />{tr("Show removed")}</label>
          )}
          {/* `btn` on its own has a transparent background and a transparent
              border, so on this white page it rendered as a word rather than
              something to press. These two are real actions and are styled as
              such. */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
          >{tr("Print")}</button>
          {/* Sits on the inventory page because "do we have it, and if not what
              would it cost" is one question asked in one breath. */}
          {data?.quoteDefaults && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setQuoting(true)}
            >{tr("Price a tire")}</button>
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
      <div className="print-only inv-sheet-head mb-3">
        {/* `priority`, and it is load-bearing rather than a speed tweak. This
            block is `display: none` until somebody prints, and an element that
            never displays never intersects the viewport — so a lazily-loaded
            badge would sit un-fetched all day and come off the printer as a gap
            where the letterhead should be. Same reasoning as the close-out. */}
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>Casias Tire Shop — Inventory</div>
          <div style={{ fontSize: "9pt" }}>
            {printedAt} · {totals.sizes} sizes · {totals.newCount} new · {totals.usedCount} used
          </div>
        </div>
      </div>

      {/*
        When the racks were last actually walked and counted.

        On the sheet as well as the screen, and that is the more important of
        the two: a printed inventory has no other way of saying how much to
        trust itself. "Counted three days ago" and "counted in March" are the
        same document otherwise, and only one of them is worth ordering from.
      */}
      {/* ── The rack questions, folded away ─────────────────────────────────
          The close-out's "How the week is going" pattern, borrowed on purpose:
          a quiet rule with a chevron, skippable at a glance, holding the three
          questions from the management reports that belong to whoever ORDERS
          stock rather than whoever owns the shop — dead money, what to keep
          stocked, and what walked out unsold. Managers and up. */}
      {can("viewReports") && (
        <>
          <button
            type="button"
            className="inv-foldhead no-print"
            aria-expanded={insightsOpen}
            onClick={() => void toggleInsights()}
          >
            <span>{tr("The racks, worth a look")}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              aria-hidden
              style={{
                transform: insightsOpen ? "rotate(180deg)" : undefined,
                transition: "transform 120ms",
              }}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {!insightsOpen && (
              <span className="inv-foldhead-hint">
                {tr("money standing still, and what to keep stocked")}
              </span>
            )}
          </button>

          {insightsOpen && !insights && (
            <div className="text-brand-300 text-sm mb-4">{tr("Adding it up…")}</div>
          )}

          {insightsOpen && insights && (
            <div className="inv-insights grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr" }}>
              {/* The letterhead for the printable. Print-only; the screen
                  never sees it. */}
              <div className="inv-insights-head">
                <ShopLogo size={44} priority />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "13pt" }}>
                    Casias Muffler and Tire Shop
                  </div>
                  <div style={{ fontSize: "9pt" }}>
                    {tr("The racks, worth a look")} · {insights.from} → {insights.to} ·{" "}
                    {tr("printed by")} {user.name}
                  </div>
                </div>
              </div>

              <div className="flex justify-end no-print" style={{ marginBottom: -6 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ height: 30, fontSize: 12 }}
                  onClick={() => setPrintingInsights(true)}
                >
                  {tr("Print")}
                </button>
              </div>

              {/* The week at a glance, in counts. Five questions a manager
                  actually asks at the racks, answered before any table:
                  what is here, what is asleep, what needs ordering, and
                  whether the week moved tires out and in. */}
              <div className="rp-stats">
                <Stat
                  label={tr("Stock on hand")}
                  value={insights.counts.stockUnits.toLocaleString()}
                  sub={tr("units on the racks")}
                />
                <Stat
                  label={tr("Standing still")}
                  value={String(insights.counts.deadSizes)}
                  sub={
                    <>
                      {tr("sizes with no sale in 45 days")} ·{" "}
                      <Link href="/pos/standing-still" className="underline">
                        {tr("the full list")} →
                      </Link>
                    </>
                  }
                  tone={insights.counts.deadSizes > 0 ? "warn" : undefined}
                />
                <Stat
                  label={tr("At the reorder point")}
                  value={String(insights.counts.reorderSizes)}
                  sub={
                    <>
                      {tr("sizes to order")} ·{" "}
                      <Link href="/pos/to-order" className="underline">
                        {tr("what to order")} →
                      </Link>
                    </>
                  }
                  tone={insights.counts.reorderSizes > 0 ? "warn" : undefined}
                />
                <Stat
                  label={tr("Tires sold this week")}
                  value={String(insights.counts.weekSoldUnits)}
                  sub={tr("new tires, last 7 days")}
                />
                <Stat
                  label={tr("Tires stocked this week")}
                  value={String(insights.counts.weekStockedUnits)}
                  sub={tr("new tires, last 7 days")}
                />
              </div>

              {/* ── Best sellers — the Reports panel, lifted whole ── */}
              <div className="rp-panel">
                <div className="rp-panel-head">
                  <span>{tr("Best sellers")}</span>
                  <em>{tr("Units sold in this window.")}</em>
                </div>
                <RankedBars
                  data={insights.bestSellers.slice(0, sellersShown).map((m) => ({
                    label: m.name,
                    value: m.units,
                    note: ` · ${formatCents(m.revenueCents)}`,
                  }))}
                  max={insights.bestSellers[0]?.units}
                  format={(n) => String(n)}
                  emptyLabel={tr("Nothing sold in this window.")}
                />
                {insights.bestSellers.length > sellersShown && (
                  <div className="rp-more rp-no-print">
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ height: 30, fontSize: 12 }}
                      onClick={() => setSellersShown((n) => n + 10)}
                    >
                      {tr("Show 10 more")}
                    </button>
                    <span>
                      {tr("showing")} {Math.min(sellersShown, insights.bestSellers.length)}{" "}
                      {tr("of")} {insights.bestSellers.length}
                    </span>
                  </div>
                )}
              </div>

              {/* ── Money standing still ── */}
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                  {tr("Money standing still")}
                </div>
                <p className="text-sm text-brand-400 mb-2">
                  {tr("On the racks with no sale in 45 days. Every one of these is cash parked on a shelf.")}
                </p>
                {insights.dead.length === 0 ? (
                  <div className="text-sm text-brand-300">{tr("Nothing — the racks are moving.")}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                        <th className="py-1 font-medium">{tr("Tire")}</th>
                        <th className="py-1 font-medium text-right">{tr("On hand")}</th>
                        {/* What it COST is the owner's book, not the floor's —
                            same line viewCosts draws everywhere else. */}
                        {can("viewCosts") && (
                          <th className="py-1 font-medium text-right pl-4">{tr("Sitting there, at cost")}</th>
                        )}
                        <th className="py-1 font-medium text-right pl-4">{tr("Last sold")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.dead.map((d) => (
                        <tr key={d.productId} className="border-t border-black/5">
                          <td className="py-1">{d.name}</td>
                          <td className="py-1 text-right tabular-nums">{d.onHand}</td>
                          {can("viewCosts") && (
                            <td className="py-1 text-right tabular-nums pl-4">
                              {formatCents(d.costCents)}
                            </td>
                          )}
                          <td className="py-1 text-right tabular-nums pl-4 text-brand-400">
                            {d.daysSinceSale === null
                              ? tr("never")
                              : `${d.daysSinceSale} ${tr("days ago")}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── Worth keeping in stock ── */}
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                  {tr("Worth keeping in stock")}
                </div>
                <p className="text-sm text-brand-400 mb-2">
                  {tr("What actually sells, against what is on the rack right now. Set puts the suggested level on the tire so the low-stock alarm watches it for you.")}
                </p>
                {insights.restock.length === 0 ? (
                  <div className="text-sm text-brand-300">{tr("Nothing selling fast enough to advise on yet.")}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                        <th className="py-1 font-medium">{tr("Tire")}</th>
                        <th className="py-1 font-medium text-right">{tr("Sold")}</th>
                        <th className="py-1 font-medium text-right pl-4">{tr("On hand")}</th>
                        <th className="py-1 font-medium text-right pl-4">{tr("Keep")}</th>
                        {can("manageProducts") && <th className="py-1 no-print" />}
                      </tr>
                    </thead>
                    <tbody>
                      {insights.restock.map((s) => {
                        const done = applied[s.productId] === s.suggested || s.reorderPoint === s.suggested;
                        return (
                          <tr key={s.productId} className="border-t border-black/5">
                            <td className="py-1">{s.name}</td>
                            <td className="py-1 text-right tabular-nums text-brand-400">
                              {s.sold90} / {s.overDays}d
                            </td>
                            <td
                              className="py-1 text-right tabular-nums pl-4"
                              style={s.onHand === 0 ? { color: "#b91c1c", fontWeight: 600 } : undefined}
                            >
                              {s.onHand}
                            </td>
                            <td className="py-1 text-right tabular-nums pl-4 font-semibold">
                              {s.suggested}
                            </td>
                            {can("manageProducts") && (
                              <td className="py-1 text-right pl-3 no-print">
                                {done ? (
                                  <span className="text-xs" style={{ color: "#15803d" }}>
                                    ✓ {tr("set")}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-outline"
                                    style={{ height: 26, fontSize: 12, padding: "0 10px" }}
                                    disabled={applying === s.productId}
                                    onClick={() => void applyReorder(s.productId, s.suggested)}
                                  >
                                    {tr("Set")}
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── What walked out — the Reports section, lifted whole ──
                  At the bottom of the fold, by instruction. Same components,
                  same classes, same stylesheet as the page it came from. */}
              <div className="rp">
                <h2 className="rp-h2">{tr("What walked out")}</h2>
                <p className="rp-note">
                  {tr("Two different qualities of evidence, kept apart. A recorded lost sale is somebody watching a customer leave; an empty search is a keystroke.")}
                </p>
                <div className="rp-two">
                  <div className="rp-panel">
                    <div className="rp-panel-head">
                      <span>{tr("Asked for and not in stock")}</span>
                      <em>{tr("From the counter's study.")}</em>
                    </div>
                    <RankedBars
                      data={insights.lost.recorded.slice(0, 10).map((r) => ({
                        label: r.size,
                        value: r.tires,
                        note:
                          r.onHand === null || r.onHand <= 0
                            ? ` · ${tr("still none")}`
                            : ` · ${r.onHand} ${tr("now on hand")}`,
                        color: r.onHand === null || r.onHand <= 0 ? "#b91c1c" : "#15803d",
                      }))}
                      format={(n) => `${n}`}
                      emptyLabel={tr("Nothing recorded in this window.")}
                    />
                    <Link href="/pos/demand" className="rp-more rp-no-print">
                      {tr("The whole study")} →
                    </Link>
                  </div>
                  <div className="rp-panel">
                    <div className="rp-panel-head">
                      <span>{tr("Searched for and not found")}</span>
                      <em>{tr("Sizes the register was asked for and could not show.")}</em>
                    </div>
                    <button
                      type="button"
                      className="rp-eye rp-no-print"
                      aria-pressed={showPartial}
                      aria-label={tr("Show half-typed searches")}
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
                    <RankedBars
                      data={insights.lost.searched
                        .filter((r) => showPartial || r.complete)
                        .slice(0, 10)
                        .map((r) => ({
                          label: r.size,
                          value: r.asks,
                          note: r.complete ? undefined : ` · ${tr("half-typed")}`,
                          color: r.complete ? undefined : "rgba(10,37,64,0.3)",
                        }))}
                      format={(n) => `${n}`}
                      emptyLabel={tr("Every search found a size we had.")}
                    />
                  </div>
                </div>
              </div>

            </div>
          )}
        </>
      )}

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
          <strong>{tr("Stock records disagree with themselves.")}</strong> This is a bug, not
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
        What to order. Same disclosure as the pricing block below it, and red
        rather than amber on purpose: a tire priced wrong is paperwork somebody
        schedules an afternoon for, and an empty rack is a customer walking back
        out of the door this morning. The two warnings genuinely are not the same
        urgency, so they do not get the same colour.

        Above pricing for that reason, and because everybody who can see the
        racks sees this one, while pricing is managers only.

        The list arrives from the server rather than being sifted out of the rows
        below, which matters more than it looks: the sheet hides sold-out sizes
        unless somebody ticks the box, and a size at zero is precisely what this
        panel is for. Read off the visible rows it would go quiet at its most
        useful moment.

        `no-print` like the pricing block, though for a milder reason — the
        printout is a counting sheet, and what to reorder is a decision taken
        afterwards, sitting down, from the count that sheet comes back with.
      */}
      {/*
        Below zero, above everything.

        First panel on the page and never collapsed, which is the difference
        between this and Running low underneath it. Low stock is a purchasing
        decision taken later, sitting down; below zero is a statement that the
        ledger and the racks disagree RIGHT NOW, and every minute it stands the
        register is quoting from a number that is not true.

        It prints, unlike the panels below it. Those are decisions made off the
        sheet; this one is an instruction to whoever is holding it — count these
        first, because everything else on the page is only as trustworthy as the
        worst row on it.
      */}
      {data && data.negativeStock.length > 0 && (
        <div className="mb-4 rounded-lg border-2 border-red-500 bg-red-50 px-3 py-2 text-sm">
          <div className="font-semibold text-red-900">
            {data.negativeStock.length === 1
              ? "1 tire is below zero"
              : `${data.negativeStock.length} tires are below zero`}
            <span className="font-normal text-red-700">
              {" "}
              · the racks and the ledger disagree
            </span>
          </div>
          <ul className="mt-1 list-disc pl-5 text-red-800">
            {data.negativeStock.map((p) => (
              <li key={p.productId}>
                {p.name}
                {p.condition === "used" && p.size ? ` (used ${p.size})` : ""} —{" "}
                {/* Said as a debt, the same way Running low says it: "-2 on
                    hand" is a fact about a column, "2 owed to customers" is a
                    fact about the shop. */}
                <strong>{-p.onHand} owed to customers</strong>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-red-700">
            Either the count is wrong, stock arrived and was never received, or
            some went missing. Count these before trusting anything else here.
          </p>
        </div>
      )}

      {data && data.lowStock.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm no-print">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left font-semibold text-red-900"
            onClick={() => setLowOpen((v) => !v)}
            aria-expanded={lowOpen}
          >
            <span
              aria-hidden="true"
              className="inline-block transition-transform"
              style={{ transform: lowOpen ? "rotate(90deg)" : "none" }}
            >
              ▶
            </span>{tr("Running low")}<span className="font-normal text-red-700">
              {" "}
              · {data.lowStock.length} to reorder
            </span>
          </button>

          {lowOpen && (
            <ul className="mt-2 list-disc pl-5 text-red-800">
              {data.lowStock.map((p) => (
                <li key={p.productId}>
                  {/* `name` already ends in the size for every tire, so the
                      size is not repeated here — same as the pricing lists. */}
                  {p.name} —{" "}
                  {p.onHand < 0 ? (
                    // Below zero is an oversell: tires sold that the racks did
                    // not have. Said as a debt rather than as "-2 on hand",
                    // because that is what it is — somebody is waiting for them.
                    <strong>
                      {-p.onHand} owed to customers
                    </strong>
                  ) : p.onHand === 0 ? (
                    <strong>none left</strong>
                  ) : (
                    <>{p.onHand} left</>
                  )}{" "}
                  <span className="text-red-700">
                    · warns at {p.reorderPoint} or fewer
                  </span>
                </li>
              ))}
            </ul>
          )}
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
            </span>{tr("Pricing needs a look")}<span className="font-normal text-amber-700"> · managers only</span>
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
                    /* Banded, and two states that beat the band.
                       Green says the shop meant this price even though it is
                       under cost — see the Discount pill. Red says the register
                       does not know what to charge for a tire that is on the
                       rack, which is the one pricing fault that surfaces at the
                       counter with a customer waiting. */
                    <tr
                      key={t.id}
                      /* Below zero outranks both of the others. A tire with no
                         price is a question at the counter; a tire at minus
                         four is stock the shop does not have and has already
                         sold, and if one row on the sheet is going to be the
                         loud one it is that. */
                      className={`inv-row border-t border-black/5${
                        t.on_hand < 0
                          ? " inv-row-warn"
                          : t.price_cents === 0 && t.on_hand > 0
                            ? " inv-row-warn"
                            : t.discounted
                              ? " inv-row-discount"
                              : ""
                      }`}
                    >
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
                        {/* A pill rather than the words " · low" tacked on the
                            end. As text it read as part of the tire's name —
                            "LANDSAIL LS588 205 55 16 · low" — which is both a
                            thing to squint at and, on a rack of forty rows,
                            invisible. Boxed, it is a badge the eye finds while
                            scrolling past, which is the only way anybody ever
                            actually reads it. */}
                        {/* Below zero replaces "low" rather than sitting beside
                            it. Both would be true and only one is worth reading:
                            "low" says order more, and ordering more is not the
                            answer to a count that is already wrong. */}
                        {/* Only ever drawn while the owner has "Show removed"
                            ticked; nobody else is sent these rows. Never
                            printed — a removed size on a rack sheet is a size
                            somebody goes looking for. */}
                        {!!t.deleted && (
                          <span
                            className="inv-pill-gone no-print"
                            title={tr("Taken off the stock list")}
                          >
                            {tr("removed")}
                          </span>
                        )}
                        {t.on_hand < 0 ? (
                          <span className="inv-pill-owed" title={tr("Sold more than the racks had")}>
                            {-t.on_hand} owed
                          </span>
                        ) : (
                          t.reorder_point > 0 &&
                          t.on_hand <= t.reorder_point && (
                            <span className="inv-pill-low no-print">low</span>
                          )
                        )}
                        {/* One or the other, never both. A tire with no price
                            has nothing to discount, and saying it is on offer
                            would be the wrong answer to the more urgent
                            question. */}
                        {t.price_cents === 0 && t.on_hand > 0 ? (
                          <span
                            className="inv-pill-warn no-print"
                            title={tr("On the rack with no price — the register does not know what to charge")}
                          >
                            Warning
                          </span>
                        ) : (
                          t.discounted === 1 && (
                            /* Prints, unlike the low-stock pill beside it.
                               "Low" is a reordering decision made sitting down
                               at the screen; a discount is a fact about the
                               price, and this sheet is what gets carried to the
                               racks and quoted from. */
                            <span
                              className="inv-pill-discount"
                              title={tr("Priced this way on purpose — kept out of the below-cost review")}
                            >
                              Discount!
                            </span>
                          )
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
                        {/* The discount switch is not here. It lives in Edit,
                            beside the price it is a statement about — a control
                            on the row would sit next to a count and read as
                            something to do with stock. */}
                        {can("manageProducts") && (
                          <button
                            type="button"
                            className="text-xs text-brand-400 hover:text-brand-500 underline"
                            onClick={() => setSheet({ mode: "edit", product: t, size: g.size })}
                          >{tr("Edit")}</button>
                        )}
                        {can("adjustInventory") && (
                          <button
                            type="button"
                            className="text-xs text-brand-400 hover:text-brand-500 underline ml-3"
                            onClick={() => setSheet({ mode: "count", product: t, size: g.size })}
                          >{tr("Count")}</button>
                        )}
                        {canRemove(t) && (
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:text-red-800 underline ml-3"
                            onClick={() => setRemoving(t)}
                          >{tr("Remove")}</button>
                        )}
                        {/* The way back. Offered only to the owner, and only on
                            a row they had to tick "Show removed" to see at all,
                            which is the whole reason that box exists. */}
                        {!!t.deleted && can("deleteProduct") && (
                          <button
                            type="button"
                            className="text-xs text-brand-400 hover:text-brand-500 underline ml-3"
                            disabled={restoring === t.id}
                            onClick={() => void restoreProduct(t)}
                          >{tr("Put back")}</button>
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
            {(g.usedCount !== 0 || g.usedProduct) && (
              <div
                className={`flex items-center justify-between text-sm border-t border-black/5 pt-1 mt-1${
                  /* At zero the line exists for the buttons and nothing else, so
                     it stays off the printed sheet — see above for why "Used: 0"
                     must not print. It has to exist SOMEWHERE though: a used
                     size keyed wrong has no stock by definition, so hiding the
                     empty ones was hiding exactly the rows that needed removing,
                     and the only way to reach one was through the database. */
                  g.usedCount === 0 ? " no-print" : ""
                }`}
              >
                <span className="text-brand-400">{tr("Used")}</span>
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
                    >{tr("Add")}</button>
                  )}
                  {g.usedProduct && can("adjustInventory") && (
                    <button
                      type="button"
                      className="text-xs text-brand-400 hover:text-brand-500 underline no-print"
                      onClick={() =>
                        setSheet({ mode: "count", product: g.usedProduct!, size: g.size })
                      }
                    >{tr("Count")}</button>
                  )}
                  {canRemove(g.usedProduct) && (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-800 underline no-print"
                      onClick={() => setRemoving(g.usedProduct)}
                    >{tr("Remove")}</button>
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
            <h2 className="text-xl font-bold text-brand-500">{tr("Batteries")}</h2>
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
                        <span className="inv-pill-low no-print">low</span>
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
                        >{tr("Edit")}</button>
                      )}
                      {can("adjustInventory") && (
                        <button
                          type="button"
                          className="text-xs text-brand-400 hover:text-brand-500 underline ml-3"
                          onClick={() => setSheet({ mode: "count", product: b, size: b.name })}
                        >{tr("Count")}</button>
                      )}
                      {canRemove(b) && (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:text-red-800 underline ml-3"
                          onClick={() => setRemoving(b)}
                        >{tr("Remove")}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/*
        Miscellaneous, after the batteries and for the same reason they are not
        tires: a TPMS sensor has no rim and belongs on no rack. This is the
        shelf for everything that is stock but is neither.

        No name mangling, unlike the battery rows. "BATTERY LARGE" repeats a
        heading that already says Batteries; "TPMS SENSOR AUTEL MX-SENSOR" says
        three things the heading does not.
      */}
      {misc.length > 0 && (
        <div className="inv-section">
          <div className="inv-rim flex items-baseline gap-3 mt-5 mb-2">
            <h2 className="text-xl font-bold text-brand-500">{tr("Miscellaneous")}</h2>
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
                      {b.reorder_point > 0 && b.on_hand <= b.reorder_point && (
                        <span className="inv-pill-low no-print">low</span>
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
                        >{tr("Edit")}</button>
                      )}
                      {can("adjustInventory") && (
                        <button
                          type="button"
                          className="text-xs text-brand-400 hover:text-brand-500 underline ml-3"
                          onClick={() => setSheet({ mode: "count", product: b, size: b.name })}
                        >{tr("Count")}</button>
                      )}
                      {canRemove(b) && (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:text-red-800 underline ml-3"
                          onClick={() => setRemoving(b)}
                        >{tr("Remove")}</button>
                      )}
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

      {sheet?.mode === "receive" && (
        <ReceiveModal
          initialSize={sheet.size}
          usedOnly={sheet.used}
          quoteDefaults={data?.quoteDefaults ?? null}
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
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void removeProduct(removing)}
        busy={removeBusy}
        title={tr("Remove this from the list?")}
        confirmLabel="Yes, remove it"
        cancelLabel="Keep it"
        acknowledge="I know this takes it off every rack view and every search"
        danger
      >
        <p>
          <strong className="text-brand-500">{removing?.name}</strong> stops appearing on
          the stock sheet, in the racks and in the counter search.
        </p>
        {/* Said plainly, because the word "remove" reads as "destroy" and the
            fear of that is what leaves wrong rows on the board for months. */}
        <p className="mt-2">
          Nothing that already happened changes. Every ticket that sold it still
          reads the same, and the movements stay in the ledger — this only takes
          it off the list of things you can sell from now on.
        </p>
        {(removing?.on_hand ?? 0) !== 0 && (
          <p className="mt-2 text-red-700">
            <strong>It still has {removing?.on_hand} on hand.</strong> Removing it
            leaves that stock counted nowhere. Count it down to zero first unless
            the row itself is the mistake.
          </p>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={confirmingCheck}
        onCancel={() => setConfirmingCheck(false)}
        onConfirm={() => void markChecked()}
        busy={checking}
        title={tr("Counted today?")}
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

      <BackToTop />
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
  quoteDefaults,
  onClose,
  onSaved,
}: {
  initialSize?: string;
  usedOnly?: boolean;
  /** The shop's posted markup and labour rate, for the suggested price under
   *  Sells at. Null for a role that cannot quote — the note simply goes. */
  quoteDefaults: QuoteDefaults | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t: tr } = useLang();
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

  /**
   * What the shop's own quoter would charge for the cost typed above.
   *
   * The same `quoteTire` the phone quoter runs, so the two can never give
   * different answers for the same cost — which they would within a week if
   * this re-derived the chain itself. Freight is passed as zero on purpose; the
   * note beside it says so.
   *
   * Null when there is nothing to say: no cost typed, or a role that cannot
   * quote and therefore has never been shown the shop's markup.
   */
  const suggestedSell = useMemo(() => {
    if (!quoteDefaults) return null;
    const costCents = parseCents(cost);
    if (costCents === null || costCents <= 0) return null;
    return quoteTire({ costCents, freightCents: 0, ...quoteDefaults }).sellCents;
  }, [cost, quoteDefaults]);

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
      title={tr("Receive stock")}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
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
            <label className="text-sm text-brand-400">{tr("Size")}<input
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
              <span className="block mt-1 text-xs text-brand-300">{tr("Any way of writing it works — 195 65 15, 195/65R15, 1956515.")}</span>
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
                  >{tr("Change")}</button>
                </div>
              ) : (
                <label className="text-sm text-brand-400">{tr("Tire")}<div className="mt-1">
                    <ProductSearch
                      autoFocus
                      placeholder={tr("Type a size or a brand — 215 55 17, vantage…")}
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
                  <label className="text-sm text-brand-400 flex-1">{tr("Brand")}<input
                      className="input mt-1 w-full"
                      value={newBrand}
                      onChange={(e) => setNewBrand(e.target.value)}
                      placeholder="GOODYEAR"
                      autoFocus
                    />
                  </label>
                  <label className="text-sm text-brand-400 flex-1">{tr("Model")}<input
                      className="input mt-1 w-full"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      placeholder="TRAVEZA"
                    />
                  </label>
                </div>
                <div className="flex gap-3">
                  <label className="text-sm text-brand-400 flex-1">{tr("Size")}<input
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
                  {/* Cost sits here, where Sells at used to, because that is
                      the order the invoice gives them: the delivery note says
                      what it cost, and what to sell it at is a decision made
                      afterwards — helped by the suggestion under Sells at
                      further down, which needs this number to exist first. */}
                  <label className="text-sm text-brand-400 flex-1">{tr("Cost each")}<input
                      className="input mt-1 w-full tabular-nums"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      placeholder="40.00"
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
                <span className="-mt-1 text-xs text-brand-300">{tr("Any way of writing it works — 195 65 15, 195/65R15, 1956515.")}</span>
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

            {/* Cost moved up into the Size row while a tire is being created —
                see the note there. Down here it is only for the ordinary path,
                where the tire already exists and there is no price to decide. */}
            {!adding && (
              <label className="text-sm text-brand-400">{tr("Cost each")}<input
                  className="input mt-1 w-full tabular-nums"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="40.00"
                  inputMode="decimal"
                />
              </label>
            )}

            {adding && (
              <label className="text-sm text-brand-400">{tr("Sells at")}<input
                  className="input mt-1 w-full tabular-nums"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="100.00"
                  inputMode="decimal"
                />
                {/* What the quoter would have said, off the cost typed above.
                    Not filled in automatically and not enforced: this is a new
                    tire nobody has priced before, and the number the shop wants
                    is often not the formula's — a slow size carries more, a
                    price-matched one carries less. Shown so that decision is
                    made against the posted markup rather than in the dark.

                    Freight is deliberately left out. The quoter takes it
                    because a phone quote is usually for something being ordered
                    in specially; a tire being received has already arrived, its
                    freight was on the invoice as a whole and not per tire, and
                    guessing a share of it here would put a number on screen
                    that no document backs up. */}
                {suggestedSell !== null && (
                  <span className="block text-xs text-brand-300 mt-1">
                    Priced the shop&apos;s way this would be{" "}
                    <strong className="text-brand-400">{formatCents(suggestedSell)}</strong>
                    <span className="text-brand-200"> · freight not counted</span>
                  </span>
                )}
              </label>
            )}
            <div className="flex gap-3">
              <label className="text-sm text-brand-400 flex-1">{tr("Supplier")}<input
                  className="input mt-1 w-full"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                />
              </label>
              <label className="text-sm text-brand-400 flex-1">{tr("Invoice")}<input
                  className="input mt-1 w-full"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </div>
          </>
        )}

        <label className="text-sm text-brand-400">{tr("How many")}<input
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
  const { t: tr } = useLang();
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
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
        <label className="text-sm text-brand-400">{tr("Counted on the rack")}<input
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
            placeholder={tr("Miscount, damaged, sold off the books…")}
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
  const { t: tr } = useLang();
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
  const [discounted, setDiscounted] = useState(product.discounted === 1);
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
        discounted,
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {simple ? (
          <label className="text-sm text-brand-400">{tr("Name")}<input
              className="input mt-1 w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-brand-400">{tr("Brand")}<input
                  className="input mt-1 w-full"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="text-sm text-brand-400">{tr("Model")}<span className="text-brand-300">(optional)</span>
                <input
                  className="input mt-1 w-full"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-brand-400">{tr("Size")}<input
                  className="input mt-1 w-full tabular-nums"
                  value={tireSize}
                  onChange={(e) => setTireSize(e.target.value)}
                  placeholder="195-65-15"
                />
              </label>
              <label className="text-sm text-brand-400">{tr("Ply")}<span className="text-brand-300">(optional)</span>
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
          <label className="text-sm text-brand-400">{tr("Price")}<span className="text-brand-300">(tax included)</span>
            <input
              className="input mt-1 w-full tabular-nums"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="100.00"
            />
          </label>
          {showCosts && (
            <label className="text-sm text-brand-400">{tr("Cost")}<span className="text-brand-300">(what we paid)</span>
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
          </p>
        )}

        {/*
          The answer to the warning above, directly under it.

          The warning states the fact and stops there; this is where somebody
          says the fact is intended.
          The review list at the top of the inventory page names every tire
          priced under cost, and most of them really are mistakes; the handful
          that are not make the list the same rows every week until people stop
          reading it, and then the real mistake goes past with them.

          Offered on any tire, not only the ones under cost. That is the "force"
          half: a tire on a clearance price that happens to still be above cost
          is still a discount the counter should see, and the switch says so.

          Not on batteries and the like — `simple` — because a shelf item at a
          fixed price is not something anybody haggles over or clears out.
        */}
        {!simple && (
          <label className="flex items-start gap-2 text-sm text-brand-400">
            <input
              type="checkbox"
              className="mt-1"
              checked={discounted}
              onChange={(e) => setDiscounted(e.target.checked)}
            />
            <span>{tr("This price is a discount")}<span className="block text-xs text-brand-300">
                Marks it <strong>Discount!</strong> on the sheet in green
                {belowCost && ", and keeps it out of the below-cost review."}
              </span>
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          {showCosts && (
            <label className="text-sm text-brand-400">{tr("Supplier")}<span className="text-brand-300">(optional)</span>
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
