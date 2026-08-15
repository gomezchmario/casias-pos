"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useLang } from "@/components/pos/LangToggle";

/**
 * The one question the data cannot answer, asked before an order is fulfilled.
 *
 * FULFILLING AN ORDER BOOKS ITS TIRES IN AND STRAIGHT BACK OUT. That is right,
 * and it is what keeps the count where it was: the tire came off the van and
 * went onto the car in the same movement, so zero stays zero.
 *
 * It goes wrong when the tire was received the ordinary way first. Somebody
 * takes the delivery, opens Receive Stock, and adds it — which is a perfectly
 * sensible thing to do. Fulfilment then books it in AGAIN, because it only skips
 * lines with a receipt tied to the sale item and a hand-entered receipt has no
 * sale item on it. The tire is received twice and sold once, and the size sits
 * one high forever with nothing on any screen to say why.
 *
 * Nothing in the database distinguishes "received in advance for this order"
 * from "received as ordinary stock" — both are a receipt for the same product.
 * So the person holding the tire is asked, and given the evidence to answer
 * with: what the count is now, and every movement that product has had. A
 * receipt in that list with no ticket number against it is very probably the
 * one in front of them.
 *
 * Gated behind a tick because both answers are wrong in different ways. Say it
 * was added when it was not and the size goes one LOW; say it was not when it
 * was and the size goes one HIGH. Neither is recoverable without somebody
 * walking the racks, so this is not a dialog to click through.
 */

type Line = {
  saleItemId: number;
  productId: number;
  description: string;
  qty: number;
  onHand: number;
  alreadyReceivedForOrder: boolean;
  movements: {
    id: number;
    at: string;
    businessDate: string;
    qtyDelta: number;
    reason: string;
    byName: string | null;
    saleNo: string | null;
    looksManual: boolean;
  }[];
};

/** The shop's words for what a movement was, not the schema's. */
const REASON: Record<string, string> = {
  receive: "Received",
  sale: "Sold",
  void_return: "Back — ticket voided",
  refund_return: "Back — refunded",
  adjust: "Adjusted",
  count: "Counted",
  damage: "Damaged",
  opening: "Opening count",
};

export function OrderStockConfirm({
  saleId,
  open,
  onCancel,
  onConfirm,
}: {
  saleId: number;
  open: boolean;
  onCancel: () => void;
  /** The sale items the counter says are already on the rack. */
  onConfirm: (alreadyStockedItemIds: number[]) => void;
}) {
  const { t: tr } = useLang();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [stocked, setStocked] = useState<Set<number>>(new Set());
  const [sure, setSure] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/sales/${saleId}/fulfillment`);
    if (!res.ok) {
      setLines([]);
      return;
    }
    setLines((await res.json()).lines ?? []);
  }, [saleId]);

  useEffect(() => {
    if (!open) return;
    // Reset every time it opens. A tick left over from the last order is an
    // answer about a different tire.
    setStocked(new Set());
    setSure(false);
    setLines(null);
    void load();
  }, [open, load]);

  const toggle = (id: number) =>
    setStocked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Lines fulfilment will actually book in — the rest already have a receipt
  // against this order and are skipped by the library regardless.
  const decidable = (lines ?? []).filter((l) => !l.alreadyReceivedForOrder);

  return (
    <Modal open={open} onClose={onCancel} title="Fulfilling this order" width={620}>
      {lines === null ? (
        <div className="text-brand-300 py-6 text-center">Checking the racks…</div>
      ) : decidable.length === 0 ? (
        <>
          <p className="text-sm text-brand-400">
            Nothing on this ticket moves stock — no tires, or they are already
            booked in against this order. Fulfilling it just closes it out.
          </p>
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-primary" onClick={() => onConfirm([])}>
              Fulfil it
            </button>
            <button type="button" className="btn btn-outline" onClick={onCancel}>{tr("Cancel")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-brand-400 mb-3">
            Tick anything you <strong>already added to the inventory</strong> when
            it arrived. Those will be taken straight off the rack instead of being
            booked in again — leave one ticked wrongly and the size ends up one
            out either way.
          </p>

          {decidable.map((l) => (
            <div key={l.saleItemId} className="osc-line">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={stocked.has(l.saleItemId)}
                  onChange={() => toggle(l.saleItemId)}
                />
                <span className="flex-1 min-w-0">
                  <span className="text-brand-500 font-medium">
                    {l.qty > 1 ? `${l.qty}× ` : ""}
                    {l.description}
                  </span>
                  <span className="block text-xs text-brand-300">
                    the count says {l.onHand} on hand
                  </span>
                </span>
              </label>

              {/* The evidence. A receipt with no ticket against it is a
                  hand-entered one, which is what this whole dialog is about, so
                  it is called out rather than left to be spotted. */}
              <div className="osc-log">
                {l.movements.length === 0 ? (
                  <div className="text-xs text-brand-300">
                    This tire has never moved. Nothing was received for it.
                  </div>
                ) : (
                  l.movements.map((m) => (
                    <div key={m.id} className="osc-move">
                      <span className="tabular-nums text-brand-300">{m.businessDate}</span>
                      <span
                        className={`tabular-nums font-semibold ${
                          m.qtyDelta < 0 ? "text-red-700" : "text-green-700"
                        }`}
                      >
                        {m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                      </span>
                      <span className="text-brand-400">
                        {REASON[m.reason] ?? m.reason}
                        {m.saleNo ? ` · ${m.saleNo}` : ""}
                        {m.byName ? ` · ${m.byName}` : ""}
                      </span>
                      {m.looksManual && (
                        <span className="osc-manual">added by hand</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}

          <label className="flex items-start gap-2 mt-4 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={sure}
              onChange={(e) => setSure(e.target.checked)}
            />
            <span className="text-brand-500">
              I&apos;m sure.{" "}
              <span className="text-brand-400">
                {stocked.size === 0
                  ? "None of these were added to the inventory — the shop is about to book them in and straight back out."
                  : /* The count came out, because it was answering a question
                       nobody asked. "1 of these is already on the rack" reads
                       as though the other four are a problem, when this line is
                       only ever confirming the ones being taken off — the
                       tires themselves are listed above it, by name. */
                    "These are already on the rack and will only be taken off."}
              </span>
            </span>
          </label>

          <div className="flex gap-2 mt-4">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!sure}
              onClick={() => onConfirm([...stocked])}
            >{tr("Fulfil the order")}</button>
            <button type="button" className="btn btn-outline" onClick={onCancel}>{tr("Cancel")}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
