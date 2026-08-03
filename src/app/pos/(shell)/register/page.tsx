"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents, parseCents } from "@/lib/money";
import { PaymentPanel } from "@/components/pos/PaymentPanel";
import { PayoutPanel } from "@/components/pos/PayoutPanel";
import type { Sale, SaleItem } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import type { QuickButton } from "@/lib/quick-buttons";

type RegisterData = {
  quickButtons: QuickButton[];
  paymentMethods: PaymentMethod[];
  mechanics: { id: number; name: string }[];
  businessDate: string;
  settings: {
    tipCommPerCents: number;
    tipCommChargeCents: number;
    customerPromptThresholdCents: number;
  };
};

export default function RegisterPage() {
  const { can } = usePosAuth();
  const [data, setData] = useState<RegisterData | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [mechanicId, setMechanicId] = useState<number | "">("");
  // Buying over the counter rather than selling. Set before the ticket exists,
  // because it decides what kind of ticket gets opened.
  const [buying, setBuying] = useState(false);
  // The ticket just closed, kept only so a receipt can be printed on request.
  const [lastSale, setLastSale] = useState<{ id: number; saleNo: string } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // A note on the ticket -- "used tire, small patch", "customer waiting", the
  // sort of thing that explains a price six weeks later. Collapsed by default
  // and saved on blur rather than per keystroke: most tickets never need one,
  // and the register cannot afford a round trip per character.
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const noteSaved = useRef("");

  useEffect(() => {
    fetch("/api/pos/register")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setError("Could not load the register"));
  }, []);

  const ensureSale = useCallback(async (): Promise<Sale | null> => {
    if (sale) return sale;
    const res = await fetch("/api/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: buying ? "purchase" : "sale" }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "Could not start a ticket");
      return null;
    }
    setSale(d.sale);
    return d.sale as Sale;
  }, [sale, buying]);

  const addLine = useCallback(
    async (desc: string, cents: number) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setLastSale(null);
      const s = await ensureSale();
      if (!s) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/pos/sales/${s.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc,
          qty: 1,
          unitPriceCents: cents,
          mechanicId: mechanicId === "" ? null : mechanicId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(d.error || "Could not add that line");
        return;
      }
      setSale(d.sale);
      setItems(d.items);
      setDescription("");
      setAmount("");
    },
    [busy, ensureSale, mechanicId],
  );

  function onQuickAmount(cents: number) {
    // Two clicks per line is the whole point: pick a service, pick a price.
    if (description.trim()) {
      void addLine(description.trim(), cents);
      return;
    }
    setAmount((cents / 100).toFixed(2));
    amountRef.current?.focus();
  }

  function onQuickService(label: string, desc: string) {
    const cents = parseCents(amount);
    if (cents !== null && cents >= 0) {
      void addLine(desc || label, cents);
      return;
    }
    setDescription(desc || label);
    amountRef.current?.focus();
  }

  function submitManual() {
    const cents = parseCents(amount);
    if (!description.trim()) {
      setError("Enter what the line is for");
      return;
    }
    if (cents === null || cents < 0) {
      setError("Enter a valid price");
      return;
    }
    void addLine(description.trim(), cents);
  }

  async function voidLine(item: SaleItem) {
    if (!sale) return;
    const res = await fetch(
      `/api/pos/sales/${sale.id}/items/${item.id}?reason=${encodeURIComponent("Removed at register")}`,
      { method: "DELETE" },
    );
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "Could not remove that line");
      return;
    }
    setSale(d.sale);
    setItems(d.items);
  }

  // Printing is offered, not forced — most tickets here are $5–$20 and the
  // customer doesn't want paper. The link stays up until the next ticket is
  // rung, which is long enough to catch the one that does.
  /**
   * Push the note to the ticket, on blur rather than per keystroke. Clicking
   * Pay blurs the field first, so the note is always sent; and because
   * updateSaleMeta happily edits a completed sale, it still lands even if the
   * payment wins the race. Skips the request when nothing changed.
   */
  const saveNote = useCallback(
    async (saleId: number) => {
      const trimmed = note.trim();
      if (trimmed === noteSaved.current) return;
      const res = await fetch(`/api/pos/sales/${saleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed || null }),
      });
      if (res.ok) noteSaved.current = trimmed;
      else setError("Could not save the note");
    },
    [note],
  );

  function finishTicket(finishedSaleId: number) {
    setLastSale(sale ? { id: finishedSaleId, saleNo: sale.sale_no } : null);
    setSale(null);
    setItems([]);
    setDescription("");
    setAmount("");
    setBuying(false);
    setError(null);
    setNote("");
    setNoteOpen(false);
    noteSaved.current = "";
  }

  const amountButtons = useMemo(
    () => data?.quickButtons.filter((b) => b.kind === "amount") ?? [],
    [data],
  );
  const serviceButtons = useMemo(
    () => data?.quickButtons.filter((b) => b.kind !== "amount") ?? [],
    [data],
  );

  if (!data) {
    return <div className="text-brand-300">Loading register…</div>;
  }
  if (!can("ringSale")) {
    return <div className="text-brand-400">Your account can&apos;t ring sales.</div>;
  }

  const liveItems = items.filter((i) => !i.voided);

  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
      <div>
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 130px 170px auto" }}>
            <input
              className="input"
              placeholder="What's it for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && amountRef.current?.focus()}
            />
            <input
              ref={amountRef}
              className="input text-right tabular-nums"
              placeholder="0.00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitManual()}
            />
            <select
              className="input"
              value={mechanicId}
              onChange={(e) =>
                setMechanicId(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">No mechanic</option>
              {data.mechanics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitManual}
              disabled={busy}
            >
              Add
            </button>
          </div>
          <p className="text-xs text-brand-300 mt-2">
            Mechanic sticks to each line, so a split ticket still pays the right person.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Price</div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {amountButtons.map((b) => (
              <button
                key={b.id}
                type="button"
                className="btn"
                style={{ background: "#0a2540", color: "#fff", height: 56, fontSize: 18 }}
                onClick={() => onQuickAmount(b.amount_cents ?? 0)}
                disabled={busy}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Service</div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {serviceButtons.map((b) => (
              <button
                key={b.id}
                type="button"
                className="btn"
                style={{
                  background: "rgba(255,200,61,0.22)",
                  color: "#0a2540",
                  height: 56,
                  fontSize: 14,
                  fontWeight: 600,
                }}
                onClick={() => onQuickService(b.label, b.description ?? b.label)}
                disabled={busy}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="bg-white rounded-2xl shadow-sm p-4 sticky" style={{ top: 16 }}>
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-semibold text-brand-500">
              {sale ? sale.sale_no : buying ? "New purchase" : "New ticket"}
            </div>
            <div className="text-xs text-brand-300">{data.businessDate}</div>
          </div>

          {!sale && lastSale && (
            <div className="mb-3 rounded-xl bg-green-50 px-3 py-3 text-sm text-green-900">
              <div className="font-semibold">{lastSale.saleNo} done</div>
              <a
                href={`/pos/sale/${lastSale.id}/receipt`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Print a receipt
              </a>
            </div>
          )}

          {!sale && can("cashPurchase") && (
            <button
              type="button"
              className="btn w-full mb-3 text-sm"
              style={{
                height: 40,
                background: buying ? "#a71d24" : "rgba(10,37,64,0.06)",
                color: buying ? "#fff" : "#0a2540",
              }}
              onClick={() => setBuying((b) => !b)}
            >
              {buying ? "Buying stock — cash out" : "Buy stock instead"}
            </button>
          )}

          {sale?.kind === "purchase" && (
            <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
              Buying over the counter — cash leaves the drawer. This is not a sale and
              earns no commission.
            </div>
          )}

          {liveItems.length === 0 ? (
            <div className="text-sm text-brand-300 py-8 text-center">
              {buying
                ? "Add what you're buying and what you paid for it."
                : "Tap a service, then a price."}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-black/5">
              {liveItems.map((i) => (
                <div key={i.id} className="py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-brand-500 truncate">{i.description}</div>
                    {i.mechanic_id && (
                      <div className="text-xs text-brand-300">
                        {data.mechanics.find((m) => m.id === i.mechanic_id)?.name}
                      </div>
                    )}
                  </div>
                  <div className="text-sm tabular-nums text-brand-500">
                    {formatCents(i.line_total_cents)}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:text-red-800"
                    onClick={() => void voidLine(i)}
                    aria-label={`Remove ${i.description}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {sale && (
            <div className="mt-3 pt-3 border-t border-black/10 flex justify-between text-lg font-semibold text-brand-500">
              <span>Total</span>
              <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
            </div>
          )}

          {sale && liveItems.length > 0 && (
            <div className="mt-3">
              {noteOpen || note ? (
                <label className="text-xs text-brand-400 block">
                  Note
                  <input
                    className="input mt-1 w-full text-sm"
                    placeholder="Anything worth remembering about this ticket"
                    value={note}
                    autoFocus={noteOpen && !note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => void saveNote(sale.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  className="text-xs text-brand-300 underline"
                  onClick={() => setNoteOpen(true)}
                >
                  Add a note
                </button>
              )}
            </div>
          )}

          {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

          {sale &&
            liveItems.length > 0 &&
            (sale.kind === "purchase" ? (
              <PayoutPanel
                sale={sale}
                methods={data.paymentMethods}
                onError={setError}
                onDone={finishTicket}
              />
            ) : (
              <PaymentPanel
                sale={sale}
                methods={data.paymentMethods}
                commPerCents={data.settings.tipCommPerCents}
                commChargeCents={data.settings.tipCommChargeCents}
                onError={setError}
                onDone={finishTicket}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
