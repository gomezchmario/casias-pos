"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WORK_PILLS } from "@/lib/work-status";
import { TicketDrawer } from "@/components/pos/TicketDrawer";
import { NoticeBoard } from "@/components/pos/NoticeBoard";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import type {
  DayTotals,
  MechanicTotal,
  MethodTotal,
  OutstandingTicket,
} from "@/lib/pos-reports";
import type { RecentLine, Standings, StandingsPeriod, TechScore } from "@/lib/leaderboard";
import type { PaymentMethod } from "@/lib/payments";

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

/** Formats a technician's money the way the current viewer is allowed to see it. */
type MoneyFmt = (cents: number, pct: number) => string;

/**
 * What the podium can be ranked on.
 *
 * New and used tires get their own entries and are never blended into the
 * headline "most tires" alone, because they are different work: a used tire is
 * priced at the counter off its condition, a new one comes off a lot with a
 * cost. Someone who moves twenty used tires and someone who fits five sets of
 * four have both had a good week, and only separate boards say so.
 *
 * `score` is what ranks; anything at or below zero is off the board entirely,
 * which for improvement means only genuine improvements place. Ranking a week
 * where everybody fell as if someone had won it is how a leaderboard stops
 * being believed.
 */
type PodiumMetric = {
  key: string;
  label: string;
  /** Word under the big number on the block. */
  unit: string;
  score: (t: TechScore) => number | null;
  show: (t: TechScore, money: MoneyFmt) => string;
};

const PODIUM_METRICS: PodiumMetric[] = [
  {
    key: "tires",
    label: "Most tires sold",
    unit: "tires",
    score: (t) => t.newTires + t.usedTires,
    show: (t) => String(t.newTires + t.usedTires),
  },
  {
    key: "newTires",
    label: "Most new tires sold",
    unit: "new tires",
    score: (t) => t.newTires,
    show: (t) => String(t.newTires),
  },
  {
    key: "usedTires",
    label: "Most used tires sold",
    unit: "used tires",
    score: (t) => t.usedTires,
    show: (t) => String(t.usedTires),
  },
  {
    key: "serviceMoney",
    label: "Most services by money",
    unit: "in service work",
    // Ranked on the share, not the cents, because the cents are zeroed for
    // anyone below owner and ranking on them would put the board in a
    // meaningless order for everyone else. The share survives the gate.
    score: (t) => t.otherIncomePct,
    show: (t, money) => money(t.otherIncomeCents, t.otherIncomePct),
  },
  {
    key: "serviceCount",
    label: "Most services by count",
    unit: "jobs",
    score: (t) => t.otherCount,
    show: (t) => String(t.otherCount),
  },
  {
    key: "tickets",
    label: "Most tickets",
    unit: "tickets",
    score: (t) => t.ticketCount,
    show: (t) => String(t.ticketCount),
  },
  {
    key: "improvement",
    label: "Best improvement",
    unit: "up on last time",
    score: (t) => t.improvementPct,
    show: (t) => `+${(t.improvementPct ?? 0).toFixed(0)}%`,
  },
];

