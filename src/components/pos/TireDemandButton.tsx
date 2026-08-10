"use client";

import { useEffect, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";

/**
 * The lost-sale button: a customer asked for a size, the shop did not have it,
 * and they left.
 *
 * That is the one number this business has never had. Sales say what was sold,
 * the racks say what is held, and neither says anything about the man who
 * wanted a 245/45R20 and drove to the shop down the road. It happens several
 * times a week, it is the best guide there is to what to buy next, and until now
 * it lived in whatever the person at the counter happened to remember.
 *
 * DESIGNED AROUND THE ONE THING THAT DECIDES WHETHER IT GETS USED: it has to
 * cost a couple of seconds, at a counter, with somebody standing at it. So:
 *
 *   It floats. It is on every screen of the register, in the same corner, and
 *   nothing has to be navigated to reach it. The customer is usually still
 *   walking out of the door.
 *
 *   It is faint until wanted. Half-transparent and small, because it is not
 *   part of ringing a sale and a control that competes with the till for
 *   attention is a control somebody eventually asks to have removed.
 *
 *   It asks one required question. Size. Quantity defaults to one and the note
 *   is optional, because a form with three required fields is a study with
 *   three entries in it.
 *
 *   It confirms in place and stays open. Entering two sizes for one customer is
 *   the normal case, not the exception.
 *
 * It draws nothing at all unless the shop has switched the study on — see
 * `tire_demand_enabled`. A study runs for a few months and then stops, and a
 * permanent button nobody has a reason to press is one people stop seeing.
 */

const QUICK = [1, 2, 4];

export function TireDemandButton() {
  const { can } = usePosAuth();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The last one written, echoed back. See `saved`. */
  const [saved, setSaved] = useState<string | null>(null);
  const sizeRef = useRef<HTMLInputElement | null>(null);

  // Asked once per mount. The switch changes about twice a year; polling it
  // would be a request every few seconds for an answer that is almost never
  // different, on the machine that has to stay quick.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/tire-demand?from=9999-01-01&to=9999-01-01");
      if (!res.ok) return;
      const d = await res.json();
      setEnabled(d.enabled === true);
    })();
  }, []);

  useEffect(() => {
    if (open) sizeRef.current?.focus();
  }, [open]);

  // Nothing to draw for somebody who cannot ring a sale, and nothing to draw
  // when the study is not running.
  if (!enabled || !can("ringSale")) return null;

  async function save() {
    const s = size.trim();
    if (!s) {
      setError("What size were they after?");
      sizeRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pos/tire-demand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: s, qty, note }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "That did not save");
      return;
    }
    // Cleared and left open, with the last one named above the box. The next
    // thing that happens is usually a second size for the same customer, and
    // closing the panel to say "saved" would make that a second trip.
    setSaved(`${qty > 1 ? `${qty}× ` : ""}${s}`);
    setSize("");
    setQty(1);
    setNote("");
    sizeRef.current?.focus();
  }

  if (!open)
    return (
      <button
        type="button"
        className="td-fab"
        title="A customer asked for a size we did not have"
        aria-label="Record a tire we did not have"
        onClick={() => {
          setSaved(null);
          setError(null);
          setOpen(true);
        }}
      >
        {/* A tire, and a small arrow leaving it. The icon has to read at 40px
            from the corner of the eye — anything with detail in it is a grey
            smudge at this size. */}
        <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true">
          <circle cx="11" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="11" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M18.5 6.5h4m0 0v4m0-4-4.2 4.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );

  return (
    <div className="td-panel" role="dialog" aria-label="Tire we did not have">
      <div className="td-head">
        <span>Didn&apos;t have it</span>
        <button type="button" className="td-x" aria-label="Close" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      <p className="td-why">
        A customer asked for a size we could not sell them. This is only for the
        buying list — it changes nothing about today.
      </p>

      <input
        ref={sizeRef}
        className="input w-full"
        placeholder="245/45R20 · 31x10.50R15 · 225 75 16"
        value={size}
        onChange={(e) => setSize(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setOpen(false);
        }}
        aria-label="Tire size"
      />

      <div className="td-qty">
        <span>How many</span>
        {QUICK.map((n) => (
          <button
            key={n}
            type="button"
            className={qty === n ? "td-q td-q-on" : "td-q"}
            aria-pressed={qty === n}
            onClick={() => setQty(n)}
          >
            {n}
          </button>
        ))}
        {/* Anything that is not one, two or four. Those three cover nearly every
            customer, and the box is for the fifth one rather than for the
            common case. */}
        <input
          className="input td-qn"
          inputMode="numeric"
          value={QUICK.includes(qty) ? "" : String(qty)}
          placeholder="…"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isInteger(n) && n > 0) setQty(Math.min(n, 24));
          }}
          aria-label="How many tires"
        />
      </div>

      <input
        className="input w-full td-note"
        placeholder="Anything worth knowing — brand asked for, wanted it today…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        aria-label="Note"
      />

      {error && <div className="td-err">{error}</div>}
      {saved && !error && (
        <div className="td-ok">
          Written down: <strong>{saved}</strong>. Another?
        </div>
      )}

      <div className="td-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Write it down"}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </div>
  );
}
