"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ShopLogo } from "@/components/ui/ShopLogo";
import { formatCents, parseCents } from "@/lib/money";
import { nowLocalIso } from "@/lib/time";
import { workStatusTitle } from "@/lib/work-status";
import type {
  DayEntry,
  DayTotals,
  HouseAccountCharge,
  OffRackLine,
  OutstandingTicket,
  StockReceived,
  TicketEdit,
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
import type { Standings, StandingsPeriod } from "@/lib/leaderboard";

/**
 * How the performance board is being read.
 *
 * Four options over three queries, because `default` and `week` ask the server
 * the same question and answer a different one on screen.
 *
 * `default` IS THE PRINTED SHEET: this week against last week, with today's
 * tips beside it. That is the state the close-out has always been in and the
 * one somebody signs, so it is what the screen opens on and what it can always
 * be put back to.
 *
 * `week` is the same two halves with the TIP column switched to this week
 * against last week, which is the one figure on the board that had nothing to
 * be read against. It is a separate option rather than the default because the
 * close-out's tip column answers "what is going home tonight", and quietly
 * turning that into a weekly total on the screen people check every night is
 * how a technician gets told the wrong number about their own money.
 */
type BoardView = "default" | StandingsPeriod;
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
  /** Signed, and zero for anybody who is not the owner. See the EOD route. */
  hiddenDrawerCents: number;
  registerChecks: RegisterCheck[];
  /** The week board, moved off Main. Dollars are blanked unless the flag says. */
  leaderboard: Standings & {
    week: { start: string; end: string };
    priorWeek: { start: string; end: string };
    comparable: { start: string; end: string; days: number };
  };
  canSeeTechIncomeCash: boolean;
  canSeePurchases: boolean;
  /** Money changed on a ticket that had already completed. */
  edits: TicketEdit[];
  /** Who went on account today, by name. */
  houseAccount: HouseAccountCharge[];
  /** What arrived on the van today. */
  received: StockReceived[];
  /** At or below the reorder point, worst first. Not scoped to this day. */
  lowStock: {
    productId: number;
    name: string;
    onHand: number;
    reorderPoint: number;
  }[];
  shopName: string;
};

/**
 * The tenders that get counted, and everything else just gets read.
 *
 * Two, by the shop's own instruction: cash — the drawer in hand — and the card
 * batch the terminal prints. Those are the only figures a person physically
 * produces at close, so they are the only ones that take a typed count, carry a
 * blind cover, and reconcile. Every other tender (SNAP, the house accounts, PO,
 * Other) is money that never passes through anybody's hands at close: its
 * takings are listed openly for the record and there is nothing to count them
 * against.
 */
const COUNTED_TENDERS = new Set(["cash", "cc"]);

