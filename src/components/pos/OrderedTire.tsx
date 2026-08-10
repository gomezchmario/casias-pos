"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { parseCents } from "@/lib/money";
import type { FoundProduct } from "@/components/pos/ProductSearch";
import { useLang } from "@/components/pos/LangToggle";

/**
 * A tire the shop is selling but does not have.
 *
 * The customer wants a 225-45-17, the racks do not have one, so it gets ordered
 * from the supplier and rung today. Until now there was no way to do that as a
 * TIRE: the search only finds tires that exist as products, so the only path was
 * a free-text line — which carries no product, moves no stock, and lands in
 * reports as an anonymous amount rather than a tire. That is the exact drift the
 * spreadsheet already had, and it is why this is a button rather than advice to
 * type the name in the other box.
 *
 * It creates the CATALOGUE ENTRY and no stock, which is the honest description
 * of what has happened: the shop now sells this tire, and has none. Completing
 * the ticket books it as an oversell — a negative count against that tire, and a
 * row in the review queue that clears itself when the delivery is received.
 * That is not a side effect to be tidied away; it is a list of tires owed to
 * customers, which is a thing the counter genuinely needs.
 */
export function OrderedTire({
  open,
  onClose,
  onCreated,
  showCosts,
  initialSize = "",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: FoundProduct) => void;
  /** Only managers and up see cost fields anywhere else; this respects that. */
  showCosts: boolean;
  /** The size already typed into the search that opened this. */
  initialSize?: string;
}) {
  const { t: tr } = useLang();
  const [size, setSize] = useState("");
  // Two fields, not one. This box used to ask for "Brand & model" together and
  // post the answer as the brand, which is how a tire arrived in the catalogue
  // branded "tRANS EAGLE 16PLY" with no model at all -- a one-off row that sorts
  // and groups nowhere near the eight TRANSEAGLE rows it belongs with. The
  // columns were always there; only this form was folding them together.
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blank on every open. This box is about one tire for one customer, and the
  // failure mode of remembering is ordering the next customer a tire in the
  // last customer's size — which reads as a perfectly plausible entry.
  useEffect(() => {
    if (!open) return;
    // The size comes in filled from whatever was typed into the search that
    // gave up and offered this. Retyping the thing you just typed is the sort
    // of small insult that gets a tool written off in a week.
    setSize(initialSize);
    setBrand("");
    setModel("");
    setPrice("");
    setCost("");
    setSupplier("");
    setError(null);
    setBusy(false);
  }, [open, initialSize]);

  const priceCents = parseCents(price);
  const costCents = parseCents(cost);
  const ready = size.trim().length > 0 && priceCents !== null && priceCents > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pos/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "tire",
        condition: "new",
        tireSize: size.trim(),
        brand: brand.trim() || null,
        model: model.trim() || null,
        priceCents,
        defaultCostCents: showCosts ? (costCents ?? 0) : 0,
        supplier: supplier.trim() || null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not add that tire");
      return;
    }
    // Handed straight to the ticket, with the count the server sent. The point
    // of the button is that somebody is mid-sale with a customer waiting; making
    // them go back and search for the tire they just typed in would be asking
    // them to do it twice.
    //
    // Not a hardcoded zero. This is a get-or-create — a size that already exists
    // comes back as the row that was already there, tires and all — and "0 on
    // hand" is a number somebody at the counter reads and believes.
    onCreated(d.product);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Order a tire in"
      width={460}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? "Adding…" : "Add and put on ticket"}
          </button>
        </>
      }
    >
      <p className="text-sm text-brand-400 mb-4">
        For a tire being ordered in for this customer. It goes on the ticket now
        and joins the price list — the racks stay at none until the delivery is
        received.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-brand-400">{tr("Size")}<span className="text-brand-300">(required)</span>
          <input
            className="input mt-1 w-full"
            autoFocus
            placeholder="225 45 17"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </label>
        {/* Brand alone. The placeholder is one word on purpose — it is the
            example somebody copies the shape of, and "Landsail LS588" in this
            box is exactly what taught the counter to type the whole name here. */}
        <label className="text-sm text-brand-400">{tr("Brand")}<input
            className="input mt-1 w-full"
            placeholder="Landsail"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </label>
      </div>

      {/* Full width, below the pair, because a model is the long one — "ST
          RADIAL II (10 PL)" does not fit in half a row, and a field that
          visibly truncates what you typed is a field people stop filling in. */}
      <label className="text-sm text-brand-400 block mt-3">{tr("Model")}<span className="text-brand-300">(and ply, if it matters)</span>
        <input
          className="input mt-1 w-full"
          placeholder="LS588, or ST RADIAL II (10 PL)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="text-sm text-brand-400">{tr("Price")}<span className="text-brand-300">(tax included)</span>
          <input
            className="input mt-1 w-full tabular-nums"
            inputMode="decimal"
            placeholder="120.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>
        {showCosts && (
          <label className="text-sm text-brand-400">{tr("Cost")}<span className="text-brand-300">(what we pay)</span>
            <input
              className="input mt-1 w-full tabular-nums"
              inputMode="decimal"
              placeholder="65.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
        )}
      </div>

      {showCosts && (
        <label className="text-sm text-brand-400 block mt-3">{tr("Supplier")}<span className="text-brand-300">(who to call)</span>
          <input
            className="input mt-1 w-full"
            placeholder="Optional"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </label>
      )}

      {error && <div className="text-sm text-red-700 mt-3">{error}</div>}
    </Modal>
  );
}
