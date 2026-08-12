"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TicketDrawer } from "@/components/pos/TicketDrawer";
import { TicketStatusPicker } from "@/components/pos/TicketStatusPicker";
import { NoticeBoard } from "@/components/pos/NoticeBoard";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import type {
  DayTotals,
  MechanicTotal,
  MethodTotal,
  OutstandingTicket,
} from "@/lib/pos-reports";
import type { RecentLine, Standings, TechScore } from "@/lib/leaderboard";
import type { PaymentMethod } from "@/lib/payments";
import { useLang } from "@/components/pos/LangToggle";

type DayData = {
  /** Today's business date, whatever day is being viewed. */
  today: string;
  totals: DayTotals;
  byMethod: MethodTotal[];
  /** `salesPct` is computed server-side because for anyone below owner the
   *  dollars needed to derive it never leave the server. */
  byMechanic: (MechanicTotal & { salesPct: number })[];
  leaderboard: Standings & {
    week: { start: string; end: string };
    priorWeek: { start: string; end: string };
    comparable: { start: string; end: string; days: number };
  };
  dayStandings: Standings;
  monthStandings: Standings;
  recentLines: RecentLine[];
  /** Every unpaid ticket on the books, any day — not just this one's. */
  outstanding: OutstandingTicket[];
  integrity: { saleId: number; saleNo: string; issue: string }[];
  canSeePurchases: boolean;
  canSeeTechIncomeCash: boolean;
  paymentMethods: PaymentMethod[];
  settings: { tipCommPerCents: number; tipCommChargeCents: number };
};

