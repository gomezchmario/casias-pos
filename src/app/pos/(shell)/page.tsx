"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { TicketDrawer } from "@/components/pos/TicketDrawer";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import type { DayTotals, MechanicTotal, MethodTotal } from "@/lib/pos-reports";
import type { Sale } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";

type DayData = {
  totals: DayTotals;
  byMethod: MethodTotal[];
  byMechanic: MechanicTotal[];
  seq: {
    duplicates: string[];
    gaps: string[];
    missing: { saleNo: string; saleId: number; method: string }[];
  };
  sales: Sale[];
  integrity: { saleId: number; saleNo: string; issue: string }[];
  canSeePurchases: boolean;
  paymentMethods: PaymentMethod[];
  settings: { tipCommPerCents: number; tipCommChargeCents: number };
};

export default function DayPage() {
  const { can } = usePosAuth();
  const [date, setDate] = useState("");
  const [data, setData] = useState<DayData | null>(null);
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const url = date ? `/api/pos/reports/daily?date=${date}` : "/api/pos/reports/daily";
    const res = await fetch(url);
    if (!res.ok) return;
    const d: DayData = await res.json();
    setData(d);
    if (!date) setDate(d.totals.businessDate);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <div className="text-brand-300">Loading…</div>;
  const t = data.totals;

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">Today</h1>
          <p className="text-brand-400 text-sm">Business day {t.businessDate}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {can("ringSale") && (
            <Link
              href="/pos/register"
              className="btn btn-primary"
              style={{ height: 44, fontSize: 16, paddingInline: 20 }}
            >
              New sale
            </Link>
          )}
        </div>
      </div>

      {data.integrity.length > 0 && (
        <div className="mb-4 rounded-xl p-4 bg-red-50 text-red-800">
          <div className="font-semibold mb-1">Books don&apos;t balance</div>
          <ul className="text-sm list-disc pl-5">
            {data.integrity.map((i, n) => (
              <li key={n}>
                {i.saleNo}: {i.issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Stat
          label="Sold"
          value={formatCents(t.goodsCents)}
          sub={`${t.saleCount} tickets · incl. ${formatCents(t.taxIncludedCents)} tax`}
        />
        <Stat label="Cashback" value={formatCents(t.tipCents)} sub="paid out" />
        <Stat label="Cashback fees" value={formatCents(t.commCents)} sub="shop keeps" />
        <Stat
          label="Collected"
          value={formatCents(t.collectedCents)}
          sub="drawer + terminal"
        />
      </div>

      {(t.openTicketCount > 0 ||
        t.outstandingCents !== 0 ||
        t.voidedCount > 0 ||
        t.purchaseCount > 0 ||
        t.priorDayAdjustmentCents !== 0) && (
        <div className="flex gap-3 mb-6 text-sm text-brand-400">
          {t.openTicketCount > 0 && <span>{t.openTicketCount} still open</span>}
          {data.canSeePurchases && t.purchaseCount > 0 && (
            <span>
              {formatCents(t.purchasesCents)} paid out for stock ({t.purchaseCount})
            </span>
          )}
          {t.outstandingCents !== 0 && (
            <span>{formatCents(t.outstandingCents)} outstanding</span>
          )}
          {t.voidedCount > 0 && <span>{t.voidedCount} voided</span>}
          {t.priorDayAdjustmentCents !== 0 && (
            <span>
              {formatCents(t.priorDayAdjustmentCents)} collected today on other days&apos;
              tickets
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Card title="By payment method">
          <table className="w-full text-sm">
            <tbody>
              {data.byMethod.map((m) => (
                <tr key={m.code} className="border-t border-black/5">
                  <td className="py-2">{m.label}</td>
                  <td className="py-2 text-right text-brand-300">{m.count}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(m.amountCents)}
                  </td>
                </tr>
              ))}
              {data.byMethod.length === 0 && (
                <tr>
                  <td className="py-4 text-brand-300">Nothing collected yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card title="By mechanic">
          <table className="w-full text-sm">
            <tbody>
              {data.byMechanic.map((m) => (
                <tr key={String(m.employeeId)} className="border-t border-black/5">
                  <td className="py-2">{m.name}</td>
                  <td className="py-2 text-right text-brand-300">{m.lineCount}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(m.salesCents)}
                  </td>
                </tr>
              ))}
              {data.byMechanic.length === 0 && (
                <tr>
                  <td className="py-4 text-brand-300">No lines yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {(data.seq.duplicates.length > 0 ||
        data.seq.gaps.length > 0 ||
        data.seq.missing.length > 0) && (
        <Card title="Card terminal (SEQ)">
          <div className="text-sm text-brand-400 flex flex-col gap-1">
            {data.seq.duplicates.length > 0 && (
              <div>Duplicate SEQ: {data.seq.duplicates.join(", ")}</div>
            )}
            {data.seq.gaps.length > 0 && <div>Missing SEQ: {data.seq.gaps.join(", ")}</div>}
            {data.seq.missing.length > 0 && (
              <div>
                Card sales with no SEQ:{" "}
                {data.seq.missing.map((m) => m.saleNo).join(", ")}
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead style={{ background: "rgba(10,37,64,0.03)" }}>
            <tr className="text-left text-brand-400 uppercase text-xs tracking-wider">
              <th className="px-4 py-3">Ticket</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">SEQ</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.sales.map((s) => (
              <tr key={s.id} className="border-t border-black/5">
                <td className="px-4 py-2">
                  <button
                    type="button"
                    className="font-medium text-brand-500 underline decoration-black/20 hover:decoration-current"
                    onClick={() => setOpenSaleId(s.id)}
                  >
                    {s.sale_no}
                  </button>
                </td>
                <td className="px-4 py-2">
                  <Badge
                    tone={
                      s.status === "completed"
                        ? "success"
                        : s.status === "voided"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {s.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 tabular-nums text-brand-400">{s.seq || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCents(s.total_cents)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {s.balance_cents !== 0 ? formatCents(s.balance_cents) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/pos/sale/${s.id}/receipt`}
                    target="_blank"
                    className="text-xs text-brand-400 underline"
                  >
                    Receipt
                  </Link>
                </td>
              </tr>
            ))}
            {data.sales.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-300">
                  Nothing rung on this day.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openSaleId !== null && (
        <TicketDrawer
          key={openSaleId}
          saleId={openSaleId}
          methods={data.paymentMethods}
          commPerCents={data.settings.tipCommPerCents}
          commChargeCents={data.settings.tipCommChargeCents}
          onClose={() => setOpenSaleId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="text-xs uppercase tracking-wider text-brand-300">{label}</div>
      <div className="text-2xl font-semibold text-brand-500 tabular-nums mt-1">{value}</div>
      {sub && <div className="text-xs text-brand-300 mt-1">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">{title}</div>
      {children}
    </div>
  );
}
