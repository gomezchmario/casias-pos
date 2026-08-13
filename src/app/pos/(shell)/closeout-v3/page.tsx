"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { RankedBars, Stat } from "@/components/pos/Charts";
import { formatCents, parseCents } from "@/lib/money";
import type { CloseoutV2 } from "@/lib/day-report";
import "../reports/reports.css";
import "./closeout3.css";

/**
 * Close-out V3 — the close-out everyone will eventually use.
 *
 * Owner-only while it is being shaped (see the nav gate); the destination is
 * the whole floor, so every control here is built for a tired cashier at nine
 * at night, not for the owner reading at leisure:
 *
 *   ONE COLUMN, THREE NUMBERED STEPS, ONE LIT BUTTON. Skimming is the enemy —
 *   this page fights it by never offering two things to do at once. Count,
 *   log, print. Everything else on screen is reading, visibly secondary.
 *
 *   BLIND, PER TENDER. The expectation for cash and the card batch each stay
 *   covered until THEIR OWN count is logged — the same rule the old close-out
 *   learned the hard way. The owner is exempt (`skipBlindCount`), because the
 *   owner is who the control reports to, not who it controls.
 *
 *   THE PRINT IS THE PRODUCT. Page one carries only what gets filed and
 *   signed: the register verdict, the reconciliation table, the tips line,
 *   two signatures. Everything else — and by print time it can be everything,
 *   because the reconciliation is already logged and whatever happened has
 *   happened — follows on the pages behind it. Print is refused until the
 *   register is logged, which is what makes page one worth signing.
 *
 * WHEN THIS OPENS TO THE FLOOR, two things must change first, and they are
 * marked below: the margin block leaves the printout (costs are the owner's
 * book), and the data route needs a floor-safe gate instead of
 * `viewBusinessReports`.
 */

type Data = CloseoutV2 & { today: string };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Which side of a difference can be wrong — the shop's own convention, copied
 * from the original close-out where it is documented at length: on a drawer
 * the money is the suspect (minus = cash not there); on a terminal the batch
 * is ground truth, so the sign flips and a plus reads as "the register logged
 * a payment that never happened".
 */
const shownVariance = (varianceCents: number, isCard: number) =>
  isCard ? -varianceCents : varianceCents;