/** M/D/YYYY, the way the shop's spreadsheet wrote dates. */
function shortDate(businessDate: string): string {
  const [y, m, d] = businessDate.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

/**
 * "3 days ago", for a debt's age.
 *
 * Split by hand rather than `new Date(iso)`, which reads a bare YYYY-MM-DD as
 * UTC and so lands a day early everywhere in the Americas. A balance labelled
 * one day older than it is invites an argument with a customer, which is a
 * worse outcome than the bug looks.
 */
function daysAgo(businessDate: string): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((today - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * "Thu–Sun", or just "Thu" for a single day.
 *
 * Spelled out rather than left as "the same 4 days", because a bare count
 * invites the reading that some days were skipped. The shop trades every day of
 * the week; naming the days says so, and says which ones, in less space.
 */
function weekdaySpan(start: string, end: string): string {
  const name = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString([], { weekday: "short", timeZone: "UTC" });
  return start === end ? name(start) : `${name(start)}–${name(end)}`;
}

function shortTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function DayPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [date, setDate] = useState("");
  const [data, setData] = useState<DayData | null>(null);
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);

  // Which outstanding rows are showing what was rung on them. A set rather than
  // one id at a time: the question this answers is "which of these is the tire
  // that just came in", and answering it by opening one row, closing it and
  // opening the next is the one-by-one it was meant to replace.
  const [openWhat, setOpenWhat] = useState<ReadonlySet<number>>(new Set());

  // Hidden until asked for, because this screen lives on a counter in a shop
  // with customers on the other side of it. Hiding the money leaves the
  // standings intact -- everyone still knows where they placed -- without
  // publishing what each person earned to whoever is waiting on a tire.
  //
  // Default-hidden rather than default-shown for the usual reason: the failure
  // mode of forgetting to press the button is a stranger reading the day's
  // takings, and the failure mode of having to press it is one press.
  const [hideMoney, setHideMoney] = useState(true);

  /*
   * No podium here any more.
   *
   * It opened this screen once, then moved to the foot of it shut behind a
   * chevron, and is now gone from it altogether. The reasoning that put it here
   * was about a board on a wall, and this was never one — the wall board is its
   * own screen at /leaderboard, running all day where the floor can see it.
   * What is left is a counter screen, and the questions asked of a counter
   * screen are who owes us money and did that ticket go through. The standings
   * table further down still answers "where am I" for anybody who wants it.
   */

  /**
   * Has somebody deliberately gone looking at another day?
   *
   * Until they have, this screen follows today and keeps following it. That is
   * not the same as seeding the box once on mount, and the difference is the
   * whole bug: this board lives on a counter and is never closed. Left alone it
   * would sit there past the 4am roll still totalling yesterday, under a header
   * that says "Business day" as if it meant it — and the first person in at 7am
   * reads a day that ended three hours ago as this morning's takings.
   *
   * A ref rather than state because nothing on screen depends on it, and
   * because it must not be what re-runs the fetch.
   */
  const pickedADay = useRef(false);

  const load = useCallback(async () => {
    const url = date ? `/api/pos/reports/daily?date=${date}` : "/api/pos/reports/daily";
    const res = await fetch(url);
    if (!res.ok) return;
    const d: DayData = await res.json();
    setData(d);
    // `d.today` and not `d.totals.businessDate`: the latter echoes whatever was
    // asked for, so it can never tell us the day has rolled underneath us.
    if (!pickedADay.current && date !== d.today) setDate(d.today);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Come back to the screen and it re-asks what day it is.
   *
   * The register is another tab; somebody rings three tickets and clicks back
   * here. Refetching on focus is what keeps this board honest without a timer
   * hammering the database all night for a shop that is closed.
   */
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  if (!data) return <div className="text-brand-300">{tr("Loading…")}</div>;
  const t = data.totals;
  const lb = data.leaderboard;

  /**
   * The one list from the server, split into the two boxes above.
   *
   * One list, two boxes, no ticket in both. The line is WHO PUT IT THERE.
   *
   * OUTSTANDING is for tickets somebody deliberately sent there: a tire marked
   * to be ordered in, a car marked as left with the shop. Those are statements a
   * person made about a job, and the box is the list of promises the shop has
   * made and not yet kept. Nothing lands on it by arithmetic.
   *
   * PENDING is money the shop has not got, on everything else. A draft abandoned
   * half-rung, a ticket closed for the customer to settle at the cashier, a
   * ticket part-paid at the counter.
   *
   * The bug this fixes was both halves at once. Pending demanded that NOTHING
   * had been collected, so three dollars against a fifty-three dollar ticket
   * dropped it off the box whose entire job is money nobody has — and the same
   * three dollars pushed it INTO Outstanding, a board of promises it had never
   * been put on by anybody. One partial payment moved a ticket between two lists
   * it had no business moving between, and the fifty still owed appeared on
   * neither in a way anybody would read.
   *
   * A marked ticket that also owes money shows in Outstanding only. That is the
   * right way round: somebody chose to put it there, the choice says what the
   * shop still has to do, and the balance rides along in its own column where
   * the panel already prints it.
   */
  const sentThereByHand = (o: OutstandingTicket) =>
    o.fulfillmentStatus !== "none" || o.workStatus !== null;
  const outstanding = data.outstanding.filter(sentThereByHand);
  const pending = data.outstanding.filter(
    (o) => !sentThereByHand(o) && o.balanceCents > 0,
  );

  /**
   * Summed from the same list the outstanding panel prints, so the headline
   * figure and the tickets underneath it can never tell different stories. They
   * used to come from two queries and did exactly that — the header claimed
   * $110 over a list of two tickets adding to $60.
   */
  const outstandingCents = outstanding.reduce((s, o) => s + o.balanceCents, 0);
  const pendingCents = pending.reduce((s, o) => s + o.balanceCents, 0);

  /**
   * What is still standing, for the dashboard only.
   *
   * A void on this page is noise. It is a fixed-height panel answering "what
   * has the shop rung in the last few minutes", read over somebody's shoulder
   * between customers, and a struck-through line is a question — what was
   * that, who cancelled it, does it matter — asked at the moment there is
   * least time to answer it. On a day with a few corrections the voids crowd
   * out the live rows the panel exists to show, because the window only holds
   * so many.
   *
   * Filtered HERE and nowhere else. Voids are the first thing looked for when
   * something is wrong, so Logs, the close-out and the ticket drawer all keep
   * showing them, struck through and greyed. This is a dashboard deciding what
   * to put in a small window, not the system deciding what happened.
   */
  const recentLines = data.recentLines.filter((l) => !l.voided && !l.saleVoided);

  /**
   * Tires promised and not yet handed over, counted separately from the money.
   *
   * The panel holds two unlike debts now — cash owed to the shop, and goods owed
   * by it — and one number cannot describe both. A heading reading "8 tickets
   * owing $370" over a list where five of the eight owe nothing is worse than no
   * heading at all, because it is the sort of wrong that gets believed.
   */
  const owedTires = outstanding.filter(
    (o) => o.balanceCents === 0 && o.fulfillmentStatus !== "none",
  ).length;

  // Per panel, because they are two lists now. One flag over both would have the
  // Outstanding chevron claiming to be open on the strength of the pending rows
  // above it. `openWhat` is still shared — sale ids are unique across the two.
  const allWhatOpen =
    outstanding.length > 0 && outstanding.every((o) => openWhat.has(o.saleId));
  const allPendingOpen = pending.length > 0 && pending.every((o) => openWhat.has(o.saleId));

  /** Money, or a share of the whole when money is hidden. */
  const money = (cents: number, ofTotal?: number) => {
    if (!hideMoney) return formatCents(cents);
    if (ofTotal === undefined) return "•••";
    return ofTotal > 0 ? `${((cents / ofTotal) * 100).toFixed(1)}%` : "—";
  };

  /**
   * A technician's income: dollars for an owner who has asked to see them,
   * their share of the shop otherwise. Everyone who can open this screen sees
   * the share — the server has already blanked the cents for anyone who may
   * not have them, so this only decides which of the two to print.
   */
  const seesTechIncomeCash = data.canSeeTechIncomeCash;
  const techMoney = (cents: number, pct: number) =>
    seesTechIncomeCash && !hideMoney ? formatCents(cents) : `${pct.toFixed(1)}%`;

  const tipPoolCents = lb.techs.reduce((s, x) => s + x.tipCentsToday, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">Casias Tire Shop</h1>
          {/* The date is bold and the week is not, because this line is read
              from a few feet away to answer one question — "is this today?" —
              and everything at the same weight makes that a sentence you have
              to read rather than a thing you can glance at. */}
          <p className="text-brand-400 text-sm">
            <strong className="text-brand-500">
              Business day {shortDate(t.businessDate)}
            </strong>{" "}
            · week of {shortDate(lb.week.start)} – {shortDate(lb.week.end)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={hideMoney ? "btn btn-ghost" : "btn btn-primary"}
            onClick={() => setHideMoney((v) => !v)}
            title={
              hideMoney
                ? "Put the dollar amounts back on screen — including tips"
                : "Swap dollar amounts back for percentages so the board can go on a wall"
            }
          >
            {hideMoney ? "Show money" : "Hide money"}
          </button>
          {/* Picking a date pins the screen to it. Nothing snaps it back on
              its own after that — a board that jumped to today while somebody
              was reading last Friday would be worse than one that sits still.
              Clearing the box is the way back, and so is the link beside it. */}
          <input
            type="date"
            className="input"
            value={date}
            max={data.today}
            onChange={(e) => {
              pickedADay.current = e.target.value !== "" && e.target.value !== data.today;
              setDate(e.target.value || data.today);
            }}
          />
          {date !== data.today && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                pickedADay.current = false;
                setDate(data.today);
              }}
            >{tr("Today")}</button>
          )}
          {can("ringSale") && (
            <Link
              href="/pos/register"
              className="btn btn-primary"
              style={{ height: 44, fontSize: 16, paddingInline: 20 }}
            >{tr("New sale")}</Link>
          )}
        </div>
      </div>

      {/* Sits above everything the day's numbers say, and below only the date
          it says them about. A note left for the counter is the first thing
          somebody opening the register needs, not the last. */}
      <NoticeBoard />

      {data.integrity.length > 0 && (
        <div className="mb-4 rounded-xl p-4 bg-red-50 text-red-800">
          <div className="font-semibold mb-1">Books don&apos;t balance</div>
          <ul className="text-sm list-disc pl-5">
            {data.integrity.map((i, n) => (
              <li key={n}>
                {i.saleNo}: {i.issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A strip of caveats used to sit here — open count, money paid out for
          stock, outstanding, voids, prior-day collections. It went because
          every one of those numbers is said better somewhere else: the open
          and outstanding tickets are listed by name a screen down, and the
          voids, purchases and prior-day money belong to the close-out, which
          is where somebody goes when they are reconciling rather than
          working. Between the notes and the debts is the worst place for a
          row of small grey qualifiers — it pushes the thing this screen is
          for below the fold to make room for footnotes. */}

      {/*
        Who owes the shop money, directly under the notes.

        High on the page on purpose. This is the only block here that is a list
        of things to DO rather than a record of things that happened, and the
        person best placed to do them is the cashier standing at the counter
        when the customer walks back in. Buried at the bottom it would be read
        once a week; here it is read every time somebody glances at the screen.

        Dollars always — never the hide-money placeholder. What a customer still
        owes is not somebody's wage, and a debt you have to press a button to
        see is a debt nobody collects.
      */}
      {/* Pending, above the debts and in red rather than amber.
          Every ticket that has taken nothing at all. Two shapes end up here and
          they read as one job: a DRAFT nobody pressed Complete on, and a ticket
          closed with the customer owing the whole amount. Both are work done and
          not a cent collected, which is the thing that walks out of a tire shop,
          and both are chased the same way — find the ticket, get the money.

          Red because it is the more urgent of the two boxes and the shorter one.
          A part-paid order from three weeks ago is a phone call; a ticket that
          collected nothing is money the shop has not started getting back.

          No status column. Where the car is and how far along a tire is are
          questions about a job in progress, and a dropdown here would invite
          somebody to answer the wrong one. The only pill is the Draft mark,
          which says which of the two shapes a row is — and so which end of it to
          pick up. */}
      {pending.length > 0 && (
        <div
          className="rounded-2xl shadow-sm p-4 mb-6"
          style={{ background: "#fef2f2", border: "1px solid rgba(153,27,27,0.30)" }}
        >
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-red-800 flex items-center gap-2">
              <span>
                ⏳ Pending — {pending.length}{" "}
                {pending.length === 1 ? "ticket" : "tickets"}
              </span>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md shrink-0 transition-colors"
                style={{
                  width: "1.35rem",
                  height: "1.35rem",
                  border: "1px solid rgba(153,27,27,0.40)",
                  background: allPendingOpen ? "rgba(153,27,27,0.15)" : "transparent",
                  color: "#991b1b",
                }}
                aria-expanded={allPendingOpen}
                aria-label={
                  allPendingOpen ? "Hide what is on every ticket" : "Show what is on every ticket"
                }
                title={allPendingOpen ? "Hide what is on them" : "Show what is on them"}
                onClick={() =>
                  setOpenWhat((prev) => {
                    const next = new Set(prev);
                    if (allPendingOpen) for (const d of pending) next.delete(d.saleId);
                    else for (const d of pending) next.add(d.saleId);
                    return next;
                  })
                }
              >
                <Caret open={allPendingOpen} />
              </button>
            </div>
            {/* "Uncollected", not "unpaid". Every row in here is unpaid — that is
                what the box is — and the number is the money nobody has started
                getting back yet. */}
            <div className="text-lg font-semibold tabular-nums text-red-900">
              {formatCents(pendingCents)} uncollected
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {pending.map((o) => {
                const showWhat = openWhat.has(o.saleId);
                return (
                  <Fragment key={o.saleId}>
                    <tr className="border-t border-red-900/10">
                      <td className="py-1.5 w-6 align-middle">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-5 h-5 rounded text-red-900/55 hover:text-red-900 hover:bg-red-900/10 transition-colors"
                          aria-expanded={showWhat}
                          aria-label={
                            showWhat ? "Hide what is on this draft" : "Show what is on this draft"
                          }
                          title="What is on this ticket"
                          onClick={() =>
                            setOpenWhat((prev) => {
                              const next = new Set(prev);
                              if (!next.delete(o.saleId)) next.add(o.saleId);
                              return next;
                            })
                          }
                        >
                          <Caret open={showWhat} />
                        </button>
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="font-medium text-red-900 underline decoration-red-900/30 hover:decoration-current"
                          onClick={() => setOpenSaleId(o.saleId)}
                        >
                          {o.saleNo}
                        </button>
                        {/* Only on the ones nobody finished. An unmarked row in
                            here is a closed ticket that simply took no money —
                            the customer is coming back with it — and needs no
                            word for that beyond the box it is sitting in. The
                            marked ones are still open at the register, which is
                            a different job: go and finish the ticket. */}
                        {o.status === "open" && (
                          <span
                            className="ml-2 align-middle text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
                            style={{
                              border: "1px solid rgba(153,27,27,0.35)",
                              color: "#991b1b",
                            }}
                            title={tr("Rung but never completed — finish the ticket")}
                          >{tr("Draft")}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-red-900/80">
                        {o.customerName ?? (
                          <span className="text-red-900/40">no name taken</span>
                        )}
                        {o.customerPhone && ` · ${o.customerPhone}`}
                        {o.notes && (
                          <div className="italic text-red-900/60" title={tr("Note on this ticket")}>
                            {o.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 text-red-900/60 tabular-nums text-right whitespace-nowrap">
                        {shortDate(o.businessDate)}
                        {o.businessDate !== t.businessDate && " ·"}
                        {o.businessDate !== t.businessDate && (
                          <span className="font-medium"> {daysAgo(o.businessDate)}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-semibold text-red-900 w-24">
                        {formatCents(o.balanceCents)}
                      </td>
                    </tr>
                    {showWhat && (
                      <tr>
                        <td />
                        <td colSpan={4} className="pb-2 text-red-900/70">
                          {o.what || <span className="italic text-red-900/40">nothing rung yet</span>}
                          {o.techs && (
                            <span className="text-xs uppercase text-red-900/45"> — {o.techs}</span>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {outstanding.length > 0 && (
        <div
          className="rounded-2xl shadow-sm p-4 mb-6"
          style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)" }}
        >
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            {/* Two clauses because there are two debts, and the tires get their
                own words rather than being folded into the ticket count. "8
                tickets owing" over five tickets that owe nothing is the kind of
                wrong that gets believed. */}
            <div className="text-xs uppercase tracking-wider text-amber-800 flex items-center gap-2">
              <span>
                ⚠️ Outstanding — {outstanding.length}{" "}
                {outstanding.length === 1 ? "ticket" : "tickets"}
                {owedTires > 0 && `, ${owedTires} waiting on a tire`}
              </span>
              {/* Every row at once, because the reason anybody opens these is to
                  compare them — which of these is the 205/55R16 the truck just
                  dropped off. Row by row that is a memory test.

                  Boxed, unlike the arrows in the rows. A bare chevron on the end
                  of a line of small capitals reads as punctuation somebody left
                  behind; the border is what says it is a thing to press. It is
                  the master, so it is allowed to be the louder one. */}
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md shrink-0 transition-colors"
                style={{
                  width: "1.35rem",
                  height: "1.35rem",
                  border: "1px solid rgba(180,83,9,0.40)",
                  background: allWhatOpen ? "rgba(180,83,9,0.15)" : "transparent",
                  color: "#92400e",
                }}
                aria-expanded={allWhatOpen}
                aria-label={
                  allWhatOpen
                    ? "Hide what is on every ticket"
                    : "Show what is on every ticket"
                }
                title={allWhatOpen ? "Hide what is on them" : "Show what is on them"}
                // Adds and removes its own rows rather than replacing the set.
                // It used to replace it, which was harmless while this was the
                // only panel using it and would now shut every draft above the
                // moment somebody opened the debts.
                onClick={() =>
                  setOpenWhat((prev) => {
                    const next = new Set(prev);
                    if (allWhatOpen) for (const x of outstanding) next.delete(x.saleId);
                    else for (const x of outstanding) next.add(x.saleId);
                    return next;
                  })
                }
              >
                <Caret open={allWhatOpen} />
              </button>

              {/* Straight to the board.

                  This panel says WHICH tickets are waiting; the board is where
                  anything gets done about one — moved a stage, rung, marked
                  picked up. Getting there was Logs, then Orders, from a screen
                  already showing the list. Same square as the chevron beside
                  it, because they are the same kind of thing: a small control
                  on the end of a heading, one that opens the rows in place and
                  one that leaves for the page that can act on them. */}
              <Link
                href="/pos/orders"
                className="inline-flex items-center justify-center rounded-md shrink-0 transition-colors"
                style={{
                  width: "1.35rem",
                  height: "1.35rem",
                  border: "1px solid rgba(180,83,9,0.40)",
                  background: "transparent",
                  color: "#92400e",
                }}
                aria-label="Open the orders board"
                title="Open the orders board"
              >
                {/* A chain, drawn rather than an emoji: 🔗 renders at whatever
                    size and colour the platform feels like, and this has to sit
                    at exactly the weight of the chevron next to it. */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
                </svg>
              </Link>
            </div>
            {/* Money only when there is money. Everything in this box is paid
                for now — what is outstanding about it is a tire or a car, not a
                balance — so the figure is almost always zero, and "$0.00 owing"
                over a list of eight tickets reads as a broken total rather than
                as good news. The count and the tires in the heading are what
                this panel is actually about. */}
            {outstandingCents > 0 && (
              <div className="text-lg font-semibold tabular-nums text-amber-900">
                {formatCents(outstandingCents)} owing
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {outstanding.map((o) => {
                const showWhat = openWhat.has(o.saleId);
                return (
                <Fragment key={o.saleId}>
                <tr className="border-t border-amber-900/10">
                  {/* The arrow, not the ticket number, because the number
                      already means "open the whole ticket" and the two are
                      different sizes of question. This one is a glance.

                      Middle-aligned rather than top, so the column of arrows
                      sits on the same line as the ticket numbers beside them
                      instead of riding a few pixels high on every row. */}
                  <td className="py-1.5 w-6 align-middle">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center w-5 h-5 rounded text-amber-900/55 hover:text-amber-900 hover:bg-amber-900/10 transition-colors"
                      aria-expanded={showWhat}
                      aria-label={showWhat ? "Hide what is on this ticket" : "Show what is on this ticket"}
                      title="What is on this ticket"
                      onClick={() =>
                        setOpenWhat((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(o.saleId)) next.add(o.saleId);
                          return next;
                        })
                      }
                    >
                      <Caret open={showWhat} />
                    </button>
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      className="font-medium text-amber-900 underline decoration-amber-900/30 hover:decoration-current"
                      onClick={() => setOpenSaleId(o.saleId)}
                    >
                      {o.saleNo}
                    </button>
                    {/* No badge. Everything that has collected nothing lives in
                        Pending above, so every ticket left in this one has
                        either taken money already or is waiting on a tire —
                        there is no second kind of row here to tell apart. */}
                  </td>
                  {/* Nameless until big-boy mode fills these in — and it says so
                      rather than leaving the column blank, because "who is this"
                      is the first question anybody asks of a debt and an empty
                      cell reads as a rendering fault. */}
                  <td className="py-1.5 text-amber-900/80">
                    {o.customerName ?? (
                      <span className="text-amber-900/40">no name taken</span>
                    )}
                    {o.customerPhone && ` · ${o.customerPhone}`}
                    {/* The ticket's note, printed here as well as on Logs.
                        It is the same string from the same column on the same
                        sale — the point is that somebody who wrote "DEPOSIT —
                        BALANCE ON PICKUP" on a ticket sees it on whichever
                        screen they happen to be looking at, instead of having
                        to remember which one shows notes. On a debt it is
                        usually the reason the debt exists. */}
                    {o.notes && (
                      <div className="italic text-amber-900/60" title={tr("Note on this ticket")}>
                        {o.notes}
                      </div>
                    )}
                  </td>
                  {/* One column, one question: what is happening with this
                      ticket. It used to be two — where the car is on an ordinary
                      ticket, how far along the tire is on an order — drawn by
                      two different controls depending on the row, with the order
                      half read-only and moved from the drawer. That was two
                      vocabularies, two places to change them, and a column whose
                      behaviour changed under you from row to row.

                      Both lists now sit in the one dropdown, and a ticket may
                      answer from both. The row still draws one pill — see
                      `shownSide` for which — with the other in its tooltip. */}
                  <td className="py-1.5 pr-3 w-px whitespace-nowrap">
                    <TicketStatusPicker
                      saleId={o.saleId}
                      workStatus={o.workStatus}
                      fulfillmentStatus={o.fulfillmentStatus}
                      canSet={can("ringSale")}
                      canOrder={can("manageSpecialOrders")}
                      canReverse={can("reverseSpecialOrder")}
                      onChanged={() => void load()}
                    />
                  </td>
                  {/* The date it was rung, not "today". A month-old balance and
                      one from an hour ago need chasing very differently. */}
                  <td className="py-1.5 text-amber-900/60 tabular-nums text-right whitespace-nowrap">
                    {shortDate(o.businessDate)}
                    {o.businessDate !== t.businessDate && " ·"}
                    {o.businessDate !== t.businessDate && (
                      <span className="font-medium"> {daysAgo(o.businessDate)}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-amber-900/60">
                    of {formatCents(o.totalCents)}
                  </td>
                  {/* "Paid", not $0.00. A zero in the money column of a panel
                      headed Outstanding reads as a bug, and the row is here for
                      the tire rather than the money — saying so in the one cell
                      somebody would otherwise query is cheaper than a footnote. */}
                  <td className="py-1.5 text-right tabular-nums font-semibold text-amber-900 w-24">
                    {o.balanceCents === 0 ? (
                      <span className="font-medium text-amber-900/50">paid</span>
                    ) : (
                      formatCents(o.balanceCents)
                    )}
                  </td>
                </tr>
                {showWhat && (
                  <tr>
                    <td />
                    <td colSpan={6} className="pb-2 text-amber-900/70">
                      {o.what || <span className="italic text-amber-900/40">nothing rung yet</span>}
                      {/* Who did it, trailing the what. "Which of these is the
                          205/55R16" is usually followed by "and who fitted it",
                          and that second question was a click into the ticket.

                          Quieter than the work itself — it is the answer to a
                          follow-up, not the reason the row unfolded — but set in
                          capitals, which is the one thing that gives a name a
                          shape of its own without a second type size fighting
                          the line it belongs to. */}
                      {o.techs && (
                        <span className="text-xs uppercase text-amber-900/45"> — {o.techs}</span>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Directly under the debts, and above the leaderboard and the takings.
          What was just rung is the thing most often checked and the thing most
          often checked against — somebody asks "did that go through", or reads
          an outstanding ticket and wants to see what was on it. It used to sit
          below the whole weekly table, which on a laptop meant scrolling past
          every number in the shop to reach the only one that had changed in the
          last minute. The summaries can wait; they are read once a day. */}
      <Card title={tr("Last transactions")} className="mb-6">
        {/* Fixed height on purpose: a busy Saturday runs to two hundred lines and
            this is a dashboard, not the ledger. The full list lives on Logs. */}
        <div className="overflow-y-auto mt-2" style={{ maxHeight: 340 }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: "#fff" }}>
              <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                <th className="py-2 font-medium">{tr("Line")}</th>
                <th className="py-2 font-medium">{tr("Tech")}</th>
                <th className="py-2 font-medium">{tr("Time")}</th>
                <th className="py-2 font-medium text-right">{tr("Total")}</th>
                <th className="py-2 font-medium pl-4">{tr("Service")}</th>
              </tr>
            </thead>
            <tbody>
              {recentLines.map((l, n) => {
                return (
                  <tr
                    key={`${l.saleId}-${n}`}
                    className="border-t border-black/5"
                    // Alternating light blue. This table is read across, at a
                    // glance, on a screen on a counter — five columns of small
                    // numbers with nothing to hold the eye is where a row gets
                    // read as the one above it. Kept very pale because that is
                    // all it is for: every row here is a live one, so the tint
                    // separates them rather than marking any of them out.
                    style={{
                      background: n % 2 === 1 ? "rgba(10,37,64,0.035)" : undefined,
                    }}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setOpenSaleId(l.saleId)}
                      >
                        {/* Written the same way the ticket drawer, the receipt
                            and the new-sale list write it, because this panel is
                            read against those and a count that appears in three
                            places out of four is worse than one that appears in
                            none. */}
                        {l.qty > 1 ? `${l.qty}× ` : ""}
                        {l.description}
                      </button>
                    </td>
                    <td className="py-2 text-brand-400">{l.techName ?? "—"}</td>
                    <td className="py-2 text-brand-300 tabular-nums">{shortTime(l.at)}</td>
                    <td className="py-2 text-right tabular-nums">{money(l.totalCents)}</td>
                    <td className="py-2 pl-4 text-brand-400">{l.service}</td>
                  </tr>
                );
              })}
              {recentLines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-brand-300">{tr("Nothing rung on this day.")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* The two half-width cards that used to sit here — "Income — share of
          the week" and "Improvement — against last week" — are gone. Both were
          bar charts of numbers the table directly below already prints, per
          technician, as figures: share of income and the week-on-week swing are
          columns in "This week". Two pictures of one table is not two pieces of
          information, it is the same one twice, and it pushed the table itself
          below the fold on the screen this dashboard is actually read on.

          Nothing was lost with them. If the bars are wanted back, the numbers
          they drew are still on `lb.techs` (`incomePct`, `improvementPct`). */}

      {/* "By payment method" and "By mechanic — today" used to sit here, and
          both were saying something the page already said better further up.
          The payment split is the close-out's job — that is the screen where a
          per-tender figure is read against a drawer being counted, and here it
          was a number with nothing to check it against. The per-mechanic table
          was the leaderboard again at one day's width, directly under the
          leaderboard, which invited exactly the comparison it cannot support:
          one day of tire work is weather and luck, and ranking it next to a
          week's figures makes a slow Tuesday look like a verdict on somebody.

          What is left is a dashboard that ends where the numbers end. */}

      {/* The day's ticket table used to sit here. It moved to Logs, which
          lists every event rather than every ticket and can be filtered and
          sorted — this page is a dashboard, and a two-hundred-row table at the
          bottom of it pushed the numbers anybody actually came for off the top
          of the screen. */}
      {/* Two ways out of the dashboard, side by side at the foot of it.
          Help sits here rather than in the tab bar on purpose. The tabs are the
          working screens somebody moves between all day, and a manual is not
          one of those — it is the thing you reach for at the moment the working
          screen stopped making sense, which is this moment, at the bottom of
          the page you were already on. */}
      {/* Help first, the ledger second, and the order is the arrow's doing.
          "…line by line →" ends in an arrow pointing right, at whatever comes
          next — so with Help beside it the arrow appeared to point AT Help,
          which is not where it goes. Last on the line, it points off the end of
          the page, which is what an arrow like that means. */}
      <div className="flex items-center justify-center gap-6 flex-wrap mb-6 text-sm">
        <Link href="/help" className="text-brand-400 underline hover:text-brand-500">{tr("Help")}</Link>
        <Link
          href="/pos/entries"
          className="text-brand-400 underline hover:text-brand-500"
        >
          Every entry of this day, line by line →
        </Link>
      </div>

      {openSaleId !== null && (
        <TicketDrawer
          key={openSaleId}
          saleId={openSaleId}
          methods={data.paymentMethods}
          commPerCents={data.settings.tipCommPerCents}
          commChargeCents={data.settings.tipCommChargeCents}
          onClose={() => setOpenSaleId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

/**
 * The disclosure arrow, drawn rather than typed.
 *
 * `▸` and `▾` are two different glyphs at two different optical weights that sit
 * on the baseline differently, so a column of them jitters as rows open and the
 * pair never quite look like the same arrow rotated. This is one shape turned
 * ninety degrees, which is what the gesture actually is.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 120ms ease",
      }}
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
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

function Empty({ children, as }: { children: React.ReactNode; as?: "row" }) {
  if (as === "row")
    return (
      <tr>
        <td className="py-4 text-brand-300">{children}</td>
      </tr>
    );
  return <div className="py-4 text-sm text-brand-300">{children}</div>;
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm p-4 ${className}`}>
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">{title}</div>
      {children}
    </div>
  );
}
