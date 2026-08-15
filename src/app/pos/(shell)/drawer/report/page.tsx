"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PrintButton } from "@/components/pos/PrintButton";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import { workStatusTitle } from "@/lib/work-status";
import { FULFILLMENT_LABELS } from "@/lib/fulfillment";
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
import type { CashierTotal, MethodVariance, Reconciliation, Shift } from "@/lib/shifts";
import type { DrawerMovement } from "@/lib/drawer";
import type { RegisterCheck } from "@/lib/register-checks";
import type { Standings } from "@/lib/leaderboard";
import type { CloseoutV2 } from "@/lib/day-report";
import type { HourCell, WeekdayRow } from "@/lib/reports-bi";
import "./report.css";

/**
 * THE DAY'S REPORT, WRITTEN FOR PAPER.
 *
 * This is the sheaf the "Print full report" button produces. It replaced the
 * close-out screen printing itself, and the difference is the whole point: that
 * screen is a tool for closing a drawer — boxes to type in, buttons to press,
 * figures that only mean something to somebody mid-count — and printing it gave
 * you a photograph of a workbench. This is a document. It is read by the owner
 * at the end of a long day and handed to an accountant who was not here, and
 * neither of them can ask it a follow-up question.
 *
 * Four rules follow from that, and every layout decision below is one of them:
 *
 *   THE ANSWER BEFORE THE EVIDENCE. Page one says whether the money is right,
 *   what came in, and what is still owed. Everything after it is the working
 *   that backs those three sentences up. The old report opened with a tender
 *   reconciliation table, which is the right thing to check and the wrong thing
 *   to lead with — nobody reads a document from the top when the top is a grid.
 *
 *   EVERY SECTION SAYS WHAT IT IS FOR, in one line, in the words the shop
 *   uses. The people this is written for did not grow up with spreadsheets and
 *   should not have to have this explained to them twice by the person who
 *   printed it. Explaining is not the same as talking down: the lines state
 *   what the numbers mean and why they are worth looking at, and then stop.
 *
 *   NOTHING ON PAPER THAT ONLY WORKS ON GLASS. No buttons, no covers, no
 *   "click to expand", no colour that carries meaning a grey printer will lose.
 *
 *   NOT ONE FIGURE FEWER THAN BEFORE. Reorganising a report is the easiest
 *   possible way to quietly lose something somebody was relying on, so every
 *   figure the old sheet printed is here. Where the old one was thin — a total
 *   with no explanation, a list with no sum at the foot — it has been filled
 *   in, not cut.
 *
 * IT READS THE SAME ENDPOINT THE OLD ONE DID. `/api/pos/reports/eod` is
 * untouched, which means the close-out screen and this document can never
 * disagree about a number: there is one calculation and two renderings of it,
 * rather than two calculations that look alike the day they are written.
 */

type EodData = {
  scope: "day" | "shift";
  businessDate: string;
  today: string;
  shift: Shift | null;
  reconciliation: Reconciliation;
  byCashier: CashierTotal[];
  dayTotals: DayTotals;
  offRack: OffRackLine[];
  outstanding: OutstandingTicket[];
  trend: TrendDay[];
  entries: DayEntry[];
  drawer: DrawerMovement[];
  hiddenDrawerCents: number;
  registerChecks: RegisterCheck[];
  leaderboard: Standings & {
    week: { start: string; end: string };
    priorWeek: { start: string; end: string };
    comparable: { start: string; end: string; days: number };
  };
  canSeeTechIncomeCash: boolean;
  canSeePurchases: boolean;
  edits: TicketEdit[];
  houseAccount: HouseAccountCharge[];
  received: StockReceived[];
  /*
    Sent by the endpoint, and deliberately not printed here.

    It is the only figure on the payload that is not about this day: it says
    what the racks look like at the moment somebody pressed print, and it would
    read the same on a report for last Tuesday. This document is the record of a
    trading day, and mixing a live stock list into it makes both harder to
    trust — the day's figures stop being a snapshot the moment one line of them
    keeps moving. What to order has its own printable page, which is where it is
    acted on. Kept on the type because the endpoint still sends it.
  */
  lowStock: { productId: number; name: string; onHand: number; reorderPoint: number }[];
  shopName: string;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Saturday, 15 August 2026" — spelled out, because this is a filed document. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return `${DAY_NAMES[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return m && d ? `${m}/${d}` : iso;
}

function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DAY_NAMES[new Date(y, m - 1, d).getDay()].slice(0, 3);
}

function clockOf(at: string): string {
  const t = at.slice(11, 16);
  if (!t) return "";
  const [h, mm] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
}

/**
 * On a drawer, minus means money is missing. On a card terminal it means the
 * opposite: nothing can be taken out of a settled batch, so a gap there is the
 * register having logged a payment the terminal never ran. The close-out screen
 * documents this convention at length; the sign is flipped here for the same
 * reason and the column heading says which way round it is being read.
 */
const shownVariance = (varianceCents: number, isCard: number) =>
  isCard ? -varianceCents : varianceCents;

/**
 * The tenders a close-out actually counts.
 *
 * The same pair the close-out screen holds under the same name, for the same
 * reason stated there: cash is the drawer in hand and `cc` is the batch the
 * terminal prints, and they are the only two figures a person physically
 * produces at close.
 */
const COUNTABLE = new Set(["cash", "cc"]);

