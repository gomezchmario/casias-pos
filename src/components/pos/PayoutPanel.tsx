"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import type { Sale } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";

/**
 * The counter-purchase side of the register: the shop buying a used tire off a
 * walk-in. Cash only, and cash only leaves the drawer here — the ledger row the
 * server writes is negative, which is what makes the day's cash come out right.
 */
export function PayoutPanel({
  sale,
  methods,
  onError,
  onDone,
}: {
  sale: Sale;
  methods: PaymentMethod[];
  onError: (msg: string | null) => void;
  onDone: (saleId: number) => void;
}) {
  const cashMethods = methods.filter((m) => m.kind === "cash");
  const [methodId, setMethodId] = useState<number>(cashMethods[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);

  async function payOut() {
    if (busy || !methodId) return;
    onError(null);
    setBusy(true);

    const completeRes = await fetch(`/api/pos/sales/${sale.id}/complete`, {
      method: "POST",
    });
    const completed = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) {
      setBusy(false);
      onError(completed.error || "Could not close the purchase");
      return;
    }

    // Pay out against the number the server just froze, for the same reason a
    // sale charges against it: the ledger has to match the frozen total.
    const payRes = await fetch(`/api/pos/sales/${sale.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "purchase_payout",
        methodId,
        amountCents: (completed.sale as Sale).subtotal_cents,
      }),
    });
    const paid = await payRes.json().catch(() => ({}));
    setBusy(false);
    if (!payRes.ok) {
      onError(paid.error || "Purchase closed but the payout did not record");
      return;
    }

    onDone(sale.id);
  }

  if (cashMethods.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-black/10 text-sm text-brand-400">
        No cash tender is set up, so nothing can be paid out.
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-black/10">
      {cashMethods.length > 1 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {cashMethods.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethodId(m.id)}
              className="btn text-sm"
              style={{
                height: 42,
                background: m.id === methodId ? "#0a2540" : "rgba(10,37,64,0.06)",
                color: m.id === methodId ? "#fff" : "#0a2540",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-between text-lg font-semibold mb-3 text-red-800">
        <span>Pay out</span>
        <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
      </div>

      <button
        type="button"
        className="btn w-full"
        style={{ height: 52, fontSize: 17, background: "#a71d24", color: "#fff" }}
        onClick={() => void payOut()}
        disabled={busy}
      >
        {busy ? "Working…" : "Pay out cash"}
      </button>
    </div>
  );
}
