"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents } from "@/lib/money";
import "./standing.css";

/**
 * Money standing still — the full list.
 *
 * The tile on the inventory fold and the Reports page both say how MANY sizes
 * have sat 45 days without a sale; the tables under them show only the worst
 * fifteen. This page is every one of them, because the person acting on it is
 * not glancing — they are walking the racks deciding what to move, discount or
 * send back, and a decision over 133 sizes cannot be made from the top 15.
 *
 * The cost column follows `viewCosts`, not this page's own gate: a manager
 * sees WHAT is asleep and for how long, the owner sees what the sleep is
 * costing. The server strips the figures rather than trusting the screen to.
 */

type Row = {
  productId: number;
  name: string;
  size: string | null;
  onHand: number;
  costCents: number | null;
  daysSinceSale: number | null;
  daysOnShelf: number | null;
};

type Data = {
  asOf: string;
  days: number;
  showCosts: boolean;
  totals: { sizes: number; units: number; costCents: number | null };
  rows: Row[];
};

export default function StandingStillPage() {
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/inventory/standing-still");
      if (res.ok) setData(await res.json());
    })();
  }, []);

  if (!can("viewReports"))
    return <div className="text-brand-400">{tr("Your account can't see this report.")}</div>;

  return (
    <div className="max-w-5xl mx-auto sst">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 sst-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">
            {tr("Money standing still")}
          </h1>
          <p className="text-brand-400 text-sm">
            {tr("Every size on the racks with no sale in 45 days — oldest sleeper first.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data}
            onClick={() => window.print()}
          >
            {tr("Print")}
          </button>
          <Link href="/pos/inventory" className="btn btn-outline">
            ← {tr("Inventory")}
          </Link>
        </div>
      </div>

      {/* On paper only — the sheet gets carried to the racks and filed. */}
      <div className="sst-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>
            {tr("Money standing still")} · Casias Muffler and Tire Shop
          </div>
          <div style={{ fontSize: "9pt" }}>
            {data ? `${tr("as of")} ${data.asOf}` : ""} · {tr("printed")} {printedOn} ·{" "}
            {tr("printed by")} {user.name}
          </div>
        </div>
      </div>

      {!data ? (
        <div className="text-brand-300 py-10 text-center">{tr("Adding it up…")}</div>
      ) : data.rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-brand-300">
          {tr("Nothing — the racks are moving.")}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm p-4 sst-block">
          {/* The conclusion first, where a stack of rows would bury it. */}
          <p className="text-sm text-brand-400 mb-3">
            <strong className="text-brand-500">
              {data.totals.sizes} {tr("sizes")} · {data.totals.units} {tr("units")}
              {data.totals.costCents !== null && (
                <> · {formatCents(data.totals.costCents)} {tr("at cost")}</>
              )}
            </strong>{" "}
            {tr("with no sale in")} {data.days} {tr("days")}.
          </p>
          <table className="w-full text-sm sst-table">
            <thead>
              <tr className="text-brand-300 text-xs uppercase tracking-wider">
                <th className="text-left py-2 font-medium">{tr("Tire")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("On hand")}</th>
                {data.showCosts && (
                  <th className="text-right py-2 font-medium pl-4">{tr("At cost")}</th>
                )}
                <th className="text-right py-2 font-medium pl-4">{tr("Last sold")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Days on shelf")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr
                  key={r.productId}
                  className="border-t border-black/5"
                  style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                >
                  <td className="py-1.5 text-brand-500">{r.name}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">{r.onHand}</td>
                  {data.showCosts && (
                    <td className="py-1.5 pl-4 text-right tabular-nums">
                      {r.costCents === null ? "—" : formatCents(r.costCents)}
                    </td>
                  )}
                  {/* "Never" in words: a tire that has never sold is a
                      different problem from one that stopped, and a dash would
                      hide the difference. */}
                  <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                    {r.daysSinceSale === null
                      ? tr("never sold one")
                      : `${r.daysSinceSale} ${tr("days ago")}`}
                  </td>
                  <td className="py-1.5 pl-4 text-right tabular-nums text-brand-400">
                    {r.daysOnShelf === null ? "—" : r.daysOnShelf}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black/20 font-semibold">
                <td className="py-2">
                  {data.totals.sizes} {tr("sizes")}
                </td>
                <td className="py-2 pl-4 text-right tabular-nums">{data.totals.units}</td>
                {data.showCosts && (
                  <td className="py-2 pl-4 text-right tabular-nums">
                    {data.totals.costCents === null ? "—" : formatCents(data.totals.costCents)}
                  </td>
                )}
                <td className="py-2 pl-4" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
