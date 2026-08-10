"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { TicketDrawer } from "@/components/pos/TicketDrawer";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import type { DayEntry } from "@/lib/pos-reports";
import type { PaymentMethod } from "@/lib/payments";

/**
 * Every entry of the day, consecutively, with nothing summed.
 *
 * The day screen answers "how did we do"; this answers "what happened". They
 * are different questions and they wanted different screens — the day screen
 * used to carry a full ticket table at the bottom, which made it long enough
 * that the numbers at the top scrolled away, and still was not the whole day
 * because it listed tickets rather than events.
 *
 * So: one row per thing that happened. A line rung is a row. Money moving is a
 * row. They interleave by time, because that is the order they happened in and
 * the only order in which a sequence makes sense to read.
 *
 * VOIDED TICKETS are included and coloured rather than filtered out. This is the
 * screen somebody opens when the drawer is short, and a void is the single most
 * likely explanation — a list that hid them would hide the answer.
 *
 * Lines struck off a ticket that still stands are the other thing, and they are
 * hidden until the eye beside the date is pressed. Those are not events; they
 * are somebody using the register, and at one per correction they outnumbered
 * the day. The distinction the whole screen turns on is "did this not happen"
 * versus "was this typed twice".
 *
 * It is also where SEQ gets fixed. The card batch is reconciled against a list
 * of the day's charges, and this is that list; sending someone into a ticket
 * one at a time to correct a transposed number meant the job was done from
 * memory at close, or not at all.
 */

type Tips = {
  from: string;
  to: string;
  rows: {
    at: string;
    businessDate: string;
    saleId: number;
    saleNo: string;
    kind: string;
    method: string;
    forName: string | null;
    takenBy: string | null;
    tipCents: number;
    commCents: number;
    saleVoided: number;
  }[];
  tipCents: number;
  commCents: number;
  ticketCount: number;
  byTech: { name: string; tipCents: number; count: number }[];
};

type Data = {
  businessDate: string;
  /** Today's business date, whatever day is being viewed. */
  today: string;
  entries: DayEntry[];
  tips: Tips;
  paymentMethods: PaymentMethod[];
  settings: { tipCommPerCents: number; tipCommChargeCents: number };
};

type SortKey =
  | "at"
  | "saleNo"
  | "what"
  | "category"
  | "detail"
  | "who"
  | "amountCents"
  | "seq";

/** Which way a column sorts the first time it is clicked. */
const FIRST_DIR: Record<SortKey, "asc" | "desc"> = {
  at: "desc",
  saleNo: "desc",
  // Up, always. A SEQ run is read against the terminal's batch, and the batch
  // prints 1, 2, 3.
  seq: "asc",
  what: "asc",
  // Alphabetical, which happens to group the five buckets into runs — the
  // actual reason anybody sorts this column.
  category: "asc",
  detail: "asc",
  who: "asc",
  amountCents: "desc",
};

function shortTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function EntriesPage() {
  const { can } = usePosAuth();
  const [date, setDate] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The far end of a range, and whether one is being asked for at all.
   *
   * Off by default and behind a button, because one day is what this screen is
   * for on nearly every visit — it is opened to answer "what did we do today".
   * A second date box sitting there permanently would be a control that has to
   * be read and dismissed a hundred times to be used once.
   */
  const [ranged, setRanged] = useState(false);
  const [until, setUntil] = useState("");

  const [query, setQuery] = useState("");
  // Lines by default, not everything. The question this screen is opened to
  // answer is almost always "what did we actually do today" — the payments are
  // the same money counted a second way, and interleaving them doubles the row
  // count for a reader who was looking for the work. Money is one tap away.
  const [kind, setKind] = useState<"all" | "line" | "money">("line");
  const [who, setWho] = useState("all");
  const [category, setCategory] = useState("all");
  const [method, setMethod] = useState("all");
  const [showVoided, setShowVoided] = useState(true);
  /**
   * The lines that were rung and struck off again mid-ticket.
   *
   * OFF BY DEFAULT, and that is the change: they used to be half the list on a
   * busy afternoon. A line typed at the wrong price and corrected ten seconds
   * later is not an event — it is somebody using the register — and a ledger
   * that shows both the mistake and the fix for every one of them buries the
   * rows that are actually about the day.
   *
   * A voided TICKET is a different thing entirely and is not affected by this.
   * That is a whole job that did not happen, it is the commonest explanation for
   * a short drawer, and it keeps its own checkbox and its own colour.
   */
  const [showDead, setShowDead] = useState(false);
  // The tips panel. Closed on arrival — this page is the ledger first, and a
  // summary that opens itself pushes the thing people came for down the screen.
  const [showTips, setShowTips] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  /**
   * Has somebody deliberately gone looking at another day?
   *
   * Until they have, this list follows today and keeps following it — not just
   * on the first draw. The tab gets opened once and left open; seeding the box
   * at mount would leave it stuck on yesterday's ledger after the 4am roll,
   * which is the one time an empty-looking Logs screen is genuinely
   * alarming rather than merely wrong.
   */
  const pickedADay = useRef(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    // Only when a range is actually being asked for AND has a far end. A blank
    // second box means "still one day", not "everything since the beginning".
    if (ranged && until) params.set("until", until);
    const qs = params.toString();
    const res = await fetch(`/api/pos/reports/entries${qs ? `?${qs}` : ""}`);
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    // `d.today`, not `d.businessDate` — the latter echoes what was asked for,
    // so it can never report that the day rolled underneath us.
    if (!pickedADay.current && date !== d.today) setDate(d.today);
  }, [date, ranged, until]);

  useEffect(() => {
    void load();
  }, [load]);

  // Come back to the tab and it re-asks what day it is. See the day screen.
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

  /**
   * Is the list currently narrowed to one card tender?
   *
   * THE ONLY CONDITION UNDER WHICH SEQ IS SHOWN ANYWHERE IN THIS APP.
   *
   * A sequence number is meaningless except beside the other numbers in the
   * same run — it is a position, not a fact about a ticket — so it appears when
   * and only when the screen is showing a run: one card tender, the day's
   * charges on it, in order. Everywhere else it was on show it was decoration
   * that invited somebody to type over it.
   */
  const cardView =
    method !== "all" &&
    data?.paymentMethods.find((m) => m.label === method)?.is_card === 1;

  /**
   * Can this person take a row off the log?
   *
   * The server has already decided — a struck row is dropped before the response
   * is built for anybody else, so `deletedBy` is null on every row they receive
   * and the column would be empty regardless. This only stops the empty column
   * being drawn.
   */
  const canStrike = can("deleteEntry");

  /** Everybody who appears today, so the filter offers only real options. */
  const people = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.entries.map((e) => e.who).filter(Boolean))].sort() as string[];
  }, [data]);

  /**
   * The buckets that actually occur today, in the order the shop thinks of them
   * rather than alphabetically.
   *
   * Tires first because tires are the business, then oil, then everything else,
   * then the money going the other way. Alphabetical would open the list with
   * Cashout — the rarest thing on it and the only one that is not a service —
   * and bury New Tire in the middle.
   *
   * Only buckets present on the day are offered. A dropdown that lists Oil
   * Change on a day nobody changed oil invites the click that returns an empty
   * table and reads as a broken screen.
   */
  const categories = useMemo(() => {
    if (!data) return [];
    const order = ["New Tire", "Used Tire", "Oil Change", "Other Service", "Cashout"];
    const present = new Set(data.entries.map((e) => e.category).filter(Boolean));
    const known = order.filter((c) => present.has(c));
    const rest = [...present].filter((c) => !order.includes(c)).sort();
    return [...known, ...rest];
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const filtered = data.entries.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      // A tender is a property of money, so choosing one is implicitly choosing
      // money — the kind select is switched over for you when you pick one, and
      // this is the belt to that's braces.
      if (method !== "all" && !(e.kind === "money" && e.what === method)) return false;
      // Exact, not a prefix or a contains: the buckets are a closed list of
      // five and two of them share a word.
      if (category !== "all" && e.category !== category) return false;
      if (who !== "all" && (e.who ?? "") !== who) return false;
      // Two different kinds of dead, two different switches. The checkbox is
      // about tickets that were voided; the eye is about lines struck off a
      // ticket that stands. Reading one flag for both is what made the eye
      // necessary — the noisy half could not be hidden without hiding the half
      // somebody opens this screen to find.
      if (!showVoided && e.saleVoided) return false;
      // A row the owner has struck off is never hidden FROM THE OWNER by
      // either switch, and nobody else is ever sent one. It is their own act
      // and it is how they take it back — a delete that made the row vanish
      // behind a filter would give no sign it had worked and no way to undo it.
      if (!showDead && e.voided && !e.saleVoided && !e.deletedBy) return false;
      if (!q) return true;
      /*
        The customer's name and phone are matched but never drawn. Being handed
        a name over the counter and finding every ticket that belongs to it is
        the thing this list could not do; showing the name in a column is not,
        because the ticket number is already there and one click opens the
        drawer that has it.

        The phone is matched digits-only as well as raw, so "2104213006" finds
        a number stored as "210-421-3006". Nobody reads a phone number back with
        the punctuation, and a search that only worked if you guessed the shop's
        own formatting would be worse than none.
      */
      const digits = q.replace(/\D/g, "");
      if (digits.length >= 3 && e.customerPhone) {
        if (e.customerPhone.replace(/\D/g, "").includes(digits)) return true;
      }
      return [
        e.saleNo,
        e.what,
        e.category,
        e.detail,
        e.who,
        e.seq,
        e.customerName,
        e.customerPhone,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    // Sorted on a copy: `data.entries` is the server's order and the reset
    // button has to be able to get back to it.
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // SEQ is a number that happens to be stored as text, and sorting it as
      // text puts 10 before 9 — which on the one screen where the whole job is
      // walking a run in order is not a cosmetic complaint.
      if (sortKey === "seq") {
        const n = (v: string | null) => (v === null || v === "" ? Infinity : Number(v));
        return (n(a.seq) - n(b.seq)) * dir;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [data, query, kind, who, category, method, showVoided, showDead, sortKey, sortDir]);

  /**
   * The rows that should print the ticket's note.
   *
   * Once per ticket, on the first of its rows in whatever order the list is
   * currently in — a note repeated under all four lines of a set of tires is
   * noise, and noise on this screen is how the one ticket that needed reading
   * gets skimmed past. Recomputed with the sort because "first" moves when the
   * order does.
   */
  const notesOn = useMemo(() => {
    const seen = new Set<number>();
    const keys = new Set<string>();
    for (const r of rows) {
      if (!r.saleNotes || seen.has(r.saleId)) continue;
      seen.add(r.saleId);
      keys.add(r.key);
    }
    return keys;
  }, [rows]);

  /** What the filtered view adds up to — the reason to filter it in the first
   *  place. Voided rows are left out of the sum even when they are on screen,
   *  because a struck-through row is money that did not move. */
  const totals = useMemo(() => {
    const live = rows.filter((r) => !r.voided);
    return {
      lines: live.filter((r) => r.kind === "line").reduce((s, r) => s + r.amountCents, 0),
      money: live.filter((r) => r.kind === "money").reduce((s, r) => s + r.amountCents, 0),
    };
  }, [rows]);

  /**
   * Which shade of red each dead row gets.
   *
   * Zebra among the red rows rather than down the whole table, because a run of
   * four voided rows is the case this exists for: at one flat tint they read as
   * a single block and the eye stops separating them, which is the opposite of
   * what a coloured row is for. Rows in between do not reset the alternation —
   * this counts reds, not positions, so two voids either side of a live row
   * still differ from each other.
   */
  const redTone = useMemo(() => {
    const tone = new Map<string, 0 | 1>();
    let n = 0;
    for (const r of rows) {
      if (!r.saleVoided && !r.deletedBy) continue;
      tone.set(r.key, (n++ % 2) as 0 | 1);
    }
    return tone;
  }, [rows]);

  /**
   * The same, for the tickets that were refunded rather than voided.
   *
   * Its own counter, so a run of refunds alternates among themselves and is not
   * thrown out of step by a void that happened to fall between them.
   */
  const amberTone = useMemo(() => {
    const tone = new Map<string, 0 | 1>();
    let n = 0;
    for (const r of rows) {
      if (r.saleVoided || r.deletedBy || !r.saleRefunded) continue;
      tone.set(r.key, (n++ % 2) as 0 | 1);
    }
    return tone;
  }, [rows]);

  /**
   * Take a dead row off the log, or put it back.
   *
   * No confirm dialog on the way in. Nothing is destroyed and the button is
   * still there afterwards reading "put back" — a modal guarding an action that
   * undoes itself in one click is a modal people learn to dismiss unread, which
   * is how they stop working on the ones that matter.
   */
  async function strike(e: DayEntry, restore: boolean) {
    setError(null);
    const res = await fetch("/api/pos/reports/entries/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: e.kind,
        id: e.kind === "line" ? Number(e.key.slice(5)) : e.paymentId,
        restore,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "That row could not be changed");
      return;
    }
    await load();
  }

  function sortOn(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(FIRST_DIR[key]);
  }

  /** Correct one payment's terminal sequence number in place. */
  async function saveSeq(paymentId: number, seq: string): Promise<boolean> {
    setError(null);
    const res = await fetch(`/api/pos/payments/${paymentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seq: seq.trim() || null }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "That SEQ would not save");
      return false;
    }
    await load();
    return true;
  }

  const Th = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        className="uppercase text-xs tracking-wider hover:text-brand-500"
        onClick={() => sortOn(k)}
      >
        {children}
        <span className="ml-1 text-[10px]">
          {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );

  if (!data) return <div className="text-brand-300">Loading…</div>;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">Logs</h1>
          <p className="text-brand-400 text-sm">
            Everything that happened, in the order it happened. Voided rows stay
            on the list.
          </p>
          {/* The other two ledgers, reached from the one people already open.
              This page is the day; those two are the same records cut the other
              way — by tire and by customer — and both were previously reachable
              only from a row that happened to mention them. Put here rather than
              in the top navigation because that is a row of places you WORK, and
              these are places you go to answer a question. */}
          <div className="flex items-center gap-2 mt-3 no-print">
            {can("viewInventory") && (
              <Link href="/pos/movements" className="btn btn-outline" style={{ height: 34, fontSize: 13 }}>
                Tire movements
              </Link>
            )}
            <Link href="/pos/customers" className="btn btn-outline" style={{ height: 34, fontSize: 13 }}>
              Customers
            </Link>
            {/* Tips are already in the list below, scattered among four hundred
                other rows and impossible to add up by eye. This is the same
                rows gathered — a view of this page rather than another page,
                which is why it is a toggle here and not a link. */}
            <button
              type="button"
              className={showTips ? "btn btn-primary" : "btn btn-outline"}
              style={{ height: 34, fontSize: 13 }}
              aria-pressed={showTips}
              onClick={() => setShowTips((v) => !v)}
            >
              Tips
            </button>
          </div>
        </div>
        {/* Picking a date pins the list to it; nothing snaps it back on its
            own after that. "Today" is the way home.

            It sits to the LEFT of the picker and is always drawn, greyed out
            when the list is already showing today. It used to appear only once
            you had moved off today, which meant the way back was a control that
            did not exist until you needed it — so nobody knew it was there, and
            the button materialising under the cursor moved the date box
            sideways at the same time. */}
        <div className="flex items-center gap-2">
          {/* The eye, and the only control on this row that is not about which
              day is being shown.

              It lives here rather than beside "Show voided" below because it is
              a switch about how much of the ledger you are looking at, which is
              the same class of thing as the date — and because the row of
              dropdowns underneath is already five controls long. An icon rather
              than a labelled checkbox for the same reason: the honest label is
              two lines of prose, and the tooltip can carry them. */}
          <button
            type="button"
            className={showDead ? "btn btn-primary" : "btn btn-outline"}
            style={{ height: 38, width: 42, padding: 0 }}
            aria-pressed={showDead}
            aria-label={
              showDead ? "Hide lines struck off mid-ticket" : "Show lines struck off mid-ticket"
            }
            title={
              showDead
                ? "Hiding lines that were rung and struck off again. Voided tickets are not affected."
                : "Also show lines that were rung and struck off again mid-ticket"
            }
            onClick={() => setShowDead((v) => !v)}
          >
            {/* Open when they are showing, struck through when they are not —
                the icon says what you are currently looking at, not what the
                button would do. Every other toggle on this screen reads the same
                way round. */}
            <svg
              viewBox="0 0 24 24"
              width={19}
              height={19}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block", margin: "0 auto" }}
              aria-hidden="true"
            >
              <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
              <circle cx="12" cy="12" r="3.1" />
              {!showDead && <path d="M3.5 20.5 20.5 3.5" />}
            </svg>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ height: 38, fontSize: 14 }}
            disabled={!data || date === data.today}
            title={
              data && date === data.today
                ? "Already showing today"
                : "Back to today"
            }
            onClick={() => {
              if (!data) return;
              pickedADay.current = false;
              setRanged(false);
              setUntil("");
              setDate(data.today);
            }}
          >
            Today
          </button>
          <input
            type="date"
            className="input"
            value={date}
            max={data?.today}
            onChange={(e) => {
              const next = e.target.value || data?.today || "";
              pickedADay.current = next !== "" && next !== data?.today;
              setDate(next);
            }}
          />
          {/* The second date, and the switch that asks for it.
              Shown as a range only once there is a far end to show — an empty
              second box would leave the list saying it is showing a range while
              still showing one day. */}
          {ranged && (
            <>
              <span className="text-brand-300 text-sm">to</span>
              <input
                type="date"
                className="input"
                value={until}
                min={date}
                max={data?.today}
                onChange={(e) => setUntil(e.target.value)}
              />
            </>
          )}
          <button
            type="button"
            className="btn btn-outline"
            style={{ height: 38, fontSize: 13, paddingInline: 10 }}
            title={ranged ? "Back to a single day" : "Search a range of days"}
            onClick={() => {
              if (ranged) {
                setRanged(false);
                setUntil("");
              } else {
                setRanged(true);
                // Seeded to the day already on screen, so turning it on shows
                // the same rows rather than emptying the list until a second
                // date is chosen.
                setUntil(date || data?.today || "");
                pickedADay.current = true;
              }
            }}
            aria-pressed={ranged}
          >
            {ranged ? "One day" : "Range"}
          </button>
        </div>
      </div>

      {/*
        Tips, gathered.

        Two halves because two questions get asked: "what do I owe each of them"
        wants the summary, and "which ticket was that on" wants the rows. The
        rows are the same payments that are already in the ledger below, so
        nothing here can disagree with it — this is a lens, not a second source.
      */}
      {showTips && data && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-lg font-semibold text-brand-500">
              Tips · {data.tips.from}
              {data.tips.to !== data.tips.from ? ` – ${data.tips.to}` : ""}
            </h2>
            <div className="text-sm text-brand-400">
              {formatCents(data.tips.tipCents)} across {data.tips.ticketCount}{" "}
              {data.tips.ticketCount === 1 ? "ticket" : "tickets"}
              {data.tips.commCents > 0 && (
                <span className="text-brand-300">
                  {" "}
                  · {formatCents(data.tips.commCents)} in terminal fees
                </span>
              )}
            </div>
          </div>

          {data.tips.rows.length === 0 ? (
            <div className="text-brand-300 py-6 text-center">No tips in this range.</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "220px minmax(0,1fr)" }}>
              <div>
                <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                  Who they were for
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {data.tips.byTech.map((t) => (
                      <tr key={t.name} className="border-t border-black/5">
                        <td className="py-1.5">{t.name}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">
                          {formatCents(t.tipCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-brand-300 mb-1">
                  The tickets
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {data.tips.rows.map((r, i) => (
                      <tr
                        key={`${r.saleId}-${i}`}
                        className="border-t border-black/5"
                        style={{
                          background: i % 2 === 0 ? "rgba(10,37,64,0.035)" : undefined,
                          opacity: r.saleVoided ? 0.5 : undefined,
                        }}
                      >
                        <td className="py-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            className="hover:underline text-brand-500"
                            onClick={() => setOpenSaleId(r.saleId)}
                            style={
                              r.saleVoided ? { textDecoration: "line-through" } : undefined
                            }
                          >
                            {r.saleNo}
                          </button>
                          <div className="text-xs text-brand-300 tabular-nums">
                            {shortTime(r.at)}
                          </div>
                        </td>
                        <td className="py-1.5 pl-4 text-brand-400">
                          {r.forName ?? <span className="text-brand-300">nobody named</span>}
                          <div className="text-xs text-brand-300">
                            {r.method}
                            {/* A tip that came back later is the kind that gets
                                forgotten, so it says so rather than looking
                                like it arrived with the sale. */}
                            {r.kind === "tip_adjustment" && " · added later"}
                            {r.takenBy ? ` · ${r.takenBy}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5 pl-4 text-right tabular-nums whitespace-nowrap">
                          {formatCents(r.tipCents)}
                          {r.commCents > 0 && (
                            <div className="text-xs text-brand-300">
                              +{formatCents(r.commCents)} fee
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* The ledger and everything that narrows it, put away while the tips
          panel is up. They answer a different question, and leaving four
          hundred rows under a summary means scrolling past the answer to reach
          nothing. */}
      {!showTips && (
        <>
      <div className="bg-white rounded-2xl shadow-sm p-3 mb-4 flex gap-3 items-center flex-wrap">
        <input
          className="input"
          style={{ minWidth: 220 }}
          placeholder="Ticket, customer, phone, service, tender, SEQ…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            // Going back to lines drops the tender, which otherwise filters the
            // list down to nothing and looks like an empty day. Asking for
            // money drops the service bucket for the same reason.
            if (e.target.value === "line") setMethod("all");
            if (e.target.value === "money" && category !== "all" && category !== "Cashout")
              setCategory("all");
          }}
        >
          <option value="all">Everything</option>
          <option value="line">Lines rung</option>
          <option value="money">Money moved</option>
        </select>
        <select
          className="input"
          value={method}
          title="Show only money taken on one tender"
          onChange={(e) => {
            const label = e.target.value;
            setMethod(label);
            if (label !== "all") setKind("money");
            // The other half of the bargain struck in the category select: a
            // tender and a service bucket cannot both be true of the same row,
            // so the last thing clicked wins rather than the two of them
            // silently cancelling out to an empty list.
            if (label !== "all" && category !== "all" && category !== "Cashout")
              setCategory("all");
            // Picking a card means reconciling it against the batch, and the
            // batch is in SEQ order. Ordering the list for the job rather than
            // making somebody click a header to start it.
            if (data.paymentMethods.find((m) => m.label === label)?.is_card === 1) {
              setSortKey("seq");
              setSortDir("asc");
            }
          }}
        >
          <option value="all">Any tender</option>
          {data.paymentMethods.map((m) => (
            <option key={m.id} value={m.label}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={category}
          title="Show only one kind of work"
          onChange={(e) => {
            const c = e.target.value;
            setCategory(c);
            // A category is a property of work done, so choosing one is
            // choosing lines — with the single exception of Cashout, which is
            // also on the money paid out of the drawer for a buyback. Without
            // this, picking New Tire while the list was narrowed to a tender
            // returns nothing, and an empty table reads as "we sold none"
            // rather than "these two filters cannot both be true".
            if (c !== "all" && c !== "Cashout" && (kind === "money" || method !== "all")) {
              setKind("line");
              setMethod("all");
            }
          }}
        >
          <option value="all">Any category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">Anybody</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {/* Voided TICKETS — whole jobs that did not happen. Not the same switch
            as the eye above, which is about lines struck off a live ticket. */}
        <label className="flex items-center gap-2 text-sm text-brand-400">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          Show voided
        </label>
        <div className="ml-auto text-sm text-brand-400">
          {/* Says the span when it is more than a day, because every figure on
              this line is a sum over it — and "3,140.00 rung" means two very
              different things across one day and across a fortnight. */}
          {ranged && until && date && until !== date && (
            <span className="text-brand-300">
              {date} → {until} ·{" "}
            </span>
          )}
          {rows.length} {rows.length === 1 ? "entry" : "entries"} ·{" "}
          <span className="tabular-nums">{formatCents(totals.lines)}</span> rung ·{" "}
          <span className="tabular-nums">{formatCents(totals.money)}</span> collected
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead style={{ background: "rgba(10,37,64,0.03)" }}>
            <tr className="text-brand-400">
              <Th k="at">Time</Th>
              {/* A column of its own, and only here. See `cardView`. */}
              {cardView && <Th k="seq">SEQ</Th>}
              <Th k="saleNo">Ticket</Th>
              <Th k="what">What</Th>
              <Th k="category">Category</Th>
              <Th k="detail">Detail</Th>
              <Th k="who">Who</Th>
              <Th k="amountCents" right>
                Amount
              </Th>
              {/* Unlabelled. The column holds one word on a handful of rows and
                  a heading over it would read as a thing every row has. */}
              {canStrike && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.key}
                className="border-t border-black/5"
                /* Pastel red for the two kinds of row that are on the list but
                   not part of the day: a voided ticket, and a row the owner has
                   struck off. Colour rather than only a strike-through, because
                   a strike-through is a property of the text and the eye reads
                   it word by word — on a table this dense the difference between
                   "this ticket happened" and "this ticket did not" has to be
                   legible from a foot away.

                   Kept at 0.5 opacity as well, which is what stops the red from
                   shouting: the row recedes AND is unmistakably marked. */
                /* Amber for a REFUNDED ticket, and it is a third state rather
                   than a lighter red. A void says the sale did not happen; a
                   refund says it did and some of the money went back. Those are
                   opposite facts about the day — a voided ticket contributes no
                   takings at all, a refunded one contributes takings AND money
                   out, both real — and a reader scanning for "why is the drawer
                   like this" has to be able to tell them apart at a glance.

                   Not faded, unlike the red. A refunded ticket is still a live
                   part of the day and its figures still count; dimming it would
                   say the opposite. */
                style={
                  e.saleVoided || e.deletedBy
                    ? {
                        opacity: 0.62,
                        background: redTone.get(e.key)
                          ? "rgba(216,68,76,0.10)"
                          : "rgba(216,68,76,0.06)",
                      }
                    : e.saleRefunded
                      ? {
                          background: amberTone.get(e.key)
                            ? "rgba(180,83,9,0.11)"
                            : "rgba(180,83,9,0.06)",
                        }
                      : e.voided
                        ? { opacity: 0.5 }
                        : undefined
                }
              >
                <td className="px-3 py-2 tabular-nums text-brand-300 whitespace-nowrap">
                  {shortTime(e.at)}
                </td>
                {cardView && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <SeqCell
                      seq={e.seq}
                      editable={can("editSeq")}
                      onSave={(v) => saveSeq(e.paymentId!, v)}
                    />
                  </td>
                )}
                <td className="px-3 py-2 whitespace-nowrap">
                  {/* Amber when the ticket still owes money, navy when it is
                      paid in full. That is the whole meaning of the colour and
                      there is no second one.

                      It used to key off `status` — whether somebody had pressed
                      Complete — and that told a story the shop does not care
                      about. A ticket sitting open with the full amount already
                      on the card was amber, which is a false alarm; a ticket
                      marked completed with $28 still owing on a special order
                      was navy, which is the alarm that actually matters going
                      unsounded. Paid is the question, so paid is the colour.

                      On the number itself rather than a badge in another
                      column, because the number is what the eye already tracks
                      down the page. */}
                  <button
                    type="button"
                    className="font-medium underline decoration-black/20 hover:decoration-current"
                    style={
                      e.saleBalanceCents > 0
                        ? { color: "#b45309" }
                        : { color: "#0a2540" }
                    }
                    title={
                      e.saleBalanceCents > 0
                        ? `${formatCents(e.saleBalanceCents)} still owing`
                        : undefined
                    }
                    onClick={() => setOpenSaleId(e.saleId)}
                  >
                    {e.saleNo}
                  </button>
                </td>
                <td
                  className="px-3 py-2"
                  style={e.voided ? { textDecoration: "line-through" } : undefined}
                >
                  {/* Money rows are marked rather than left to be inferred from
                      the tender's name. "Cash" and "FLAT" look alike in a
                      column, and reading a payment as a second line rung is how
                      a day appears to have taken twice what it did. */}
                  {e.kind === "money" && (
                    <span className="text-brand-300 mr-1.5" title="Money moved">
                      $
                    </span>
                  )}
                  {e.what}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {e.category ? (
                    <span
                      className="text-xs"
                      style={
                        // Cashout is the one bucket where the money goes the
                        // other way, so it is the one that is coloured.
                        e.category === "Cashout"
                          ? { color: "#b45309", fontWeight: 600 }
                          : { color: "rgba(10,37,64,0.55)" }
                      }
                    >
                      {e.category}
                    </span>
                  ) : (
                    <span className="text-brand-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-brand-400">
                  <div className="flex items-center gap-2 flex-wrap">
                    {e.detail && <span>{e.detail}</span>}
                    {/* The one thing that tells a struck row apart from a
                        voided one. They are the same colour on purpose — both
                        are outside the day — and without this the owner would
                        have no way to know which of the two they were looking
                        at, on the only screen where both appear. */}
                    {e.deletedBy && (
                      <Badge tone="danger">
                        deleted · {e.deletedBy}
                        {e.deletedAt ? ` · ${e.deletedAt.slice(0, 10)}` : ""}
                      </Badge>
                    )}
                    {/* The ticket's note, in the same words the ticket shows —
                        this is the column for whatever did not fit a column,
                        and a note is exactly that. */}
                    {notesOn.has(e.key) && (
                      <span className="italic text-brand-300" title="Note on this ticket">
                        {e.saleNotes}
                      </span>
                    )}
                    {/* The price was unlocked at the counter and typed over.
                        Legal, and sometimes right — but it is the single thing
                        on a day's list most worth a second look, so it says
                        what the rack wanted rather than only that something
                        changed. A badge reading "price edited" sends the reader
                        off to find the tire; this one answers in place. */}
                    {e.listPriceCents !== null &&
                      e.listPriceCents !== e.amountCents && (
                        <Badge tone="warning">
                          {e.amountCents < e.listPriceCents ? "under" : "over"} rack{" "}
                          {formatCents(e.listPriceCents)}
                        </Badge>
                      )}
                  </div>
                </td>
                <td className="px-3 py-2 text-brand-400">{e.who ?? "—"}</td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  style={e.voided ? { textDecoration: "line-through" } : undefined}
                >
                  {formatCents(e.amountCents)}
                </td>
                {/* The owner's column, and only theirs. Offered on dead rows
                    alone: a live row is refused by the server anyway, and a
                    button that is always there and usually errors teaches people
                    to expect it to fail. */}
                {canStrike && (
                  <td className="px-2 py-2 text-right" style={{ width: 76 }}>
                    {e.deletedBy ? (
                      <button
                        type="button"
                        className="text-xs text-brand-400 hover:text-brand-500 underline"
                        title="Put this row back on the log"
                        onClick={() => void strike(e, true)}
                      >
                        put back
                      </button>
                    ) : (
                      e.strikeable && (
                        <button
                          type="button"
                          className="text-xs text-brand-300 hover:text-red-700 underline"
                          title="Take this row off the log. It moves no money — everyone else stops seeing it, you still do."
                          onClick={() => void strike(e, false)}
                        >
                          delete
                        </button>
                      )
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={(cardView ? 8 : 7) + (canStrike ? 1 : 0)} className="px-4 py-10 text-center text-brand-300">
                  {data.entries.length === 0 ? (
                    "Nothing happened on this day."
                  ) : query.trim() ? (
                    /*
                      The one thing somebody searching a name needs told.

                      This list only holds the days on screen, so a search runs
                      over those days and no others — which means looking for a
                      customer while the picker sits on today finds nothing at
                      all, and reads exactly like "that customer does not
                      exist". It is the failure this screen will produce most
                      often now that names are searchable, and it is invisible
                      unless it is said out loud, here, at the moment it
                      happens.
                    */
                    <>
                      <div className="text-brand-400">
                        Nothing matching “{query.trim()}”{" "}
                        {ranged && until && until !== date
                          ? `between ${date} and ${until}`
                          : `on ${date}`}
                        .
                      </div>
                      {/* Boxed and sized up on purpose. An empty table is the
                          most believable thing on this screen — it looks like
                          an answer — and the one sentence that says it is not
                          an answer has to be impossible to have missed. */}
                      <div
                        className="mx-auto mt-4 max-w-xl rounded-xl px-5 py-4 text-left"
                        style={{
                          background: "#fff7ed",
                          border: "2px solid rgba(180,83,9,0.45)",
                          color: "#92400e",
                        }}
                      >
                        <div className="font-semibold text-base mb-1">
                          This only searched{" "}
                          {ranged && until && until !== date
                            ? "the dates on screen"
                            : "one day"}
                          .
                        </div>
                        <div className="text-base leading-snug">
                          A customer&apos;s older tickets will not show until you
                          widen the dates — use <strong>Range</strong> at the top
                          of the page.
                        </div>
                      </div>
                    </>
                  ) : (
                    "Nothing matches those filters."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        </>
      )}

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
 * One card charge's sequence number — the only editable SEQ in the app.
 *
 * The register hands these out itself, in the order tickets are rung, so the
 * only thing left for a person is the case the register cannot know about:
 * several cards run on the terminal in a burst and keyed in afterwards off a
 * pile of slips, in whatever order the slips came up. The money is right and
 * the numbers are shuffled, so they get shuffled back, here, against the batch.
 *
 * Click-to-edit rather than a permanent input. Almost every row on this screen
 * is being read, not fixed, and a column of open text boxes reads as a form to
 * be filled in — which is exactly how a SEQ gets blanked by a stray click while
 * somebody scrolls.
 *
 * Enter saves, Escape puts the old value back, and leaving the box saves too:
 * the natural thing to do after typing a number is to click the next row, and
 * losing the correction at that point would be the second-most-annoying
 * possible behaviour after losing it silently.
 */
function SeqCell({
  seq,
  editable,
  onSave,
}: {
  seq: string | null;
  editable: boolean;
  onSave: (v: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(seq ?? "");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(seq ?? "");
  }, [seq]);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  async function commit() {
    if (busy) return;
    setEditing(false);
    if ((value.trim() || null) === seq) return;
    setBusy(true);
    const ok = await onSave(value);
    setBusy(false);
    if (!ok) setValue(seq ?? "");
  }

  if (!editable) {
    return seq ? (
      <span className="text-brand-300 tabular-nums">SEQ {seq}</span>
    ) : (
      <span className="text-brand-300">no SEQ</span>
    );
  }

  if (editing) {
    return (
      <input
        ref={ref}
        autoFocus
        className="input py-0.5 px-1.5 text-xs tabular-nums"
        style={{ width: 90 }}
        value={value}
        disabled={busy}
        placeholder="SEQ"
        onChange={(v) => setValue(v.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") void commit();
          if (ev.key === "Escape") {
            setValue(seq ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="text-xs tabular-nums rounded px-1.5 py-0.5 hover:bg-black/5"
      title="Click to correct the terminal sequence number"
      // A card charge with no SEQ shows up on the close-out as a problem, so it
      // is amber here — the row that needs typing into is the one that says so.
      style={seq ? { color: "rgba(10,37,64,0.55)" } : { color: "#b45309" }}
      onClick={() => setEditing(true)}
    >
      {seq ? `SEQ ${seq}` : "no SEQ"}
    </button>
  );
}
