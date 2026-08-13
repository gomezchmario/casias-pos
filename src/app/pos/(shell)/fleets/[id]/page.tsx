"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { useLang } from "@/components/pos/LangToggle";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents } from "@/lib/money";
import type { FleetReport } from "@/lib/fleets";
import "./fleet.css";

/**
 * A fleet's statement — the sheet that goes to the company.
 *
 * THE DRIVER COLUMN IS WHY THIS PAGE EXISTS. A company tab that says "$4,200 in
 * March" is a number the customer has to take on trust; one that says which
 * driver, which truck and which ticket is a document they can check against
 * their own dispatch records, and an argument about a charge becomes a
 * five-minute lookup instead of a lost customer.
 *
 * Four columns that reconcile — opening, charged, paid, closing — the same
 * shape as the month statement and computed from the same signed ledger, so a
 * company sheet and the shop's own statement can never quote different figures
 * for the same month.
 */

type Data = FleetReport & { today: string; shopName: string };

export default function FleetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();
  const [month, setMonth] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [printedOn, setPrintedOn] = useState("");

  useEffect(() => setPrintedOn(new Date().toLocaleDateString()), []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/fleets/${id}?${month ? `month=${month}` : ""}`);
    if (res.ok) setData(await res.json());
  }, [id, month]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!can("manageCreditAccounts"))
    return <div className="text-brand-400">{tr("Your account can't see this report.")}</div>;
  if (!data) return <div className="text-brand-300">{tr("Adding it up…")}</div>;

  const months: string[] = [];
  {
    const d = new Date(`${data.today.slice(0, 7)}-01T00:00:00Z`);
    for (let i = 0; i < 12; i++) {
      months.push(d.toISOString().slice(0, 7));
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
  }

  return (
    <div className="max-w-5xl mx-auto flt">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4 flt-hide-on-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{data.fleet.name}</h1>
          <p className="text-brand-400 text-sm">
            {tr("Company account")} · {data.fleet.customerNo}
            {data.fleet.phone && ` · ${data.fleet.phone}`} ·{" "}
            {data.members.length}{" "}
            {data.members.length === 1 ? tr("driver") : tr("drivers")}
            {data.fleet.creditApproved === 0 && (
              <strong className="text-red-700"> · {tr("not approved for credit")}</strong>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label={tr("Month")}
          >
            <option value="">{tr("This month")}</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            {tr("Print")}
          </button>
          <Link href="/pos/customers" className="btn btn-outline">
            ← {tr("Customers")}
          </Link>
        </div>
      </div>

      <div className="flt-print-head">
        <ShopLogo size={44} priority />
        <div>
          <div style={{ fontWeight: 700, fontSize: "13pt" }}>{data.shopName}</div>
          <div style={{ fontSize: "9pt" }}>
            {tr("Statement of account")} · {data.fleet.name} ({data.fleet.customerNo}) ·{" "}
            {data.from} → {data.to} · {tr("printed")} {printedOn} · {user.name}
          </div>
        </div>
      </div>

      {/* Where this goes and who settles it. On the sheet itself, because a
          statement that has to be looked up in the system before it can be
          posted is a statement that waits on a desk. */}
      {(data.fleet.address || data.fleet.billingName || data.fleet.email) && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flt-block flt-billto">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
            {tr("Bill to")}
          </div>
          <div className="text-sm">
            <div style={{ fontWeight: 600 }}>{data.fleet.name}</div>
            {data.fleet.address && (
              <div style={{ whiteSpace: "pre-line" }} className="text-brand-400">
                {data.fleet.address}
              </div>
            )}
            {(data.fleet.phone || data.fleet.email) && (
              <div className="text-brand-400">
                {[data.fleet.phone, data.fleet.email].filter(Boolean).join(" · ")}
              </div>
            )}
            {data.fleet.billingName && (
              <div className="mt-1">
                {tr("Attn")}: {data.fleet.billingName}
                {(data.fleet.billingPhone || data.fleet.billingEmail) && (
                  <span className="text-brand-400">
                    {" "}
                    · {[data.fleet.billingPhone, data.fleet.billingEmail].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* The four columns that reconcile, first — everything under them is the
          evidence for the last one. */}
      <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flt-block">
        <div className="flt-totals">
          <div>
            <div className="flt-lab">{tr("Owed at the start")}</div>
            <div className="flt-val">{formatCents(data.totals.openingCents)}</div>
          </div>
          <div>
            <div className="flt-lab">{tr("Charged")}</div>
            <div className="flt-val">+{formatCents(data.totals.chargedCents)}</div>
          </div>
          <div>
            <div className="flt-lab">{tr("Paid")}</div>
            <div className="flt-val">−{formatCents(data.totals.paidCents)}</div>
          </div>
          <div>
            <div className="flt-lab">{tr("Owed now")}</div>
            <div className="flt-val flt-closing">{formatCents(data.totals.closingCents)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flt-block">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
          {tr("Charges")}
        </div>
        {data.charges.length === 0 ? (
          <div className="text-sm text-brand-300">{tr("Nothing charged in this period.")}</div>
        ) : (
          <table className="w-full text-sm flt-table">
            <thead>
              <tr className="text-brand-300 text-xs uppercase tracking-wider">
                <th className="text-left py-2 font-medium">{tr("Date")}</th>
                <th className="text-left py-2 font-medium">{tr("Ticket")}</th>
                <th className="text-left py-2 font-medium">{tr("Driver")}</th>
                <th className="text-left py-2 font-medium">{tr("Vehicle")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {data.charges.map((c, i) => (
                <tr
                  key={c.saleId}
                  className="border-t border-black/5"
                  style={i % 2 === 1 ? { background: "rgba(10,37,64,0.02)" } : undefined}
                >
                  <td className="py-1.5 tabular-nums whitespace-nowrap">{c.businessDate}</td>
                  <td className="py-1.5 tabular-nums text-brand-400">{c.saleNo}</td>
                  {/* A charge rung on the company itself has no driver, and
                      saying so beats a blank cell — "on the account" is a fact,
                      not a missing one. */}
                  <td className="py-1.5">
                    {c.driverName ?? (
                      <span className="text-brand-300">{tr("on the account")}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-brand-400">
                    {c.vehicle ?? "—"}
                    {/* Under the vehicle rather than in a column of its own:
                        it is a sentence of variable length, and a column sized
                        for "4× LANDSAIL 235-55-18, MOUNT & BALANCE, DISPOSAL"
                        would leave the rest of the table in a gutter. Shown
                        always — this is the sheet that gets posted, and a
                        detail somebody has to ask for is a phone call. */}
                    {c.what && (
                      <div className="text-xs text-brand-300 mt-0.5">{c.what}</div>
                    )}
                  </td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">
                    {formatCents(c.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black/20 font-semibold">
                <td className="py-2" colSpan={4}>
                  {data.charges.length} {data.charges.length === 1 ? tr("charge") : tr("charges")}
                </td>
                <td className="py-2 pl-4 text-right tabular-nums">
                  {formatCents(data.totals.chargedCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {data.payments.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flt-block">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
            {tr("Payments received")}
          </div>
          <table className="w-full text-sm flt-table">
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t border-black/5">
                  <td className="py-1.5 tabular-nums whitespace-nowrap">{p.businessDate}</td>
                  <td className="py-1.5 text-brand-400">{p.how ?? "—"}</td>
                  <td className="py-1.5 text-brand-400">{p.note ?? ""}</td>
                  <td className="py-1.5 text-brand-300">{p.byName}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">
                    {formatCents(p.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-4 flt-block">
        <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
          {tr("Drivers on this account")}
        </div>
        {data.members.length === 0 ? (
          <div className="text-sm text-brand-300">
            {tr("Nobody is billed to this account yet.")}
          </div>
        ) : (
          <table className="w-full text-sm flt-table">
            <thead>
              <tr className="text-brand-300 text-xs uppercase tracking-wider">
                <th className="text-left py-2 font-medium">{tr("Driver")}</th>
                <th className="text-left py-2 font-medium">{tr("Phone")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Vehicles")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Charged, all time")}</th>
                <th className="text-right py-2 font-medium pl-4">{tr("Last in")}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="border-t border-black/5">
                  <td className="py-1.5">{m.name}</td>
                  <td className="py-1.5 text-brand-400">{m.phone ?? "—"}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">{m.vehicles}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">
                    {formatCents(m.chargedCents)}
                  </td>
                  <td className="py-1.5 pl-4 text-right tabular-nums text-brand-300">
                    {m.lastVisit ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
