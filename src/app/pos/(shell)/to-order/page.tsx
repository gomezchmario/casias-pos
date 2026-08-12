"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents } from "@/lib/money";
import "../standing-still/standing.css";

/**
 * What to order — the buying sheet, and the mirror of Standing still.
 *
 * That page is money asleep on the racks; this is money about to walk out of
 * the door for want of a tire. Same shape on purpose: a full list rather than a
 * tile's worth, a print button, and a letterhead — because both are read while
 * walking the racks or holding a phone to a supplier, and neither job is done
 * at a screen.
 *
 * TWO LISTS, KEPT APART. The first is sizes that breached a level somebody set;
 * the second is sizes selling faster than they are stocked whether or not
 * anybody ever set one. Merging them would bury the second in the first, and
 * the second is the one that grows the range back — which, on the evidence of
 * the trends report, is this shop's whole problem.
 */

type ReorderRow = {
  productId: number;
  name: string;
  size: string | null;
  onHand: number;
  reorderPoint: number;
  sold90: number;
  suggested: number;
};

type RestockRow = {
  productId: number;
  name: string;
  size: string | null;
  onHand: number;
  sold90: number;
  overDays: number;
  reorderPoint: number;
  suggested: number;
  daysOfCover: number | null;
};

type Data = {
  asOf: string;
  showCosts: boolean;
  reorder: ReorderRow[];
  restock: RestockRow[];
};

