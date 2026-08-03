"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { Modal } from "@/components/ui/Modal";
import { formatCents, parseCents } from "@/lib/money";
import { looksSpecialized } from "@/lib/tire-size";
import "./inventory.css";

type Tire = {
  id: number;
  name: string;
  sku: string;
  brand: string | null;
  model: string | null;
  ply: string | null;
  condition: "new" | "used" | null;
  price_cents: number;
  default_cost_cents: number | null;
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

type Data = {
  sections: RimSection[];
  showCosts: boolean;
  lowStock: number;
  integrityIssues: { lotId: number; lotNo: string; issue: string }[];
};

type Sheet =
  | { mode: "receive"; product?: Tire; size?: string; used?: boolean }
  | { mode: "count"; product: Tire; size: string }
  | null;

/**
 * What the shop paid, written so it can sit on the counter in front of the
 * customer. $140 becomes "P140" on the end of the name, where a ply or spec
 * code would normally live -- which is the whole point, because that is a place
 * the eye already skips. It is there so whoever is haggling knows the floor.
 *
 * This is a disguise, not a permission. The real control is the server, which
 * sends `default_cost_cents` as null to anyone without `viewCosts`; this only
 * ever renders a number the caller was already entitled to see.
 *
 * Whole dollars, because the cents are noise when you are deciding how far down
 * you will go -- but kept when they are not zero rather than rounding away real
 * money.
 */
function costCode(cents: number): string {
  const dollars = cents / 100;
  return `P${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

export default function InventoryPage() {
  const { can } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState("");

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
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
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
                          */}
                          {t.default_cost_cents != null && ` ${costCode(t.default_cost_cents)}`}
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
                      {can("adjustInventory") && (
                        <td className="py-1 text-right w-24 no-print">
                          <button
                            type="button"
                            className="text-xs text-brand-400 hover:text-brand-500 underline"
                            onClick={() => setSheet({ mode: "count", product: t, size: g.size })}
                          >
                            Count
                          </button>
                        </td>
                      )}
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

      {data && totals.sizes === 0 && (
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
  const [productId, setProductId] = useState<number | null>(null);
  const [products, setProducts] = useState<Tire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tab !== "new") return;
    fetch("/api/pos/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []));
  }, [tab]);

  async function submit() {
    setError(null);
    const n = parseInt(qty, 10);
    if (!Number.isInteger(n) || n < 1) {
      setError("How many?");
      return;
    }

    const body =
      tab === "used"
        ? { usedSize: size, qty: n, specialized }
        : {
            productId,
            qty: n,
            unitCostCents: parseCents(cost) ?? 0,
            supplier: supplier || null,
            reference: reference || null,
          };
    if (tab === "used" && !size.trim()) {
      setError("Which size?");
      return;
    }
    if (tab === "new" && !productId) {
      setError("Pick a tire");
      return;
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
            <label className="text-sm text-brand-400">
              Tire
              <select
                className="input mt-1 w-full"
                value={productId ?? ""}
                onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Pick one…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
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