const signed = (cents: number) =>
  cents === 0 ? formatCents(0) : `${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;

/** A heading, its one-line explanation, and the thing itself. */
function Section({
  n,
  title,
  lead,
  children,
  breakBefore,
}: {
  n?: string;
  title: string;
  lead: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <section className={`dr-sec${breakBefore ? " dr-break" : ""}`}>
      <h2 className="dr-h2">
        {n && <span className="dr-h2-n">{n}</span>}
        {title}
      </h2>
      <p className="dr-lead">{lead}</p>
      {children}
    </section>
  );
}

/**
 * How today sits against its own weekday — "+18% on the last 4 Saturdays".
 *
 * A sign and a percentage, never a bare arrow: an arrow says a direction and
 * this has to survive being read off a photocopy by somebody who was not here.
 * Nothing is drawn at all when there is no baseline, because a comparison
 * against nothing is worse than no comparison.
 */
function Against({
  now,
  base,
  days,
  weekday,
}: {
  now: number;
  base: number;
  days: number;
  weekday: string;
}) {
  if (base <= 0) return null;
  const pct = Math.round(((now - base) / base) * 100);
  return (
    <div className={`dr-vs${pct >= 0 ? " dr-vs-up" : " dr-vs-down"}`}>
      {pct >= 0 ? "+" : ""}
      {pct}% on the last {days} {weekday}
      {days === 1 ? "" : "s"}
    </div>
  );
}

/**
 * How many separate tickets were opened in each hour of a day.
 *
 * Counted off the day's own entries rather than asked of the server, for two
 * reasons: it costs nothing, and it means today's chart and last week's chart
 * are produced by one function — two queries that agree on the day they are
 * written are two queries that disagree by Christmas.
 *
 * DISTINCT TICKETS, not lines. A ticket with four tires on it is one customer
 * at the counter, and the question this answers is how many people the shop had
 * to serve in that hour, not how much work went on the paper.
 *
 * EACH TICKET COUNTED ONCE, IN THE HOUR IT STARTED. Counting a ticket in every
 * hour it touched was the obvious way to write this and it is wrong twice over:
 * a ticket rung at 9:58 and paid at 10:02 landed in both hours, so the bars
 * summed to more tickets than the day actually had — measured on a real
 * Saturday, 45 against 42 — and the chart would have quietly contradicted the
 * count printed at the top of the same page. Two figures disagreeing on one
 * sheet is worse than either being slightly coarse.
 *
 * IT STILL WILL NOT EQUAL THE TICKET COUNT ON PAGE ONE, and that is correct
 * rather than a rounding difference. This counts everybody who stood at the
 * counter, which includes somebody coming in today to settle a ticket rung last
 * Friday — a real customer in a real hour, and not one of today's tickets. On
 * the day this was checked that was exactly one person, S-2026-000206 from the
 * week before. So the two figures are labelled as the different things they
 * are: page one counts TICKETS OPENED, this counts PEOPLE SERVED.
 */
function ticketsByHour(entries: DayEntry[]): Map<number, number> {
  const firstHour = new Map<string, number>();
  for (const e of entries) {
    if (e.saleStatus === "voided") continue;
    const h = Number(e.at.slice(11, 13));
    if (!Number.isFinite(h)) continue;
    const seen = firstHour.get(e.saleNo);
    if (seen === undefined || h < seen) firstHour.set(e.saleNo, h);
  }
  const byHour = new Map<number, number>();
  for (const h of firstHour.values()) byHour.set(h, (byHour.get(h) ?? 0) + 1);
  return byHour;
}

/** Said once, where a section has nothing in it — a blank space reads as a bug. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="dr-none">{children}</p>;
}

export default function DayReportPage() {
  const { user, can } = usePosAuth();
  const [data, setData] = useState<EodData | null>(null);
  /*
    THREE ENDPOINTS, BECAUSE THE DAY IS ANSWERED IN THREE PLACES.

    The close-out endpoint holds the money. The daily-report endpoint holds two
    things it does not — whether the racks moved in step with the tickets, and
    who was on the clock for how long — and the business endpoint holds the week
    shape behind the heatmap. All three already exist and already back a screen
    somebody reads, which is the point: this document quotes them rather than
    recalculating anything, so it cannot drift away from the screens it was
    printed from.

    Both are optional. If either fails the report still prints everything else
    rather than refusing — a close-out sheet that will not come out of the
    printer because a heatmap query timed out is worse than one without a
    heatmap.
  */
  const [day, setDay] = useState<CloseoutV2 | null>(null);
  const [heatmap, setHeatmap] = useState<HourCell[] | null>(null);
  const [weekdays, setWeekdays] = useState<WeekdayRow[] | null>(null);
  /*
    The same weekday a week ago, fetched whole rather than as a summary.

    It comes off the SAME endpoint as today, so both days are bucketed by the
    identical function below and cannot disagree about what an hour is. A
    summary figure from a different query would have been cheaper and would
    have had to be trusted; this can be checked against that day's own report.
  */
  const [lastWeek, setLastWeek] = useState<EodData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState("");

  const load = useCallback(async () => {
    const date = new URLSearchParams(window.location.search).get("date");
    const res = await fetch(`/api/pos/reports/eod${date ? `?date=${date}` : ""}`);
    if (!res.ok) {
      setError("Could not load the day");
      return;
    }
    /* Held rather than only pushed into state: the fetches below key off the
       business date this payload reports, and reading a Response twice is not
       something it will let you do. */
    const eod = (await res.json()) as EodData;
    setData(eod);

    const d = await fetch(`/api/pos/reports/closeout${date ? `?date=${date}` : ""}`);
    if (d.ok) setDay(await d.json());

    /* Seven days back from the day the SERVER says this is, not from whatever
       was in the query string — asked without a date it answers for the current
       business day, and that is the day this must line up against. */
    const prev = new Date(`${eod.businessDate}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 7);
    const lw = await fetch(`/api/pos/reports/eod?date=${prev.toISOString().slice(0, 10)}`);
    if (lw.ok) setLastWeek(await lw.json());

    /*
      FOUR WEEKS, AND THE WINDOW IS THE WHOLE ARGUMENT.

      This is what today gets measured against, so it decides whether the
      comparison means anything. Three windows were candidates:

        YESTERDAY is useless here. A tire shop's Saturday and its Tuesday are
        different businesses — comparing them says which day of the week it is,
        not how the shop is doing.

        THE SAME DAY LAST WEEK is fair on the weekday and is one sample. One
        rained-off Saturday, or one fleet dropping six trucks in at once, moves
        it enough to report a collapse or a boom that did not happen.

        FOUR OF THE SAME WEEKDAY is both. It cancels the weekday effect the way
        a same-day comparison does, and four samples is enough that one odd
        Saturday cannot carry it. Twenty-eight days is also recent enough to
        still be describing how the shop trades NOW, which a quarter or a year
        would quietly stop doing.

      So: the twenty-eight days ending today, and today's own figures are taken
      back out of the average below — a day cannot be part of what it is being
      measured against.

      The heatmap rides on the same window rather than asking for a wider one
      of its own. Four of each weekday is enough to show the shape of a week,
      and one request is one request.
    */
    /* The server's business date again, not the browser's calendar date: the
       shop's day runs past midnight, so at 12:30am those two are different and
       only one of them is the day being reported on. */
    const to = eod.businessDate;
    const fromD = new Date(`${to}T00:00:00Z`);
    fromD.setUTCDate(fromD.getUTCDate() - 27);
    const b = await fetch(
      `/api/pos/reports/business?from=${fromD.toISOString().slice(0, 10)}&to=${to}`,
    );
    if (b.ok) {
      const bi = await b.json();
      setHeatmap(bi.heatmap ?? []);
      setWeekdays(bi.weekdays ?? []);
    }
  }, []);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
    void load();
  }, [load]);

  /** Every derived figure the document quotes, worked out once. */
  const facts = useMemo(() => {
    if (!data) return null;
    const t = data.dayTotals;
    const rec = data.reconciliation;

    /* Money the shop actually took, the way the close-out states it: goods less
       what was given away, plus tips, less anything bought back over the
       counter. The four parts are printed beneath it so the figure can be
       checked rather than trusted. */
    const takenIn = t.goodsCents + t.tipCents - t.purchasesCents;
    const avgTicket = t.saleCount > 0 ? Math.round(t.goodsCents / t.saleCount) : 0;

    const counted = rec.methods.filter((m) => m.counted);
    const offBy = counted.reduce((s, m) => s + shownVariance(m.varianceCents, m.isCard), 0);

    /* The trend arrives oldest-first and ends on this day, so the eighth day
       back is the same weekday — which is the only fair comparison a tire shop
       has. Saturday is not Tuesday and never will be. */
    const days = data.trend;
    const today = days[days.length - 1];
    const priorDays = days.slice(0, -1);
    const avgGoods =
      priorDays.length > 0
        ? Math.round(priorDays.reduce((s, d) => s + d.goodsCents, 0) / priorDays.length)
        : 0;

    /*
      OUTSTANDING IS TWO LISTS WEARING ONE NAME.

      `outstandingTickets` says so itself: a ticket sits there for one of two
      reasons, it owes money or it owes a tire. Printed as one table under a
      heading about money, seven of nine rows read "$0.00 owed" — which is true
      and useless, and it buries the two rows that are actually money out of the
      building. Worse, it invites the eye to total a column of zeroes and
      conclude the day is fine.

      So they are split by the only thing that separates them: whether a balance
      is left. The money list foots to a real figure; the work list drops the
      money columns entirely and says what is being waited on instead. Not one
      ticket is dropped — the same nine rows print, under the two headings that
      describe them.
    */
    /*
      Today against the average of the other same weekdays in the window.

      Today is subtracted out of both the total and the count first, so this is
      genuinely "the other four Saturdays" and not a figure that includes the
      day it is judging. Null when there is nothing left to compare against —
      a first Saturday on a new register has no baseline, and inventing one by
      dividing by zero, or by quietly falling back to a different weekday, is
      how a report starts lying on its most prominent line.
    */
    const wd = (() => {
      if (!weekdays) return null;
      const [yy, mm, dd] = data.businessDate.split("-").map(Number);
      const dow = new Date(yy, mm - 1, dd).getDay();
      const row = weekdays.find((w) => w.weekday === dow);
      if (!row || row.days <= 1) return null;
      const others = row.days - 1;
      return {
        dow,
        days: others,
        tickets: (row.tickets - t.saleCount) / others,
        goods: (row.goodsCents - t.goodsCents) / others,
      };
    })();

    const owes = data.outstanding.filter((o) => o.balanceCents > 0);
    const waiting = data.outstanding.filter((o) => o.balanceCents <= 0);
    const owed = owes.reduce((s, o) => s + o.balanceCents, 0);
    const onAccount = data.houseAccount.reduce((s, h) => s + h.amountCents, 0);

    /* Undone pairs cancel: a movement and the row that reverses it are both
       kept on the ledger and neither belongs in a net the owner reads. Same
       rule the close-out applies, applied here for the same reason. */
    const undone = new Set<number>();
    for (const m of data.drawer) {
      if (m.reverses_id != null) {
        undone.add(m.id);
        undone.add(m.reverses_id);
      }
    }
    const moves = data.drawer.filter((m) => !undone.has(m.id));
    const movesNet = moves.reduce(
      (s, m) => s + (m.kind === "withdrawal" ? -m.amount_cents : m.amount_cents),
      0,
    );

    /* What sold, by the five buckets the register rings against. Off the line
       entries rather than a second query, so this can never disagree with the
       ledger printed at the back of the document. */
    const byCategory = new Map<string, { units: number; cents: number }>();
    let newTireUnits = 0;
    let newTireCents = 0;
    for (const e of data.entries) {
      if (e.kind !== "line" || e.ticketKind === "purchase") continue;
      if (e.saleStatus === "voided") continue;
      const cat = e.category || "Other Service";
      const cur = byCategory.get(cat) ?? { units: 0, cents: 0 };
      const qty = Number((e.detail.match(/^(\d+)\s*×/) ?? [])[1] ?? 1) || 1;
      cur.units += qty;
      cur.cents += e.amountCents;
      byCategory.set(cat, cur);
      if (cat === "New Tire") {
        newTireUnits += qty;
        newTireCents += e.amountCents;
      }
    }
    const categories = [...byCategory.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.cents - a.cents);

    const receivedUnits = data.received.reduce((s, r) => s + r.qty, 0);

    /*
      Every new tire that left the building today, one line each.

      The body of the report says how many and how much; this is the list behind
      that figure. It is the appendix people actually go looking for — "which
      tires went out on Saturday" is asked far more often than any other
      question about a past day, by whoever is deciding what to reorder and by
      anybody checking a warranty claim months later.

      Built off the same entries as the ledger at the back, filtered to the New
      Tire bucket, so it can never disagree with it.
    */
    const tiresSold = data.entries
      .filter(
        (e) =>
          e.kind === "line" &&
          e.category === "New Tire" &&
          e.ticketKind !== "purchase" &&
          !e.voided &&
          e.saleStatus !== "voided",
      )
      .map((e) => ({
        ...e,
        qty: Number((e.detail.match(/^(\d+)\s*×/) ?? [])[1] ?? 1) || 1,
      }));

    return {
      wd,
      tiresSold,
      owes,
      waiting,
      takenIn,
      avgTicket,
      counted,
      offBy,
      today,
      avgGoods,
      owed,
      onAccount,
      moves,
      movesNet,
      categories,
      newTireUnits,
      newTireCents,
      receivedUnits,
    };
  }, [data]);

  if (error) return <div className="p-6 text-red-700">{error}</div>;
  if (!data || !facts) return <div className="p-6 text-brand-300">Reading the day…</div>;

  const rec = data.reconciliation;
  const t = data.dayTotals;
  const registerLogged = rec.anyCounted;

  /* Balanced, over, or short — in that order of likelihood, and in words
     before figures. "OUT BY 24" is a phrase somebody has to be taught; "we have
     $24 more than the tickets explain" is not. */
  const verdict = !registerLogged
    ? { tone: "wait", head: "The register has not been counted yet", body: "" }
    : facts.offBy === 0
      ? {
          tone: "ok",
          head: "The money balances",
          body: "Every tender was counted and each one matches what the tickets say it should be. Nothing to chase.",
        }
      : facts.offBy > 0
        ? {
            tone: "over",
            head: `There is ${formatCents(facts.offBy)} more than the tickets explain`,
            body: "Nothing is missing. This is almost always a sale rung short, or one that was never rung at all — worth finding, because the ticket it belongs to is wrong.",
          }
        : {
            tone: "short",
            head: `${formatCents(Math.abs(facts.offBy))} is not there`,
            body: "The drawer holds less than the tickets say it should. Check the day's cash movements first, then any ticket rung on the wrong tender.",
          };

  return (
    <div className="dr">
      {/* Screen only. On paper the document begins at the masthead. */}
      <div className="dr-bar no-print">
        <div>
          <strong>Daily Business Report</strong> · {longDate(data.businessDate)}
        </div>
        {/*
          Print and Back, the same pair every other printable in the app puts
          there, and the same component — so the way out of a document is the
          same wherever somebody meets one.

          IT NO LONGER PRINTS ITSELF. Firing the dialog on arrival meant the
          only way to look at the report was to dismiss a print dialog first,
          and anybody who wanted to read a figure rather than file the sheet had
          to cancel out of the printer to do it. Landing on the page and waiting
          to be told also means the paper is only spent when somebody meant to
          spend it.
        */}
        <PrintButton />
      </div>

      {/* ══════════ MASTHEAD ══════════ */}
      <header className="dr-masthead">
        <div className="dr-mast-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="dr-logo" />
          <div>
            <div className="dr-shop">{data.shopName}</div>
            <div className="dr-doc">Daily Business Report</div>
          </div>
        </div>
        <div className="dr-mast-right">
          <div className="dr-mast-date">{longDate(data.businessDate)}</div>
          <dl className="dr-meta">
            <dt>Covers</dt>
            <dd>
              {data.scope === "shift" && data.shift
                ? `One shift, opened ${clockOf(data.shift.opened_at)}`
                : "The whole trading day"}
            </dd>
            <dt>Printed</dt>
            <dd>{printedAt}</dd>
            <dt>By</dt>
            <dd>{user?.name ?? "—"}</dd>
          </dl>
        </div>
      </header>

      {/* ══════════ 1. THE ANSWER ══════════ */}
      <div className={`dr-verdict dr-verdict-${verdict.tone}`}>
        <div className="dr-verdict-tag">The bottom line</div>
        <div className="dr-verdict-head">{verdict.head}</div>
        {verdict.body && <div className="dr-verdict-body">{verdict.body}</div>}
        {!registerLogged && (
          <div className="dr-verdict-body">
            Nobody has typed in what is physically in the drawer, so this report can say what the
            tickets expect but not whether the money agrees with them. Count the drawer and the card
            terminal, log it, and print this again.
          </div>
        )}
      </div>

      <div className="dr-headline">
        <div className="dr-stat dr-stat-lead">
          <div className="dr-stat-label">Money taken in</div>
          <div className="dr-stat-value">{formatCents(facts.takenIn)}</div>
          {facts.wd && (
            <Against
              now={facts.takenIn}
              base={facts.wd.goods}
              days={facts.wd.days}
              weekday={DAY_NAMES[facts.wd.dow]}
            />
          )}
          <div className="dr-stat-sub">
            {formatCents(t.goodsCents)} sold
            {t.discountsCents > 0 && <> · less {formatCents(t.discountsCents)} discounts</>}
            {t.tipCents > 0 && <> · plus {formatCents(t.tipCents)} tips</>}
            {t.purchasesCents > 0 && <> · less {formatCents(t.purchasesCents)} bought back</>}
          </div>
        </div>
        <div className="dr-stat">
          <div className="dr-stat-label">Tickets</div>
          <div className="dr-stat-value">{t.saleCount}</div>
          {facts.wd && (
            <Against
              now={t.saleCount}
              base={facts.wd.tickets}
              days={facts.wd.days}
              weekday={DAY_NAMES[facts.wd.dow]}
            />
          )}
          <div className="dr-stat-sub">
            {t.voidedCount > 0 ? `${t.voidedCount} voided as well` : "none voided"}
          </div>
        </div>
        <div className="dr-stat">
          <div className="dr-stat-label">Average ticket</div>
          <div className="dr-stat-value">{formatCents(facts.avgTicket)}</div>
          {facts.wd && facts.wd.tickets > 0 && (
            <Against
              now={facts.avgTicket}
              base={facts.wd.goods / facts.wd.tickets}
              days={facts.wd.days}
              weekday={DAY_NAMES[facts.wd.dow]}
            />
          )}
          <div className="dr-stat-sub">what a customer spent, on average</div>
        </div>
        <div className="dr-stat">
          <div className="dr-stat-label">Still owed to us</div>
          <div className={`dr-stat-value${facts.owed > 0 ? " dr-owed" : ""}`}>
            {formatCents(facts.owed)}
          </div>
          <div className="dr-stat-sub">
            {facts.owes.length === 0
              ? "every ticket paid in full"
              : `${facts.owes.length} ticket${facts.owes.length === 1 ? "" : "s"} not paid in full`}
          </div>
        </div>
      </div>

      {/* ══════════ 2. HOW TODAY COMPARES ══════════ */}
      <Section
        n="1"
        title="How today compares"
        lead="The week leading up to today, so the run of days can be seen rather than described. It is a shape, not a scorecard — a single day either side of today says little on its own, which is why the figures at the top are measured against four weeks of the same weekday instead."
      >
        {data.trend.length === 0 ? (
          <Nothing>No earlier days to compare against yet.</Nothing>
        ) : (
          <>
            <div className="dr-chart">
              {(() => {
                const max = Math.max(...data.trend.map((d) => d.goodsCents), 1);
                return data.trend.map((d, i) => {
                  const isToday = i === data.trend.length - 1;
                  const isSameDay = false;
                  return (
                    <div key={d.businessDate} className="dr-bar-col">
                      <div className="dr-bar-amt">{formatCents(d.goodsCents)}</div>
                      <div className="dr-bar-track">
                        <div
                          className={`dr-bar-fill${isToday ? " is-today" : ""}${
                            isSameDay ? " is-lastweek" : ""
                          }`}
                          style={{ height: `${Math.max(2, (d.goodsCents / max) * 100)}%` }}
                        />
                      </div>
                      <div className="dr-bar-day">
                        {weekdayShort(d.businessDate)}
                        <span className="dr-bar-date">{shortDate(d.businessDate)}</span>
                      </div>
                      <div className="dr-bar-n">{d.saleCount} tk</div>
                    </div>
                  );
                });
              })()}
            </div>
            {/*
              Two columns, because a comparison read down a column of labels is
              not a comparison. Today on the left, the baseline on the right,
              and the three measures that answer different questions: how much
              came in, how many people came, and what each of them spent.

              The third is the one that cannot be read off the other two. A day
              can take the same money from half the customers at twice the
              ticket, and that is a completely different day — one worth
              understanding rather than filing.
            */}
            <table className="dr-table dr-compare">
              <thead>
                <tr>
                  <th />
                  <th className="num">Today</th>
                  <th className="num">
                    {facts.wd
                      ? `Last ${facts.wd.days} ${DAY_NAMES[facts.wd.dow]}${facts.wd.days === 1 ? "" : "s"}`
                      : "The days before"}
                  </th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const base = facts.wd;
                  const rows: {
                    label: string;
                    now: number;
                    was: number | null;
                    fmt: (n: number) => string;
                  }[] = [
                    {
                      label: "Sold",
                      now: t.goodsCents,
                      was: base ? base.goods : facts.avgGoods,
                      fmt: formatCents,
                    },
                    {
                      label: "Tickets",
                      now: t.saleCount,
                      was: base ? base.tickets : null,
                      fmt: (n) => String(Math.round(n)),
                    },
                    {
                      label: "Average ticket",
                      now: facts.avgTicket,
                      was: base && base.tickets > 0 ? base.goods / base.tickets : null,
                      fmt: formatCents,
                    },
                  ];
                  return rows.map((r) => {
                    const pct =
                      r.was && r.was > 0 ? Math.round(((r.now - r.was) / r.was) * 100) : null;
                    return (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        <td className="num dr-now">{r.fmt(r.now)}</td>
                        <td className="num">{r.was === null ? "—" : r.fmt(r.was)}</td>
                        <td
                          className={`num${
                            pct === null ? "" : pct >= 0 ? " dr-vs-up" : " dr-vs-down"
                          }`}
                        >
                          {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct}%`}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </>
        )}
      </Section>

      {/* ══════════ 3. THE MONEY ══════════ */}
      <Section
        n="2"
        title="Where the money came from"
        lead="Every way a customer can pay, what the tickets say came in on it, and — for the two we physically count — what was actually there. A difference on the drawer means cash; a difference on the card terminal means the register logged a payment the terminal never ran."
        breakBefore
      >
        <table className="dr-table">
          <thead>
            <tr>
              <th>How they paid</th>
              <th className="num">Off the tickets</th>
              <th className="num">Should be in hand</th>
              <th className="num">Counted</th>
              <th className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rec.methods.map((m: MethodVariance) => {
              const v = shownVariance(m.varianceCents, m.isCard);
              return (
                <tr key={m.methodId}>
                  <td>
                    {m.label}
                    {/*
                      Only on the two that CAN be counted.

                      Cash and the card batch are the two a person physically
                      produces at close; everything else — the house accounts,
                      financing, PO — is money that never passes through
                      anybody's hands here, so there was never a count to miss.
                      Badging all seven made the sheet read as though five
                      things had been skipped, which is the opposite of what it
                      says, and it drowned the badge on the one tender where it
                      actually means somebody has not finished.
                    */}
                    {COUNTABLE.has(m.code) && !m.counted && (
                      <span className="dr-tag">not counted</span>
                    )}
                  </td>
                  <td className="num">{formatCents(m.takingsCents)}</td>
                  <td className="num">
                    {m.counted || m.code === "cash" ? formatCents(m.expectedCents) : "—"}
                  </td>
                  <td className="num">
                    {m.counted && m.countedCents !== null ? formatCents(m.countedCents) : "—"}
                  </td>
                  <td className={`num${m.counted && v !== 0 ? " dr-off" : ""}`}>
                    {m.counted ? signed(v) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Everything, together</td>
              <td className="num">
                {formatCents(rec.methods.reduce((s, m) => s + m.takingsCents, 0))}
              </td>
              <td className="num">{formatCents(rec.totalExpectedCents)}</td>
              <td className="num">{formatCents(rec.totalCountedCents)}</td>
              <td className={`num${facts.offBy !== 0 ? " dr-off" : ""}`}>
                {registerLogged ? signed(facts.offBy) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="dr-foot">
          <strong>Only cash and the card batch get counted.</strong> They are the two a person
          physically produces at close — notes in the drawer, and the total the terminal prints when
          the batch is settled. Everything else on this table is money that never passed through
          anybody&apos;s hands here, so it is listed for the record with nothing to count it against.
        </p>

        {rec.tips.cents > 0 && (
          <p className="dr-foot">
            <strong>Tips: {formatCents(rec.tips.cents)}.</strong>{" "}
            {rec.tips.balancedByTips
              ? "The drawer is short by exactly this, which means the tips were paid out in cash before it was counted. Nothing is missing."
              : rec.tips.cashCounted
                ? `Treating the tips as already paid out, the cash difference would be ${signed(rec.tips.cashVarianceIfTipsPaidCents)}.`
                : "Counted on the tickets. The drawer has not been counted, so there is nothing to read this against yet."}
          </p>
        )}

        {rec.hints.length > 0 && (
          <div className="dr-callout">
            <div className="dr-callout-head">This looks like a payment rung on the wrong button</div>
            {rec.hints.map((h, i) => (
              <p key={i} className="dr-callout-body">
                {h.overLabel} is over by the same amount {h.shortLabel} is short. That is what
                happens when a customer paid one way and it was rung the other — the money is all
                here, but two tickets are wrong and the day&apos;s figures for both tenders are
                wrong with them.
              </p>
            ))}
          </div>
        )}
      </Section>

      {/* ══════════ 4. DRAWER MOVEMENTS ══════════ */}
      <Section
        n="3"
        title="Cash in and out of the drawer"
        lead="Money that moved for a reason that was not a sale — a run to the bank, change brought in, a part paid for in cash. Each one changes what should be in the drawer at close, which is why they are on the record with a name against them."
      >
        {facts.moves.length === 0 ? (
          <Nothing>Nothing was taken out or put in today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>What happened</th>
                <th>Why</th>
                <th>Logged by</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {facts.moves.map((m) => (
                <tr key={m.id}>
                  <td className="dr-time">{clockOf(m.created_at)}</td>
                  <td>{m.kind === "withdrawal" ? "Cash out" : "Cash in"}</td>
                  <td>
                    {m.reason}
                    {m.note && <span className="dr-note"> — {m.note}</span>}
                  </td>
                  <td>{m.created_by_name}</td>
                  <td className="num">
                    {m.kind === "withdrawal" ? "−" : "+"}
                    {formatCents(m.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Net effect on the drawer</td>
                <td className="num">{signed(facts.movesNet)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      {/* ══════════ 5. REGISTER LOGS ══════════ */}
      <Section
        n="4"
        title="Every count taken today"
        lead="The drawer can be counted as often as it suits — at a shift change, after a bank run, or any time it feels wrong. Each count is kept. The last one of the day is the one this report is signed on."
      >
        {data.registerChecks.length === 0 ? (
          <Nothing>The register has not been counted today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Counted by</th>
                <th>What was counted</th>
                <th className="num">Difference</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.registerChecks.map((c) => (
                <tr key={c.id} className={c.deleted ? "dr-struck" : undefined}>
                  <td className="dr-time">{clockOf(c.checkedAt)}</td>
                  <td>
                    {c.checkedByName}
                    {c.note && <div className="dr-note">{c.note}</div>}
                    {c.deleted === 1 && (
                      <div className="dr-note">
                        struck off by {c.deletedByName ?? "—"}
                        {c.deletedReason ? ` — ${c.deletedReason}` : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    {c.lines
                      .map((l) => `${l.label} ${formatCents(l.countedCents)}`)
                      .join(" · ")}
                  </td>
                  <td className={`num${c.balanced ? "" : " dr-off"}`}>
                    {signed(c.varianceCents)}
                  </td>
                  <td>{c.balanced ? "Balanced" : "Did not balance"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 6. WHO TOOK THE MONEY ══════════ */}
      <Section
        n="5"
        title="Who took the money"
        lead="Every payment carries the name of whoever was signed in when it was rung. This is not a sales ranking — it says who was standing at the register, which is the question asked when a figure needs explaining."
      >
        {data.byCashier.length === 0 ? (
          <Nothing>No payments were taken today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Payments</th>
                <th className="num">Collected</th>
                <th className="num">Of that, tips</th>
              </tr>
            </thead>
            <tbody>
              {data.byCashier.map((c) => (
                <tr key={c.employeeId}>
                  <td>{c.name}</td>
                  <td className="num">{c.count}</td>
                  <td className="num">{formatCents(c.collectedCents)}</td>
                  <td className="num">{c.tipCents > 0 ? formatCents(c.tipCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Everybody</td>
                <td className="num">{data.byCashier.reduce((s, c) => s + c.count, 0)}</td>
                <td className="num">
                  {formatCents(data.byCashier.reduce((s, c) => s + c.collectedCents, 0))}
                </td>
                <td className="num">
                  {formatCents(data.byCashier.reduce((s, c) => s + c.tipCents, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      {/* ══════════ 7. MONEY OWED ══════════ */}
      <Section
        n="6"
        title="Money still owed to us"
        lead="Tickets that were finished but not paid in full. This is the shop's money sitting outside the building, and it is the one list on this report worth acting on tomorrow morning."
        breakBefore
      >
        {facts.owes.length === 0 ? (
          <Nothing>Every ticket was paid in full. Nothing is owed.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Who</th>
                <th>What for</th>
                <th className="num">Ticket</th>
                <th className="num">Paid</th>
                <th className="num">Owed</th>
              </tr>
            </thead>
            <tbody>
              {facts.owes.map((o) => (
                <tr key={o.saleId}>
                  <td className="dr-mono">{o.saleNo}</td>
                  <td>
                    {o.customerName ?? "no name taken"}
                    {o.customerPhone && <div className="dr-note">{o.customerPhone}</div>}
                    {(o.workStatus || o.fulfillmentStatus) && (
                      <div className="dr-note">
                        {workStatusTitle(o.workStatus) ??
                          FULFILLMENT_LABELS[o.fulfillmentStatus] ??
                          ""}
                      </div>
                    )}
                  </td>
                  <td>
                    {o.what}
                    {o.notes && <div className="dr-note">{o.notes}</div>}
                  </td>
                  <td className="num">{formatCents(o.totalCents)}</td>
                  <td className="num">{formatCents(o.paidCents)}</td>
                  <td className="num dr-off">{formatCents(o.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Owed altogether</td>
                <td className="num dr-off">{formatCents(facts.owed)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      {/* ══════════ 7b. WORK STILL OWED ══════════ */}
      <Section
        n="7"
        title="Paid for, but we still owe them something"
        lead="These tickets are settled — every one of them is paid in full — but they are not finished. The shop is holding a vehicle, or waiting on a tire that has been sold and not yet fitted. No money is at stake here; the job is."
      >
        {facts.waiting.length === 0 ? (
          <Nothing>Nothing is being waited on.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Who</th>
                <th>What for</th>
                <th>What we owe them</th>
              </tr>
            </thead>
            <tbody>
              {facts.waiting.map((o) => (
                <tr key={o.saleId}>
                  <td className="dr-mono">{o.saleNo}</td>
                  <td>
                    {o.customerName ?? "no name taken"}
                    {o.customerPhone && <div className="dr-note">{o.customerPhone}</div>}
                  </td>
                  <td>
                    {o.what}
                    {o.notes && <div className="dr-note">{o.notes}</div>}
                  </td>
                  <td>
                    {workStatusTitle(o.workStatus) ??
                      FULFILLMENT_LABELS[o.fulfillmentStatus] ??
                      "still open"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 8. ON ACCOUNT ══════════ */}
      <Section
        n="8"
        title="Put on a house account today"
        lead="Work done for a company or a regular who settles up monthly instead of at the counter. The till balances because the ticket reads paid — but the money has not arrived yet, and it is chased with a statement rather than a phone call."
      >
        {data.houseAccount.length === 0 ? (
          <Nothing>Nothing went on account today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Account</th>
                <th>What for</th>
                <th>Their PO</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.houseAccount.map((h) => (
                <tr key={h.paymentId}>
                  <td className="dr-mono">{h.saleNo}</td>
                  <td>
                    {h.customer ?? "no name taken"}
                    {h.phone && <div className="dr-note">{h.phone}</div>}
                  </td>
                  <td>{h.what}</td>
                  <td>{h.po || "—"}</td>
                  <td className="num">{formatCents(h.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Charged to accounts today</td>
                <td className="num">{formatCents(facts.onAccount)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      {/* ══════════ 9. WHAT SOLD ══════════ */}
      <Section
        n="9"
        title="What the shop sold"
        lead="The day's work split into the five kinds of thing this register rings. Tires against service is the split worth watching: it is this shop's parts-against-labour."
        breakBefore
      >
        {facts.categories.length === 0 ? (
          <Nothing>Nothing was sold today.</Nothing>
        ) : (
          <>
            <table className="dr-table">
              <thead>
                <tr>
                  <th>Kind of work</th>
                  <th className="num">Lines</th>
                  <th className="num">Money</th>
                  <th className="num">Share</th>
                  <th className="dr-barcell">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const total = facts.categories.reduce((s, c) => s + c.cents, 0) || 1;
                  return facts.categories.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td className="num">{c.units}</td>
                      <td className="num">{formatCents(c.cents)}</td>
                      <td className="num">{Math.round((c.cents / total) * 100)}%</td>
                      <td className="dr-barcell">
                        <div className="dr-hbar" style={{ width: `${(c.cents / total) * 100}%` }} />
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
              <tfoot>
                <tr>
                  <td>Everything</td>
                  <td className="num">{facts.categories.reduce((s, c) => s + c.units, 0)}</td>
                  <td className="num">
                    {formatCents(facts.categories.reduce((s, c) => s + c.cents, 0))}
                  </td>
                  <td className="num">100%</td>
                  <td className="dr-barcell">&nbsp;</td>
                </tr>
              </tfoot>
            </table>
            <p className="dr-foot">
              <strong>
                New tires: {facts.newTireUnits} sold, {formatCents(facts.newTireCents)}.
              </strong>{" "}
              Of {t.saleCount} tickets today,{" "}
              {t.saleCount > 0 ? Math.round((facts.newTireUnits / t.saleCount) * 100) : 0}% carried a
              new tire — the day&apos;s best selling question is how many people who came in left on
              them.
            </p>
          </>
        )}
      </Section>

      {/* ══════════ 9b. THE RACKS ══════════ */}
      {day && (
        <Section
          n="10"
          title="Did the racks move in step"
          lead="A sold tire leaves two records, written by different parts of the program: a line on the ticket, and a movement on the stock ledger. When the two counts agree, no tire left the building unrecorded. When they do not, one of them is wrong and it is worth knowing which."
        >
          <table className="dr-table dr-compact">
            <tbody>
              <tr>
                <td>Tires on today&apos;s tickets</td>
                <td className="num">{day.stock.unitsSoldOnTickets}</td>
              </tr>
              <tr>
                <td>Tires taken off the racks</td>
                <td className="num">{day.stock.unitsOut}</td>
              </tr>
              {day.stock.fulfilledForEarlierUnits > 0 && (
                <tr>
                  <td className="dr-note">
                    of those, fitted today for tickets rung on earlier days
                  </td>
                  <td className="num dr-note">{day.stock.fulfilledForEarlierUnits}</td>
                </tr>
              )}
              {day.stock.awaitingFulfillmentUnits > 0 && (
                <tr>
                  <td className="dr-note">sold today as orders, not yet fitted</td>
                  <td className="num dr-note">{day.stock.awaitingFulfillmentUnits}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                {(() => {
                  /* The comparison the exception itself makes: both sides with
                     the two halves of the special-order cycle taken out, since
                     a tire sold one day and fitted another is the design
                     working rather than stock walking. */
                  const racks = day.stock.unitsOut - day.stock.fulfilledForEarlierUnits;
                  const tickets =
                    day.stock.unitsSoldOnTickets - day.stock.awaitingFulfillmentUnits;
                  const ok = racks === tickets;
                  return (
                    <>
                      <td>{ok ? "The two agree" : "The two DO NOT agree"}</td>
                      <td className={`num${ok ? "" : " dr-off"}`}>
                        {ok ? "✓" : `${tickets} vs ${racks}`}
                      </td>
                    </>
                  );
                })()}
              </tr>
            </tfoot>
          </table>
          {day.stock.unreviewedOversells > 0 && (
            <div className="dr-callout">
              <div className="dr-callout-head">
                {day.stock.unreviewedOversells} oversell
                {day.stock.unreviewedOversells === 1 ? "" : "s"} still to review
              </div>
              <p className="dr-callout-body">
                The register sold these while its own count said the rack was empty. Either the
                count was wrong — a tire on the rack nobody had booked in — or a tire left without
                being rung. Both are worth ten minutes.
              </p>
              {day.stock.oversellRows.length > 0 && (
                <p className="dr-callout-body">
                  {day.stock.oversellRows
                    .map(
                      (o) =>
                        `${o.productName}${o.saleNo ? ` on ${o.saleNo}` : ""}${
                          o.byName ? ` (${o.byName})` : ""
                        } — ${o.short} beyond the count`,
                    )
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ══════════ 10. WHO DID THE WORK ══════════ */}
      <Section
        n="10"
        title="Who did the work"
        lead={`Each technician's week so far, against the same number of days of the week before. Credit follows the line on the ticket, so a ticket with two jobs on it is split between the two people who did them.`}
      >
        {data.leaderboard.techs.length === 0 ? (
          <Nothing>Nobody has been credited with work this week.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th className="num">Tickets</th>
                <th className="num">New tires</th>
                <th className="num">Used tires</th>
                <th className="num">Other jobs</th>
                {data.canSeeTechIncomeCash && <th className="num">Money brought in</th>}
                {data.canSeeTechIncomeCash && <th className="num">Against last week</th>}
                <th className="num">Tips</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.techs.map((tech) => (
                <tr key={tech.employeeId}>
                  <td>{tech.name}</td>
                  <td className="num">{tech.ticketCount}</td>
                  <td className="num">{tech.newTires}</td>
                  <td className="num">{tech.usedTires}</td>
                  <td className="num">{tech.otherCount}</td>
                  {data.canSeeTechIncomeCash && (
                    <td className="num">{formatCents(tech.incomeCents)}</td>
                  )}
                  {data.canSeeTechIncomeCash && (
                    <td className="num">
                      {tech.improvementPct === null
                        ? "—"
                        : `${tech.improvementPct >= 0 ? "+" : ""}${Math.round(tech.improvementPct)}%`}
                    </td>
                  )}
                  <td className="num">
                    {tech.tipCents > 0 ? formatCents(tech.tipCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="dr-foot">
          Week of {data.leaderboard.week.start} to {data.leaderboard.week.end}, read against{" "}
          {data.leaderboard.comparable.days} matching day
          {data.leaderboard.comparable.days === 1 ? "" : "s"} of the week before.
        </p>

        {/*
          Hours, and what each hour brought in.

          Rate per hour is worked out ONLY over hours somebody actually clocked
          out of. The rest were closed automatically at nine, which is a
          placeholder rather than a time anybody went home — dividing money by a
          placeholder produces a figure that looks like a fact, and the share
          that is guesswork is stated here rather than folded in.
        */}
        {day && day.hours.people.length > 0 && (
          <>
            <h3 className="dr-h3">Hours on the clock</h3>
            <table className="dr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Hours</th>
                  <th className="num">Brought in</th>
                  <th className="num">Per hour</th>
                </tr>
              </thead>
              <tbody>
                {day.hours.people.map((h) => {
                  const tech = day.mechanics.find((m) => m.employeeId === h.employeeId);
                  const perHour =
                    h.knownMinutes > 0 && tech
                      ? Math.round((tech.salesCents / h.knownMinutes) * 60)
                      : null;
                  return (
                    <tr key={h.employeeId}>
                      <td>
                        {h.name}
                        {h.onTheClock && <span className="dr-tag">still on</span>}
                      </td>
                      {/* Both halves, because they are different facts: hours
                          somebody clocked out of, and hours the 9pm auto-close
                          guessed at. Added together silently they would make a
                          guess look like a measurement. */}
                      <td className="num">
                        {((h.knownMinutes + h.assumedMinutes) / 60).toFixed(1)}
                        {h.assumedMinutes > 0 && (
                          <div className="dr-note">
                            {(h.assumedMinutes / 60).toFixed(1)} estimated
                          </div>
                        )}
                      </td>
                      <td className="num">{tech ? formatCents(tech.salesCents) : "—"}</td>
                      <td className="num">{perHour === null ? "—" : formatCents(perHour)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="dr-foot">
              {day.hours.confidencePct === 100
                ? "Everybody clocked out, so every hour here is a real one."
                : `${day.hours.confidencePct}% of these hours were clocked out properly. The rest were closed automatically at 9pm and are an estimate — the per-hour figures ignore them.`}
            </p>
          </>
        )}
      </Section>

      {/* ══════════ 10b. WHEN THE SHOP IS BUSY ══════════ */}
      <Section
        n="11"
        title="How the day ran, hour by hour"
        lead="How many customers stood at the counter in each hour of TODAY, with the same day last week beside it. Two Saturdays are the only fair comparison a tire shop has, and the shape matters as much as the total — the same forty customers arriving in three hours or spread over nine are two very different days to staff."
        breakBefore
      >
        {(() => {
          const mine = ticketsByHour(data.entries);
          const theirs = lastWeek ? ticketsByHour(lastWeek.entries) : new Map<number, number>();
          const hrs = [...mine.keys(), ...theirs.keys()];
          if (hrs.length === 0)
            return <Nothing>No tickets were opened today.</Nothing>;
          const lo = Math.min(...hrs);
          const hi = Math.max(...hrs);
          const cols = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
          const max = Math.max(...[...mine.values(), ...theirs.values()], 1);
          const label = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
          const mineTotal = [...mine.values()].reduce((a, b) => a + b, 0);
          const theirsTotal = [...theirs.values()].reduce((a, b) => a + b, 0);
          return (
            <>
              {/*
                Two bars per hour, today always on the left and always solid.

                The current day is the subject of this whole document, so it is
                never the outlined one and never has to be looked for: it is the
                filled bar, it is first in every pair, and it is named in the key
                with its own date. Last week is drawn hollow — the same height
                scale, visibly a different thing, and it survives a mono printer
                where two shades of grey would not.
              */}
              <div className="dr-hours">
                {cols.map((h) => {
                  const a = mine.get(h) ?? 0;
                  const b = theirs.get(h) ?? 0;
                  return (
                    <div key={h} className="dr-hour">
                      <div className="dr-hour-bars">
                        <div
                          className="dr-hour-bar dr-hour-today"
                          style={{ height: `${(a / max) * 100}%` }}
                        >
                          {a > 0 && <span className="dr-hour-n">{a}</span>}
                        </div>
                        {lastWeek && (
                          <div
                            className="dr-hour-bar dr-hour-prev"
                            style={{ height: `${(b / max) * 100}%` }}
                          >
                            {b > 0 && <span className="dr-hour-n">{b}</span>}
                          </div>
                        )}
                      </div>
                      <div className="dr-hour-label">{label(h)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="dr-key">
                <span className="dr-key-item">
                  <span className="dr-key-swatch dr-hour-today" />
                  <strong>Today</strong> — {longDate(data.businessDate)} · {mineTotal} served
                </span>
                {lastWeek && (
                  <span className="dr-key-item">
                    <span className="dr-key-swatch dr-hour-prev" />
                    Same day last week — {longDate(lastWeek.businessDate)} · {theirsTotal} served
                  </span>
                )}
              </div>
              {lastWeek && theirsTotal > 0 && (
                <p className="dr-foot">
                  <strong>
                    {mineTotal > theirsTotal
                      ? `${mineTotal - theirsTotal} more `
                      : mineTotal < theirsTotal
                        ? `${theirsTotal - mineTotal} fewer `
                        : "The same number of "}
                    customer{Math.abs(mineTotal - theirsTotal) === 1 ? "" : "s"} than the same day
                    last week.
                  </strong>{" "}
                  A customer here is anybody served at the counter — including somebody
                  settling a ticket rung on an earlier day, which is why this can differ by
                  one or two from the ticket count on page one.{" "}
                  The busiest hour today was{" "}
                  {label([...mine.entries()].sort((x, y) => y[1] - x[1])[0][0])} with{" "}
                  {Math.max(...mine.values())} ticket
                  {Math.max(...mine.values()) === 1 ? "" : "s"}.
                </p>
              )}
            </>
          );
        })()}

      </Section>

      {/* ══════════ 11b. THE WEEK'S SHAPE ══════════ */}
      {/*
        Its own numbered section rather than a sub-heading under the hour chart.

        It was tucked under "How the day ran" on the reasoning that they answer
        the same question — and they do — but a reader looking for the heatmap
        went to the contents, found no heading with its name on it, and
        concluded it had been dropped. A section somebody cannot find is a
        section that is not there. Numbered, named the way it is asked for, and
        it stays next to the day it gives context to.
      */}
      <Section
        n="12"
        title="When the shop is busy"
        lead="The last four weeks as a grid: which hours of which days actually carry the shop. Darker is busier. This is the one page here that settles a rota argument — a shop can feel busy on a Saturday and take most of its money on a Thursday."
      >
        {/*
          The whole week behind the day above.

          A single day, even against its own last week, cannot say whether a
          quiet Tuesday afternoon is a problem or simply what Tuesday afternoons
          are. Four weeks of every weekday can, and it is the grid that settles a
          rota argument. Today's row is boxed so the day this report is about is
          never something to go hunting for.
        */}
        {heatmap === null ? (
          <Nothing>
            This grid is built from the shop&apos;s trading history, which only the owner&apos;s
            account can read. Everything else on this page is here.
          </Nothing>
        ) : heatmap.length === 0 ? (
          <Nothing>No tickets in the last four weeks to build a pattern from.</Nothing>
        ) : (
          <>
            {(() => {
              const hrs2 = heatmap.map((c) => c.hour);
              const lo2 = Math.min(...hrs2);
              const hi2 = Math.max(...hrs2);
              const cols2 = Array.from({ length: hi2 - lo2 + 1 }, (_, i) => lo2 + i);
              const max2 = Math.max(...heatmap.map((c) => c.tickets), 1);
              const at = (wd: number, hr: number) =>
                heatmap.find((c) => c.weekday === wd && c.hour === hr)?.tickets ?? 0;
              const label2 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
              const [yy, mm, dd] = data.businessDate.split("-").map(Number);
              const todayDow = new Date(yy, mm - 1, dd).getDay();
              return (
                <table className="dr-heat">
                  <thead>
                    <tr>
                      <th />
                      {cols2.map((h) => (
                        <th key={h}>{label2(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAY_NAMES.map((name, wd) => (
                      <tr key={wd} className={wd === todayDow ? "dr-heat-today" : undefined}>
                        <th>
                          {name.slice(0, 3)}
                          {wd === todayDow && <span className="dr-heat-mark">today</span>}
                        </th>
                        {cols2.map((h) => {
                          const n = at(wd, h);
                          /* Ink, not hue. A printer rendering a blue-to-red
                             scale in grey gives the busiest hour and the
                             quietest the same tone; density does not have that
                             problem, and it reads at arm's length. */
                          const shade = n === 0 ? 0 : 0.12 + (n / max2) * 0.78;
                          return (
                            <td
                              key={h}
                              style={{ background: `rgba(10,37,64,${shade.toFixed(2)})` }}
                            >
                              <span style={{ color: shade > 0.55 ? "#fff" : "#111827" }}>
                                {n || ""}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            <p className="dr-foot">
              Every ticket opened in that hour over the last four weeks, all four of each weekday
              added together. Darker is busier. The boxed row is the day this report covers.
            </p>
          </>
        )}
      </Section>

      {/* ══════════ 11. THINGS THAT NEED AN EYE ══════════ */}
      <Section
        n="13"
        title="Prices changed at the counter"
        lead="Tires sold for something other than the price on the rack. Every one of them may have been the right call — this is the record of the calls, not a list of mistakes."
        breakBefore
      >
        {data.offRack.length === 0 ? (
          <Nothing>Everything went out at the price on the rack.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>What</th>
                <th>Who rang it</th>
                <th className="num">Rack price</th>
                <th className="num">Charged</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {data.offRack.map((o, i) => (
                <tr key={`${o.saleId}-${i}`}>
                  <td className="dr-mono">{o.saleNo}</td>
                  <td>
                    {o.qty > 1 ? `${o.qty}× ` : ""}
                    {o.description}
                  </td>
                  <td>{o.who ?? "—"}</td>
                  <td className="num">{formatCents(o.listCents)}</td>
                  <td className="num">{formatCents(o.chargedCents)}</td>
                  <td className={`num${o.deltaCents < 0 ? " dr-off" : ""}`}>
                    {signed(o.deltaCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        n="14"
        title="Tickets changed after they were finished"
        lead="Money moved on a ticket that had already been completed. Legitimate every day — a wrong tender, a refund, a discount agreed after the fact — and worth a glance, because a finished ticket is supposed to stay finished."
      >
        {data.edits.length === 0 ? (
          <Nothing>No completed ticket was changed today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Ticket</th>
                <th>Changed by</th>
                <th>What changed</th>
                <th className="num">Was</th>
                <th className="num">Now</th>
              </tr>
            </thead>
            <tbody>
              {data.edits.map((e, i) => (
                <tr key={`${e.saleId}-${i}`}>
                  <td className="dr-time">{clockOf(e.at)}</td>
                  <td className="dr-mono">
                    {e.saleNo}
                    {e.saleDate !== data.businessDate && (
                      <div className="dr-note">from {e.saleDate}</div>
                    )}
                  </td>
                  <td>{e.by}</td>
                  <td>
                    {e.what}
                    {e.voided && <span className="dr-tag">voided</span>}
                  </td>
                  <td className="num">{formatCents(e.beforeCents)}</td>
                  <td className="num">{formatCents(e.afterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ══════════ 13. SIGNATURES ══════════ */}
      <section className="dr-sec dr-sign">
        <h2 className="dr-h2">Counted, checked and filed</h2>
        <p className="dr-lead">
          Two signatures: the person who counted the drawer, and the person who checked their
          figures. Sign only after the card terminal batch has been settled.
        </p>
        <div className="dr-sign-rows">
          <div className="dr-sign-row">
            <div className="dr-sign-line" />
            <div className="dr-sign-label">Counted by</div>
          </div>
          <div className="dr-sign-row">
            <div className="dr-sign-line" />
            <div className="dr-sign-label">Checked by</div>
          </div>
          <div className="dr-sign-row">
            <div className="dr-sign-line" />
            <div className="dr-sign-label">Date</div>
          </div>
        </div>
      </section>

      {/* ══════════ APPENDIX A — NEW TIRES SOLD ══════════ */}
      {/*
        Three appendices, in the order they get looked at.

        A is the one people come back to a printed day for: which tires went
        out. B is the other half of the same question — which came in. C is
        everything, kept last because it is the raw record rather than an answer
        to anything, and a reader who needs it knows to turn to the back.
      */}
      <section className="dr-sec dr-break">
        <h2 className="dr-h2">
          <span className="dr-h2-n">A</span>Appendix — new tires sold today
        </h2>
        <p className="dr-lead">
          Every new tire that left the building, one line each, with the ticket it went out on and
          who fitted it. This is the list behind the figure on page one.
        </p>
        {facts.tiresSold.length === 0 ? (
          <Nothing>No new tires were sold today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Ticket</th>
                <th>Tire</th>
                <th>Customer</th>
                <th>Fitted by</th>
                <th className="num">Qty</th>
                <th className="num">Sold for</th>
              </tr>
            </thead>
            <tbody>
              {facts.tiresSold.map((e) => (
                <tr key={e.key}>
                  <td className="dr-time">{clockOf(e.at)}</td>
                  <td className="dr-mono">{e.saleNo}</td>
                  <td>{e.what}</td>
                  <td>{e.customerName ?? "no name taken"}</td>
                  <td>{e.who ?? "—"}</td>
                  <td className="num">{e.qty}</td>
                  <td className="num">{formatCents(e.amountCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>
                  {facts.tiresSold.length} line{facts.tiresSold.length === 1 ? "" : "s"}
                </td>
                <td className="num">{facts.newTireUnits}</td>
                <td className="num">{formatCents(facts.newTireCents)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* ══════════ APPENDIX B — TIRES STOCKED ══════════ */}
      <section className="dr-sec dr-break">
        <h2 className="dr-h2">
          <span className="dr-h2-n">B</span>Appendix — stock received today
        </h2>
        <p className="dr-lead">
          What was unloaded and put on the racks, with the supplier and the invoice it came on, so
          it can be checked against the bill when that arrives.
        </p>
        {data.received.length === 0 ? (
          <Nothing>Nothing was received today.</Nothing>
        ) : (
          <table className="dr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>What</th>
                <th>Supplier</th>
                <th>Invoice</th>
                <th>Received by</th>
                <th className="num">How many</th>
              </tr>
            </thead>
            <tbody>
              {data.received.map((r) => (
                <tr key={r.movementId}>
                  <td className="dr-time">{clockOf(r.at)}</td>
                  <td>{r.name}</td>
                  <td>{r.supplier || "—"}</td>
                  <td>{r.reference || "—"}</td>
                  <td>{r.by ?? "—"}</td>
                  <td className="num">{r.qty}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Items received</td>
                <td className="num">{facts.receivedUnits}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      {/* ══════════ APPENDIX C — THE WHOLE LEDGER ══════════ */}
      <section className="dr-sec dr-break">
        <h2 className="dr-h2">
          <span className="dr-h2-n">C</span>Appendix — everything rung today
        </h2>
        <p className="dr-lead">
          Every line and every payment, in the order it happened. Nothing here is a summary; it is
          the record the rest of this report is worked out from, kept so any figure above can be
          traced back to the ticket it came off.
        </p>
        {data.entries.length === 0 ? (
          <Nothing>Nothing was rung today.</Nothing>
        ) : (
          <table className="dr-table dr-ledger">
            <thead>
              <tr>
                <th>Time</th>
                <th>Ticket</th>
                <th>Kind</th>
                <th>What</th>
                <th>Detail</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.key} className={e.saleStatus === "voided" ? "dr-struck" : undefined}>
                  <td className="dr-time">{clockOf(e.at)}</td>
                  <td className="dr-mono">{e.saleNo}</td>
                  <td>{e.kind === "money" ? "Payment" : e.category || "—"}</td>
                  <td>
                    {e.what}
                    {e.customerName && <div className="dr-note">{e.customerName}</div>}
                    {e.voidReason && <div className="dr-note">voided — {e.voidReason}</div>}
                  </td>
                  <td className="dr-note">{e.detail}</td>
                  <td className="num">{formatCents(e.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="dr-colophon">
        {data.shopName} · {longDate(data.businessDate)} · printed {printedAt} by{" "}
        {user?.name ?? "—"}
        {can("viewCosts") ? "" : ""}
      </footer>
    </div>
  );
}