export default function DayPage() {
  const { can } = usePosAuth();
  const [date, setDate] = useState("");
  const [data, setData] = useState<DayData | null>(null);
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);

  // Hidden until asked for, because this screen lives on a counter in a shop
  // with customers on the other side of it. Hiding the money leaves the
  // standings intact -- everyone still knows where they placed -- without
  // publishing what each person earned to whoever is waiting on a tire.
  //
  // Default-hidden rather than default-shown for the usual reason: the failure
  // mode of forgetting to press the button is a stranger reading the day's
  // takings, and the failure mode of having to press it is one press.
  const [hideMoney, setHideMoney] = useState(true);

  // Tires stay the default because it is what the shop has always put on the
  // board, and a dropdown that starts somewhere new every time is one people
  // stop trusting to mean what it says.
  const [metricKey, setMetricKey] = useState("tires");
  const [podiumPeriod, setPodiumPeriod] = useState<StandingsPeriod>("week");
  /**
   * Whether the podium shows everybody who placed, or only the top three.
   *
   * Three by default and deliberately. A podium is a picture, not a table --
   * the whole reason it earns the top of the screen is that it reads in one
   * glance from across the shop, and a fourth and fifth block turn it into
   * something you have to stand in front of.
   *
   * But three is also the number that makes fourth place invisible, and on a
   * floor of seven that is most of the shop. Somebody who rang eleven tickets
   * and came fourth has done a day's work the board says nothing about. So the
   * rest is one click away, listed rather than blocked out, because past third
   * the interesting question stops being "who won" and becomes "where am I".
   */
  const [podiumAll, setPodiumAll] = useState(false);

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

  if (!data) return <div className="text-brand-300">Loading…</div>;
  const t = data.totals;
  const lb = data.leaderboard;

  /**
   * Summed from the same list the outstanding panel prints, so the headline
   * figure and the tickets underneath it can never tell different stories. They
   * used to come from two queries and did exactly that — the header claimed
   * $110 over a list of two tickets adding to $60.
   */
  const outstandingCents = data.outstanding.reduce(
    (s, o) => s + o.balanceCents,
    0,
  );

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

  const metrics = PODIUM_METRICS;
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const podiumBoard =
    podiumPeriod === "day"
      ? data.dayStandings
      : podiumPeriod === "week"
        ? lb
        : data.monthStandings;

  const podium = podiumBoard.techs
    .map((x) => ({ ...x, podiumScore: metric.score(x) ?? 0 }))
    .filter((x) => x.podiumScore > 0)
    // Income breaks ties. For a viewer who may not see it the cents are all
    // zero, but the server sorted the list by the real figures before blanking
    // them, so a stable sort still lands ties in the same order an owner sees.
    .sort((a, b) => b.podiumScore - a.podiumScore || b.incomeCents - a.incomeCents);

  const tipPoolCents = lb.techs.reduce((s, x) => s + x.tipCentsToday, 0);

  return (
    <div className="max-w-7xl">
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
            >
              Today
            </button>
          )}
          {can("ringSale") && (
            <Link
              href="/pos/register"
              className="btn btn-primary"
              style={{ height: 44, fontSize: 16, paddingInline: 20 }}
            >
              New sale
            </Link>
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
          working. Between the notes and the podium is the worst place for a
          row of small grey qualifiers — it pushes the thing this screen is
          for below the fold to make room for footnotes. */}

      <Podium
        title={`Employee of the ${podiumPeriod} — ${metric.label.toLowerCase()}`}
        // One date, not "Aug 5 – Aug 5". This line is also what keeps the
        // "Today" option honest when somebody is reading back an older date:
        // the option is named for the span it means, and the date under the
        // title says which one is actually on screen.
        span={
          podiumBoard.range.start === podiumBoard.range.end
            ? shortDate(podiumBoard.range.start)
            : `${shortDate(podiumBoard.range.start)} – ${shortDate(podiumBoard.range.end)}`
        }
        unit={metric.unit}
        entries={podium.map((x) => ({
          employeeId: x.employeeId,
          name: x.name,
          value: metric.show(x, techMoney),
          sub: `${x.newTires} new · ${x.usedTires} used · ${x.otherCount} service`,
        }))}
        showAll={podiumAll}
        onToggleAll={() => setPodiumAll((v) => !v)}
        control={
          <div className="flex gap-2">
            <select
              className="input"
              style={{ height: 32, fontSize: 13, paddingBlock: 0 }}
              value={metric.key}
              onChange={(e) => setMetricKey(e.target.value)}
            >
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              style={{ height: 32, fontSize: 13, paddingBlock: 0 }}
              value={podiumPeriod}
              onChange={(e) => setPodiumPeriod(e.target.value as StandingsPeriod)}
            >
              <option value="day">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          </div>
        }
      />

      {/*
        Who owes the shop money, directly under the podium.

        High on the page on purpose. This is the only block here that is a list
        of things to DO rather than a record of things that happened, and the
        person best placed to do them is the cashier standing at the counter
        when the customer walks back in. Buried at the bottom it would be read
        once a week; here it is read every time somebody glances at the screen.

        Dollars always — never the hide-money placeholder. What a customer still
        owes is not somebody's wage, and a debt you have to press a button to
        see is a debt nobody collects.
      */}
      {data.outstanding.length > 0 && (
        <div
          className="rounded-2xl shadow-sm p-4 mb-6"
          style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.30)" }}
        >
          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-amber-800">
              ⚠️ Outstanding — {data.outstanding.length}{" "}
              {data.outstanding.length === 1 ? "ticket" : "tickets"} owing
            </div>
            <div className="text-lg font-semibold tabular-nums text-amber-900">
              {formatCents(outstandingCents)}
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {data.outstanding.map((o) => (
                <tr key={o.saleId} className="border-t border-amber-900/10">
                  <td className="py-1.5">
                    <button
                      type="button"
                      className="font-medium text-amber-900 underline decoration-amber-900/30 hover:decoration-current"
                      onClick={() => setOpenSaleId(o.saleId)}
                    >
                      {o.saleNo}
                    </button>
                    {/* Every ticket in this panel is owing, so a badge saying
                        "still open" was only ever repeating the panel's own
                        heading — and it repeated it in the register's old
                        vocabulary, where open meant nobody pressed Complete
                        rather than nobody paid. The amount owed is in the
                        column on the right and it is the whole story. */}
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
                    {/* The ticket's note, printed here as well as on Entries.
                        It is the same string from the same column on the same
                        sale — the point is that somebody who wrote "DEPOSIT —
                        BALANCE ON PICKUP" on a ticket sees it on whichever
                        screen they happen to be looking at, instead of having
                        to remember which one shows notes. On a debt it is
                        usually the reason the debt exists. */}
                    {o.notes && (
                      <div className="italic text-amber-900/60" title="Note on this ticket">
                        {o.notes}
                      </div>
                    )}
                  </td>
                  {/* Where the car is. Only here, on purpose: this panel is the
                      one place a ticket is looked at while its car is still on
                      the lot, so it is the one place the answer is worth
                      keeping. Everywhere else the same three words would be a
                      field to maintain on tickets whose cars left days ago. */}
                  <td className="py-1.5 w-32">
                    <WorkStatusPicker
                      saleId={o.saleId}
                      value={o.workStatus}
                      canSet={can("ringSale")}
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
                  <td className="py-1.5 text-right tabular-nums font-semibold text-amber-900 w-24">
                    {formatCents(o.balanceCents)}
                  </td>
                </tr>
              ))}
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
      <Card title="Last transactions" className="mb-6">
        {/* Fixed height on purpose: a busy Saturday runs to two hundred lines and
            this is a dashboard, not the ledger. The full list lives on Entries. */}
        <div className="overflow-y-auto mt-2" style={{ maxHeight: 340 }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: "#fff" }}>
              <tr className="text-left text-brand-300 uppercase text-xs tracking-wider">
                <th className="py-2 font-medium">Line</th>
                <th className="py-2 font-medium">Tech</th>
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium text-right">Total</th>
                <th className="py-2 font-medium pl-4">Service</th>
              </tr>
            </thead>
            <tbody>
              {data.recentLines.map((l, n) => {
                const dead = l.voided || l.saleVoided;
                return (
                  <tr
                    key={`${l.saleId}-${n}`}
                    className="border-t border-black/5"
                    // Alternating light blue. This table is read across, at a
                    // glance, on a screen on a counter — five columns of small
                    // numbers with nothing to hold the eye is where a row gets
                    // read as the one above it. The tint is kept very pale so
                    // it separates the rows without competing with the voided
                    // rows, which are the ones that have to stand out.
                    style={{
                      background: n % 2 === 1 ? "rgba(10,37,64,0.035)" : undefined,
                      opacity: dead ? 0.45 : undefined,
                    }}
                  >
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setOpenSaleId(l.saleId)}
                        style={dead ? { textDecoration: "line-through" } : undefined}
                      >
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
              {data.recentLines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-brand-300">
                    Nothing rung on this day.
                  </td>
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

      <Card title="This week" className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-brand-300 text-xs uppercase tracking-wider">
                <th className="text-left py-2 font-medium" rowSpan={2}>
                  Technician
                </th>
                <th
                  className="py-2 font-medium border-l border-black/5"
                  colSpan={3}
                  title={`${shortDate(lb.range.start)} – ${shortDate(lb.range.end)}`}
                >
                  This week
                  {lb.comparable.days < 7
                    ? ` (${weekdaySpan(lb.range.start, lb.range.end)})`
                    : ""}
                </th>
                {/* Naming the weekdays is not decoration. This column is the
                    same days of last week, not all of it, and one headed
                    plainly "Last week" beside a partial one is how somebody
                    concludes the shop is collapsing every Thursday. */}
                <th
                  className="py-2 font-medium border-l border-black/5"
                  colSpan={3}
                  title={`${shortDate(lb.comparable.start)} – ${shortDate(lb.comparable.end)} — the same ${lb.comparable.days} day${lb.comparable.days === 1 ? "" : "s"} of last week, so the two halves cover equal trading`}
                >
                  Last week
                  {lb.comparable.days < 7
                    ? ` (${weekdaySpan(lb.comparable.start, lb.comparable.end)})`
                    : ""}
                </th>
                <th className="py-2 font-medium border-l border-black/5" rowSpan={2}>
                  Tips today
                </th>
                <th className="py-2 font-medium border-l border-black/5" rowSpan={2}>
                  Mprvmt
                </th>
                <th
                  className="py-2 font-medium border-l border-black/5"
                  rowSpan={2}
                  title={
                    seesTechIncomeCash
                      ? "Dollars when money is showing, share of the shop otherwise"
                      : "Share of everything the shop took this week"
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
              {lb.techs.map((x) => (
                <tr key={x.employeeId} className="border-t border-black/5">
                  <td className="py-2 font-medium text-brand-500">{x.name}</td>
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    {x.newTires || "—"}
                  </td>
                  <td className="py-2 text-center tabular-nums">{x.usedTires || "—"}</td>
                  <td className="py-2 text-center tabular-nums">{x.otherCount || "—"}</td>
                  <td className="py-2 text-center tabular-nums text-brand-300 border-l border-black/5">
                    {x.prior.newTires || "—"}
                  </td>
                  <td className="py-2 text-center tabular-nums text-brand-300">
                    {x.prior.usedTires || "—"}
                  </td>
                  <td className="py-2 text-center tabular-nums text-brand-300">
                    {x.prior.otherCount || "—"}
                  </td>
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    {x.tipCentsToday ? money(x.tipCentsToday, tipPoolCents) : "—"}
                  </td>
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    <Swing pct={x.improvementPct} />
                  </td>
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    {techMoney(x.incomeCents, x.incomePct)}
                  </td>
                </tr>
              ))}
              {lb.techs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-brand-300">
                    Nobody has rung a line this week.
                  </td>
                </tr>
              )}
            </tbody>
            {lb.techs.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-black/10 font-medium">
                  <td className="py-2">Shop</td>
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    {lb.techs.reduce((s, x) => s + x.newTires, 0)}
                  </td>
                  <td className="py-2 text-center tabular-nums">
                    {lb.techs.reduce((s, x) => s + x.usedTires, 0)}
                  </td>
                  <td className="py-2 text-center tabular-nums">
                    {lb.techs.reduce((s, x) => s + x.otherCount, 0)}
                  </td>
                  <td className="py-2 text-center tabular-nums text-brand-300 border-l border-black/5">
                    {lb.techs.reduce((s, x) => s + x.prior.newTires, 0)}
                  </td>
                  <td className="py-2 text-center tabular-nums text-brand-300">
                    {lb.techs.reduce((s, x) => s + x.prior.usedTires, 0)}
                  </td>
                  <td className="py-2 text-center tabular-nums text-brand-300">
                    {lb.techs.reduce((s, x) => s + x.prior.otherCount, 0)}
                  </td>
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    {tipPoolCents ? money(tipPoolCents) : "—"}
                  </td>
                  <td className="py-2 border-l border-black/5" />
                  <td className="py-2 text-center tabular-nums border-l border-black/5">
                    {techMoney(lb.totalIncomeCents, 100)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

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

      {/* The day's ticket table used to sit here. It moved to Entries, which
          lists every event rather than every ticket and can be filtered and
          sorted — this page is a dashboard, and a two-hundred-row table at the
          bottom of it pushed the numbers anybody actually came for off the top
          of the screen. */}
      <Link
        href="/pos/entries"
        className="block text-center text-sm text-brand-400 underline hover:text-brand-500 mb-6"
      >
        Every entry of this day, line by line →
      </Link>

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

type PodiumEntry = { employeeId: number; name: string; value: string; sub: string };

/**
 * Top three on whatever the dropdowns are asking for.
 *
 * Deliberately renders even with nobody on it, unlike most empty states here:
 * the dropdowns live in this card, and a component that disappears when its
 * metric has no winners takes the only means of choosing a different metric
 * away with it.
 */
function Podium({
  title,
  span,
  unit,
  entries,
  control,
  showAll,
  onToggleAll,
}: {
  title: string;
  span: string;
  unit: string;
  /** Everybody who placed, best first — not pre-cut to three. */
  entries: PodiumEntry[];
  control: React.ReactNode;
  showAll: boolean;
  onToggleAll: () => void;
}) {
  const medals = [
    { bg: "linear-gradient(160deg,#f7e08a,#d4af37)", fg: "#4a3803", h: 132, label: "1st" },
    { bg: "linear-gradient(160deg,#e6ebf0,#a8b3bd)", fg: "#3a4149", h: 108, label: "2nd" },
    { bg: "linear-gradient(160deg,#e0b48c,#c08457)", fg: "#4a2c12", h: 92, label: "3rd" },
  ];
  const top = entries.slice(0, 3);
  // Second, first, third -- the winner stands in the middle.
  const order = [1, 0, 2].filter((i) => i < top.length);
  const rest = entries.slice(3);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-brand-300">{title}</div>
          <div className="text-xs text-brand-300 opacity-70 mt-0.5">{span}</div>
        </div>
        <div className="flex items-center gap-2">
          {/* Only offered when there is a fourth person to show. An eye that
              opens nothing is a control that teaches people it does nothing. */}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={onToggleAll}
              title={
                showAll
                  ? "Back to the top three"
                  : `Show all ${entries.length} who placed`
              }
              aria-label={showAll ? "Show the top three" : "Show everybody who placed"}
              aria-pressed={showAll}
              className="rounded-lg flex items-center justify-center"
              style={{
                height: 32,
                width: 34,
                border: "1px solid rgba(10,37,64,0.18)",
                background: showAll ? "#0a2540" : "#fff",
                color: showAll ? "#fff" : "rgba(10,37,64,0.55)",
              }}
            >
              <EyeIcon open={showAll} />
            </button>
          )}
          {control}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="py-8 text-center text-brand-300 text-sm">
          Nobody has placed on this yet.
        </div>
      ) : (
        <div className="flex items-end justify-center gap-4">
          {order.map((i) => {
            const e = top[i];
            const m = medals[i];
            return (
              <div
                key={e.employeeId}
                className="flex flex-col items-center"
                style={{ width: 170 }}
              >
                <div className="font-semibold text-brand-500 text-center">{e.name}</div>
                <div className="text-xs text-brand-300 mb-2 text-center">{e.sub}</div>
                <div
                  className="w-full rounded-t-xl flex flex-col items-center justify-center"
                  style={{ background: m.bg, color: m.fg, height: m.h }}
                >
                  <div className="text-3xl font-bold tabular-nums leading-none">{e.value}</div>
                  <div className="text-[11px] uppercase tracking-wider mt-1 opacity-80">
                    {m.label} · {unit}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fourth downwards, as a list rather than more blocks.
          Past third the question stops being "who won" and becomes "where am
          I", and a list answers that in a way five diminishing coloured boxes
          never could — the places are numbered, the figures line up in a
          column, and it costs about as much height as one more block. */}
      {showAll && rest.length > 0 && (
        <div className="mt-5 pt-4" style={{ borderTop: "1px solid rgba(10,37,64,0.08)" }}>
          <table className="w-full text-sm">
            <tbody>
              {rest.map((e, i) => (
                <tr key={e.employeeId} className="border-t border-black/5">
                  <td className="py-2 text-brand-300 tabular-nums" style={{ width: 44 }}>
                    {i + 4}
                  </td>
                  <td className="py-2 font-medium text-brand-500">{e.name}</td>
                  <td className="py-2 text-xs text-brand-300">{e.sub}</td>
                  <td className="py-2 text-right tabular-nums font-semibold">
                    {e.value}
                    <span className="text-xs text-brand-300 font-normal"> {unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The eye on the podium. Open when everybody is showing, struck through when
 * only the top three are — the slash is what makes the two states tell apart at
 * a glance, since an eye on its own reads as "look here" either way.
 */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      {!open && <path d="M4 20 20 4" />}
    </svg>
  );
}

/**
 * Waiting / Working on it / Ready for pickup — ONE pill, showing only the state
 * the ticket is actually in.
 *
 * This started as three pills side by side with the inactive two greyed out,
 * which is fine on a mockup with one row and awful on a real panel: eight
 * outstanding tickets meant twenty-four little boxes, twenty-one of which were
 * saying nothing. The noise drowned the column it was meant to explain, and a
 * panel whose job is "these are the tickets that need chasing" cannot afford to
 * be the loudest thing on the screen.
 *
 * So: what is true is shown, what is not is put away behind a click. The colour
 * carries the meaning at a distance — grey nobody has looked, amber under way,
 * green ready to hand back — and the words are there for anyone close enough to
 * read them.
 *
 * It is a native <select> deliberately, not a hand-rolled popover. A menu built
 * out of divs inside a scrolling table is a positioning bug waiting to happen,
 * and it has to reimplement click-outside, escape, and keyboard selection that
 * the browser already does correctly. The pill is the select; the chrome is
 * styled away.
 */
/* The four pills now live in `@/lib/work-status`, because the close-out prints
   them too and the board and the paper must not be able to drift apart. */

function WorkStatusPicker({
  saleId,
  value,
  canSet,
  onChanged,
}: {
  saleId: number;
  value: string | null;
  canSet: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const on = WORK_PILLS.find((p) => p.value === value);

  // Somebody who cannot ring a sale can still be looking at this screen, and
  // where the car is is not a secret from them — they just do not get to move
  // it. Show the state, drop the control. Nothing at all when nothing is set:
  // a read-only dash is a column of dashes.
  if (!canSet) {
    if (!on) return null;
    return (
      <span
        className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight"
        style={{ background: on.bg, color: on.fg }}
      >
        {on.label}
      </span>
    );
  }

  const set = async (next: string) => {
    setBusy(true);
    try {
      await fetch(`/api/pos/sales/${saleId}/work-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // "" is how the blank option gets back to meaning null — nobody has
        // said anything about this ticket, which is a real state and the one
        // every ticket starts in.
        body: JSON.stringify({ workStatus: next === "" ? null : next }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      value={value ?? ""}
      disabled={busy}
      title={on ? on.title : "Set where this car is"}
      aria-label="Where this car is"
      className="cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight outline-none disabled:opacity-50"
      style={{
        // Untouched tickets get a quiet outline rather than a filled pill.
        // Present enough to be found, faint enough that a panel of eight
        // untouched tickets does not look like it is trying to tell you
        // something.
        background: on ? on.bg : "transparent",
        color: on ? on.fg : "rgba(120,53,15,0.45)",
        border: `1px solid ${on ? on.border : "rgba(120,53,15,0.20)"}`,
        // The browser's arrow doubles the width of a pill this small and adds
        // a second thing to look at in every row.
        appearance: "none",
      }}
      onChange={(e) => void set(e.target.value)}
    >
      <option value="">Set status…</option>
      {WORK_PILLS.map((p) => (
        <option key={p.value} value={p.value}>
          {p.title}
        </option>
      ))}
    </select>
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
