"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents, parseCents } from "@/lib/money";
import { nowLocalIso } from "@/lib/time";
import { workStatusTitle } from "@/lib/work-status";
import type {
  DayEntry,
  DayTotals,
  OffRackLine,
  OutstandingTicket,
  TrendDay,
} from "@/lib/pos-reports";
import type {
  CashierTotal,
  MethodVariance,
  Reconciliation,
  Shift,
  SwapHint,
} from "@/lib/shifts";
import type { DrawerMovement } from "@/lib/drawer";
import type { RegisterCheck } from "@/lib/register-checks";
import "./eod.css";

type EodData = {
  scope: "day" | "shift";
  businessDate: string;
  today: string;
  shift: Shift | null;
  shifts: Shift[];
  currentShift: Shift | null;
  reconciliation: Reconciliation;
  byCashier: CashierTotal[];
  dayTotals: DayTotals;
  offRack: OffRackLine[];
  outstanding: OutstandingTicket[];
  trend: TrendDay[];
  entries: DayEntry[];
  drawer: DrawerMovement[];
  registerChecks: RegisterCheck[];
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKind, setDrawerKind] = useState<"withdrawal" | "deposit">("withdrawal");
  const [drawerAmount, setDrawerAmount] = useState("");
  const [drawerReason, setDrawerReason] = useState("");
  // Counts the cashier has typed but not yet checked. Kept separate from the
  // saved ones so re-loading the report never silently discards typing.
  const dirty = useRef(false);

  /**
   * The close-out runs in order, and the printout is the end of it.
   *
   * Count → check the difference → close the card batch → print. Each step
   * unlocks the next, because the sheet that gets signed and filed is a claim
   * that all of them were done, and a sheet printed before the batch was
   * settled is a claim that is not true. The shop's whole card reconciliation
   * rests on the terminal's batch total matching this page; printing first and
   * settling afterwards is how a night ends with paper that says one thing and
   * a merchant statement that says another.
   *
   * Both flags live only in this tab, not in the database. They gate an action
   * that produces paper — they are not a record of anything, and storing them
   * would invite reading "batch closed" off a screen as evidence that it was.
   * The evidence is the terminal's own printout, stapled to this one.
   */
  const [checked, setChecked] = useState(false);
  const [batchClosedAt, setBatchClosedAt] = useState<string | null>(null);

  /**
   * Counting blind.
   *
   * Until the register is logged, the Expected column is covered. This is not
   * decoration — a count taken next to the number it is supposed to produce is
   * not a count, it is transcription. Everybody means to count honestly and
   * everybody, at nine at night with a queue at the door, will glance right and
   * type $842.17 because that is what it says. And that is exactly the night a
   * genuine forty-dollar gap files itself away as balanced.
   *
   * Uncovered the moment the register is logged, because from then on the whole
   * point of the screen is comparing the two, and re-covered by `resetSequence`
   * whenever the count changes — a second attempt at a count is still a count.
   *
   * The owner is exempt. They are who reads the sheet rather than who the sheet
   * is a control on, and there is no one for them to be honest in front of.
   */
  const countBlind = !can("skipBlindCount");
  const showExpected = checked || !countBlind;


  /**
   * Any change to what is being counted, or to which day is on screen, takes
   * the whole sequence back to the start.
   *
   * This is the part worth being strict about. A cashier who checks, closes the
   * batch, then notices a fifty they missed and types it in has a stale check
   * and a batch closed against the wrong figure — and the Print button, if it
   * stayed lit, would hand them a sheet that looks finished.
   */
  const resetSequence = useCallback(() => {
    setChecked(false);
    setBatchClosedAt(null);
  }, []);

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
        return false;
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
      return true;
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

  /**
   * The one button. Counts go in the table above — the same table, at noon and
   * at nine — and this writes them down.
   *
   * There is deliberately no second set of boxes anywhere on this page. A
   * midday count and a closing count are the same physical act on the same
   * drawer, and giving them separate inputs would mean two places to type the
   * same number, two chances to type it into the wrong one, and a screen that
   * has to explain which is which. Counting the register three times in a day
   * is three presses of this button, and the log below fills up.
   *
   * Saving comes first and revealing second, on purpose. The expected figures
   * uncover as a consequence of the count being written down, so there is no
   * order of operations in which somebody sees the answer and then decides
   * whether to record their count.
   */
  async function logRegister() {
    if (busy) return;
    if (countsPayload.length === 0) {
      setError("Type what is in the drawer and on the terminal first");
      return;
    }
    setBusy(true);
    // Only for today. A log is a statement about what is physically in the
    // drawer at this moment, so reading back last Tuesday's sheet gets the
    // comparison and writes nothing.
    if (data?.businessDate === data?.today && shiftId === "") {
      const res = await fetch("/api/pos/register-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counts: countsPayload }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setBusy(false);
        setError(d.error || "Could not log the register");
        return;
      }
    }
    const ok = await load(true);
    setBusy(false);
    if (ok) setChecked(true);
  }

  async function removeRegisterCheck(c: RegisterCheck) {
    if (busy) return;
    const why = window.prompt(
      `Remove the ${shortTime(c.checkedAt)} log by ${c.checkedByName}? Say why:`,
      "Counted into the wrong tender",
    );
    if (!why?.trim()) return;
    setBusy(true);
    const res = await fetch("/api/pos/register-checks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, reason: why.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not remove that log");
      return;
    }
    void load(false);
  }

  async function saveDrawerMovement() {
    if (busy) return;
    const cents = parseCents(drawerAmount);
    if (cents === null || cents <= 0) {
      setError("Enter how much cash is moving");
      return;
    }
    if (!drawerReason.trim()) {
      setError("Say what the money is for");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/drawer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountCents: cents,
        kind: drawerKind,
        reason: drawerReason.trim(),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not record that");
      return;
    }
    setError(null);
    setDrawerAmount("");
    setDrawerReason("");
    setDrawerOpen(false);
    void load(false);
  }

  async function undoDrawerMovement(m: DrawerMovement) {
    if (busy) return;
    const why = window.prompt(
      `Put ${formatCents(Math.abs(m.amount_cents))} back? Say why:`,
      "Entered by mistake",
    );
    if (!why?.trim()) return;
    setBusy(true);
    const res = await fetch("/api/pos/drawer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reverseId: m.id, reason: why.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not undo that");
      return;
    }
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
  const drawerNet = data.drawer.reduce((s, m) => s + m.amount_cents, 0);
  // Pressing the button writes a log only when the page is showing the day and
  // scope the drawer is actually in right now. Anywhere else it is a read.
  const canLogNow =
    data.businessDate === data.today && shiftId === "" && can("closeShift");

  return (
    <div className="max-w-4xl eod">
      <div className="flex items-end justify-between mb-6 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">End of day</h1>
          <p className="text-brand-400 text-sm">
            Count the drawer and the terminal, then log the register.
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
              resetSequence();
              setDate(e.target.value);
            }}
          />
          <select
            className="input"
            value={shiftId}
            onChange={(e) => {
              dirty.current = false;
              resetSequence();
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
          {/* The Print button that used to sit here is gone. Up here it was
              always available, which made it the easy way to produce a sheet
              without having counted anything. It now lives at the end of the
              count, where it is the last step of a sequence rather than a
              shortcut past one. */}
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
          <Stat label="Tips" value={formatCents(data.dayTotals.tipCents)} sub="to technicians" />
          <Stat label="Terminal tax" value={formatCents(data.dayTotals.commCents)} sub="on tips taken out" />
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
            Sold and tips above cover the whole business day. Only the count below
            is limited to this shift.
          </p>
        )}
      </Section>

      {/* On paper this section exists only when cash actually moved. A block
          that prints "Nothing taken out or put in today" every night for a year
          is a block people stop reading, and it is the one place an unexplained
          $200 out of the drawer would have shown up. */}
      {(data.drawer.length > 0 || can("drawerCash")) && (
        <Section
          title="Cash in and out of the drawer"
          className={data.drawer.length === 0 ? "no-print" : undefined}
        >
          <p className="text-sm text-brand-400 mb-3">
            Money moved for reasons that are not sales by management. It changes
            what should be in the drawer and nothing else.
          </p>

          {data.drawer.length > 0 ? (
            <table className="w-full text-sm eod-table">
              <tbody>
                {data.drawer.map((m) => {
                  const undone = m.reversed_by_id !== null;
                  return (
                    <tr
                      key={m.id}
                      className="border-t border-black/5"
                      style={undone ? { opacity: 0.5 } : undefined}
                    >
                      <td className="py-2">
                        <span
                          style={
                            undone ? { textDecoration: "line-through" } : undefined
                          }
                        >
                          {m.reason}
                        </span>
                        {m.kind === "reversal" && (
                          <span className="text-xs text-brand-300 ml-2">undo</span>
                        )}
                        <div className="text-xs text-brand-300">
                          {shortTime(m.created_at)} · {m.created_by_name}
                        </div>
                      </td>
                      <td
                        className="py-2 text-right tabular-nums whitespace-nowrap"
                        style={{ color: m.amount_cents < 0 ? "#b45309" : "#15803d" }}
                      >
                        {m.amount_cents > 0 ? "+" : "−"}
                        {formatCents(Math.abs(m.amount_cents))}
                      </td>
                      <td className="py-2 text-right no-print" style={{ width: 60 }}>
                        {can("drawerCash") && !undone && m.kind !== "reversal" && (
                          <button
                            type="button"
                            className="text-xs text-brand-300 underline"
                            onClick={() => void undoDrawerMovement(m)}
                            disabled={busy}
                          >
                            Undo
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/20 font-semibold">
                  <td className="py-2">Net out of the drawer</td>
                  <td className="py-2 text-right tabular-nums">
                    {drawerNet > 0 ? "+" : drawerNet < 0 ? "−" : ""}
                    {formatCents(Math.abs(drawerNet))}
                  </td>
                  <td className="no-print" />
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="text-sm text-brand-300">
              Nothing taken out or put in today.
            </div>
          )}

          {can("drawerCash") && (
            <div className="no-print mt-3">
              {!drawerOpen ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setDrawerOpen(true)}
                >
                  Take cash out
                </button>
              ) : (
                <div className="flex items-end gap-2 flex-wrap">
                  <label className="text-xs text-brand-400">
                    What happened
                    <select
                      className="input mt-1"
                      value={drawerKind}
                      onChange={(e) =>
                        setDrawerKind(e.target.value as "withdrawal" | "deposit")
                      }
                    >
                      <option value="withdrawal">Cash out of the drawer</option>
                      <option value="deposit">Cash into the drawer</option>
                    </select>
                  </label>
                  <label className="text-xs text-brand-400">
                    Amount
                    <input
                      className="input mt-1 w-28 text-right tabular-nums"
                      inputMode="decimal"
                      placeholder="0.00"
                      autoFocus
                      value={drawerAmount}
                      onChange={(e) => setDrawerAmount(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-brand-400 flex-1" style={{ minWidth: 200 }}>
                    What for
                    <input
                      className="input mt-1 w-full"
                      placeholder="To the bank, to the safe, paid the water bill…"
                      value={drawerReason}
                      onChange={(e) => setDrawerReason(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveDrawerMovement();
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveDrawerMovement()}
                    disabled={busy}
                  >
                    {busy ? "Working…" : "Record it"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDrawerOpen(false);
                      setDrawerAmount("");
                      setDrawerReason("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* The week behind tonight, in two bars-and-nothing-else charts.
          One number on its own is not information — $104 is a good day or a
          disaster depending on the six days before it, and the person signing
          this sheet is the person who knows which. Two charts rather than one
          because tickets and takings answer different questions and routinely
          disagree: a quiet day of big tickets and a busy day of flat repairs
          look identical on either chart alone and nothing alike on both.

          Deliberately not a line chart, and deliberately without a y-axis.
          A day's takings is a total, not a reading on a continuum, and a bar
          says so. The axis is left off because nobody reads one at a glance;
          the day being closed carries its own figure printed on it, and every
          other bar is read against that one. */}
      {data.trend.length > 0 && (
        <div
          className="eod-charts grid gap-4 mb-4"
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          <TrendChart
            title="Tickets"
            days={data.trend}
            today={data.businessDate}
            value={(d) => d.saleCount}
            format={(n) => String(n)}
          />
          <TrendChart
            title="Taken in"
            days={data.trend}
            today={data.businessDate}
            value={(d) => d.goodsCents}
            format={(n) => formatCents(n)}
          />
        </div>
      )}

      {/* Every debt on the books, directly above the count.
          Placed here and not at the foot on purpose. The close-out is worked
          top to bottom, and this is the last thing anybody can still do
          something about tonight — a customer who is coming back at six is
          reachable at five, and not at all once the sheet is signed. Below the
          count it would be a summary; above it, it is a prompt.

          The same list, the same amber, the same columns as the day screen
          leads with, because the person reading this at 9pm has been looking at
          that panel all day and should not have to re-learn it on paper. The
          only things dropped are the two that mean nothing on a sheet: the
          ticket number stops being a button, and the status stops being a
          dropdown and becomes the word it was showing. */}
      {data.outstanding.length > 0 && (
        <div className="eod-outstanding rounded-2xl shadow-sm p-4 mb-4"
             style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)" }}>
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-amber-800">
              ⚠️ Outstanding — {data.outstanding.length}{" "}
              {data.outstanding.length === 1 ? "ticket" : "tickets"} owing
            </div>
            <div className="text-lg font-semibold tabular-nums text-amber-900">
              {formatCents(
                data.outstanding.reduce((s, o) => s + o.balanceCents, 0),
              )}
            </div>
          </div>
          <table className="w-full text-sm eod-table">
            <tbody>
              {data.outstanding.map((o) => (
                <tr key={o.saleId} className="border-t border-amber-900/10">
                  <td className="py-1.5 font-medium text-amber-900 whitespace-nowrap">
                    {o.saleNo}
                  </td>
                  <td className="py-1.5 text-amber-900/80">
                    {o.customerName ?? (
                      <span className="text-amber-900/40">no name taken</span>
                    )}
                    {o.customerPhone && ` · ${o.customerPhone}`}
                    {o.notes && (
                      <div className="italic text-amber-900/60">{o.notes}</div>
                    )}
                  </td>
                  {/* The long form of the status. "Waiting" alone is fine on
                      screen where orange finishes the sentence; in one colour on
                      paper, "Waiting on us" and "Waiting on delivery" are
                      opposite instructions that abbreviate identically. */}
                  <td className="py-1.5 text-amber-900/70 whitespace-nowrap">
                    {workStatusTitle(o.workStatus) ?? ""}
                  </td>
                  {/* The date AND how old it is. On screen the day board can
                      leave the arithmetic to whoever is reading it, because
                      they know what today is. A sheet gets filed and pulled out
                      again in November, and "2026-07-30" beside a $256 balance
                      says nothing about whether that is a customer coming back
                      Friday or a debt nobody has chased in a fortnight. */}
                  <td className="py-1.5 text-amber-900/60 tabular-nums text-right whitespace-nowrap">
                    {o.businessDate}
                    {o.businessDate !== data.businessDate && (
                      <span className="font-medium"> · {daysOld(o.businessDate, data.businessDate)}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/60 whitespace-nowrap">
                    of {formatCents(o.totalCents)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-amber-900 whitespace-nowrap">
                    {formatCents(o.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Section title="Count the money">
        {/* Says why the column is dashes, so it reads as a rule rather than as
            the page having failed to load. */}
        {!showExpected && (
          <p className="text-sm text-brand-400 mb-3 no-print">
            Count it first. What the register expects is covered until you log it.
          </p>
        )}
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
                  showExpected={showExpected}
                  value={counts[m.methodId] ?? ""}
                  onChange={(v) => {
                    dirty.current = true;
                    resetSequence();
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
                  {showExpected ? formatCents(r.totalExpectedCents) : <Covered />}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(r.totalCountedCents)}
                </td>
                {/* Covered along with Expected, and for the same reason: a
                    difference plus a counted figure IS the expected figure,
                    and leaving it showing would make the cover decorative. */}
                <td
                  className={`py-2 text-right tabular-nums ${
                    everyTenderBalances ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {showExpected ? (
                    <>
                      {r.totalVarianceCents > 0 ? "+" : ""}
                      {formatCents(r.totalVarianceCents)}
                    </>
                  ) : (
                    <Covered />
                  )}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* The close-out, left to right, in the order it is done.
            Laid out as one row of three rather than three scattered controls,
            because the sequence IS the procedure — somebody new should be able
            to work out what to do tonight by reading which button is lit. */}
        <div className="flex items-center gap-2 mt-3 no-print flex-wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void logRegister()}
            disabled={busy || countsPayload.length === 0}
            title={
              canLogNow
                ? "Write this count down, and show what the register expected"
                : "Show what the register expected — nothing is logged for a past day"
            }
          >
            {busy ? "Working…" : "Log Register"}
          </button>

          {/* Not a checkbox. Settling the batch is a thing somebody walks over
              and does on the terminal, and a button that lights up the next
              step reads as "now go do this" where a tick reads as a claim about
              the past. Clicking again undoes it, because the recovery from a
              mis-click must not be reloading the page and re-typing the count.

              Three states, and the colour is the whole instruction:
                navy, greyed  — not your turn yet, it matches the button before
                               it because it is the same kind of thing
                orange        — your turn, go do it
                green         — done
              Nobody has to read the label to know where they are in the night. */}
          <button
            type="button"
            className={checked && !batchClosedAt ? "btn" : "btn btn-primary"}
            style={
              batchClosedAt
                ? { background: "#15803d", color: "#fff" }
                : checked
                  ? { background: "#ea580c", color: "#fff" }
                  : undefined
            }
            disabled={!checked || busy}
            onClick={() => setBatchClosedAt(batchClosedAt ? null : nowLocalIso())}
            title={
              checked
                ? "Settle the day's card batch on the terminal, then mark it here"
                : "Log the register first"
            }
          >
            {batchClosedAt ? "Batch closed ✓" : "Terminal batch closed"}
          </button>

          <button
            type="button"
            className="btn"
            style={{ background: "#4b5563", color: "#fff" }}
            disabled={!batchClosedAt}
            onClick={() => window.print()}
            title={
              batchClosedAt
                ? "Print the sheet to sign and file"
                : "Close the terminal batch first"
            }
          >
            Print the close-out
          </button>

          {/* No note box. A count is a time, a name and two figures, and there
              is nothing a cashier could type here that the row does not
              already say. The column stays in the database so a reason can be
              attached later if one ever turns out to be wanted. */}

          {r.anyCounted && everyTenderBalances && (
            <span className="text-sm text-green-700">Everything balances.</span>
          )}
        </div>

        {/* Says which step is next in words, for the nights when the greyed-out
            buttons are not enough of an answer. */}
        {!batchClosedAt && (
          <p className="text-xs text-brand-300 mt-2 no-print">
            {countsPayload.length === 0
              ? "Count the drawer and the terminal above, then log the register."
              : !checked
                ? "Log the register, then settle the batch on the card terminal."
                : "Settle the day's batch on the card terminal, then mark it here to print."}
          </p>
        )}
      </Section>

      {/* Counts taken partway through the day.
          The close-out above answers "was tonight right". This answers "when
          did it go wrong", which is the only question worth asking on the
          nights the first answer is no. Four clean checks and a short close
          narrows a missing sixty dollars to the last two hours and to the two
          people who were on — and that is a conversation, where "the drawer
          was short today" is a shrug.

          Below the close-out on the screen and ABOVE it on nothing: this is
          not a step in the nightly sequence, it is a thing that happens at
          noon by somebody who then goes back to work. It sits here because
          this is the page about counting money, not because it is done now. */}
      {(data.registerChecks.length > 0 || canLogNow) && (
        <Section
          title="Register logs through the day"
          className={data.registerChecks.length === 0 ? "no-print" : undefined}
        >
          {/* No paragraph of instructions here. The rows say everything worth
              saying — a time, a name, two figures and whether they agreed —
              and the button that fills them is directly above. */}
          {data.registerChecks.length > 0 ? (
            <table className="w-full text-sm eod-table">
              <tbody>
                {data.registerChecks.map((c) => (
                  <tr key={c.id} className="border-t border-black/5 align-top">
                    <td className="py-2 whitespace-nowrap">
                      <div className="font-medium tabular-nums">{shortTime(c.checkedAt)}</div>
                      <div className="text-xs text-brand-300">{c.checkedByName}</div>
                    </td>
                    <td className="py-2">
                      {c.lines.map((l) => (
                        <div key={l.methodId} className="flex gap-2 justify-between">
                          <span>{l.label}</span>
                          <span className="tabular-nums">
                            {formatCents(l.countedCents)}
                            {/* The expectation as it stood AT THE COUNT, which
                                is the only expectation this count was ever a
                                check of. See the migration. */}
                            <span className="text-brand-300">
                              {" "}
                              of {formatCents(l.expectedCents)}
                            </span>
                            {l.varianceCents !== 0 && (
                              <strong
                                className="eod-log-bad"
                                style={{ color: "#a71d24" }}
                              >
                                {" "}
                                {l.varianceCents > 0 ? "+" : "−"}
                                {formatCents(Math.abs(l.varianceCents))}
                              </strong>
                            )}
                          </span>
                        </div>
                      ))}
                      {c.note && (
                        <div className="text-xs italic text-brand-300 mt-1">{c.note}</div>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {c.balanced ? (
                        <span style={{ color: "#15803d" }}>Balanced</span>
                      ) : (
                        <strong className="eod-log-bad" style={{ color: "#a71d24" }}>
                          OUT BY{" "}
                          {formatCents(
                            Math.abs(
                              c.lines.reduce((s, l) => s + Math.abs(l.varianceCents), 0),
                            ),
                          )}
                        </strong>
                      )}
                    </td>
                    <td className="py-2 text-right no-print" style={{ width: 70 }}>
                      {can("deleteRegisterCheck") && (
                        <button
                          type="button"
                          className="text-xs text-brand-300 underline"
                          onClick={() => void removeRegisterCheck(c)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-brand-300">
              Nothing logged today yet — the first Log Register will land here.
            </div>
          )}

        </Section>
      )}

      {r.hints.length > 0 && <MixUps hints={r.hints} />}

      {/* Screen only. It says the same thing as the boxed flag at the foot of
          the printout, and a sheet that states its problem twice in two
          different tones invites the reading that they are two problems. */}
      {r.anyCounted && !everyTenderBalances && r.hints.length === 0 && (
        <div className="no-print mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
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

      {/* Prices typed over at the counter.
          Appears only when it happened — a section
          that is present every day reading "none" is a section people stop
          seeing. Each row says what the rack wanted and what was charged,
          because "the price was changed" is not actionable and "$170 tire went
          out at $140" is. */}
      {data.offRack.length > 0 && (
        <Section title="Prices changed at the counter">
          <p className="text-sm text-brand-400 mb-2">
            These were rung at something other than the price on the rack.
          </p>
          <table className="w-full text-sm eod-table">
            <tbody>
              {data.offRack.map((l, i) => (
                <tr key={i} className="border-t border-black/5">
                  <td className="py-2 whitespace-nowrap">{l.saleNo}</td>
                  <td className="py-2">
                    {l.description}
                    {l.qty > 1 && <span className="text-brand-300"> ×{l.qty}</span>}
                  </td>
                  <td className="py-2 text-brand-300">{l.who ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums text-brand-300">
                    rack {formatCents(l.listCents)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(l.chargedCents)}
                  </td>
                  <td
                    className="py-2 text-right tabular-nums"
                    style={{ color: l.deltaCents < 0 ? "#a71d24" : "#166534" }}
                  >
                    {l.deltaCents < 0 ? "−" : "+"}
                    {formatCents(Math.abs(l.deltaCents))}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-black/10 font-semibold">
                <td className="py-2" colSpan={5}>
                  {/* Signed, and summed rather than counted. The question a
                      manager actually has is "what did today's flexibility
                      cost", and a count of five lines does not answer it. */}
                  Against the rack, all day
                </td>
                <td className="py-2 text-right tabular-nums">
                  {(() => {
                    const d = data.offRack.reduce((s, l) => s + l.deltaCents, 0);
                    return `${d < 0 ? "−" : "+"}${formatCents(Math.abs(d))}`;
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
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

      {/* The ledger is not here. It is a page of its own and it belongs AFTER
          the signature — see the `DayLedger` at the foot of this file. Putting
          it here would push the sign-off onto page three, and a signature
          block that arrives after forty rows of ledger is a signature block
          nobody signs. */}

      {/* The tail of the printed sheet, and nothing on screen.
          A close-out is only worth filing if it says who did it and that the
          card batch was settled against these figures — the two things a
          disputed statement three weeks from now needs answered. The lines are
          ruled rather than pre-filled because a signature is the point: the
          system can state what it knows, but only a person can attest they
          counted it. */}
      <div className="print-only eod-signoff">
        {/* The headline the filed sheet is read for.
            Checking the difference is allowed to come out wrong — most nights
            that are wrong are the nights the paperwork matters — so nothing
            blocks on it. What must not happen is a short night filing quietly:
            the per-tender differences are in the table above, but a table is
            something you have to read, and this is something you see. Boxed and
            stated in words, at the bottom, directly over the signature that
            says somebody looked. */}
        {!everyTenderBalances && (
          <div className="eod-flag">
            <strong>DOES NOT BALANCE</strong> — out by{" "}
            {formatCents(Math.abs(r.totalVarianceCents))}
            {r.totalVarianceCents === 0
              ? " across tenders, netting to zero overall"
              : r.totalVarianceCents < 0
                ? " short"
                : " over"}
            .{" "}
            {r.methods
              .filter((m) => m.counted && m.varianceCents !== 0)
              .map(
                (m) =>
                  `${m.label} ${m.varianceCents > 0 ? "+" : "−"}${formatCents(
                    Math.abs(m.varianceCents),
                  )}`,
              )
              .join(" · ")}
            {r.hints.length > 0 && " — possible tender mix-up, see above."}
          </div>
        )}
        {/* A midday log that came out wrong, said again at the bottom.
            The logs print in full further up, but a table is something you
            have to read and the sheet gets filed by somebody who is tired. If
            the register was already sixty dollars out at two in the afternoon,
            that is a bigger fact about the day than anything in the close-out
            below it, and it belongs over the signature. */}
        {data.registerChecks.some((c) => !c.balanced) && (
          <div className="eod-flag">
            <strong>A REGISTER LOG DID NOT BALANCE</strong> —{" "}
            {data.registerChecks
              .filter((c) => !c.balanced)
              .map(
                (c) =>
                  `${shortTime(c.checkedAt)} (${c.checkedByName}): ` +
                  c.lines
                    .filter((l) => l.varianceCents !== 0)
                    .map(
                      (l) =>
                        `${l.label} ${l.varianceCents > 0 ? "+" : "−"}${formatCents(
                          Math.abs(l.varianceCents),
                        )}`,
                    )
                    .join(", "),
              )
              .join(" · ")}
            .
          </div>
        )}
        {/* An uncounted tender is not the same as a balanced one and must not
            print as silence. */}
        {r.methods.some((m) => !m.counted && m.count > 0) && (
          <div className="eod-flag eod-flag-quiet">
            Not counted:{" "}
            {r.methods
              .filter((m) => !m.counted && m.count > 0)
              .map((m) => m.label)
              .join(", ")}
            .
          </div>
        )}
        <div className="eod-signoff-line">
          Card terminal batch settled{" "}
          {batchClosedAt ? `at ${shortTime(batchClosedAt)}` : "— NOT CONFIRMED"} ·
          printed {shortTime(nowLocalIso())}
        </div>
        <div className="eod-rules">
          <div className="eod-rule">Counted by</div>
          <div className="eod-rule">Checked by</div>
          <div className="eod-rule">Date</div>
        </div>
      </div>

      {/* Page two onwards. Everything above is the close-out; this is the
          working behind it, and it is here rather than earlier so the sheet
          that gets signed is one page. */}
      <DayLedger data={data} />

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
  showExpected,
  onChange,
}: {
  method: MethodVariance;
  value: string;
  showExpected: boolean;
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
        {/* Say it on the row itself. Someone counting a drawer that is $400
            light needs the explanation next to the number, not in a section
            they may have scrolled past. */}
        {method.drawerAdjustCents !== 0 && (
          <div className="text-xs text-brand-300">
            Includes {formatCents(Math.abs(method.drawerAdjustCents))}{" "}
            {method.drawerAdjustCents < 0 ? "taken out of" : "put into"} the drawer
          </div>
        )}
      </td>
      <td className="py-2 text-right tabular-nums">
        {showExpected ? formatCents(method.expectedCents) : <Covered />}
      </td>
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
        {!showExpected ? (
          <Covered />
        ) : variance === null ? (
          "—"
        ) : (
          `${variance > 0 ? "+" : ""}${formatCents(variance)}`
        )}
      </td>
    </tr>
  );
}

/**
 * The stand-in for a figure somebody is not allowed to see yet.
 *
 * Dashes rather than a blank cell, and on screen only. A blank reads as "there
 * is nothing here", which is a different and wrong claim — the money exists,
 * it is just not being shown until it has been counted. On the printed sheet
 * it collapses to nothing at all, because by the time anything is printing the
 * register has been logged and the real figures are in the cells.
 */
function Covered() {
  return (
    <span className="text-brand-300 no-print" title="Shown once you log the register">
      – – –
    </span>
  );
}

/**
 * The whole reason this screen exists. Two tenders off by the same amount in
 * opposite directions is almost always one sale keyed on the wrong button, so
 * say so plainly and name the tickets it could be.
 */
function MixUps({ hints }: { hints: SwapHint[] }) {
  return (
    /* Prints, unlike the plain out-by advisory above it: this one names the
       tickets, and a ticket number is the only thing on the sheet somebody can
       act on tomorrow morning. The tint drops away on paper — see eod.css. */
    <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 eod-mixups">
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

/**
 * The back of the close-out: everything that was rung, on its own page.
 *
 * Print only, and deliberately last in the document even though it reads as
 * "the detail behind the summary". The order on paper is the order of
 * importance to the person filing it — the count and the signature are page
 * one, and the working is behind. Put the other way round, the sign-off lands
 * on page three under forty rows of ledger and stops being signed.
 */
function DayLedger({ data }: { data: EodData }) {
  if (data.entries.length === 0) return null;

  const tires = data.entries.filter(
    (e) => e.kind === "line" && e.category === "New Tire" && !e.voided,
  );
  const tireTotal = tires.reduce((s, e) => s + e.amountCents, 0);

  return (
    <div className="print-only eod-ledger">
      <div className="eod-ledger-head">
        {data.shopName} · {data.businessDate} · everything rung
      </div>

      {/* Tires first, and by themselves.
          Not a filter picked at random: a new tire is the only thing in this
          shop that leaves a hole in a rack. Every other line is labour, and
          labour does not need reconciling against stock. So the one question
          worth being able to answer off a filed sheet — "what came off the
          shelves on the 4th" — gets its own block at the top instead of being
          scattered through forty rows.

          The same rows appear again below in the full list. That is
          deliberate: a block that pulled rows OUT of the chronological list
          would break the one property that list is for, which is that it is
          complete and in order. */}
      {tires.length > 0 && (
        <div className="eod-ledger-block">
          <div className="eod-ledger-title">
            New tires out — {tires.length} line{tires.length === 1 ? "" : "s"},{" "}
            {formatCents(tireTotal)}
          </div>
          <table className="w-full text-sm eod-table">
            <tbody>
              {tires.map((e) => (
                <tr key={e.key} className="border-t border-black/10">
                  <td className="py-1 tabular-nums whitespace-nowrap">{shortTime(e.at)}</td>
                  <td className="py-1 whitespace-nowrap">{e.saleNo}</td>
                  <td className="py-1">
                    {e.what}
                    {e.detail && <span className="text-brand-300"> {e.detail}</span>}
                  </td>
                  <td className="py-1">{e.who ?? ""}</td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap">
                    {formatCents(e.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Then the whole day, in the order it happened.
          Lines and money interleaved rather than in two tables, because a line
          rung and the money taken against it are one event to whoever is
          reading, and making them merge two lists in their head is exactly the
          step that goes wrong. Voids stay in and are struck through — the
          reason to open a consecutive list is almost always to find the thing
          that went wrong, and the thing that went wrong is very often the
          thing that was voided. */}
      <div className="eod-ledger-block">
        <div className="eod-ledger-title">
          Everything rung — {data.entries.length} entries
        </div>
        <table className="w-full text-sm eod-table">
          <tbody>
            {data.entries.map((e) => (
              <tr
                key={e.key}
                className="border-t border-black/10"
                style={e.voided ? { textDecoration: "line-through" } : undefined}
              >
                <td className="py-1 tabular-nums whitespace-nowrap">{shortTime(e.at)}</td>
                <td className="py-1 whitespace-nowrap">{e.saleNo}</td>
                <td className="py-1 whitespace-nowrap">{e.category}</td>
                <td className="py-1">
                  {e.what}
                  {e.detail && <span className="text-brand-300"> {e.detail}</span>}
                </td>
                <td className="py-1">{e.who ?? ""}</td>
                <td className="py-1 text-right tabular-nums whitespace-nowrap">
                  {formatCents(e.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Seven bars, drawn in HTML rather than a charting library.
 *
 * A chart on a page that must print is not the same problem as a chart on a
 * screen. Canvas and SVG-heavy libraries render at screen resolution, drop
 * their fills when browsers strip backgrounds for printing, and pull a
 * megabyte into a bundle that lives on one PC in a tire shop. Seven divs with a
 * height and a border print at whatever the printer's resolution is, because
 * they are just boxes.
 *
 * The bars are OUTLINED, not filled. A filled bar chart is a solid block of
 * toner seven times over, and the first thing a print driver "helpfully"
 * removes. An outline survives both.
 */
function TrendChart({
  title,
  days,
  today,
  value,
  format,
}: {
  title: string;
  days: TrendDay[];
  today: string;
  value: (d: TrendDay) => number;
  format: (n: number) => string;
}) {
  // Max of one, never zero, so a week with no trade draws a flat baseline
  // instead of dividing by nothing and disappearing.
  const max = Math.max(1, ...days.map(value));

  return (
    <div className="eod-chart bg-white rounded-2xl shadow-sm p-4">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        {title} — last 7 days
      </div>
      <div className="eod-chart-bars flex items-end gap-1" style={{ height: 84 }}>
        {days.map((d) => {
          const v = value(d);
          const isToday = d.businessDate === today;
          return (
            <div key={d.businessDate} className="flex-1 flex flex-col items-center gap-1">
              {/* The figure sits above its own bar. On a sheet that gets read
                  across a counter this is what makes the chart worth printing
                  at all — the shape answers "how was tonight" and the numbers
                  answer "by how much", without a second table. */}
              <div
                className="eod-chart-value tabular-nums text-brand-400"
                style={{ fontSize: 9, lineHeight: 1 }}
              >
                {v === 0 ? "" : format(v)}
              </div>
              <div
                className="eod-chart-bar w-full"
                style={{
                  height: `${Math.max((v / max) * 56, v > 0 ? 2 : 1)}px`,
                  // Today is filled and everything before it is outlined. One
                  // solid bar in seven is the cheapest possible way to say
                  // "this is the day you are closing" and it survives a mono
                  // printer, which a colour difference would not.
                  background: isToday ? "#0a2540" : "transparent",
                  border: "1px solid #0a2540",
                  borderRadius: 2,
                }}
              />
              <div
                className="eod-chart-day text-brand-300"
                style={{ fontSize: 9, lineHeight: 1 }}
              >
                {weekdayLetter(d.businessDate)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Mon", from a plain YYYY-MM-DD.
 *
 * Parsed as UTC and formatted as UTC. Parsing "2026-08-04" as local time puts
 * it at midnight, which in a timezone behind UTC is the previous evening — and
 * the chart would silently label every bar with the wrong weekday.
 */
function weekdayLetter(businessDate: string): string {
  const d = new Date(`${businessDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

/**
 * How long a debt has been sitting, measured against the day being closed and
 * not against the wall clock — so a sheet reprinted next week still describes
 * the night it covers rather than the night it was reprinted.
 *
 * Both dates are plain YYYY-MM-DD, parsed as UTC so the subtraction is whole
 * days and cannot be knocked off by a daylight-saving boundary between them.
 */
function daysOld(businessDate: string, today: string): string {
  const a = Date.parse(`${businessDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return "";
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/** "2026-08-02T14:38:56" -> "2:38 PM". Local ISO, so no Date parsing needed. */
function shortTime(iso: string): string {
  const hm = iso.slice(11, 16);
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h)) return hm;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm p-4 mb-4 eod-section ${className ?? ""}`}>
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