export default function ToOrderPage() {
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [printedOn, setPrintedOn] = useState("");
  /**
   * The level each tire currently carries, as far as this page knows.
   *
   * Held rather than re-fetched after every edit: setting eight levels in a row
   * should not cost eight round trips through the two sweeps behind this page.
   * Seeded from the server on load and updated in place on each save, so the
   * row shows what was actually written.
   */
  const [level, setLevel] = useState<Record<number, number>>({});
  /** What is in the box right now, which may not be a number yet. */
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/inventory/to-order");
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    setLevel(
      Object.fromEntries([
        ...d.reorder.map((r) => [r.productId, r.reorderPoint]),
        ...d.restock.map((r) => [r.productId, r.reorderPoint]),
      ]),
    );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Write a reorder level — any whole number, including none.
   *
   * ZERO IS A REAL ANSWER, not an empty field: it means "do not watch this
   * size", which is a decision a shop makes about a tire it stocks on request
   * and does not want an alarm for. So the box can be cleared and that clears
   * the level, rather than the page refusing an empty value and leaving the old
   * one quietly in place.
   *
   * The suggestion is only ever a suggestion. It rounds to how tires actually
   * sell — one, a pair, a set — but the person holding the phone knows things
   * the rate of sale does not, so the number is theirs to overrule.
   */
  async function saveLevel(productId: number, raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isInteger(next) || next < 0) {
      setError(tr("A reorder level is a whole number of tires, or blank for none."));
      return;
    }
    if (next === level[productId]) return;
    setApplying(productId);
    setError(null);
    const res = await fetch(`/api/pos/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorderPoint: next }),
    });
    setApplying(null);
    if (!res.ok) {
      setError(tr("Could not set that reorder point"));
      return;
    }
    setLevel((l) => ({ ...l, [productId]: next }));
    setDraft((d) => {
      const n = { ...d };
      delete n[productId];
      return n;
    });
  }

  /**
   * One editable level, shared by both tables.
   *
   * The box shows what the tire CARRIES, not what is suggested — a field
   * pre-filled with a recommendation is one somebody saves without reading, and
   * then the shop's levels are whatever the rate of sale said on the day
   * somebody happened to open this page. The suggestion sits beside it as a
   * button, which is a thing you choose rather than a thing you accept.
   */
  const LevelBox = ({ productId, suggested }: { productId: number; suggested: number }) => {
    const current = level[productId] ?? 0;
    const value = draft[productId] ?? (current === 0 ? "" : String(current));
    return (
      <span className="flex items-center gap-1.5 justify-end">
        <input
          className="input text-right tabular-nums"
          style={{ width: 58, height: 28, fontSize: 13 }}
          inputMode="numeric"
          placeholder={tr("none")}
          value={value}
          disabled={applying === productId}
          onChange={(e) => setDraft((d) => ({ ...d, [productId]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onBlur={(e) => void saveLevel(productId, e.target.value)}
        />
        {current !== suggested && (
          <button
            type="button"
            className="text-xs underline text-brand-400 whitespace-nowrap"
            title={tr("Use the suggested level")}
            disabled={applying === productId}
            onClick={() => void saveLevel(productId, String(suggested))}
          >
            {suggested}
          </button>
        )}
        {current !== 0 && (
          <button
            type="button"
            className="text-xs underline text-brand-300"
            title={tr("Stop watching this size")}
            disabled={applying === productId}
            onClick={() => void saveLevel(productId, "0")}
          >
            ✕
          </button>
        )}
      </span>
    );
  };

  if (!can("viewReports"))
    return <div className="text-brand-400">{tr("Your account can't see this report.")}</div>;

  const totalUnits =
    (data?.reorder.reduce((n, r) => n + r.suggested, 0) ?? 0) +
    (data?.restock.reduce((n, r) => n + Math.max(0, r.suggested - r.onHand), 0) ?? 0);

  return (
    <div className="max-w-5xl mx-auto sst">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 sst-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("What to order")}</h1>
          <p className="text-brand-400 text-sm">
            {tr("Sizes at their reorder point, and sizes selling faster than they are stocked. Take it to the phone.")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data}
            onClick={() => window.print()}
          >
            {tr("Print")}
          </button>
          <Link href="/pos/standing-still" className="btn btn-outline">
            {tr("Standing still")} →
          </Link>
          <Link href="/pos/inventory" className="btn btn-outline">
            ← {tr("Inventory")}
          </Link>
        </div>
      </div>

      <div className="sst-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            {tr("What to order")} · Casias Muffler and Tire Shop
          </div>
          <div style={{ fontSize: "9pt" }}>
            {data ? `${tr("as of")} ${data.asOf}` : ""} · {tr("printed")} {printedOn} ·{" "}
            {tr("printed by")} {user.name}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 sst-hide-on-print">
          {error}
        </div>
      )}

      {!data ? (
        <div className="text-brand-300 py-10 text-center">{tr("Adding it up…")}</div>
      ) : (
        <>
          <p className="text-sm text-brand-400 mb-3">
            <strong className="text-brand-500">
              {data.reorder.length + data.restock.length} {tr("sizes")} · {totalUnits}{" "}
              {tr("tires")}
            </strong>{" "}
            {tr("to bring the racks back to where they should be.")}
          </p>

          {/* ── At the reorder point ─────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 sst-block">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
              {tr("At or under the reorder point")}
            </div>
            <p className="text-sm text-brand-400 mb-2">
              {tr("A level somebody set on the tire, now breached. The short, certain list.")}
            </p>
            {data.reorder.length === 0 ? (
              <div className="text-sm text-brand-300">{tr("Nothing has breached its level.")}</div>
            ) : (
              <table className="w-full text-sm sst-table">
                <thead>
                  <tr className="text-brand-300 text-xs uppercase tracking-wider">
                    <th className="text-left py-2 font-medium">{tr("Tire")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("On hand")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Level")}</th>
                    <th className="py-2 sst-hide-on-print" />
                    <th className="text-right py-2 font-medium pl-4">{tr("Sold, 90 days")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Order")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reorder.map((r, i) => (
                    <tr
                      key={r.productId}
                      className="border-t border-black/5"
                      style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                    >
                      <td className="py-1.5 text-brand-500">{r.name}</td>
                      <td
                        className="py-1.5 pl-4 text-right tabular-nums"
                        style={r.onHand <= 0 ? { color: "#b91c1c", fontWeight: 700 } : undefined}
                      >
                        {r.onHand}
                      </td>
                      {/* Printed as a plain figure; edited on screen. */}
                      <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400 sst-print-only">
                        {level[r.productId] ?? r.reorderPoint}
                      </td>
                      <td className="py-1.5 pl-4 text-right sst-hide-on-print">
                        {can("manageProducts") ? (
                          <LevelBox productId={r.productId} suggested={r.suggested} />
                        ) : (
                          <span className="tabular-nums text-brand-400">
                            {level[r.productId] ?? r.reorderPoint}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                        {r.sold90}
                      </td>
                      <td className="py-1.5 pl-4 text-right tabular-nums font-semibold">
                        {r.suggested}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Selling faster than it is stocked ────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm p-4 sst-block">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
              {tr("Selling faster than it is stocked")}
            </div>
            <p className="text-sm text-brand-400 mb-2">
              {tr("Worked out from the rate of sale, whether or not anybody set a level. Type a Keep level to have the alarm watch this size — the suggestion beside the box fills it in, and ✕ or an empty box stops watching.")}
            </p>
            {data.restock.length === 0 ? (
              <div className="text-sm text-brand-300">
                {tr("Nothing selling fast enough to advise on yet.")}
              </div>
            ) : (
              <table className="w-full text-sm sst-table">
                <thead>
                  <tr className="text-brand-300 text-xs uppercase tracking-wider">
                    <th className="text-left py-2 font-medium">{tr("Tire")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Sold")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("On hand")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Days of cover")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Suggested")}</th>
                    <th className="text-right py-2 font-medium pl-4">{tr("Keep")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.restock.map((r, i) => {
                    return (
                      <tr
                        key={r.productId}
                        className="border-t border-black/5"
                        style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                      >
                        <td className="py-1.5 text-brand-500">{r.name}</td>
                        <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                          {r.sold90} / {r.overDays}d
                        </td>
                        <td
                          className="py-1.5 pl-4 text-right tabular-nums"
                          style={r.onHand === 0 ? { color: "#b91c1c", fontWeight: 700 } : undefined}
                        >
                          {r.onHand}
                        </td>
                        {/* Null is not "forever" — it is nothing on the rack,
                            which is the worst case there is. */}
                        <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                          {r.daysOfCover === null ? tr("none left") : r.daysOfCover}
                        </td>
                        <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                          {r.suggested}
                        </td>
                        <td className="py-1.5 pl-4 text-right tabular-nums font-semibold sst-print-only">
                          {level[r.productId] ?? r.reorderPoint}
                        </td>
                        <td className="py-1.5 pl-4 text-right sst-hide-on-print">
                          {can("manageProducts") ? (
                            <LevelBox productId={r.productId} suggested={r.suggested} />
                          ) : (
                            <span className="tabular-nums">
                              {level[r.productId] ?? r.reorderPoint}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
