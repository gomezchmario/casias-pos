"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents, parseCents } from "@/lib/money";
import type { DayTotals } from "@/lib/pos-reports";
import type {
  CashierTotal,
  MethodVariance,
  Reconciliation,
  Shift,
  SwapHint,
} from "@/lib/shifts";
import "./eod.css";

type EodData = {
  scope: "day" | "shift";
  businessDate: string;
  shift: Shift | null;
  shifts: Shift[];
  currentShift: Shift | null;
  reconciliation: Reconciliation;
  byCashier: CashierTotal[];
  dayTotals: DayTotals;
  seq: { duplicates: string[]; gaps: string[]; missing: { saleNo: string }[] };
  canSeePurchases: boolean;
  shopName: string;
};

export default function EndOfDayPage() {
  const { can } = usePosAuth();
  const [date, setDate] = useState("");
  const [shiftId, setShiftId] = useState<number | "">("");
  const [data, setData] = useState<EodData | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Counts the cashier has typed but not yet checked. Kept separate from the
  // saved ones so re-loading the report never silently discards typing.
  const dirty = useRef(false);

  const countsPayload = useMemo(() => {
    const out: { methodId: number; countedCents: number }[] = [];
    for (const [id, raw] of Object.entries(counts)) {
      const cents = parseCents(raw);
      if (cents === null || cents < 0) continue;
      out.push({ methodId: Number(id), countedCents: cents });
    }
    return out;
  }, [counts]);

  const load = useCallback(
    async (preview: boolean) => {
      setError(null);
      const res = preview
        ? await fetch("/api/pos/reports/eod", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shiftId: shiftId === "" ? null : shiftId,
              date: date || undefined,
              counts: countsPayload,
            }),
          })
        : await fetch(
            `/api/pos/reports/eod?${shiftId !== "" ? `shiftId=${shiftId}` : `date=${date}`}`,
          );
      if (!res.ok) {
        setError("Could not load the close-out");
        return;
      }
      const d: EodData = await res.json();
      setData(d);
      if (!date) setDate(d.businessDate);
      if (!preview && !dirty.current) {
        // Seed the boxes with whatever was counted previously, so reopening a
        // closed shift shows what was actually counted rather than blanks.
        const seeded: Record<number, string> = {};
        for (const m of d.reconciliation.methods) {
          if (m.counted && m.countedCents !== null)
            seeded[m.methodId] = (m.countedCents / 100).toFixed(2);
        }
        setCounts(seeded);
      }
    },
    [date, shiftId, countsPayload],
  );

  useEffect(() => {
    void load(false);
    // Deliberately not re-running on countsPayload: typing a count must not
    // fire a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shiftId]);

  async function closeOut() {
    if (!data?.shift || busy) return;
    setBusy(true);
    const res = await fetch(`/api/pos/shifts/${data.shift.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counts: countsPayload, note: note.trim() || null }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not close the shift");
      return;
    }
    dirty.current = false;
    setNote("");
    void load(false);
  }

  async function startShift() {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/pos/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingFloatCents: 0 }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not open a shift");
      return;
    }
    void load(false);
  }

  if (!data) return <div className="text-brand-300">Loading close-out…</div>;

  const r = data.reconciliation;
  const openShiftHere = data.currentShift;
  // A net variance of zero does NOT mean the drawer is right: cash short $40 and
  // Clover over $40 nets to nothing while still being a real mis-tendered sale.
  // Only call it balanced when every tender counted is individually correct.
  const everyTenderBalances = r.methods.every((m) => !m.counted || m.varianceCents === 0);

  return (
    <div className="max-w-4xl eod">
      <div className="flex items-end justify-between mb-6 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">End of day</h1>
          <p className="text-brand-400 text-sm">
            Count the drawer and the terminal, then check the difference.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => {
              setShiftId("");
              dirty.current = false;
              setDate(e.target.value);
            }}
          />
          <select
            className="input"
            value={shiftId}
            onChange={(e) => {
              dirty.current = false;
              setShiftId(e.target.value === "" ? "" : Number(e.target.value));
            }}
          >
            <option value="">Whole day</option>
            {data.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shift_no} · {s.opened_by_name}
                {s.is_open ? " (open)" : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <div className="print-only mb-4">
        <div className="text-xl font-bold">{data.shopName}</div>
        <div className="text-sm">
          {data.scope === "shift" && data.shift
            ? `Shift ${data.shift.shift_no} — ${data.shift.opened_by_name}`
            : "Day close-out"}{" "}
          · {data.businessDate}
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-700">{error}</div>}

      {!openShiftHere && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between no-print">
          <span>No shift is open. The next sale will start one automatically.</span>
          {can("closeShift") && (
            <button
              type="button"
              className="btn btn-primary text-sm"
              onClick={() => void startShift()}
              disabled={busy}
            >
              Start a shift now
            </button>
          )}
        </div>
      )}

      <Section title="What the register says">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <Stat label="Sold" value={formatCents(data.dayTotals.goodsCents)} sub={`${data.dayTotals.saleCount} tickets`} />
          <Stat label="Cashback out" value={formatCents(data.dayTotals.tipCents)} />
          <Stat label="Cashback fees" value={formatCents(data.dayTotals.commCents)} sub="shop keeps" />
          <Stat label="Collected" value={formatCents(data.dayTotals.collectedCents)} />
        </div>
        {data.canSeePurchases && data.dayTotals.purchaseCount > 0 && (
          <p className="text-xs text-brand-300 mt-2">
            Includes {formatCents(data.dayTotals.purchasesCents)} paid out for stock on{" "}
            {data.dayTotals.purchaseCount} purchase ticket
            {data.dayTotals.purchaseCount === 1 ? "" : "s"}, already netted out of cash.
          </p>
        )}
        {/*
          Stays on the printout deliberately. The figures above are day-wide
          while the count below is one shift, and on paper -- with no scope
          selector visible -- there is nothing else to say which is which.
        */}
        {data.scope === "shift" && (
          <p className="text-xs text-brand-300 mt-2">
            Sold and cashback above cover the whole business day. Only the count below
            is limited to this shift.
          </p>
        )}
      </Section>

      <Section title="Count the money">
        <table className="w-full text-sm eod-table">
          <thead>
            <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
              <th className="py-2">Tender</th>
              <th className="py-2 text-right">Expected</th>
              <th className="py-2 text-right">Counted</th>
              <th className="py-2 text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {r.methods
              .filter((m) => m.count > 0 || m.counted || counts[m.methodId])
              .map((m) => (
                <CountRow
                  key={m.methodId}
                  method={m}
                  value={counts[m.methodId] ?? ""}
                  onChange={(v) => {
                    dirty.current = true;
                    setCounts((c) => ({ ...c, [m.methodId]: v }));
                  }}
                />
              ))}
          </tbody>
          {r.anyCounted && (
            <tfoot>
              <tr className="border-t-2 border-black/20 font-semibold">
                <td className="py-2">Total counted</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(r.totalExpectedCents)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(r.totalCountedCents)}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${
                    everyTenderBalances ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {r.totalVarianceCents > 0 ? "+" : ""}
                  {formatCents(r.totalVarianceCents)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        <div className="flex items-center gap-2 mt-3 no-print">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void load(true)}
            disabled={busy || countsPayload.length === 0}
          >
            Check the difference
          </button>
          {r.anyCounted && everyTenderBalances && (
            <span className="text-sm text-green-700">Everything balances.</span>
          )}
        </div>
      </Section>

      {r.hints.length > 0 && <MixUps hints={r.hints} />}

      {r.anyCounted && !everyTenderBalances && r.hints.length === 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold mb-1">
            {r.totalVarianceCents === 0
              ? "The total comes out right, but the individual tenders do not."
              : `Out by ${formatCents(Math.abs(r.totalVarianceCents))}, and it does not look like a tender mix-up.`}
          </div>
          No two tenders are off by the same amount in opposite directions, so this is
          more likely a miscount, a missing ticket, or cash taken out without a ticket.
        </div>
      )}

      <Section title="Who took the money">
        <table className="w-full text-sm eod-table">
          <tbody>
            {data.byCashier.map((c) => (
              <tr key={c.employeeId} className="border-t border-black/5">
                <td className="py-2">{c.name}</td>
                <td className="py-2 text-right text-brand-300">{c.count} payments</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(c.collectedCents)}
                </td>
              </tr>
            ))}
            {data.byCashier.length === 0 && (
              <tr>
                <td className="py-3 text-brand-300">Nothing collected yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      {(data.seq.duplicates.length > 0 ||
        data.seq.gaps.length > 0 ||
        data.seq.missing.length > 0) && (
        <Section title="Card terminal (SEQ)">
          <div className="text-sm text-brand-400 flex flex-col gap-1">
            {data.seq.duplicates.length > 0 && (
              <div>Duplicate SEQ: {data.seq.duplicates.join(", ")}</div>
            )}
            {data.seq.gaps.length > 0 && <div>Missing SEQ: {data.seq.gaps.join(", ")}</div>}
            {data.seq.missing.length > 0 && (
              <div>
                Card sales with no SEQ: {data.seq.missing.map((m) => m.saleNo).join(", ")}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Controls, not report. A printed close-out should not carry a button. */}
      {data.shift?.is_open === 1 && can("closeShift") && (
        <div className="no-print">
          <Section title="Close this shift">
            <p className="text-sm text-brand-400 mb-3">
              Closing freezes the counts above against {data.shift.shift_no}. Sales
              carry on as normal — the next one opens a fresh shift.
            </p>
            <div className="flex items-end gap-2">
              <label className="text-xs text-brand-400 flex-1">
                Note (optional)
                <input
                  className="input mt-1 w-full"
                  placeholder="Anything worth remembering about this count"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void closeOut()}
                disabled={busy}
              >
                {busy ? "Working…" : "Close shift"}
              </button>
            </div>
          </Section>
        </div>
      )}

      {data.shift && data.shift.is_open === 0 && (
        <div className="text-sm text-brand-400">
          Closed {data.shift.closed_at} by {data.shift.closed_by_name}.
          {data.shift.closing_note && ` — ${data.shift.closing_note}`}
        </div>
      )}
    </div>
  );
}

function CountRow({
  method,
  value,
  onChange,
}: {
  method: MethodVariance;
  value: string;
  onChange: (v: string) => void;
}) {
  const typed = parseCents(value);
  const variance = typed === null ? null : typed - method.expectedCents;

  return (
    <tr className="border-t border-black/5">
      <td className="py-2">
        {method.label}
        <span className="text-xs text-brand-300 ml-2">
          {method.count} payment{method.count === 1 ? "" : "s"}
        </span>
      </td>
      <td className="py-2 text-right tabular-nums">{formatCents(method.expectedCents)}</td>
      <td className="py-2 text-right">
        <input
          className="input text-right tabular-nums w-28 no-print"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="print-only tabular-nums">
          {typed === null ? "—" : formatCents(typed)}
        </span>
      </td>
      <td
        className={`py-2 text-right tabular-nums ${
          variance === null ? "text-brand-300" : variance === 0 ? "text-green-700" : "text-red-700"
        }`}
      >
        {variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatCents(variance)}`}
      </td>
    </tr>
  );
}

/**
 * The whole reason this screen exists. Two tenders off by the same amount in
 * opposite directions is almost always one sale keyed on the wrong button, so
 * say so plainly and name the tickets it could be.
 */
function MixUps({ hints }: { hints: SwapHint[] }) {
  return (
    <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3">
      <div className="font-semibold text-amber-900 mb-2">
        This looks like a payment rung on the wrong tender
      </div>
      {hints.map((h, i) => (
        <div key={i} className="text-sm text-amber-900 mb-3 last:mb-0">
          <div>
            <strong>{h.shortLabel}</strong> is short by {formatCents(h.amountCents)} and{" "}
            <strong>{h.overLabel}</strong> is over by the same amount — so a{" "}
            {h.overLabel} sale was probably rung as {h.shortLabel}.
          </div>
          {h.candidates.length > 0 ? (
            <div className="mt-1">
              <div className="text-xs uppercase tracking-wider opacity-70">
                {h.shortLabel} payments for exactly {formatCents(h.amountCents)} — one of
                these was likely {h.overLabel}
              </div>
              <ul className="list-disc pl-5">
                {h.candidates.map((c) => (
                  <li key={c.paymentId}>
                    <a
                      href={`/pos/sale/${c.saleId}/receipt`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {c.saleNo}
                    </a>{" "}
                    — {formatCents(c.amountCents)}, taken by {c.takenBy}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-1 text-xs opacity-80">
              No single {h.shortLabel} payment matches that amount exactly, so it may be
              more than one ticket.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 eod-section">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-brand-300">{label}</div>
      <div className="text-xl font-semibold text-brand-500 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-brand-300">{sub}</div>}
    </div>
  );
}
