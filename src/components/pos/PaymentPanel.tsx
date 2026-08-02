"use client";

import { useEffect, useMemo, useState } from "react";
import { computeTipCommission, formatCents, parseCents } from "@/lib/money";
import type { Sale } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";

/** "0042" + 1 -> "0043". Keeps the terminal's padding so the two match. */
function bumpSeq(seq: string): string {
  const t = seq.trim();
  if (!/^\d+$/.test(t)) return "";
  const next = String(Number(t) + 1);
  return next.length < t.length ? next.padStart(t.length, "0") : next;
}

/** One tender in a split. */
type TenderLine = { methodId: number; amount: string; seq: string };

export function PaymentPanel({
  sale,
  methods,
  commPerCents,
  commChargeCents,
  onError,
  onDone,
}: {
  sale: Sale;
  methods: PaymentMethod[];
  commPerCents: number;
  commChargeCents: number;
  onError: (msg: string | null) => void;
  onDone: (saleId: number) => void;
}) {
  const [methodId, setMethodId] = useState<number>(methods[0]?.id ?? 0);
  const [cashback, setCashback] = useState("");
  const [seq, setSeq] = useState("");
  const [splitTip, setSplitTip] = useState(false);
  const [tipSeq, setTipSeq] = useState("");
  const [busy, setBusy] = useState(false);

  // Paying with more than one tender. Off by default and deliberately tucked
  // away: it is a handful of tickets a week, and putting it in the main path
  // would slow down the hundreds that are one tap.
  const [splitTender, setSplitTender] = useState(false);
  const [lines, setLines] = useState<TenderLine[]>([]);

  const method = methods.find((m) => m.id === methodId);
  const tipCents = Math.max(0, parseCents(cashback) ?? 0);
  const commCents = useMemo(
    () => computeTipCommission(tipCents, commPerCents, commChargeCents),
    [tipCents, commPerCents, commChargeCents],
  );

  // Prefill the terminal's next sequence number so the cashier confirms a
  // number instead of reading one off the terminal and typing it every sale.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pos/next-seq")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { nextSeq: string | null } | null) => {
        if (cancelled || !d?.nextSeq) return;
        setSeq(d.nextSeq);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The tip's own charge is the very next one off the terminal.
  useEffect(() => {
    if (splitTip) setTipSeq((prev) => prev || bumpSeq(seq));
  }, [splitTip, seq]);

  // Running the cashback separately means the card is charged twice: the goods
  // first, then the tip plus its fee. The ticket total is the same either way.
  const splitting = splitTip && tipCents > 0 && !splitTender;
  const firstChargeCents = sale.subtotal_cents + (splitting ? 0 : tipCents + commCents);
  const secondChargeCents = splitting ? tipCents + commCents : 0;

  const allocatedCents = lines.reduce((s, l) => s + Math.max(0, parseCents(l.amount) ?? 0), 0);
  const remainingCents = sale.subtotal_cents - allocatedCents;

  function startSplit() {
    setSplitTender(true);
    setSplitTip(false);
    setCashback("");
    // Two lines is the overwhelmingly common case — usually "the rest in cash".
    setLines([
      { methodId: methods[0]?.id ?? 0, amount: "", seq: "" },
      { methodId: methods[1]?.id ?? methods[0]?.id ?? 0, amount: "", seq: "" },
    ]);
  }

  function updateLine(i: number, patch: Partial<TenderLine>) {
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }

  async function complete() {
    if (busy) return;
    if (!splitTender && !method) return;
    onError(null);
    setBusy(true);

    const completeRes = await fetch(`/api/pos/sales/${sale.id}/complete`, {
      method: "POST",
    });
    const completed = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) {
      setBusy(false);
      onError(completed.error || "Could not close the ticket");
      return;
    }

    // Charge against the subtotal the server just froze, not the copy this
    // component rendered from — those are the same number only if nothing
    // changed underneath us, and the ledger has to match the frozen one.
    const frozenSubtotal = (completed.sale as Sale).subtotal_cents;

    if (splitTender) {
      const parsed = lines.map((l) => ({
        methodId: l.methodId,
        amountCents: Math.max(0, parseCents(l.amount) ?? 0),
        seq: l.seq.trim() || null,
      }));
      const total = parsed.reduce((s, p) => s + p.amountCents, 0);
      if (total !== frozenSubtotal) {
        setBusy(false);
        onError(
          `The ticket froze at ${formatCents(frozenSubtotal)} but the split adds up to ${formatCents(total)} — take payment from Today.`,
        );
        return;
      }

      // Each tender is its own ledger row. If a later one fails, the earlier
      // ones stand and the ticket keeps a balance — which is precisely what the
      // balance column is for, and it shows up on Today rather than vanishing.
      for (const [i, p] of parsed.entries()) {
        if (p.amountCents === 0) continue;
        const res = await fetch(`/api/pos/sales/${sale.id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...p, tipCents: 0 }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setBusy(false);
          onError(
            d.error ||
              `Tender ${i + 1} did not record — the ticket still owes the rest. Finish it from Today.`,
          );
          return;
        }
      }

      setBusy(false);
      onDone(sale.id);
      return;
    }

    const payRes = await fetch(`/api/pos/sales/${sale.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        methodId,
        amountCents: frozenSubtotal + (splitting ? 0 : tipCents + commCents),
        tipCents: splitting ? 0 : tipCents,
        seq: seq.trim() || null,
      }),
    });
    const paid = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      setBusy(false);
      // The ticket is closed but unpaid — it stays open on the balance report
      // rather than silently vanishing.
      onError(paid.error || "Ticket closed but the payment did not record");
      return;
    }

    if (splitting) {
      const tipRes = await fetch(`/api/pos/sales/${sale.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "tip_adjustment",
          methodId,
          tipCents,
          seq: tipSeq.trim() || null,
        }),
      });
      const tipped = await tipRes.json().catch(() => ({}));
      if (!tipRes.ok) {
        setBusy(false);
        onError(
          tipped.error ||
            "The sale went through but the cashback charge did not — add it from Today.",
        );
        return;
      }
    }

    setBusy(false);
    onDone(sale.id);
  }

  if (splitTender) {
    return (
      <div className="mt-4 pt-4 border-t border-black/10">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-brand-300">
            Split across tenders
          </div>
          <button
            type="button"
            className="text-xs text-brand-400 underline"
            onClick={() => setSplitTender(false)}
          >
            Cancel split
          </button>
        </div>

        <div className="flex flex-col gap-2 mb-3">
          {lines.map((l, i) => {
            const lineMethod = methods.find((m) => m.id === l.methodId);
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={l.methodId}
                    onChange={(e) => updateLine(i, { methodId: Number(e.target.value) })}
                  >
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input text-right tabular-nums"
                    style={{ width: 110 }}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={l.amount}
                    onChange={(e) => updateLine(i, { amount: e.target.value })}
                  />
                  {lines.length > 2 && (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-800"
                      onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
                      aria-label={`Remove tender ${i + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {lineMethod?.is_card === 1 && (
                  <input
                    className="input tabular-nums text-sm"
                    placeholder={`SEQ for ${lineMethod.label}`}
                    value={l.seq}
                    onChange={(e) => updateLine(i, { seq: e.target.value })}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between mb-1 text-sm">
          <button
            type="button"
            className="text-brand-400 underline"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { methodId: methods[0]?.id ?? 0, amount: "", seq: "" },
              ])
            }
          >
            Add another tender
          </button>
          {/* One tap to dump the rest on the current line — the common last
              step, and it removes the mental arithmetic. */}
          {remainingCents > 0 && (
            <button
              type="button"
              className="text-brand-400 underline"
              onClick={() =>
                updateLine(lines.length - 1, {
                  amount: (
                    (Math.max(0, parseCents(lines[lines.length - 1].amount) ?? 0) +
                      remainingCents) /
                    100
                  ).toFixed(2),
                })
              }
            >
              Rest on last line
            </button>
          )}
        </div>

        <div className="flex justify-between text-sm text-brand-400 mt-2">
          <span>Ticket</span>
          <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
        </div>
        <div
          className={`flex justify-between text-lg font-semibold mb-3 ${
            remainingCents === 0 ? "text-green-700" : "text-brand-500"
          }`}
        >
          <span>{remainingCents === 0 ? "Covered" : "Still to allocate"}</span>
          <span className="tabular-nums">{formatCents(remainingCents)}</span>
        </div>

        <p className="text-xs text-brand-300 mb-3">
          Cashback isn&apos;t offered on a split — add it from Today afterwards if they
          ask for it.
        </p>

        <button
          type="button"
          className="btn btn-primary w-full"
          style={{ height: 52, fontSize: 17 }}
          onClick={() => void complete()}
          disabled={busy || remainingCents !== 0}
        >
          {busy ? "Working…" : `Take ${lines.filter((l) => parseCents(l.amount)).length} payments`}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-black/10">
      <div className="grid grid-cols-2 gap-2 mb-3">
        {methods.map((m) => (
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

      {method?.allows_tip === 1 && (
        <>
          <div className="flex gap-2 mb-2">
            <label className="text-xs text-brand-400 flex-1">
              Cashback
              <input
                className="input mt-1 w-full text-right tabular-nums"
                inputMode="decimal"
                placeholder="0.00"
                value={cashback}
                onChange={(e) => setCashback(e.target.value)}
              />
            </label>
            <div className="text-xs text-brand-400 flex-1">
              Fee
              <div className="input mt-1 w-full text-right tabular-nums bg-black/5">
                {formatCents(commCents)}
              </div>
            </div>
          </div>

          {tipCents > 0 && method?.is_card === 1 && (
            <label className="flex items-center gap-2 text-xs text-brand-400 mb-2">
              <input
                type="checkbox"
                checked={splitTip}
                onChange={(e) => setSplitTip(e.target.checked)}
              />
              Run cashback as a second charge (its own SEQ)
            </label>
          )}
        </>
      )}

      {method?.is_card === 1 && (
        <div className="flex gap-2 mb-2">
          <label className="text-xs text-brand-400 flex-1">
            {splitting ? "SEQ — sale" : "SEQ"}
            <input
              className="input mt-1 w-full tabular-nums"
              placeholder="Terminal sequence #"
              value={seq}
              onChange={(e) => setSeq(e.target.value)}
            />
          </label>
          {splitting && (
            <label className="text-xs text-brand-400 flex-1">
              SEQ — cashback
              <input
                className="input mt-1 w-full tabular-nums"
                placeholder="Second charge #"
                value={tipSeq}
                onChange={(e) => setTipSeq(e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      <div className="flex justify-between text-lg font-semibold text-brand-500 mb-1">
        <span>{splitting ? "Charge 1" : "Charge"}</span>
        <span className="tabular-nums">{formatCents(firstChargeCents)}</span>
      </div>
      {splitting && (
        <div className="flex justify-between text-lg font-semibold text-brand-500 mb-1">
          <span>Charge 2</span>
          <span className="tabular-nums">{formatCents(secondChargeCents)}</span>
        </div>
      )}
      <div className="mb-3" />

      <button
        type="button"
        className="btn btn-primary w-full"
        style={{ height: 52, fontSize: 17 }}
        onClick={() => void complete()}
        disabled={busy || !method}
      >
        {busy ? "Working…" : splitting ? "Take both charges" : "Complete sale"}
      </button>

      {methods.length > 1 && (
        <button
          type="button"
          className="w-full mt-2 text-xs text-brand-400 underline"
          onClick={startSplit}
        >
          Paying with more than one tender
        </button>
      )}
    </div>
  );
}