const varianceWords = (cents: number) =>
  cents === 0 ? formatCents(0) : `${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;

export default function CloseoutV3Page() {
  const { can, user } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printedOn, setPrintedOn] = useState("");
  /** Typed counts, by tender code. Only cash and cc take one. */
  const [counts, setCounts] = useState<{ cash: string; cc: string }>({ cash: "", cc: "" });
  /** Codes whose count has been logged this sequence — the per-tender covers. */
  const [logged, setLogged] = useState<ReadonlySet<string>>(new Set());
  const [floatCount, setFloatCount] = useState("");
  /**
   * The clock, ticking, only so the float warning can expire on its own.
   *
   * Held in state rather than read inline because the warning has to go away
   * while somebody is looking at the page — a note that only disappears on the
   * next reload is a note that is still on screen at four in the afternoon,
   * which is the whole complaint.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  /** Clock-out times being typed, by employee — defaulted to now on first edit. */
  const [outAt, setOutAt] = useState<Record<number, string>>({});
  /**
   * Which sheet is going to the printer.
   *
   * The signature page is what gets printed every night and filed; the full
   * report is the same page with the day's evidence behind it, wanted
   * occasionally rather than nightly. Six pages coming out by default is how a
   * printout stops being read and then stops being filed — so the default is
   * the one page, and everything else is a second, deliberate press.
   *
   * The mode has to be committed to the DOM before the print dialog reads it,
   * which is why the button sets state and an effect does the printing.
   */
  const [printMode, setPrintMode] = useState<"page1" | null>(null);
  useEffect(() => {
    if (!printMode) return;
    const done = () => setPrintMode(null);
    window.addEventListener("afterprint", done);
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [printMode]);
  const [drawerKind, setDrawerKind] = useState<"withdrawal" | "deposit">("withdrawal");
  const [drawerAmount, setDrawerAmount] = useState("");
  const [drawerReason, setDrawerReason] = useState("");
  const [drawerHidden, setDrawerHidden] = useState(false);

  useEffect(() => setPrintedOn(new Date().toLocaleString()), []);

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/reports/closeout");
    if (!res.ok) {
      setError("Could not load the day");
      return;
    }
    setData(await res.json());
    setError(null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // The nav already gates this; the render gate is for the URL typed by hand.
  if (!can("viewCloseout"))
    return <div className="text-brand-400">Your account doesn&apos;t close the day.</div>;
  if (error)
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>;
  if (!data) return <div className="text-brand-300">Adding it up…</div>;

  /*
    The "don't record the float here too" note, and the ten minutes it is worth
    reading for.

    The mistake it prevents is a real one and it happens once: first thing in
    the morning, somebody counts the hundred in the drawer and books it a second
    time as cash in. But the note was firing on every cash-in for the rest of
    the day — at four in the afternoon, over a twenty-dollar float from a change
    run — and a warning that is wrong nine times out of ten is a warning people
    stop reading before the tenth.

    So it lives for ten minutes from the day's FIRST cash-in, which is the only
    window in which the confusion is live. Before any cash-in it stays up, since
    that is the moment it is trying to catch. `now` ticks so it expires while
    the page is open rather than at the next reload.
  */
  const firstCashIn = data.drawer.movements
    .filter((m) => m.amount_cents > 0 && !m.reverses_id)
    .map((m) => Date.parse(m.created_at))
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b)[0];
  const floatWarningLive =
    firstCashIn === undefined || now - firstCashIn < 10 * 60 * 1000;

  const weekday = DAY_NAMES[new Date(`${data.businessDate}T12:00:00`).getDay()];

  /*
    Split by whether anybody has answered them.

    A dismissal on the alarm log does not stop an alarm firing — the figures
    underneath it have not changed — but it does mean somebody has looked. An
    alert list where "Mario checked this at 3:51 and said what it was" sits in
    the same red box as "nobody has seen this" is a list that gets read once and
    then skimmed, so the answered ones move below the fold and take their note
    with them.
  */
  const live = data.exceptions.filter((x) => !x.dismissed);
  const answered = data.exceptions.filter((x) => x.dismissed);
  const liveChecks = data.drawer.checks.filter((c) => !c.deleted);
  /** The verdict is read off the LAST live log — the one the paper certifies. */
  const finalCheck = liveChecks.at(-1) ?? null;
  const countable = data.tenders.filter((t) => t.code === "cash" || t.code === "cc");
  const blind = !can("skipBlindCount");
  const show = (code: string) => !blind || logged.has(code);

  const registerLogged = liveChecks.length > 0;
  /*
    Whether PRINTING is allowed, which is not the same question.

    Print is held back until the register is logged because an unsigned sheet
    that certifies nothing is worse than no sheet — a cashier who can print
    before counting has a piece of paper that looks like a close-out and is not
    one.

    The owner is exempt, for the same reason the blind count exempts them: this
    control exists to make sure the count happens before the paperwork, and the
    owner is who that reports TO rather than who it is aimed at. Wanting the
    day's sheet at four in the afternoon to take to the accountant is a normal
    thing for an owner to want, and the verdict line above already says in
    capitals when the register has not been logged, so nothing printed this way
    can pretend otherwise.
  */
  const mayPrint = registerLogged || can("skipBlindCount");
  const outBy = finalCheck
    ? finalCheck.lines.reduce(
        (n, l) => n + Math.abs(shownVariance(l.varianceCents, l.isCard)),
        0,
      )
    : 0;
  const cashLine = finalCheck?.lines.find((l) => l.isCard === 0) ?? null;
  const shortByExactlyTips =
    !!cashLine && data.totals.tipCents > 0 && cashLine.varianceCents === -data.totals.tipCents;

  async function doClockOut(employeeId: number) {
    if (busy) return;
    const hhmm = outAt[employeeId] ?? new Date().toTimeString().slice(0, 5);
    setBusy(true);
    const res = await fetch("/api/pos/hours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        at: `${data!.businessDate}T${hhmm}:00`,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not clock them out");
      return;
    }
    setError(null);
    await load();
  }

  async function saveFloat() {
    if (busy) return;
    const cents = parseCents(floatCount);
    if (cents === null || cents < 0) {
      setError("Type what you counted in the drawer");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/shifts/float", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countedCents: cents }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not record the opening count");
      return;
    }
    setError(null);
    setFloatCount("");
    // The float is the first term of every expectation the day produces, so
    // changing it re-covers any count taken against the old one.
    setLogged(new Set());
    await load();
  }

  async function saveMovement(acknowledgeOverdraw = false) {
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

    /*
      THE FLOAT, ABOUT TO BE ENTERED AS CASH IN.

      This is the mistake this shop actually makes. On 12 August it was made
      twice — $80 at 8:11am "money on cash register at the start of the day",
      then $20 at 10:47 "not money, just for the float so that it balances" —
      and because the shift already carries the float, the two of them counted
      the same hundred a second time and put the drawer $200 out. Somebody then
      booked a $200 withdrawal that never happened to make it balance, which
      hid the whole thing behind a clean zero.

      So the one shape that is almost certainly that mistake gets stopped and
      asked: the day's FIRST cash-in, for EXACTLY the standing float. Both
      conditions matter. A $100 cash-in later in the day is a change run and
      wants no interruption, and the first cash-in of the day for $37 is
      obviously not a float.

      Measured against the float SETTING rather than a hardcoded hundred, so it
      follows the shop if the float ever changes.

      A native confirm, like the overdraw question below it: this has to be
      unmissable and it has to block, and it is the same conversation.
    */
    const floatCents = data?.drawer.floatCents ?? 0;
    const alreadyCashedIn = (data?.drawer.movements ?? []).some(
      (mv) => mv.amount_cents > 0 && !mv.reverses_id,
    );
    if (
      drawerKind === "deposit" &&
      floatCents > 0 &&
      cents === floatCents &&
      !alreadyCashedIn
    ) {
      const ok = window.confirm(
        `That is exactly the register float (${formatCents(floatCents)}), and it is the first cash-in today.\n\n` +
          `IF THIS IS THE MORNING FLOAT, DO NOT RECORD IT HERE.\n\n` +
          `The drawer already carries the float. Entering it here counts the same money twice and leaves the drawer reading over by ${formatCents(floatCents)} at close.\n\n` +
          `Use Step 1 at the top of this page — "count what is in the drawer" — which records the float without moving any money.\n\n` +
          `Is this genuinely other cash going into the drawer?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    const res = await fetch("/api/pos/drawer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountCents: cents,
        kind: drawerKind,
        reason: drawerReason.trim(),
        hidden: drawerHidden,
        acknowledgeOverdraw,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // The one refusal with a second question in it — see the old close-out.
      if (d.overdraw && window.confirm(`${d.error}\n\nRecord it anyway?`)) {
        void saveMovement(true);
        return;
      }
      setError(d.error || "Could not record that");
      return;
    }
    setError(null);
    setDrawerAmount("");
    setDrawerReason("");
    setDrawerHidden(false);
    // Any money moving re-covers the counts: the expectation just changed, so
    // the next count is a fresh count.
    setLogged(new Set());
    await load();
  }

  async function undoMovement(id: number, amountCents: number) {
    if (busy) return;
    const why = window.prompt(
      `Put ${formatCents(Math.abs(amountCents))} back? Say why:`,
      "Entered by mistake",
    );
    if (!why?.trim()) return;
    setBusy(true);
    const res = await fetch("/api/pos/drawer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reverseId: id, reason: why.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not undo that");
      return;
    }
    setLogged(new Set());
    await load();
  }

  async function logRegister() {
    if (busy) return;
    const payload = countable
      .map((t) => ({
        methodId: t.methodId,
        countedCents: parseCents(counts[t.code as "cash" | "cc"] ?? "") ?? -1,
      }))
      .filter((c) => c.countedCents >= 0);
    if (payload.length === 0) {
      setError("Type what is in the drawer and on the terminal first");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/pos/register-checks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counts: payload }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not log the register");
      return;
    }
    setError(null);
    setLogged(
      new Set(
        countable
          .filter((t) => payload.some((p) => p.methodId === t.methodId))
          .map((t) => t.code),
      ),
    );
    await load();
  }

  return (
    <div className="max-w-4xl mx-auto rp cv3">
      {/* ═══ SCREEN: the procedure ═══════════════════════════════════════ */}
      <div className="cv3-screen">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-brand-500">
            Close the day · {weekday} {data.businessDate}
          </h1>
          <p className="text-brand-400 text-sm">
            Step 1 in the morning, the rest at close. The printout is refused until the
            register is logged.
          </p>
        </div>

        {/* ── What needs attention, before anything else ─────────────────
            At the top, above the first step, because a warning found after the
            work is a warning found too late: the point of "one oversell to
            review" or "the racks and the tickets disagree" is that somebody
            walks over and looks BEFORE the drawer is counted and the day is
            signed off. Underneath the steps it was a footnote to work already
            finished. */}
        {live.length > 0 && (
          <div className="rp-concerns mb-4">
            {live.map((x, i) => (
              <div key={i} className={`rp-concern ${x.severity}`}>
                <div className="rp-concern-head">
                  <span className="rp-concern-tag">
                    {x.severity === "serious" ? "Serious" : "Watch"}
                  </span>
                  <span className="rp-concern-find">{x.text}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/*
          Answered alarms drop below the line.

          Dismissing still does not silence anything — the alarm is computed the
          same way and is still on this page, still on the printout, still
          carrying its own words. What changes is that it stops competing with
          the ones nobody has looked at. An alert list where "somebody checked
          this at 3:51 and said what it was" sits in the same red box as "nobody
          has seen this" is a list that gets read once and then skimmed.
        */}
        {answered.length > 0 && (
          <details className="rp-answered">
            <summary>
              {answered.length}{" "}
              {answered.length === 1 ? "alert dealt with" : "alerts dealt with"}
            </summary>
            {answered.map((x, i) => (
              <div key={i} className="rp-answered-row">
                <div className="rp-answered-text">{x.text}</div>
                <div className="rp-answered-by">
                  Dismissed by {x.dismissed?.byName} ·{" "}
                  {x.dismissed?.at.slice(11, 16)}
                  {x.dismissed?.note ? ` — “${x.dismissed.note}”` : ""}
                </div>
              </div>
            ))}
          </details>
        )}

        {/* ── Step 1 · The morning count ─────────────────────────────────
            First thing in the morning, before a single ticket. The float is
            the first term of every expectation the day produces — expected =
            float + takings + movements — so a drawer that actually opened
            with $80 reads $20 short at nine at night, and the search covers
            the whole day instead of the two minutes before opening.

            Counting here does NOT create a cash-in movement. The shift
            already carries the float; recording it as money arriving counts
            the same hundred twice, which is a real morning this shop lost
            hours to. See countOpeningFloat. */}
        <div className="cv3-step">
          <div className="cv3-step-head">
            <span className="cv3-step-no">1</span>
            <span className="cv3-step-title">Count the opening drawer</span>
          </div>
          {data.drawer.floatCountedAt ? (
            <div className="cv3-float-done">
              ✓ {formatCents(data.drawer.floatCents)} counted at{" "}
              {data.drawer.floatCountedAt.slice(11, 16)}
              {data.drawer.floatCountedByName && ` by ${data.drawer.floatCountedByName}`}.
            </div>
          ) : (
            <p className="text-sm text-brand-400 mb-2">
              Nobody has counted the drawer today, so the day is running on the
              standing float of {formatCents(data.drawer.floatCents)} — a figure, not a
              fact. Count what is actually in there and type it in:{" "}
              <strong>whatever you type becomes the drawer&apos;s opening
              figure for the whole day</strong>, and every expectation is
              measured from it. If there is $80 in there this morning, type 80.
            </p>
          )}
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs text-brand-400">
              Counted in the drawer
              <input
                className="input mt-1 w-32 text-right tabular-nums"
                inputMode="decimal"
                /* NOT the standing float. A box pre-filled with the answer is a
                   box somebody agrees with instead of counting — which is how a
                   drawer that opened with $80 was recorded as $100 and put the
                   day $200 out. */
                placeholder="0.00"
                value={floatCount}
                onChange={(e) => setFloatCount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveFloat();
                }}
              />
            </label>
            <button
              type="button"
              className={data.drawer.floatCountedAt ? "btn btn-outline" : "btn btn-primary"}
              disabled={busy || !floatCount.trim()}
              onClick={() => void saveFloat()}
            >
              {data.drawer.floatCountedAt ? "Correct it" : "Record the opening count"}
            </button>
          </div>
        </div>

        {/* ── Step 2 · Count the day ─────────────────────────────────────── */}
        <div className="cv3-step">
          <div className="cv3-step-head">
            <span className="cv3-step-no">2</span>
            <span className="cv3-step-title">Count the drawer and the terminal</span>
          </div>
          <p className="text-sm text-brand-400 mb-2">
            Count the cash in hand. Settle and read the batch total off the card terminal.
            {blind && " What the register expects stays covered until you log your count — that is the point of counting."}
          </p>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Tender</th>
                <th className="r">Expected</th>
                <th className="r">Counted</th>
                <th className="r">Difference</th>
              </tr>
            </thead>
            <tbody>
              {countable.map((t) => {
                const typed = parseCents(counts[t.code as "cash" | "cc"] ?? "");
                const variance = typed === null ? null : typed - t.expectedCents;
                return (
                  <tr key={t.methodId}>
                    <td>
                      {t.label}
                      <span className="text-xs text-brand-300 ml-2">
                        {t.count} payment{t.count === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="r n">
                      {show(t.code) ? (
                        formatCents(t.expectedCents)
                      ) : (
                        <span className="text-brand-300">– – –</span>
                      )}
                    </td>
                    <td className="r">
                      <input
                        className="input text-right tabular-nums w-28"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={counts[t.code as "cash" | "cc"] ?? ""}
                        onChange={(e) => {
                          // Any change to a count re-covers and restarts the
                          // sequence — a second attempt is still a count.
                          setLogged(new Set());
                          setCounts((c) => ({ ...c, [t.code]: e.target.value }));
                        }}
                      />
                    </td>
                    <td className="r n">
                      {!show(t.code) || variance === null ? (
                        <span className="text-brand-300">—</span>
                      ) : (
                        <span
                          style={{
                            color:
                              shownVariance(variance, t.isCard) < 0 ? "#b91c1c" : "#15803d",
                            fontWeight: 600,
                          }}
                        >
                          {varianceWords(shownVariance(variance, t.isCard))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* The rest of the tenders, in the open — nothing to count, nothing
              to hide. See the close-out's per-tender rule. */}
          <p className="rp-note">
            {data.tenders
              .filter((t) => t.code !== "cash" && t.code !== "cc" && t.takingsCents !== 0)
              .map((t) => `${t.label} ${formatCents(t.takingsCents)}`)
              .join(" · ") || "No other tenders today."}
          </p>
          <button
            type="button"
            className="btn btn-primary mt-2"
            disabled={busy}
            onClick={() => void logRegister()}
          >
            {busy ? "Working…" : "Log Register"}
          </button>
        </div>

        {/* ── Cash in / out of the drawer ────────────────────────────────
            Not a numbered step: a drop to the safe or a gas run happens when
            it happens, not in sequence. It lives between the count and the
            verdict because the one honest time to remember a forgotten
            movement is the moment the difference appears. Same endpoint, same
            overdraw confirm, same owner-only hidden option as the old page. */}
        <div className="cv3-step">
          <div className="cv3-step-head">
            <span className="cv3-step-no">$</span>
            <span className="cv3-step-title">Cash in / out of the drawer</span>
          </div>
          {data.drawer.movements.length > 0 && (
            <table className="rp-table mb-2">
              <tbody>
                {data.drawer.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="n">{m.created_at.slice(11, 16)}</td>
                    <td>{m.reason}</td>
                    <td className="r n">
                      {m.amount_cents >= 0 ? "+" : "−"}
                      {formatCents(Math.abs(m.amount_cents))}
                    </td>
                    <td className="r">
                      {!m.reversed_by_id && m.kind !== "reversal" && (
                        <button
                          type="button"
                          className="text-xs underline text-brand-400"
                          disabled={busy}
                          onClick={() => void undoMovement(m.id, m.amount_cents)}
                        >
                          undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs text-brand-400">
              What happened
              <select
                className="input mt-1"
                value={drawerKind}
                onChange={(e) => setDrawerKind(e.target.value as "withdrawal" | "deposit")}
              >
                <option value="withdrawal">Cash out of the drawer</option>
                <option value="deposit">Cash into the drawer</option>
              </select>
            </label>
            {drawerKind === "deposit" && floatWarningLive && (
              <div
                className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1"
                style={{ maxWidth: 240 }}
              >
                The opening float is counted on its own when the shift opens — don&apos;t
                record it here too.
              </div>
            )}
            <label className="text-xs text-brand-400">
              Amount
              <input
                className="input mt-1 w-28 text-right tabular-nums"
                inputMode="decimal"
                placeholder="0.00"
                value={drawerAmount}
                onChange={(e) => setDrawerAmount(e.target.value)}
              />
            </label>
            <label className="text-xs text-brand-400 flex-1" style={{ minWidth: 180 }}>
              What for
              <input
                className="input mt-1 w-full"
                placeholder="To the bank, gas, change…"
                value={drawerReason}
                onChange={(e) => setDrawerReason(e.target.value)}
              />
            </label>
            {can("hideDrawerMovement") && (
              <label
                className="text-xs flex items-center gap-1.5 cursor-pointer"
                title="Recorded in full, but left out of the expected count and the sheet"
              >
                <input
                  type="checkbox"
                  checked={drawerHidden}
                  onChange={(e) => setDrawerHidden(e.target.checked)}
                />
                <span className={drawerHidden ? "text-amber-800 font-semibold" : "text-brand-400"}>
                  Keep off the sheet
                </span>
              </label>
            )}
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() => void saveMovement()}
            >
              Record it
            </button>
          </div>
        </div>

        {/* ── Who is still on the clock ──────────────────────────────────
            The half of the time clock that never happened. People check in at
            the door and leave without checking out, so a nightly job closes
            every open entry at nine and every stored day reads as ending at
            21:00 — which makes hours, and anything divided by them, fiction.

            The person closing the day is standing here and knows who went
            home and roughly when. Asking them once, here, is what turns the
            clock into data. The entry records who pressed it: a manager
            attesting is different evidence from the technician pressing their
            own button, and payroll should be able to tell. */}
        {data.hours.people.some((h) => h.onTheClock) && (
          <div className="cv3-step">
            <div className="cv3-step-head">
              <span className="cv3-step-no">⏱</span>
              <span className="cv3-step-title">Still on the clock</span>
            </div>
            <p className="text-sm text-brand-400 mb-2">
              Clock them out at the time they actually left. Anyone left on will be
              auto-closed at 9pm tonight.
            </p>
            <table className="rp-table">
              <tbody>
                {data.hours.people
                  .filter((h) => h.onTheClock)
                  .map((h) => (
                    <tr key={h.employeeId}>
                      <td>{h.name}</td>
                      <td className="text-brand-400">
                        in at {h.since?.slice(11, 16)}
                      </td>
                      <td className="r">
                        <input
                          type="time"
                          className="input"
                          style={{ height: 30, fontSize: 13, width: 110 }}
                          value={outAt[h.employeeId] ?? new Date().toTimeString().slice(0, 5)}
                          onChange={(e) =>
                            setOutAt((o) => ({ ...o, [h.employeeId]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="r">
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ height: 30, fontSize: 12 }}
                          disabled={busy}
                          onClick={() => void doClockOut(h.employeeId)}
                        >
                          Clock out
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Step 3 · The verdict ───────────────────────────────────────── */}
        <div className={`cv3-step ${registerLogged ? "" : "cv3-step-waiting"}`}>
          <div className="cv3-step-head">
            <span className="cv3-step-no">3</span>
            <span className="cv3-step-title">Read the verdict</span>
          </div>
          {!registerLogged ? (
            <p className="text-sm text-brand-300">Appears once the register is logged.</p>
          ) : (
            <>
              <div className={`cv3-verdict ${outBy === 0 || shortByExactlyTips ? "is-good" : "is-bad"}`}>
                {outBy === 0
                  ? "BALANCED"
                  : shortByExactlyTips
                    ? `SHORT BY EXACTLY THE TIPS (${formatCents(data.totals.tipCents)}) — that is not a shortage`
                    : `OUT BY ${formatCents(outBy)}`}
              </div>
              {finalCheck && (
                <table className="rp-table">
                  <tbody>
                    {finalCheck.lines.map((l) => (
                      <tr key={l.methodId}>
                        <td>{l.label}</td>
                        <td className="r n">{formatCents(l.countedCents)} counted</td>
                        <td className="r n">{formatCents(l.expectedCents)} expected</td>
                        <td
                          className="r n"
                          style={{
                            color:
                              shownVariance(l.varianceCents, l.isCard) < 0
                                ? "#b91c1c"
                                : "#15803d",
                            fontWeight: 700,
                          }}
                        >
                          {varianceWords(shownVariance(l.varianceCents, l.isCard))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* ── Step 4 · Print and sign ────────────────────────────────────── */}
        <div className={`cv3-step ${mayPrint ? "" : "cv3-step-waiting"}`}>
          <div className="cv3-step-head">
            <span className="cv3-step-no">4</span>
            <span className="cv3-step-title">Print and sign</span>
          </div>
          <p className="text-sm text-brand-400 mb-2">
            The close-out is one page: the verdict, the reconciliation and the
            signatures. Settle the terminal batch before signing.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!mayPrint}
              title={
                registerLogged
                  ? "Print the sheet that gets signed"
                  : mayPrint
                    ? "The register is not logged — this sheet will say so"
                    : "Log the register first"
              }
              onClick={() => setPrintMode("page1")}
            >
              Print the close-out
            </button>
            {/* The previous close-out's sheet, printed FROM the previous
                close-out. Deliberately not a copy of that layout living here:
                one printed document should have one source, and two copies
                look identical the day they are made and disagree within a
                month with nobody able to say which is the real one. That page
                is off the nav but still runs; this opens it, it prints itself,
                and it closes. */}
            <button
              type="button"
              className="btn btn-outline"
              disabled={!mayPrint}
              title={
                registerLogged
                  ? "Print the previous close-out sheet"
                  : mayPrint
                    ? "The register is not logged — this sheet will say so"
                    : "Log the register first"
              }
              onClick={() =>
                window.open("/pos/eod?print=1", "_blank", "noopener,width=1100,height=800")
              }
            >
              Print full report
            </button>
          </div>
        </div>
      </div>

      {/* ═══ PRINT: page one — the sheet that gets signed ════════════════ */}
      <div className="cv3-print">
        <div className="cv3-page1">
          <div className="cv3-letterhead">
            <ShopLogo size={48} priority />
            <div>
              <div style={{ fontWeight: 700, fontSize: "14pt" }}>
                Casias Muffler and Tire Shop · Close-out
              </div>
              <div style={{ fontSize: "9.5pt" }}>
                {weekday} {data.businessDate} · printed {printedOn} · by {user.name}
              </div>
            </div>
          </div>

          {/* The register, first and biggest — this is what the sheet certifies. */}
          <div className={`cv3-verdict ${outBy === 0 || shortByExactlyTips ? "is-good" : "is-bad"}`}>
            {!registerLogged
              ? "REGISTER NOT LOGGED — THIS SHEET CERTIFIES NOTHING"
              : outBy === 0
                ? "REGISTER BALANCED"
                : shortByExactlyTips
                  ? `SHORT BY EXACTLY THE TIPS (${formatCents(data.totals.tipCents)}) — NOT A SHORTAGE`
                  : `OUT BY ${formatCents(outBy)}`}
          </div>

          {finalCheck && (
            <table className="rp-table cv3-recon">
              <thead>
                <tr>
                  <th>Tender</th>
                  <th className="r">Expected</th>
                  <th className="r">Counted</th>
                  <th className="r">Difference</th>
                </tr>
              </thead>
              <tbody>
                {finalCheck.lines.map((l) => (
                  <tr key={l.methodId}>
                    <td>{l.label}</td>
                    <td className="r n">{formatCents(l.expectedCents)}</td>
                    <td className="r n">{formatCents(l.countedCents)}</td>
                    <td className="r n" style={{ fontWeight: 700 }}>
                      {varianceWords(shownVariance(l.varianceCents, l.isCard))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* The drawer explained in one line each — the three numbers that
              produced Expected, so a signature is never against a mystery. */}
          <table className="rp-table">
            <tbody>
              <tr>
                <td>
                  Opening float
                  <span style={{ fontSize: "9pt", color: "rgb(10 37 64 / 0.6)" }}>
                    {data.drawer.floatCountedAt
                      ? ` · counted ${data.drawer.floatCountedAt.slice(11, 16)}${data.drawer.floatCountedByName ? ` by ${data.drawer.floatCountedByName}` : ""}`
                      : " · NOT COUNTED — standing figure"}
                  </span>
                </td>
                <td className="r n">{formatCents(data.drawer.floatCents)}</td>
              </tr>
              <tr>
                <td>Cash from customers</td>
                <td className="r n">+{formatCents(data.drawer.cashSalesCents)}</td>
              </tr>
              <tr>
                <td>
                  Cash moved in / out
                  {data.drawer.movements.length > 0 &&
                    ` (${data.drawer.movements.map((m) => m.reason).join(", ")})`}
                </td>
                <td className="r n">
                  {data.drawer.movementsCents >= 0 ? "+" : "−"}
                  {formatCents(Math.abs(data.drawer.movementsCents))}
                </td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Cash the drawer should hold</td>
                <td className="r n">{formatCents(data.drawer.expectedCents)}</td>
              </tr>
              <tr>
                <td>Tips paid out to technicians</td>
                <td className="r n">−{formatCents(data.totals.tipCents)}</td>
              </tr>
            </tbody>
          </table>

          {/* The day in four figures — enough for the file, no more. */}
          <div className="rp-stats cv3-day">
            <Stat label="Sold" value={formatCents(data.totals.goodsCents)} />
            <Stat label="Collected" value={formatCents(data.totals.collectedCents)} />
            <Stat label="Tickets" value={String(data.totals.saleCount)} />
            <Stat
              label="Voids / refunds"
              value={`${data.tickets.voided} / ${data.tickets.refunds.length}`}
            />
          </div>

          {/* Hand-ticked, not database-claimed: the system cannot verify the
              terminal was settled, so the paper says a human did. */}
          <div className="cv3-manual-ticks">
            <div>☐ Terminal batch settled, slip stapled to this sheet</div>
            <div>☐ Cash drop / deposit prepared</div>
          </div>

          <div className="cv3-signatures">
            <div>
              <div className="cv3-sigline" />
              <div>Counted and closed by</div>
            </div>
            <div>
              <div className="cv3-sigline" />
              <div>Reviewed by</div>
            </div>
          </div>
        </div>

        {/* ═══ PRINT: the evidence, behind the signature page ═════════════ */}
        <div className="cv3-evidence">
          <h2 className="rp-h2">The day in full</h2>

          <h3 className="cv3-h3">Where the money came from</h3>
          <table className="rp-table">
            <tbody>
              {data.tenders
                .filter((t) => t.count > 0 || t.takingsCents !== 0)
                .map((t) => (
                  <tr key={t.methodId}>
                    <td>{t.label}</td>
                    <td className="r n">{t.count}</td>
                    <td className="r n">{formatCents(t.takingsCents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="rp-note">
            Tax inside {formatCents(data.totals.taxIncludedCents)} · disposal fees{" "}
            {formatCents(data.sold.disposalCents)} · on house accounts{" "}
            {formatCents(data.owed.houseChargedTodayCents)}
          </p>

          {liveChecks.length > 1 && (
            <>
              <h3 className="cv3-h3">Every register log today</h3>
              <table className="rp-table">
                <tbody>
                  {liveChecks.map((c) => (
                    <tr key={c.id}>
                      <td className="n">{c.checkedAt.slice(11, 16)}</td>
                      <td>{c.checkedByName}</td>
                      <td className="r">
                        {c.balanced
                          ? "balanced"
                          : c.lines
                              .filter((l) => l.varianceCents !== 0)
                              .map(
                                (l) =>
                                  `${l.label} ${varianceWords(shownVariance(l.varianceCents, l.isCard))}`,
                              )
                              .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {(data.tickets.voids.length > 0 ||
            data.tickets.refunds.length > 0 ||
            data.tickets.discounts.length > 0 ||
            data.tickets.unpaid.length > 0) && (
            <>
              <h3 className="cv3-h3">Corrections and balances</h3>
              <table className="rp-table">
                <tbody>
                  {data.tickets.voids.map((v) => (
                    <tr key={`v${v.saleId}`}>
                      <td>VOID</td>
                      <td className="n">{v.saleNo}</td>
                      <td className="r n">{formatCents(v.totalCents)}</td>
                      <td>
                        {v.voidedByName ?? "—"} · {v.reason ?? "no reason given"}
                      </td>
                    </tr>
                  ))}
                  {data.tickets.refunds.map((r) => (
                    <tr key={`r${r.saleId}-${r.createdAt}`}>
                      <td>REFUND</td>
                      <td className="n">{r.saleNo}</td>
                      <td className="r n">−{formatCents(Math.abs(r.amountCents))}</td>
                      <td>{r.byName ?? "—"}</td>
                    </tr>
                  ))}
                  {data.tickets.discounts.map((d) => (
                    <tr key={`d${d.saleId}`}>
                      <td>DISCOUNT</td>
                      <td className="n">{d.saleNo}</td>
                      <td className="r n">−{formatCents(d.discountCents)}</td>
                      <td>{d.byName ?? "—"}</td>
                    </tr>
                  ))}
                  {data.tickets.unpaid.map((u) => (
                    <tr key={`u${u.saleId}`}>
                      <td>UNPAID</td>
                      <td className="n">{u.saleNo}</td>
                      <td className="r n">{formatCents(u.balanceCents)}</td>
                      <td>{u.customerName ?? "no name"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 className="cv3-h3">Who did the work</h3>
          <RankedBars
            data={data.mechanics.map((m) => ({
              label: m.name,
              value: m.salesCents,
              note: ` · ${m.lineCount} lines`,
            }))}
            format={formatCents}
            emptyLabel="Nobody credited."
          />

          {data.hours.people.length > 0 && (
            <>
              <h3 className="cv3-h3">Hours on the clock</h3>
              <table className="rp-table">
                <tbody>
                  {data.hours.people.map((h) => (
                    <tr key={h.employeeId}>
                      <td>{h.name}</td>
                      <td className="r n">
                        {((h.knownMinutes + h.assumedMinutes) / 60).toFixed(1)} h
                      </td>
                      <td className="text-brand-400">
                        {h.assumedMinutes > 0
                          ? `${(h.assumedMinutes / 60).toFixed(1)} h of it assumed`
                          : "clocked out"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rp-note">
                {data.hours.confidencePct}% of the day&rsquo;s hours were actually clocked
                out; the rest was auto-closed at 9pm and is an estimate.
              </p>
            </>
          )}

          <h3 className="cv3-h3">What sold</h3>
          <p className="rp-note">
            New tires {data.sold.newTires.units} ({formatCents(data.sold.newTires.cents)}) ·
            used {data.sold.usedTires.units} ({formatCents(data.sold.usedTires.cents)}) ·
            service lines {data.sold.service.lines} ({formatCents(data.sold.service.cents)}) ·
            disposals {data.sold.disposalUnits} ({formatCents(data.sold.disposalCents)}) ·
            tire attachment {data.sold.attachmentPct.toFixed(0)}%
          </p>
          <RankedBars
            data={data.sold.topProducts.slice(0, 6).map((p) => ({
              label: p.label,
              value: p.qty,
              note: ` · ${formatCents(p.cents)}`,
            }))}
            format={(n) => String(n)}
            emptyLabel="No products sold."
          />

          {data.stock.oversellRows.length > 0 && (
            <>
              <h3 className="cv3-h3">Oversells to review — where, exactly</h3>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Tire</th>
                    <th>Ticket</th>
                    <th>Rung by</th>
                    <th className="r">Sold short</th>
                    <th className="r">On hand now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.oversellRows.map((o, i) => (
                    <tr key={i}>
                      <td>{o.productName}</td>
                      <td className="n">{o.saleNo ?? "—"}</td>
                      <td>{o.byName ?? "—"}</td>
                      <td className="r n">{o.short}</td>
                      <td
                        className="r n"
                        style={o.onHand < 0 ? { color: "#b91c1c", fontWeight: 700 } : undefined}
                      >
                        {o.onHand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="rp-note">
                The register sold these while its count said the rack was empty. Either the
                count was wrong (walk over and count that size) or the tire came from
                somewhere the system does not know about. Review each on the Inventory tab —
                reviewing records the answer, it does not change stock.
              </p>
            </>
          )}

          <h3 className="cv3-h3">Stock and what is owed</h3>
          <p className="rp-note">
            Tires on tickets {data.stock.unitsSoldOnTickets} · off the racks{" "}
            {data.stock.unitsOut}
            {data.stock.fulfilledForEarlierUnits > 0 &&
              ` (${data.stock.fulfilledForEarlierUnits} fitted for earlier orders)`}
            {data.stock.awaitingFulfillmentUnits > 0 &&
              ` (${data.stock.awaitingFulfillmentUnits} sold as orders, not yet fitted)`}{" "}
            · oversells to review {data.stock.unreviewedOversells} · outstanding on tickets{" "}
            {formatCents(data.owed.outstandingTicketCents)} ({data.owed.outstandingTicketCount})
          </p>

          {/* THE PAPER IS THE OWNER'S. A cashier prints it, but it goes into
              the owner's file — so it carries everything the day can say,
              margin included. The owner decided this trade explicitly: a
              complete document beats a censored one, and the screen (not the
              sheet) is where floor-level secrecy lives. */}
          <h3 className="cv3-h3">Margin</h3>
          <p className="rp-note">
            {data.margin.marginPct.toFixed(0)}% ({formatCents(data.margin.marginCents)}) on the{" "}
            {data.margin.coveragePct}% of sales with a cost. Computed only over lines that
            carry one — the coverage is the honesty figure beside it.
          </p>
        </div>
      </div>
    </div>
  );
}
