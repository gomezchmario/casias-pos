"use client";

import { useState } from "react";
import { useLang } from "@/components/pos/LangToggle";
import { formatCents, parseCents } from "@/lib/money";

/**
 * Money off the ticket.
 *
 * The one control on this drawer that existed only as a report. `setDiscount`
 * has been in the library since the beginning and nothing called it, so the
 * "who gave the discounts" panel read zero on every window — not because the
 * shop never discounts but because there was no way to record that it had.
 *
 * The ceiling is a SETTING and not a role, so a cashier can knock a few dollars
 * off a regular and a manager can decide a ticket is half price. The control
 * says which of the two it is looking at rather than letting somebody type a
 * number and be refused: a field that accepts input and then says no is how
 * people learn to distrust a screen.
 *
 * A reason is required. This is the one act on a ticket that reduces what the
 * shop is owed with nothing to show for it, and "why" is the whole record.
 */
export function DiscountTicket({
  subtotalCents,
  currentCents,
  maxCents,
  busy,
  onSet,
}: {
  subtotalCents: number;
  currentCents: number;
  /** The cashier ceiling, or null for anybody who has no ceiling. */
  maxCents: number | null;
  busy: boolean;
  onSet: (amountCents: number, reason: string) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [arming, setArming] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const cents = parseCents(amount);
  const overCeiling = maxCents !== null && cents !== null && cents > maxCents;
  const overTicket = cents !== null && cents > subtotalCents;
  const valid = cents !== null && cents >= 0 && !overCeiling && !overTicket && reason.trim().length > 0;

  if (!arming)
    return (
      <button
        type="button"
        /* block + mx-auto rather than self-center alone: self-center only does
           anything inside a flex parent, and on the register this sits in a
           plain div, where it was hugging the left edge. */
        className="block mx-auto text-sm text-brand-400 hover:text-brand-500 underline self-center"
        onClick={() => {
          setAmount(currentCents ? (currentCents / 100).toFixed(2) : "");
          setReason("");
          setArming(true);
        }}
      >
        {currentCents > 0
          ? `${tr("Change the")} ${formatCents(currentCents)} ${tr("discount")}`
          : tr("Take money off this ticket")}
      </button>
    );

  return (
    <div className="rounded-xl bg-black/[0.03] p-3">
      <div className="text-xs text-brand-400 mb-2">
        {tr("Comes off the ticket before payment, and is reported separately at close.")}{" "}
        {maxCents !== null && (
          <>
            {tr("You can take up to")} <strong>{formatCents(maxCents)}</strong>{" "}
            {tr("off; more than that needs a manager.")}
          </>
        )}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs text-brand-400">
          {tr("How much off")}
          <input
            className="input mt-1 w-28 text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-brand-400 flex-1" style={{ minWidth: 180 }}>
          {tr("Why")}
          <input
            className="input mt-1 w-full"
            placeholder={tr("Regular · matched a price · put right a mistake")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !valid}
          onClick={() => void onSet(cents!, reason.trim())}
        >
          {tr("Take it off")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>
          {tr("Cancel")}
        </button>
      </div>
      {overCeiling && (
        <div className="text-xs mt-2" style={{ color: "#a71d24" }}>
          {tr("That is more than you can take off on your own — a manager has to do it.")}
        </div>
      )}
      {overTicket && (
        <div className="text-xs mt-2" style={{ color: "#a71d24" }}>
          {tr("That is more than the ticket comes to. Giving back more than was charged is a refund.")}
        </div>
      )}
    </div>
  );
}