export default function EndOfDayPage() {
  const { user, can } = usePosAuth();
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
  // Off every time the form opens, never remembered. A box that stayed ticked
  // would eventually hide a genuine run to the bank, and the whole value of the
  // flag is that the owner knows exactly which shortfalls are theirs.
  const [drawerHidden, setDrawerHidden] = useState(false);
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
  /**
   * Which tenders the last log actually covered, by method id.
   *
   * The cover used to be one flag for the whole table, and that was a hole in
   * the blind count: logging the terminal batch at noon — Credit Card typed,
   * nothing else — uncovered EVERY tender's expectation, so whoever counted the
   * drawer that night counted next to the number they were supposed to produce.
   * A tender's expectation now uncovers only when that tender itself was in a
   * logged count, and `resetSequence` covers them all again the moment any
   * count changes.
   */
  const [loggedMethods, setLoggedMethods] = useState<ReadonlySet<number>>(new Set());
  /**
   * The whole reading block — the two charts AND the performance board — folded
   * away until somebody asks for it.
   *
   * Shut by default because of what this page is for. The close-out is a
   * sequence: count, log, settle, sign. Neither the charts nor the board is a
   * step in it; both are things to read once the money is away. Open, they put
   * two charts and ten columns between the takings and the count every single
   * night, on the screen somebody is trying to work down.
   *
   * ONE CONTROL FOR BOTH, which is the point. They used to fold separately —
   * the board behind a chevron, the charts always on — so the "get this out of
   * my way" gesture only cleared half of it and the screen still opened on a
   * week's history. Grouped, the working sequence runs uninterrupted from the
   * takings to the count to the drawer.
   *
   * Both still print in full whether or not this is open. Paper has nobody to
   * click it, and the sheet is where they are actually meant to be read — so
   * the folding is done in screen-only CSS and the printed page is untouched.
   */
  const [weekOpen, setWeekOpen] = useState(false);
  /**
   * The window the performance board is read over, and the board itself when it
   * is anything but the week.
   *
   * The week comes down with the close-out and is the only one that prints, so
   * it needs no second fetch and no loading state. Day and month are asked for
   * separately — see `/api/pos/reports/standings` — and until the answer lands,
   * the week is what is on screen. That is the right thing to show while
   * waiting: it is real, it is labelled, and it is what the sheet says.
   */
  const [view, setView] = useState<BoardView>("default");
  const [altBoard, setAltBoard] = useState<Standings | null>(null);
  /**
   * Which board the screen actually needs fetching.
   *
   * `default` and `week` are the SAME query — this week against last week — and
   * differ only in which tips the column carries, so neither costs a request:
   * the close-out already sent the week board. Only day and month go back to
   * the server.
   */
  const period: StandingsPeriod = view === "default" ? "week" : view;
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
    // Re-covered per tender too. A second attempt at a count is still a count,
    // for each drawer and terminal separately.
    setLoggedMethods(new Set());
  }, []);

  /** The method ids behind `COUNTED_TENDERS`, once the day's data is here. */
  const countableIds = useMemo(
    () =>
      new Set(
        (data?.reconciliation.methods ?? [])
          .filter((m) => COUNTED_TENDERS.has(m.code))
          .map((m) => m.methodId),
      ),
    [data],
  );

  const countsPayload = useMemo(() => {
    const out: { methodId: number; countedCents: number }[] = [];
    for (const [id, raw] of Object.entries(counts)) {
      // Only the countable tenders may enter a count. The others have no input
      // box, but old checks seeded values for them into `counts` — without this
      // filter a re-log would faithfully re-record a tender nobody counts.
      if (!countableIds.has(Number(id))) continue;
      const cents = parseCents(raw);
      if (cents === null || cents < 0) continue;
      out.push({ methodId: Number(id), countedCents: cents });
    }
    return out;
  }, [counts, countableIds]);

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

  /**
   * The board over a period the close-out did not send.
   *
   * A request of its own so that changing the dropdown cannot disturb the
   * count — see the standings route. `cancelled` guards the usual race: pick
   * month, change your mind, pick day, and the slower of the two answers must
   * not land last and overwrite the one that was asked for.
   */
  useEffect(() => {
    if (period === "week") {
      setAltBoard(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const sp = new URLSearchParams({ period });
      if (date) sp.set("date", date);
      const res = await fetch(`/api/pos/reports/standings?${sp}`);
      if (!res.ok || cancelled) return;
      const d = await res.json();
      if (!cancelled) setAltBoard(d.board);
    })();
    return () => {
      cancelled = true;
    };
  }, [period, date]);

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
    if (ok) {
      setChecked(true);
      // Uncover exactly what was logged. Cash typed alone uncovers cash alone;
      // the terminal's expectation stays covered until ITS count is logged.
      setLoggedMethods(new Set(countsPayload.map((c) => c.methodId)));
    }
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

  async function saveDrawerMovement(acknowledgeOverdraw = false) {
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
        hidden: drawerHidden,
        acknowledgeOverdraw,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      /*
        The one refusal with a second question in it. The server said this
        withdrawal is bigger than the drawer's books — which is either a typo
        about to poison the day, or the truth about a drawer that is over. Only
        the person holding the cash knows which, so they are asked, in the
        server's own words, and their yes goes back with the flag set.
      */
      if (d.overdraw && window.confirm(`${d.error}\n\nRecord it anyway?`)) {
        void saveDrawerMovement(true);
        return;
      }
      setError(d.error || "Could not record that");
      return;
    }
    setError(null);
    setDrawerAmount("");
    setDrawerReason("");
    setDrawerHidden(false);
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
  /**
   * The drawer short by exactly the day's tips, and nothing else out.
   *
   * That is not a shortage. Tips are earned on tickets and handed over in cash,
   * sometimes before the night is finished — a technician leaving at noon takes
   * theirs at noon — so the till is legitimately light by that money. Calling it
   * a discrepancy every evening is how a count stops being read.
   *
   * Only when the cash side is the ONLY thing out. A drawer short by the tips
   * AND a terminal over by forty dollars is still a night with a problem in it.
   */
  const tipsExplainIt =
    !everyTenderBalances &&
    r.tips.balancedByTips &&
    r.methods.every((m) => !m.counted || m.varianceCents === 0 || m.kind === "cash");
  /** Nothing left for the cashier to explain, tips accounted for. */
  const settled = everyTenderBalances || tipsExplainIt;

  /**
   * The same day as the floor will read it, for the owner's printed copy.
   *
   * Only the owner is ever sent a non-zero `hiddenDrawerCents`, so `auditing` is
   * false on every other screen and these two collapse back to the real figures.
   * The masking itself is deliberately the same rule the server applies in
   * `maskCashVariance` — the cash difference is forced to zero rather than the
   * expectation being corrected, because correcting the expectation would make a
   * genuine surplus visible again, and a visible surplus is the thing somebody
   * pockets.
   */
  const auditing = data.hiddenDrawerCents !== 0;
  const printTotalVarianceCents = auditing
    ? r.methods.reduce((s, m) => s + (m.code === "cash" ? 0 : m.varianceCents), 0)
    : r.totalVarianceCents;
  const printSettled = auditing
    ? r.methods.every((m) => !m.counted || m.code === "cash" || m.varianceCents === 0)
    : settled;
  const drawerNet = data.drawer.reduce((s, m) => s + m.amount_cents, 0);
  /**
   * Debts only. A draft is not one — see the note above the panel that prints
   * these. Filtered here rather than at the query, because the same list feeds
   * Main, which does want them and shows them in a box of their own.
   */
  const outstanding = data.outstanding.filter((o) => o.status !== "open");
  const lb = data.leaderboard;
  /**
   * What the screen's copy of the board is showing.
   *
   * Falls back to the week whenever the alternative is not the one being asked
   * for — mid-fetch, or after a failed one. Never a spinner and never an empty
   * table: this block is a reading, and a reading that blinks out every time a
   * dropdown moves is one people stop trusting.
   */
  const shownBoard = period !== "week" && altBoard?.period === period ? altBoard : lb;

  /**
   * The week board, and which page it lands on.
   *
   * Page one is a fixed sheet with a signature on its bottom rule, and two
   * of the blocks above that signature grow: the count gains a row per
   * tender actually used, and this board gains one per technician. Between
   * them they are the only things that can push the signature onto a second
   * sheet, which is the one way this layout fails.
   *
   * So the sheet is allowed to shed the board rather than break. Twelve
   * combined rows is what page one holds -- measured, not guessed, and
   * measured at the tightest tender counts rather than the usual one. Past
   * that the board goes overleaf onto the financial report, which is where a
   * week-to-date reading belongs anyway; what it must never do is push the
   * signature, because a close-out whose signature moved is a close-out
   * somebody has to check for a missing page.
   *
   * The board itself is identical either way. Only which slot renders it
   * changes, so the two cannot drift apart.
   */
  const weekOnPageOne =
    lb.techs.length + r.methods.filter((m) => m.count > 0 || m.counted).length <= 12;

  /**
   * The board, as a value rather than markup in place.
   * The week's board, moved off Main.
   *
   * Beneath the charts and above the debts because of what it is: the two
   * charts say what the shop did, this says who did it, and both are
   * history by the time this sheet is read. Everything below is still
   * actionable tonight -- money to count, people to ring -- so the reading
   * that matters goes last.
   *
   * No money-hiding cover on any of it, unlike the count below. That cover
   * exists so a cashier types what is in the drawer before seeing what
   * should be; nothing on this table is a figure anybody is about to be
   * asked to match, so hiding it would only be ceremony. The dollars are
   * already blanked server-side for anyone below owner -- see the report
   * route -- and what is left is a share, which is everybody's business.
   */
  const performanceBoard = (
        /* No chevron of its own. The whole reading block folds behind the one
           heading above the charts — two controls for one gesture is how you
           end up with the charts showing and the board hidden, which is neither
           of the two states anybody wanted. */
        <Section
          title="Performance"
          className={`eod-week${weekOpen ? "" : " eod-screen-hide"}`}
        >
          {/* The window the board is read over.

              Screen only, and the sheet does not follow it: paper always
              prints the week, because a close-out is filed and compared
              against other close-outs, and a column that meant "this month" on
              one night and "today" on another would make the whole stack
              unreadable. */}
          <div className="no-print flex items-center gap-2 mb-3 flex-wrap">
            <select
              className="input"
              style={{ height: 34, fontSize: 13 }}
              value={view}
              onChange={(e) => setView(e.target.value as BoardView)}
              aria-label="Compare over"
            >
              <option value="default">Default — the printed sheet</option>
              <option value="day">By day</option>
              <option value="week">By week</option>
              <option value="month">By month</option>
            </select>
            <span className="text-xs text-brand-300">
              {view === "default"
                ? "This week against last week, with tonight's tips. Exactly what prints."
                : view === "day"
                  ? "Each technician against the last day they were in, tips included."
                  : view === "month"
                    ? "This month so far against the same days of last month."
                    : "This week so far against the same weekdays of last week, tips included."}
              {view !== "default" && " The printed sheet is unaffected."}
            </span>
          </div>

          {/* Screen. Hidden on paper in every case -- the print copy below is
              the one that gets filed, and it is always the week. */}
          <div className="overflow-x-auto no-print">
            <PerformanceTable board={shownBoard} canSeeCash={data.canSeeTechIncomeCash} view={view} />
          </div>

          {/* Paper. Rendered whether the block is folded or not, because a fold
              is a thing somebody clicks and paper has nobody to click it. */}
          <div className="print-only">
            <PerformanceTable board={lb} canSeeCash={data.canSeeTechIncomeCash} view="default" />
          </div>
        </Section>
  );

  // Pressing the button writes a log only when the page is showing the day and
  // scope the drawer is actually in right now. Anywhere else it is a read.
  const canLogNow =
    data.businessDate === data.today && shiftId === "" && can("closeShift");
  /**
   * Reading back a day that is already over, rather than closing tonight.
   *
   * The count → check → batch → print sequence exists so the sheet that gets
   * signed is a claim all four were done, in order, tonight. None of that means
   * anything on a day that finished last Tuesday: the drawer was counted then,
   * the batch was settled then, and somebody now is pulling the sheet out to
   * file a copy or to answer a question. Making them walk a live close-out
   * procedure to reprint history teaches them to click through the gates, which
   * is the exact habit the gates exist to prevent.
   */
  const pastDay = data.businessDate !== data.today;

  return (
    <div className="max-w-4xl mx-auto eod">
      {/* Repeats on every printed page — see `.eod-print-footer`.
          Pages get separated in a filing cabinet, and page three of a close-out
          is forty unlabelled rows of numbers unless it says whose day it is.

          It does NOT number the pages, and that is a limitation rather than a
          choice: page numbering needs `counter(page)` in an `@page` margin box,
          which Chrome does not implement. Chrome's own print dialog will add
          "1/3" under More settings → Headers and footers, and that is the
          reliable way to get it. A hand-counted number here would be wrong the
          first time a day ran to an extra page. */}
      <div className="eod-print-footer print-only">
        {data.shopName} · {data.businessDate}
        {pastDay && " · reprint"} · Printed by {user.name}
      </div>

      {/* PAGE ONE, and the same page one every night.
          A close-out is a document somebody signs, and a document somebody
          signs has to look the same each time it is put in front of them —
          the eye learns where the numbers are and stops reading the labels.
          So everything above the signature is fixed: the takings, the two
          charts, the week, and the count. The only block that changes height
          is the count itself, which grows a row per tender in use and cannot
          reach the foot of the page even with every tender counted.

          Laid out as a column with a floor, so the signature sits on the
          bottom rule whether the count came to four rows or eight. A
          signature block that floats up the page on a quiet day is how
          somebody starts wondering whether a page is missing. */}
      <div className="eod-page-one">

      <div className="flex items-end justify-between mb-6 no-print eod-before-drawer">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">Close-out</h1>
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

      {/* The badge on the filed sheet, and who ran it off.
          The name is not the same claim as the signature at the foot. That one
          says somebody counted; this one only says whose screen the paper came
          out of — which is what turns a sheet found loose in a drawer back into
          a sheet somebody can be asked about. Beside the shop's own mark,
          because a close-out gets handed to an accountant and a page of figures
          with no letterhead is a page of figures. */}
      <div className="print-only eod-sheet-head mb-4">
        {/* `priority`, and it is load-bearing rather than a speed tweak.
            This block is `display: none` until the moment somebody prints, and
            an element that is never displayed never intersects the viewport —
            so a lazily-loaded badge would sit un-fetched all day and come off
            the printer as a gap where the letterhead should be. Eager is the
            only setting under which this image exists on paper. */}
        <ShopLogo size={54} priority />
        <div>
          <div className="text-xl font-bold">{data.shopName}</div>
          <div className="text-sm">
            {data.scope === "shift" && data.shift
              ? `Shift ${data.shift.shift_no} — ${data.shift.opened_by_name}`
              : "Day close-out"}{" "}
            · {data.businessDate} · Printed by {user.name}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 eod-before-drawer">{error}</div>
      )}

      {!openShiftHere && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between no-print eod-before-drawer">
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

      <Section title="What the register says" className="eod-before-drawer">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <Stat label="Sold" value={formatCents(data.dayTotals.goodsCents)} sub={`${data.dayTotals.saleCount} tickets`} />
          <Stat label="Tips" value={formatCents(data.dayTotals.tipCents)} sub="to technicians" />
          {/* The gap is deliberate — this used to be Terminal tax.
              It came off because it answered a question nobody was asking at
              close: the fee is already netted out of what the terminal settles,
              so it explains nothing about tonight's drawer and could not be
              acted on either way. It is still counted, and it is still in the
              tips ledger overleaf where somebody chasing it will look.

              The cell stays rather than the grid dropping to three, so the four
              headline figures keep the positions the eye has learned and
              Collected stays where it has always been on the right. */}
          <div />
          {/* Asked three times in one day, so it gets answered on the sheet.
              The first attempt at this said "what came in, not what was rung",
              which is true, fits on one line, and was understood by nobody: it
              describes the difference between the two figures without ever
              saying what either of them IS, so a reader who did not already
              know had nothing to attach it to.

              So both get named, and the one being asked about goes first. It
              takes a second line and is worth it — the question is comparative,
              which means the answer has to mention the other number, and this
              is the panel where both are sitting side by side.

              Deliberately not spelling out WHY they differ. That is tips, and
              balances paid off old tickets, and today's work that went on
              account — three clauses that would take the caption to four lines
              and turn a label into a paragraph. Somebody who knows which number
              is which can work the rest out, and the ones who cannot are asking
              a different question, out loud, which is fine. */}
          <Stat
            label="Collected"
            value={formatCents(data.dayTotals.collectedCents)}
            sub="Money that actually came in today. Sold is what we charged for."
          />
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
      {/* The one control over everything that is reading rather than working.

          Its own element rather than a `<Section>` wrapped round the two blocks,
          because the board renders in one of two DOM slots depending on the
          night — see `weekOnPageOne` — and a shared parent would have to pick
          one of them, which is the thing that decides where the signature lands
          on paper. So the grouping is done with a heading and screen-only
          folding, and the printed sheet never learns this control exists. */}
      <button
        type="button"
        className="eod-weekhead no-print"
        aria-expanded={weekOpen}
        onClick={() => setWeekOpen((v) => !v)}
      >
        <span>How the week is going</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden
          style={{
            transform: weekOpen ? "rotate(180deg)" : undefined,
            transition: "transform 120ms",
          }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!weekOpen && (
          <span className="eod-weekhead-hint">
            the day against the six before it, and who did the work
          </span>
        )}
      </button>

      {data.trend.length > 0 && (
        <div
          className={`eod-charts grid gap-4 mb-4${weekOpen ? "" : " eod-screen-hide"}`}
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

        {weekOnPageOne && performanceBoard}

      <Section title="Tender reconciliation" className="eod-tender">
        {/*
          The owner's own doing, said plainly, on screen only.

          Sent as zero to everybody else, so this cannot appear for them. For
          the owner it is the difference between a shortfall to investigate and
          one they created this afternoon — without it they would be reading
          their own planted figure as a loss, which is the control pointed at
          the wrong person.

          `no-print` is the whole design: the sheet that gets signed and filed
          must read as the floor's night, or the count stops being a test of
          anything.
        */}
        {data.hiddenDrawerCents !== 0 && (
          <div className="eod-hidden-note no-print">
            <strong>
              {formatCents(Math.abs(data.hiddenDrawerCents))} taken out and kept off
              this sheet.
            </strong>{" "}
            The cash column below is short by that much on purpose, and only you
            can see this line. A count that comes out short by exactly this was
            counted honestly.
          </div>
        )}
        {/* Says why the column is dashes, so it reads as a rule rather than as
            the page having failed to load. Shown while ANY countable tender is
            still covered — logging the drawer does not finish the job if the
            batch is still to count, and the rule holds per tender. */}
        {countBlind &&
          r.methods.some(
            (m) =>
              COUNTED_TENDERS.has(m.code) &&
              (m.count > 0 || m.counted || counts[m.methodId]) &&
              !loggedMethods.has(m.methodId),
          ) && (
            <p className="text-sm text-brand-400 mb-3 no-print">
              Count it first. Cash and the card batch each stay covered until their
              own count is logged.
            </p>
          )}
        {/*
          A DRAWER THAT EXPECTS MINUS MONEY, explained before anybody counts
          against it. A physical drawer cannot hold −$31; when the figure below
          says it does, the movement ledger has more going out than ever came
          in, and no count can balance until the wrong movement is found. Said
          here in full because of what happened the one time it was not: the
          number was read as "the difference", three counts were logged and
          struck against it, and a negative payment was rung onto a real ticket
          to force it to zero.

          Shown even before the register is logged — the Expected column is
          covered then, but this is not a figure, it is a fault, and covering a
          fault is how it gets counted against blind.
        */}
        {(() => {
          const negCash = r.methods.find((m) => m.kind === "cash" && m.expectedCents < 0);
          if (!negCash) return null;
          return (
            <div className="mb-3 rounded-lg border-2 border-red-400 bg-red-50 px-3 py-2 text-sm text-red-900">
              <strong>
                The drawer&apos;s books have gone negative — the register expects{" "}
                −{formatCents(-negCash.expectedCents)}, which no drawer can hold.
              </strong>{" "}
              More cash is recorded leaving the drawer today than the float and the
              day&apos;s cash sales put into it, so a movement below is too big or was
              entered twice. Counting cannot come out right until it is fixed: find
              the wrong row under <em>Cash in and out of the drawer</em> and undo it.
              This is not the amount missing — it is the bookkeeping being impossible.
            </div>
          );
        })()}
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
              .map((m) =>
                COUNTED_TENDERS.has(m.code) ? (
                  <CountRow
                    key={m.methodId}
                    method={m}
                    // Per tender, not per table. Cash and the card batch each
                    // stay covered until THEIR OWN count is logged — logging
                    // one must not hand over the number the other person is
                    // still supposed to produce.
                    showExpected={!countBlind || loggedMethods.has(m.methodId)}
                    // Cash, on a day the owner has planted a withdrawal in. Only
                    // the owner ever receives a non-zero `hiddenDrawerCents`, so
                    // this can never be true on anybody else's screen.
                    maskPrint={data.hiddenDrawerCents !== 0 && m.code === "cash"}
                    value={counts[m.methodId] ?? ""}
                    onChange={(v) => {
                      dirty.current = true;
                      resetSequence();
                      setCounts((c) => ({ ...c, [m.methodId]: v }));
                    }}
                  />
                ) : (
                  /* Everything that is not the drawer or the batch. Nobody
                     physically produces these figures at close — SNAP settles
                     itself, the house accounts are a ledger — so there is
                     nothing to count them against and no count to keep honest:
                     the takings sit in the open, uncovered, by instruction. */
                  <tr key={m.methodId} className="border-t border-black/5">
                    <td className="py-2">
                      {m.label}
                      <span className="text-xs text-brand-300 ml-2">
                        {m.count} payment{m.count === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCents(m.takingsCents)}
                    </td>
                    <td
                      className="py-2 text-right text-brand-300"
                      title="Not counted at close — listed for the record"
                    >
                      —
                    </td>
                    <td className="py-2 text-right text-brand-300">—</td>
                  </tr>
                ),
              )}
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
                  className={`py-2 text-right tabular-nums ${varianceClass(
                    settled ? 0 : r.totalVarianceCents,
                  )}`}
                >
                  {!showExpected ? (
                    <Covered />
                  ) : auditing ? (
                    <>
                      <span className="no-print">
                        {varianceWords(r.totalVarianceCents)}
                      </span>
                      <span className="print-only">
                        {varianceWords(printTotalVarianceCents)}
                      </span>
                    </>
                  ) : (
                    varianceWords(r.totalVarianceCents)
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

          {/* The owner is never locked out of this.

              The count → log → settle → print sequence is a control on the
              floor: it exists so the sheet that gets signed is a claim that all
              four were done, in order, tonight. The owner is who that claim is
              made TO, not who it is a control on, and they have reason to want
              the paper at any hour — a sheet mid-afternoon to take to the bank,
              a copy for a question on the phone, a look at how a night is
              shaping up before it ends.

              Nothing is faked to let them: the signature line still prints
              "NOT CONFIRMED" when the batch has not been settled, so an early
              sheet says on its face that it is early. What is unlocked is the
              button, not the claim. */}
          <button
            type="button"
            className="btn"
            style={{ background: "#4b5563", color: "#fff" }}
            disabled={!batchClosedAt && !pastDay && user.role !== "owner"}
            onClick={() => window.print()}
            title={
              pastDay
                ? "Print this day's sheet again — it was closed on the night"
                : batchClosedAt
                  ? "Print the sheet to sign and file"
                  : user.role === "owner"
                    ? "Print it now — the batch is not settled yet, and the sheet will say so"
                    : "Close the terminal batch first"
            }
          >
            {pastDay ? "Print this day" : "Print the close-out"}
          </button>

          {/* No note box. A count is a time, a name and two figures, and there
              is nothing a cashier could type here that the row does not
              already say. The column stays in the database so a reason can be
              attached later if one ever turns out to be wanted. */}

          {r.anyCounted && settled && (
            <span className="text-sm text-green-700">
              {tipsExplainIt ? "Balances once the tips are counted out." : "Everything balances."}
            </span>
          )}
        </div>

        {/* Says which step is next in words, for the nights when the greyed-out
            buttons are not enough of an answer. */}
        {/* Nothing to instruct on a finished day. The sequence is tonight's
            procedure, and telling somebody reading back Tuesday to go and
            settle Tuesday's batch is an instruction they cannot follow. */}
        {!batchClosedAt && !pastDay && (
          <p className="text-xs text-brand-300 mt-2 no-print">
            {countsPayload.length === 0
              ? "Count the drawer and the terminal above, then log the register."
              : !checked
                ? "Log the register, then settle the batch on the card terminal."
                : "Settle the day's batch on the card terminal, then mark it here to print."}
          </p>
        )}
        {pastDay && (
          <p className="text-xs text-brand-300 mt-2 no-print">
            {data.businessDate} is closed. This is a reprint — nothing here
            writes anything down.
          </p>
        )}
      </Section>

        {/* The foot of page one: what is being attested, and the space to
            attest it. The warnings that used to sit here have moved to the
            head of the financial report overleaf — they belong with the
            detail that explains them, and a page somebody signs should end
            with the signing rather than with an alarm. */}
        <div className="eod-signature print-only">
          {/* Three different sentences, because the honest one differs.
              Tonight, this line is a claim: the batch was settled, at this time,
              by the person about to sign. Un-settled, it must say so loudly — that
              is the whole reason it prints.

              A reprint of a finished day can say neither. This browser did not
              settle Tuesday's batch and has no idea whether anybody did; the sheet
              signed on the night is the record of that. Printing "NOT CONFIRMED"
              across a reprint would put a false accusation on paper, so it says
              what it actually knows: this is a copy, taken later. */}
          <div className="eod-signoff-line">
            {pastDay ? (
              <>
                Reprint of {data.businessDate}, taken {shortTime(nowLocalIso())} —
                the signed original is the record of the night&apos;s close.
              </>
            ) : (
              <>
                Card terminal batch settled{" "}
                {batchClosedAt ? `at ${shortTime(batchClosedAt)}` : "— NOT CONFIRMED"} ·
                printed {shortTime(nowLocalIso())}
              </>
            )}
          </div>
          <div className="eod-rules">
            <div className="eod-rule">Counted by</div>
            <div className="eod-rule">Checked by</div>
            <div className="eod-rule">Date</div>
          </div>
        </div>
      </div>

      {/* PAGE TWO. Everything the close-out is accountable FOR, as opposed to
          the close-out itself.

          The warnings lead it, all of them together, directly under the
          heading. Scattered through the sheet they were three boxes somebody
          met one at a time between tables of figures; collected at the top of
          their own page they are the first thing read after the signature is
          given, which is the moment somebody is still in a position to do
          something about them. */}
      <div className="eod-report-head print-only">
        <span className="t">Financial Report</span>
        <span className="d">{data.shopName} · {data.businessDate}</span>
      </div>

      {/* The headline the filed sheet is read for.
          Checking the difference is allowed to come out wrong — most nights
          that are wrong are the nights the paperwork matters — so nothing
          blocks on it. What must not happen is a short night filing quietly:
          the per-tender differences are in the table above, but a table is
          something you have to read, and this is something you see. Boxed and
          stated in words, at the bottom, directly over the signature that
          says somebody looked. */}
      {/* On an audited day the box is screen-only, and a second, print-only copy
          below states the day as the floor reads it. Without the split the
          owner's printed sheet would carry a DOES NOT BALANCE box for a
          shortfall the same sheet shows as zero. */}
      {!settled && (
        <div className={`eod-flag${auditing ? " no-print" : ""}`}>
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
                `${m.label} ${varianceWords(shownVariance(m.varianceCents, m.isCard))}`,
            )
            .join(" · ")}
          {r.hints.length > 0 && " — possible tender mix-up, see above."}
        </div>
      )}

      {/* The printed copy of the same box, cash taken out of it. Drawn only when
          something OTHER than cash is still out, so a night whose only problem
          was the planted withdrawal prints no warning at all — which is the
          whole point. */}
      {auditing && !printSettled && (
        <div className="eod-flag print-only">
          <strong>DOES NOT BALANCE</strong> — out by{" "}
          {formatCents(Math.abs(printTotalVarianceCents))}
          {printTotalVarianceCents < 0 ? " short" : " over"}.{" "}
          {r.methods
            .filter((m) => m.counted && m.code !== "cash" && m.varianceCents !== 0)
            .map((m) => `${m.label} ${varianceWords(shownVariance(m.varianceCents, m.isCard))}`)
            .join(" · ")}
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
                      `${l.label} ${varianceWords(shownVariance(l.varianceCents, l.isCard))}`,
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

      {/* The tender mix-up advisory, promoted into the warnings. It is the one
          that names ticket numbers, so it is the one somebody can act on. */}
      {r.hints.length > 0 && <MixUps hints={r.hints} />}

      {/* Tickets whose money changed after they were finished.
          Boxed like the other things somebody is meant to stop at. A manager is
          allowed to re-price a completed ticket — a tire rung at 290 that was
          really 250 has to be fixable — but it moves a figure this day has
          already counted, and a day's takings that quietly disagree with the
          tickets people remember ringing is how trust in the whole sheet goes.
          Naming them is not an accusation; it is what lets the number at the top
          be accounted for. */}
      {data.edits.length > 0 && (
        <div className="eod-flag mb-4">
          <div className="font-semibold mb-1">
            {data.edits.length} ticket{data.edits.length === 1 ? "" : "s"} changed
            after completing
          </div>
          <table className="w-full text-sm eod-table">
            <tbody>
              {data.edits.map((e, n) => (
                <tr key={`${e.saleId}-${n}`} className="border-t border-black/10">
                  <td className="py-1 whitespace-nowrap">
                    {e.saleNo}
                    {e.saleDate !== data.businessDate && (
                      <span className="text-brand-300"> · {e.saleDate}</span>
                    )}
                  </td>
                  <td className="py-1">{e.what}</td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap">
                    {e.voided ? (
                      <>
                        <s>{formatCents(e.beforeCents)}</s> struck off
                      </>
                    ) : (
                      <>
                        {formatCents(e.beforeCents)} → <strong>{formatCents(e.afterCents)}</strong>
                      </>
                    )}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {e.by} · {e.at.slice(11, 16)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* On paper this section exists only when cash actually moved. A block
          that prints "Nothing taken out or put in today" every night for a year
          is a block people stop reading, and it is the one place an unexplained
          $200 out of the drawer would have shown up. */}
      {(data.drawer.length > 0 || can("drawerCash")) && (
        <Section
          title="Cash in and out of the drawer"
          className={`eod-drawer ${data.drawer.length === 0 ? "no-print" : ""}`}
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
                        {/* Only ever rendered for the owner — nobody else is
                            sent these rows at all. `no-print` because the whole
                            point is that it is not on the sheet somebody signs;
                            it is here so the owner can read their own count. */}
                        {m.hidden === 1 && (
                          <span className="eod-hidden-pill no-print">off the sheet</span>
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
                  {/* Said at the moment the mistake gets made, not in a manual.
                      The one morning this happened, every count until
                      mid-afternoon read $100 short and the floor went looking
                      for money that was never missing. */}
                  {drawerKind === "deposit" && (
                    <div
                      className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1"
                      style={{ maxWidth: 260 }}
                    >
                      The opening float is counted on its own when the shift
                      opens — don&apos;t record it here too, or every count today
                      reads short by that much.
                    </div>
                  )}
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
                  {/* Owner only, and the label says what it does rather than
                      what it is for. Everything about the row is still recorded
                      — the amount, the reason, who took it, an audit entry — and
                      what is withheld is the floor's expectation of it, so the
                      drawer comes up short by this on purpose. */}
                  {can("hideDrawerMovement") && (
                    <label
                      className="text-xs flex items-center gap-1.5 cursor-pointer"
                      title="Recorded in full, but left out of the expected count, the sheet and the logs"
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
                      setDrawerHidden(false);
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
                {data.registerChecks.map((c) => {
                  /* The NET, not the sum of the sizes.
                     It used to add the differences up as absolute values, so a
                     drawer eighty short and a terminal a hundred over read as
                     "OUT BY $180" — a number that is true of nothing and points
                     nowhere. What somebody wants off this row at a glance is
                     whether there is more money than there should be or less,
                     and by how much; that is the net and only the net.

                     Both figures, because they answer different questions and
                     only one of them is usually the right one to ask.

                     OUT BY is how much is wrong in total, counting a shortfall
                     and an overage as equally wrong. It leads because it is the
                     honest headline on almost every bad night: tenders that are
                     all short do not cancel, and $84 missing plus $101 missing
                     is $185 missing, not the $17 that subtracting them suggests.

                     The net is only shown when the tenders point BOTH ways, and
                     that is the case it is worth showing for. Ringing a sale on
                     the wrong button moves money between piles without
                     destroying any — a cash sale booked onto the card puts one
                     side over and the other short by exactly the same — so when
                     a plus and a minus are both on screen the question "what am
                     I actually holding once they are put together" is a real
                     one with a real answer. When every tender leans the same
                     way there is nothing to put together, and printing a second
                     number equal to the first would only invite subtracting
                     them. */
                  const shown = c.lines.map((l) => shownVariance(l.varianceCents, l.isCard));
                  const net = shown.reduce((s, v) => s + v, 0);
                  const overCents = shown.reduce((s, v) => s + Math.max(v, 0), 0);
                  const shortCents = shown.reduce((s, v) => s - Math.min(v, 0), 0);
                  return (
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
                                style={{
                                  color:
                                    shownVariance(l.varianceCents, l.isCard) > 0
                                      ? "#15803d"
                                      : "#a71d24",
                                }}
                              >
                                {" "}
                                {varianceWords(shownVariance(l.varianceCents, l.isCard))}
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
                        <>
                          <strong className="eod-log-bad" style={{ color: "#a71d24" }}>
                            OUT BY {formatCents(overCents + shortCents)}
                          </strong>
                          {overCents > 0 && shortCents > 0 && (
                            <div
                              className={`text-xs font-normal ${varianceClass(net)}`}
                            >
                              {varianceWords(net)} together
                            </div>
                          )}
                        </>
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
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-brand-300">
              Nothing logged today yet — the first Log Register will land here.
            </div>
          )}

        </Section>
      )}

      {/* Who went on account today, by name.
          The tender table one section up counts "Credit Account $360" and
          stops, which is right for cash and for a card — those are one pile and
          one batch and no more needs saying. A house account is not a pile, it
          is a list of people who owe the shop money, and a single total is the
          one presentation nobody can act on. You cannot ring a number.

          Both figures come off the same ledger rows by business date, so the
          names here and the total above can never disagree. */}
      {data.houseAccount.length > 0 && (
        <Section title="On account today">
          <table className="w-full text-sm eod-table">
            <tbody>
              {data.houseAccount.map((h) => (
                <tr key={h.paymentId} className="border-t border-black/5">
                  <td className="py-1.5 whitespace-nowrap">{h.saleNo}</td>
                  {/* Indented off the ticket number. The number runs to
                      thirteen characters and the tire under it to forty, so
                      with the columns touching "S-2026-000183" and "VANTAGE"
                      read as one string and the eye has to go back for the
                      break. */}
                  <td className="py-1.5 pl-3">
                    {h.customer ?? <span className="text-brand-300">no name taken</span>}
                    {h.phone && <span className="text-brand-300"> · {h.phone}</span>}
                    {/* The reference off the invoice, where there is one. This
                        is the sheet somebody chases from a week later, and a
                        name without a PO is a longer phone call. */}
                    {h.po && <span className="text-brand-300"> · PO {h.po}</span>}
                    <div className="text-xs text-brand-300">{h.what}</div>
                  </td>
                  {/* The ticket's own day, said only when it is not this one — a
                      charge settled later than it was rung is worth seeing. */}
                  <td className="py-1.5 text-right tabular-nums text-brand-300 whitespace-nowrap">
                    {h.saleDate !== data.businessDate ? h.saleDate : ""}
                  </td>
                  {/* Covered until the drawer is logged, exactly like Expected.
                      Not modesty about what the shop is owed -- the names are
                      right there and stay there. It is that this is the one
                      figure on the sheet a short drawer can be made to
                      disappear into: a cashier who is forty dollars light and
                      can see forty dollars sitting on account has been handed
                      the story, and "he said put it on his account" is a
                      sentence nobody can disprove a week later. Count first,
                      then read. */}
                  <td className="py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">
                    {showExpected ? formatCents(h.amountCents) : <Covered />}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-black/40 font-semibold">
                <td className="py-1.5" colSpan={3}>
                  {data.houseAccount.length} charge
                  {data.houseAccount.length === 1 ? "" : "s"} on account
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {showExpected ? (
                    formatCents(data.houseAccount.reduce((s, h) => s + h.amountCents, 0))
                  ) : (
                    <Covered />
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      {/* The drawer, read with the tips in mind.
          Prints as well as showing on screen: whoever signs the sheet at nine
          needs the same two figures the person counting had, or the paper says
          the night was short when it was not.

          Only when the cash was counted and there were tips to pay. On a day
          with neither there is nothing to reconcile and a box saying so is one
          more thing to read past. */}
      {r.tips.cashCounted && r.tips.cents > 0 && r.tips.cashVarianceCents !== 0 && (
        <div
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          style={
            r.tips.balancedByTips
              ? { background: "#f0fdf4", border: "1px solid rgba(22,101,52,0.25)", color: "#166534" }
              : { background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)", color: "#92400e" }
          }
        >
          {r.tips.balancedByTips ? (
            <>
              <div className="font-semibold mb-1">
                Short by {formatCents(r.tips.cents)} — exactly the day&apos;s tips.
              </div>
              The drawer balances once they are counted out. Nothing to explain.
            </>
          ) : (
            <>
              <div className="font-semibold mb-1">
                Drawer {r.tips.cashVarianceCents < 0 ? "short" : "over"}{" "}
                {formatCents(Math.abs(r.tips.cashVarianceCents))}
                {" · "}
                {formatCents(r.tips.cents)} of tips on the day
              </div>
              {/* Both readings, because either can be the true one and the
                  screen cannot know which. Tips are handed over whenever
                  somebody leaves, so part of them may already be out of the
                  till and part still in it. */}
              With every tip paid out, the drawer would be{" "}
              <strong>
                {r.tips.cashVarianceIfTipsPaidCents === 0
                  ? "exactly right"
                  : `${r.tips.cashVarianceIfTipsPaidCents < 0 ? "short" : "over"} ${formatCents(
                      Math.abs(r.tips.cashVarianceIfTipsPaidCents),
                    )}`}
              </strong>
              .
            </>
          )}
        </div>
      )}

      {/* Screen only. It says the same thing as the boxed flag at the foot of
          the printout, and a sheet that states its problem twice in two
          different tones invites the reading that they are two problems. */}
      {r.anyCounted && !settled && r.hints.length === 0 && (
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

      <Section title="Who received the payments">
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

      {/* The board, when page one could not hold it -- see .
          Last on this page because it is the least urgent thing on the
          sheet: everything above is tonight, and this is the week. */}
      {!weekOnPageOne && performanceBoard}

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

      <DayLedger data={data} outstanding={outstanding} />

      {data.shift && data.shift.is_open === 0 && (
        <div className="text-sm text-brand-400">
          Closed {data.shift.closed_at} by {data.shift.closed_by_name}.
          {data.shift.closing_note && ` — ${data.shift.closing_note}`}
        </div>
      )}
    </div>
  );
}

/**
 * Which side of a difference is the one that can be wrong.
 *
 * On a drawer the money is the suspect: counted minus expected, so a minus is
 * cash that is not there. On a card terminal it cannot be. The amount is keyed
 * in at the time of sale and the batch settles, and nobody can take money out
 * of a settled batch — so when the terminal ran $2,117 against a register
 * claiming $2,218, the $101 is not missing, it is a payment the register logged
 * that never happened. The terminal figure is the real one and the register is
 * the thing at fault, so the sign is flipped and the number reads as the
 * register being over rather than the money being under.
 *
 * The signs therefore mean different things by tender, DELIBERATELY, and this
 * should not be tidied into one consistent subtraction. Minus is money the shop
 * does not have; plus on a terminal tender is money the register invented. Both
 * are read off this sheet by somebody deciding what to go and look for, and
 * those are two different searches: one in the drawer, one in the day's tickets.
 *
 * Consequence worth knowing before changing anything here: a cash sale rung as
 * card puts the drawer up by the amount AND the register over by the same, so
 * both sides show a plus and the combined figure reads as double it. That is
 * the shop's own convention, chosen with the case in front of us.
 */
function shownVariance(varianceCents: number, isCard: number): number {
  return isCard ? -varianceCents : varianceCents;
}
function varianceWords(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;
}

/** Red for money that is not there, green for money that is. */
function varianceClass(cents: number | null): string {
  if (cents === null) return "text-brand-300";
  return cents < 0 ? "text-red-700" : "text-green-700";
}

function CountRow({
  method,
  value,
  showExpected,
  maskPrint,
  onChange,
}: {
  method: MethodVariance;
  value: string;
  showExpected: boolean;
  /**
   * Print this line as though it balanced.
   *
   * Only ever set on the cash row of an audited day, and only on the OWNER page
   * — everyone else was already sent masked figures by the server. The screen
   * keeps the truth because that is where the owner reads it; the sheet that
   * gets signed and filed has to read as the floor own night, or the count
   * stops being a test of anything.
   */
  maskPrint: boolean;
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
        {!showExpected ? (
          <Covered />
        ) : method.expectedCents < 0 ? (
          /* An impossible figure never reads as an ordinary one. The banner
             above the table explains it; this makes sure the cell itself is
             what sends the eye there. */
          <span
            className="text-red-700 font-semibold"
            title="No drawer can hold minus money — a movement is too big or entered twice. See the notice above."
          >
            −{formatCents(-method.expectedCents)} ⚠
          </span>
        ) : (
          formatCents(method.expectedCents)
        )}
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
        className={`py-2 text-right tabular-nums ${varianceClass(
          variance === null ? null : shownVariance(variance, method.isCard),
        )}`}
      >
        {!showExpected ? (
          <Covered />
        ) : variance === null ? (
          "—"
        ) : maskPrint ? (
          /* Two renderings of one cell: the truth on screen, a balanced line on
             paper. Both are always in the markup and the stylesheet picks — the
             alternative is deciding at render time whether a print is happening,
             which nothing on the page can know. */
          <>
            <span className="no-print">
              {varianceWords(shownVariance(variance, method.isCard))}
            </span>
            <span className="print-only">{varianceWords(0)}</span>
          </>
        ) : (
          varianceWords(shownVariance(variance, method.isCard))
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
 * The back of the close-out: what is still owed, what has to be reordered, and
 * everything that was rung — on its own page.
 *
 * Print only, and deliberately last in the document even though the first two
 * blocks are the ones somebody acts on. The order on paper is the order of
 * importance to the person filing it — the count and the signature are page
 * one, and everything else is behind. Put the other way round, the sign-off
 * lands on page three under forty rows of ledger and stops being signed. The
 * debts and the reorder list go at the TOP of this page rather than the bottom
 * for the same reason in miniature: they are what the back page is read for.
 *
 * Renders when there is anything at all to say, not only when something was
 * rung. A Sunday with no tickets can still have four people owing money and a
 * size that has been out for a week, and those are exactly the days that get
 * closed quickly.
 */
function DayLedger({
  data,
  outstanding,
}: {
  data: EodData;
  /** Already filtered — drafts dropped. See where it is computed. */
  outstanding: OutstandingTicket[];
}) {
  if (
    data.entries.length === 0 &&
    outstanding.length === 0 &&
    data.lowStock.length === 0
  )
    return null;

  const tires = data.entries.filter(
    (e) => e.kind === "line" && e.category === "New Tire" && !e.voided,
  );
  const tireTotal = tires.reduce((s, e) => s + e.amountCents, 0);

  return (
    <div className="print-only eod-ledger">
      {/* PAGE THREE. Named like the financial report before it, and for the
          same reason: these sheets get separated in a filing cabinet, and a
          page of forty unlabelled rows is a page nobody can put back. */}
      <div className="eod-report-head">
        <span className="t">Logs Report</span>
        <span className="d">{data.shopName} · {data.businessDate}</span>
      </div>

        {/* Every debt on the books, at the head of the back page and directly
            above what has to be reordered.

            The two are the same kind of thing and are the reason this page gets
            pulled out again: they are the only blocks on the whole sheet that
            are not about the day just closed. Everything on page one is settled
            by the time it is signed. These two are tomorrow's work — people to
            ring, sizes to order — so they open the back page together, ahead of
            the ledger, where somebody going through last night's sheet in the
            morning meets them first.

            The same amber and the same columns as the day screen leads with,
            because the person reading this at 9pm has been looking at that panel
            all day and should not have to re-learn it on paper. Two things are
            dropped because they mean nothing on a sheet: the ticket number stops
            being a button, and the status stops being a dropdown and becomes the
            word it was showing.

            DRAFTS ARE DROPPED TOO, and that is about what this sheet is for. It
            is a record of the day's money, signed and filed. A half-rung ticket
            nobody completed is not money owed by anyone — it is a job left open on
            a machine, which is a thing to fix at the register while the shop is
            still open, and Main carries it in its own box all day for exactly
            that. Printing it here under a heading that says "owing" would put a
            number on the sheet that no customer owes. */}
        {/* PAPER ONLY. The debts belong on the filed sheet — that is how the same
            names turn up on Monday's, Tuesday's and Wednesday's copies until
            somebody finally rings them — but on screen this is a list that already
            exists, in colour and up to date, on Main. Two live copies of one list
            is two places to read it and one of them to forget. */}
        {outstanding.length > 0 && (
          <div className="print-only eod-outstanding rounded-2xl shadow-sm p-4 mb-4"
               style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)" }}>
            <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
              <div className="text-xs uppercase tracking-wider text-amber-800">
                ⚠️ Outstanding — {outstanding.length}{" "}
                {outstanding.length === 1 ? "ticket" : "tickets"} owing
              </div>
              <div className="text-lg font-semibold tabular-nums text-amber-900">
                {formatCents(outstanding.reduce((s, o) => s + o.balanceCents, 0))}
              </div>
            </div>
            <table className="w-full text-sm eod-table">
              <tbody>
                {outstanding.map((o) => (
                  <tr key={o.saleId} className="border-t border-amber-900/10">
                    {/* No Draft mark. There are no drafts in this list any more —
                        see the note above the panel. */}
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

        {/* What to reorder, under the debts and above the tires that went out.
            The block below says what left the racks tonight; this says which
            racks cannot take another one leaving. Read the other way round —
            the shortages after forty rows of what was sold — and the reorder
            list is the thing skipped.

            Printed even on a night when no tires went out at all, which is why
            it is not inside the block below, and why the whole page renders on
            a day with nothing rung at all. A day of nothing but flats does not
            make an empty rack any less empty. */}
        {data.lowStock.length > 0 && (
          <div className="eod-ledger-block">
            <div className="eod-ledger-title">
              Running low — {data.lowStock.length} to reorder
            </div>
            <table className="w-full text-sm eod-table">
              <tbody>
                {data.lowStock.map((p) => (
                  <tr key={p.productId} className="border-t border-black/10">
                    {/* `name` already ends in the size on every tire, so the size
                        is not repeated — same as the inventory sheet. */}
                    <td className="py-1">{p.name}</td>
                    <td className="py-1 whitespace-nowrap">
                      {p.onHand < 0 ? (
                        // Below zero is an oversell: tires sold that the racks did
                        // not have. Said as a debt rather than as "-2 on hand",
                        // because that is what it is — somebody is waiting.
                        <strong>{-p.onHand} owed to customers</strong>
                      ) : p.onHand === 0 ? (
                        <strong>none left</strong>
                      ) : (
                        `${p.onHand} left`
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums whitespace-nowrap">
                      warns at {p.reorderPoint} or fewer
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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

      {/* What came IN, directly under what went out.
          The two belong together: between them they are the day's whole effect
          on the racks, and reading one without the other is how a count that
          looks wrong turns out to be a delivery nobody had written down.

          Cost is on it because this is the sheet somebody checks the supplier's
          invoice against, and a delivery note with no prices is half a
          document. It is behind the same manager gate as every other cost on
          this page — see `canSeePurchases`. */}
      {data.received.length > 0 && (
        <div className="eod-ledger-block">
          <div className="eod-ledger-title">
            Stock received — {data.received.length} line
            {data.received.length === 1 ? "" : "s"},{" "}
            {data.received.reduce((s, x) => s + x.qty, 0)} item
            {data.received.reduce((s, x) => s + x.qty, 0) === 1 ? "" : "s"}
            {data.canSeePurchases &&
              `, ${formatCents(data.received.reduce((s, x) => s + x.qty * x.unitCostCents, 0))} at cost`}
          </div>
          <table className="w-full text-sm eod-table">
            <tbody>
              {data.received.map((x) => (
                <tr key={x.movementId} className="border-t border-black/10">
                  <td className="py-1 tabular-nums whitespace-nowrap">{shortTime(x.at)}</td>
                  <td className="py-1 tabular-nums whitespace-nowrap">{x.qty}×</td>
                  <td className="py-1">
                    {x.name}
                    {/* A tire ordered in for one customer arrives on the same
                        van as everything else and has to be on the delivery
                        note, but it is spoken for the moment it lands. */}
                    {x.saleNo && (
                      <span className="text-brand-300"> · for {x.saleNo}</span>
                    )}
                    {x.supplier && <span className="text-brand-300"> · {x.supplier}</span>}
                    {x.reference && <span className="text-brand-300"> · {x.reference}</span>}
                  </td>
                  <td className="py-1">{x.by ?? ""}</td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap">
                    {data.canSeePurchases ? formatCents(x.qty * x.unitCostCents) : ""}
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
            {/* Struck through only when the TICKET was voided, not when a line
                on it was.

                `e.voided` is true for both, which is right for the screen and
                wrong for this sheet: a line taken off a ticket that then went on
                to be rung and paid is an ordinary correction, and half the
                printout coming off the printer with a line through it teaches
                people that the strike means nothing. A voided ticket is the
                thing worth finding, so it is the only thing marked — and it
                carries the reason, because "why" is the next question and the
                answer is already recorded.

                The class rather than an inline strike, so the print stylesheet
                can give these a fill of their own that beats the zebra
                underneath. A struck row in a banded table is easy to miss on
                paper when the band it lands on is already grey. */}
            {data.entries.map((e) => (
              <tr
                key={e.key}
                className={`border-t border-black/10${
                  e.saleStatus === "voided" ? " eod-void" : ""
                }`}
              >
                <td className="py-1 tabular-nums whitespace-nowrap">{shortTime(e.at)}</td>
                <td className="py-1 whitespace-nowrap">{e.saleNo}</td>
                <td className="py-1 whitespace-nowrap">{e.category}</td>
                <td className="py-1">
                  {e.what}
                  {e.detail && <span className="text-brand-300"> {e.detail}</span>}
                  {e.saleStatus === "voided" && (
                    <span className="eod-void-why">
                      {" "}
                      — voided{e.voidReason ? `: ${e.voidReason}` : ", no reason given"}
                    </span>
                  )}
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

/** M/D/YYYY, the way the shop's spreadsheet wrote dates. */
function shortDate(businessDate: string): string {
  const [y, m, d] = businessDate.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

/**
 * "Thu-Sun", or just "Thu" for a single day.
 *
 * Spelled out rather than left as "the same 4 days", because a bare count
 * invites the reading that some days were skipped. The shop trades every day of
 * the week; naming the days says so, and says which ones, in less space.
 */
function weekdaySpan(start: string, end: string): string {
  const name = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString([], { weekday: "short", timeZone: "UTC" });
  return start === end ? name(start) : `${name(start)}-${name(end)}`;
}

function Swing({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-brand-300">N/A</span>;
  const up = pct >= 0;
  return (
    <span className="tabular-nums font-medium" style={{ color: up ? "#15803d" : "#b91c1c" }}>
      {up ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

function Section({
  title,
  className,
  children,
  open,
  onToggle,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
  /**
   * Whether the body is showing, for the sections that fold.
   *
   * Screen only — a fold is a thing somebody clicks, and paper has nobody to
   * click it. The printed sheet always carries the whole section, which is why
   * the caller hides the body with `print-only` rather than not rendering it.
   */
  open?: boolean;
  onToggle?: () => void;
}) {
  const head = "text-xs uppercase tracking-wider text-brand-300";
  return (
    <div className={`bg-white rounded-2xl shadow-sm p-4 mb-4 eod-section ${className ?? ""}`}>
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`${head} mb-2 flex items-center gap-1.5 w-full text-left hover:text-brand-400`}
        >
          {title}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden
            className="no-print"
            style={{
              transform: open ? "rotate(180deg)" : undefined,
              transition: "transform 120ms",
            }}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <div className={`${head} mb-2`}>{title}</div>
      )}
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

/**
 * The performance table, over whatever period it is handed.
 *
 * A component rather than markup in place because the sheet renders it TWICE:
 * once for the screen over whichever period the dropdown is on, and once for
 * paper, always over the week. The printed close-out is a document that has to
 * look the same every night — somebody comparing Tuesday's sheet to Friday's
 * must be comparing the same two columns — so paper does not follow the
 * dropdown. Two copies of the same component is what guarantees they can only
 * differ in the ways they are meant to.
 */
function PerformanceTable({
  board,
  canSeeCash,
  view,
}: {
  board: Standings;
  canSeeCash: boolean;
  /**
   * Which of the four readings this copy is. `default` is the printed sheet and
   * is what the print copy is always given — see the call sites.
   */
  view: BoardView;
}) {
  /**
   * Which tips the column carries.
   *
   * `default` carries TODAY'S with nothing beside them, which is what the sheet
   * has always shown: on a close-out this column answers "what is going home in
   * whose pocket tonight", and a weekly total is not that number. Turning it
   * into one quietly, on the screen people check every night, is how somebody
   * gets told the wrong figure about their own money.
   *
   * Every other reading carries the period's tips against the period before —
   * this week against last week, this month against last. That comparison is
   * the whole reason the extra readings exist: tips were the one column on the
   * board with nothing to be read against.
   */
  const comparingTips = view !== "default";
  const tipOf = (x: Standings["techs"][number]) =>
    comparingTips ? x.tipCents : x.tipCentsToday;
  const tipPoolCents = board.techs.reduce((s, x) => s + tipOf(x), 0);

  // What the two halves of the table are called. The day board's right-hand
  // column is each technician's OWN last shift, not one shared day, so it is
  // never given a date in the heading — the dates go on the rows, where they
  // are true. See `priorPerTech`.
  const partial = board.range.days < 7 && board.period === "week";
  const thisLabel =
    board.period === "day" ? "Today" : board.period === "month" ? "This month" : "This week";
  const priorLabel =
    board.period === "day"
      ? "Last day here"
      : board.period === "month"
        ? "Last month"
        : "Last week";
  const thisTitle = `${shortDate(board.range.start)} – ${shortDate(board.range.end)}`;
  const priorTitle = board.priorPerTech
    ? "Each technician against the last day they were in — not against yesterday, so a day off does not read as a collapse"
    : `${shortDate(board.priorRange.start)} – ${shortDate(board.priorRange.end)} — the same ${board.range.days} day${board.range.days === 1 ? "" : "s"}, so the two halves cover equal trading`;
  const tipHead = !comparingTips
    ? "Tips today"
    : board.period === "day"
      ? "Tips today"
      : board.period === "month"
        ? "Tips this month"
        : "Tips this week";

  return (
            <table className="w-full text-sm eod-table">
              <thead>
                <tr className="text-brand-300 text-xs uppercase tracking-wider">
                  <th className="text-left py-2 font-medium" rowSpan={2}>
                    Technician
                  </th>
                  <th
                    className="py-2 font-medium border-l border-black/5"
                    colSpan={3}
                    title={thisTitle}
                  >
                    {thisLabel}
                    {partial ? ` (${weekdaySpan(board.range.start, board.range.end)})` : ""}
                  </th>
                  {/* Naming the weekdays is not decoration. This column is the
                      same days of last week, not all of it, and one headed
                      plainly "Last week" beside a partial one is how somebody
                      concludes the shop is collapsing every Thursday. */}
                  <th
                    className="py-2 font-medium border-l border-black/5"
                    colSpan={3}
                    title={priorTitle}
                  >
                    {priorLabel}
                    {partial
                      ? ` (${weekdaySpan(board.priorRange.start, board.priorRange.end)})`
                      : ""}
                  </th>
                  <th className="py-2 font-medium border-l border-black/5" rowSpan={2}>
                    {tipHead}
                  </th>
                  <th className="py-2 font-medium border-l border-black/5" rowSpan={2}>
                    Mprvmt
                  </th>
                  <th
                    className="py-2 font-medium border-l border-black/5"
                    rowSpan={2}
                    title={
                      canSeeCash
                        ? "What each technician brought in over this period"
                        : "Share of everything the shop took over this period"
                    }
                  >
                    Income
                  </th>
                </tr>
                <tr className="text-brand-300 text-xs uppercase tracking-wider">
                  <th className="py-1 font-normal border-l border-black/5">New</th>
                  <th className="py-1 font-normal">Used</th>
                  <th className="py-1 font-normal">Other</th>
                  <th className="py-1 font-normal border-l border-black/5">New</th>
                  <th className="py-1 font-normal">Used</th>
                  <th className="py-1 font-normal">Other</th>
                </tr>
              </thead>
              <tbody>
                {board.techs.map((x) => (
                  <tr key={x.employeeId} className="border-t border-black/5">
                    <td className="py-2 font-medium text-brand-500">{x.name}</td>
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      {x.newTires || "—"}
                    </td>
                    <td className="py-2 text-center tabular-nums">{x.usedTires || "—"}</td>
                    <td className="py-2 text-center tabular-nums">{x.otherCount || "—"}</td>
                    {/* On the day board the three prior cells are a different
                        day for every row, so the day itself is written under
                        them. Without it the column is three numbers from an
                        unnamed date, which is the one thing worse than no
                        comparison at all. */}
                    <td
                      className="py-2 text-center tabular-nums text-brand-300 border-l border-black/5"
                      title={x.priorDate ? shortDate(x.priorDate) : undefined}
                    >
                      {x.prior.newTires || "—"}
                    </td>
                    <td className="py-2 text-center tabular-nums text-brand-300">
                      {x.prior.usedTires || "—"}
                    </td>
                    <td className="py-2 text-center tabular-nums text-brand-300">
                      {x.prior.otherCount || "—"}
                      {board.priorPerTech && (
                        <span className="block text-[10px] leading-tight">
                          {x.priorDate ? shortDate(x.priorDate) : "first day"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      {tipOf(x) ? formatCents(tipOf(x)) : "—"}
                      {/* Last week's beside this week's, in the same grey the
                          prior work columns use. Drawn only when the tips are
                          being compared — on the printed sheet the figure is
                          tonight's takings and has no counterpart. */}
                      {comparingTips && (
                        <span className="block text-[10px] leading-tight text-brand-300">
                          {x.priorTipCents ? formatCents(x.priorTipCents) : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      <Swing pct={x.improvementPct} />
                    </td>
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      {canSeeCash ? formatCents(x.incomeCents) : `${x.incomePct.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
                {board.techs.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-brand-300">
                      {board.period === "day"
                        ? "Nobody has rung a line today."
                        : `Nobody has rung a line this ${board.period}.`}
                    </td>
                  </tr>
                )}
              </tbody>
              {board.techs.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-black/10 font-medium">
                    <td className="py-2">Shop</td>
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      {board.techs.reduce((s, x) => s + x.newTires, 0)}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      {board.techs.reduce((s, x) => s + x.usedTires, 0)}
                    </td>
                    <td className="py-2 text-center tabular-nums">
                      {board.techs.reduce((s, x) => s + x.otherCount, 0)}
                    </td>
                    <td className="py-2 text-center tabular-nums text-brand-300 border-l border-black/5">
                      {board.techs.reduce((s, x) => s + x.prior.newTires, 0)}
                    </td>
                    <td className="py-2 text-center tabular-nums text-brand-300">
                      {board.techs.reduce((s, x) => s + x.prior.usedTires, 0)}
                    </td>
                    <td className="py-2 text-center tabular-nums text-brand-300">
                      {board.techs.reduce((s, x) => s + x.prior.otherCount, 0)}
                    </td>
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      {tipPoolCents ? formatCents(tipPoolCents) : "—"}
                      {comparingTips && (
                        <span className="block text-[10px] leading-tight text-brand-300 font-normal">
                          {board.totalPriorTipCents
                            ? formatCents(board.totalPriorTipCents)
                            : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 border-l border-black/5" />
                    <td className="py-2 text-center tabular-nums border-l border-black/5">
                      {canSeeCash ? formatCents(board.totalIncomeCents) : "100%"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
  );
}
