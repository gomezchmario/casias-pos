"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { usePosAuth } from "@/components/pos/PosShell";
import { computeTipCommission, formatCents, parseCents } from "@/lib/money";
import type { Sale, SaleItem } from "@/lib/sales";
import type { Payment, PaymentMethod } from "@/lib/payments";

type Detail = { sale: Sale; items: SaleItem[]; payments: Payment[] };

export function TicketDrawer({
  saleId,
  methods,
  commPerCents,
  commChargeCents,
  onClose,
  onChanged,
}: {
  saleId: number;
  methods: PaymentMethod[];
  commPerCents: number;
  commChargeCents: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = usePosAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/sales/${saleId}`);
    if (!res.ok) {
      setError("Could not load that ticket");
      return;
    }
    setDetail(await res.json());
  }, [saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, init);
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "That didn't work");
      return false;
    }
    await load();
    onChanged();
    return true;
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={detail ? detail.sale.sale_no : "Ticket"}
      width={620}
    >
      {!detail ? (
        <div className="text-brand-300">Loading…</div>
      ) : (
        <div className="flex flex-col gap-5">
          <Lines items={detail.items} />
          <Money sale={detail.sale} payments={detail.payments} methods={methods} />

          {error && <div className="text-sm text-red-700">{error}</div>}

          {can("editSeq") && (
            <SeqEditor
              sale={detail.sale}
              busy={busy}
              onSave={(seq) =>
                send(`/api/pos/sales/${saleId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ seq }),
                })
              }
            />
          )}

          {detail.sale.status === "completed" && can("takePayment") && (
            <TipAdjustment
              methods={methods}
              commPerCents={commPerCents}
              commChargeCents={commChargeCents}
              busy={busy}
              onAdd={(methodId, tipCents, seq) =>
                send(`/api/pos/sales/${saleId}/payments`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    kind: "tip_adjustment",
                    methodId,
                    tipCents,
                    seq,
                  }),
                })
              }
            />
          )}

          {detail.sale.status !== "voided" && can("voidSale") && (
            <VoidTicket
              busy={busy}
              onVoid={async (reason) => {
                const ok = await send(`/api/pos/sales/${saleId}/void`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reason }),
                });
                return ok;
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function Lines({ items }: { items: SaleItem[] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {items.map((i) => (
          <tr key={i.id} className="border-t border-black/5">
            <td className={`py-1.5 ${i.voided ? "line-through text-brand-300" : ""}`}>
              {i.qty > 1 ? `${i.qty}× ` : ""}
              {i.description}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatCents(i.line_total_cents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Money({
  sale,
  payments,
  methods,
}: {
  sale: Sale;
  payments: Payment[];
  methods: PaymentMethod[];
}) {
  const label = (id: number) => methods.find((m) => m.id === id)?.label ?? "Payment";
  return (
    <div className="rounded-xl bg-black/[0.03] p-3 text-sm">
      <Row label="Subtotal" value={formatCents(sale.subtotal_cents)} />
      {sale.tip_cents !== 0 && (
        <Row label="Cashback" value={formatCents(sale.tip_cents)} />
      )}
      {sale.comm_cents !== 0 && (
        <Row label="Cashback fee" value={formatCents(sale.comm_cents)} />
      )}
      <Row label="Total" value={formatCents(sale.total_cents)} strong />
      <div className="mt-2 pt-2 border-t border-black/10">
        {payments.map((p) => (
          <Row
            key={p.id}
            label={`${label(p.method_id)}${p.kind !== "payment" ? ` · ${p.kind.replace("_", " ")}` : ""}${p.seq ? ` · SEQ ${p.seq}` : ""}`}
            value={formatCents(p.amount_cents)}
            muted
          />
        ))}
        {payments.length === 0 && (
          <div className="text-brand-300">Nothing collected on this ticket.</div>
        )}
      </div>
      {sale.balance_cents !== 0 && (
        <Row label="Balance due" value={formatCents(sale.balance_cents)} strong />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-0.5 ${strong ? "font-semibold text-brand-500" : muted ? "text-brand-400" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function SeqEditor({
  sale,
  busy,
  onSave,
}: {
  sale: Sale;
  busy: boolean;
  onSave: (seq: string | null) => Promise<boolean>;
}) {
  const [value, setValue] = useState(sale.seq ?? "");
  const dirty = (value.trim() || null) !== sale.seq;

  return (
    <div className="flex items-end gap-2">
      <label className="text-xs text-brand-400 flex-1">
        SEQ
        <input
          className="input mt-1 w-full tabular-nums"
          placeholder="Terminal sequence #"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !dirty}
        onClick={() => void onSave(value.trim() || null)}
      >
        Save SEQ
      </button>
    </div>
  );
}

/**
 * The forgotten-tip fix, at the counter. This books an adjustment against the
 * original ticket instead of ringing the phantom second sale the spreadsheet
 * forced on them.
 */
function TipAdjustment({
  methods,
  commPerCents,
  commChargeCents,
  busy,
  onAdd,
}: {
  methods: PaymentMethod[];
  commPerCents: number;
  commChargeCents: number;
  busy: boolean;
  onAdd: (methodId: number, tipCents: number, seq: string | null) => Promise<boolean>;
}) {
  const tipMethods = useMemo(() => methods.filter((m) => m.allows_tip === 1), [methods]);
  const [methodId, setMethodId] = useState<number>(tipMethods[0]?.id ?? 0);
  const [amount, setAmount] = useState("");
  const [seq, setSeq] = useState("");

  const method = tipMethods.find((m) => m.id === methodId);
  const tipCents = Math.max(0, parseCents(amount) ?? 0);
  const commCents = computeTipCommission(tipCents, commPerCents, commChargeCents);

  // A tip added the next morning is still a fresh swipe on the terminal, so it
  // gets a SEQ like any other card charge — otherwise it lands in the day's
  // "card sales with no SEQ" list and someone goes hunting for a mistake that
  // isn't there.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pos/next-seq")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { nextSeq: string | null } | null) => {
        if (cancelled || !d?.nextSeq) return;
        setSeq((prev) => prev || d.nextSeq!);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (tipMethods.length === 0) return null;

  return (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        Cashback added later
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-brand-400 flex-1">
          Amount
          <input
            className="input mt-1 w-full text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-brand-400 flex-1">
          Tender
          <select
            className="input mt-1 w-full"
            value={methodId}
            onChange={(e) => setMethodId(Number(e.target.value))}
          >
            {tipMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {method?.is_card === 1 && (
          <label className="text-xs text-brand-400 flex-1">
            SEQ
            <input
              className="input mt-1 w-full tabular-nums"
              placeholder="Terminal sequence #"
              value={seq}
              onChange={(e) => setSeq(e.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || tipCents <= 0}
          onClick={async () => {
            if (await onAdd(methodId, tipCents, seq.trim() || null)) {
              setAmount("");
              setSeq("");
            }
          }}
        >
          Add
        </button>
      </div>
      <p className="text-xs text-brand-300 mt-2">
        Charges {formatCents(tipCents + commCents)} — {formatCents(commCents)} fee. Books
        to today, on this ticket.
      </p>
    </div>
  );
}

function VoidTicket({
  busy,
  onVoid,
}: {
  busy: boolean;
  onVoid: (reason: string) => Promise<boolean>;
}) {
  const [arming, setArming] = useState(false);
  const [reason, setReason] = useState("");

  if (!arming) {
    return (
      <button
        type="button"
        className="text-sm text-red-700 hover:text-red-900 underline self-start"
        onClick={() => setArming(true)}
      >
        Void this ticket
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-red-50 p-3">
      <div className="text-sm text-red-800 mb-2">
        Voiding reverses every payment on this ticket. Nothing is deleted.
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-red-800 flex-1">
          Reason
          <input
            className="input mt-1 w-full"
            placeholder="Why is this being voided?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          style={{ background: "#a71d24", color: "#fff" }}
          disabled={busy || !reason.trim()}
          onClick={() => void onVoid(reason.trim())}
        >
          Void
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
