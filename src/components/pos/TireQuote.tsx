"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatCents, parseCents } from "@/lib/money";
import { quoteTire } from "@/lib/tire-quote";

export type QuoteDefaults = {
  marginBp: number;
  taxRateBp: number;
  mountBalanceCents: number;
  roundToCents: number;
};

/**
 * The COTIZADOR, for the counter.
 *
 * ONE quote, not the six side-by-side columns of the spreadsheet it replaces.
 * Those columns existed to compare suppliers, and in practice five of them held
 * stale numbers from whenever somebody last used them — two were outright
 * broken and nobody noticed, because a wrong number in a grid looks exactly
 * like a right one. A single box that is always about the tire being discussed
 * right now cannot go stale.
 *
 * Everything is computed in the browser by `quoteTire`, the same function the
 * server would use. No request is made: the person using this is on the phone,
 * and the number has to move as they type.
 */
export function TireQuote({
  open,
  onClose,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  defaults: QuoteDefaults;
}) {
  const [cost, setCost] = useState("");
  const [freight, setFreight] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  // The three that can be moved for one quote. Held as text so a half-typed
  // number does not snap back to the default under the cursor.
  const [margin, setMargin] = useState("");
  const [mb, setMb] = useState("");
  const [round, setRound] = useState("");

  // Read through a ref so the effect below can depend on `open` ALONE.
  //
  // Depending on `defaults` looks more correct and is a live bug: saving new
  // defaults replaces the object, which would re-run the effect and blank the
  // cost the user had just typed — mid-quote, with someone on the phone, at the
  // exact moment they were most confident the number on screen was theirs.
  const latest = useRef(defaults);
  latest.current = defaults;

  // Cleared on every open. A quote is about one tire and one phone call, and
  // the failure mode of remembering is quoting the next customer the last
  // customer's cost — which reads as a perfectly plausible price.
  useEffect(() => {
    if (!open) return;
    const d = latest.current;
    setCost("");
    setFreight("");
    setAdjusting(false);
    setMargin(String(d.marginBp / 100));
    setMb(String(d.mountBalanceCents / 100));
    setRound(String(d.roundToCents / 100));
  }, [open]);

  const marginBp = useMemo(() => {
    const n = Number(margin.replace(/[%\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : defaults.marginBp;
  }, [margin, defaults.marginBp]);

  const mbCents = parseCents(mb) ?? defaults.mountBalanceCents;
  const roundCents = parseCents(round) ?? defaults.roundToCents;
  const costCents = parseCents(cost) ?? 0;
  const freightCents = parseCents(freight) ?? 0;

  const q = quoteTire({
    costCents,
    freightCents,
    marginBp,
    taxRateBp: defaults.taxRateBp,
    mountBalanceCents: mbCents,
    roundToCents: roundCents,
  });

  const moved =
    marginBp !== defaults.marginBp ||
    mbCents !== defaults.mountBalanceCents ||
    roundCents !== defaults.roundToCents;

  const reset = () => {
    setMargin(String(defaults.marginBp / 100));
    setMb(String(defaults.mountBalanceCents / 100));
    setRound(String(defaults.roundToCents / 100));
  };

  const row = (label: string, value: string, dim = false) => (
    <div className={`flex justify-between ${dim ? "text-brand-400" : "text-brand-500"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Price a tire" width={440}>
      <p className="text-sm text-brand-400 mb-4">
        For a tire the shop doesn’t stock. Type what the supplier is charging.
      </p>

      <div className="flex gap-3 mb-4">
        <label className="flex-1 text-sm">
          <span className="block mb-1 text-brand-400">Supplier cost</span>
          <input
            className="input w-full"
            inputMode="decimal"
            autoFocus
            placeholder="65"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="block mb-1 text-brand-400">Freight</span>
          <input
            className="input w-full"
            inputMode="decimal"
            placeholder="0"
            value={freight}
            onChange={(e) => setFreight(e.target.value)}
          />
        </label>
      </div>

      {/*
        The answer, and it is deliberately the biggest thing in the box. This
        gets read off out loud to somebody waiting on the phone, so the one
        number that gets said has to be unmissable among the five that explain
        how it was reached.
      */}
      <div className="rounded-xl bg-brand-50 px-4 py-3 mb-3 text-center">
        <div className="text-xs uppercase tracking-wide text-brand-400 mb-0.5">Quote, each</div>
        <div className="text-4xl font-semibold text-brand-600 tabular-nums">
          {formatCents(q.sellCents)}
        </div>
        {q.sellCents > 0 && (
          <div className="text-sm text-brand-400 mt-1 tabular-nums">
            Set of 2 {formatCents(q.setOfTwoCents)} · Set of 4 {formatCents(q.setOfFourCents)}
          </div>
        )}
      </div>

      {q.sellCents > 0 && (
        <div className="text-sm space-y-1 mb-3 px-1">
          {row("Cost + freight", formatCents(q.subtotalCents), true)}
          {row(`Markup ${(marginBp / 100).toFixed(marginBp % 100 ? 2 : 0)}%`, formatCents(q.marginCents), true)}
          {row(`Tax ${(defaults.taxRateBp / 100).toFixed(2)}%`, formatCents(q.taxCents), true)}
          {row("Mount & balance", formatCents(q.mountBalanceCents), true)}
          {row("", "", true)}
          {row("Before rounding", formatCents(q.rawTotalCents), true)}
          {roundCents > 0 &&
            row(`Rounded up to next ${formatCents(roundCents)}`, `+${formatCents(q.roundingCents)}`, true)}
        </div>
      )}

      <button
        type="button"
        className="text-sm text-brand-400 hover:text-brand-500 flex items-center gap-1.5"
        onClick={() => setAdjusting((v) => !v)}
        aria-expanded={adjusting}
      >
        <span
          aria-hidden="true"
          className="inline-block"
          style={{ transform: adjusting ? "rotate(90deg)" : "none" }}
        >
          ▶
        </span>
        Adjust markup, mount &amp; balance, rounding
        {moved && !adjusting && <span className="text-amber-700">· changed</span>}
      </button>

      {adjusting && (
        <div className="mt-3 rounded-lg border border-black/5 bg-black/[0.02] p-3">
          <div className="flex gap-3">
            <label className="flex-1 text-sm">
              <span className="block mb-1 text-brand-400">Markup %</span>
              <input
                className="input w-full"
                inputMode="decimal"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
              />
            </label>
            <label className="flex-1 text-sm">
              <span className="block mb-1 text-brand-400">Mount &amp; bal.</span>
              <input
                className="input w-full"
                inputMode="decimal"
                value={mb}
                onChange={(e) => setMb(e.target.value)}
              />
            </label>
            <label className="flex-1 text-sm">
              <span className="block mb-1 text-brand-400">Round up to</span>
              <input
                className="input w-full"
                inputMode="decimal"
                value={round}
                onChange={(e) => setRound(e.target.value)}
              />
            </label>
          </div>
          {/*
            Says plainly that this is for one quote. Without the sentence the
            obvious reading of an editable field is that it saves, and somebody
            would drop the markup for one awkward customer believing they had
            changed it back afterwards.
          */}
          {/*
            Nothing here saves, deliberately, and the sentence says so.

            Moving the markup is haggling — it belongs to the one awkward
            customer it was done for, and it should not outlive the phone call.
            A Save button here would put the shop's standing margin one click
            from a screen used dozens of times a day under time pressure, and
            the drift would be invisible: every future quote would come out
            wrong-but-plausible, with nothing on screen to say the number had
            ever moved. So the box reopens on the shop's defaults, every time.
            Changing those for good is a settings-page decision, made when
            nobody is waiting.
          */}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-brand-400">
              This quote only — reopening starts from the shop’s defaults again.
            </span>
            {moved && (
              <button
                type="button"
                className="text-xs text-brand-500 underline whitespace-nowrap"
                onClick={reset}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
