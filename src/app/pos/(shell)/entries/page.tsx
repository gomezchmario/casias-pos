"use client";

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
 * Voided rows are included and struck through rather than filtered out. This is
 * the screen somebody opens when the drawer is short, and a void is the single
 * most likely explanation — a list that hid them would hide the answer.
 *
 * It is also where SEQ gets fixed. The card batch is reconciled against a list
 * of the day's charges, and this is that list; sending someone into a ticket
 * one at a time to correct a transposed number meant the job was done from
 * memory at close, or not at all.
 */

type Data = {
  businessDate: string;
  /** Today's business date, whatever day is being viewed. */
  today: string;
  entries: DayEntry[];
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
  const [sortKey, setSortKey] = useState<SortKey>("at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  /**
   * Has somebody deliberately gone looking at another day?
   *
   * Until they have, this list follows today and keeps following it — not just
   * on the first draw. The tab gets opened once and left open; seeding the box
   * at mount would leave it stuck on yesterday's ledger after the 4am roll,
   * which is the one time an empty-looking Entries screen is genuinely
   * alarming rather than merely wrong.
   */
  const pickedADay = useRef(false);

  const load = useCallback(async () => {
    const url = date
      ? `/api/pos/reports/entries?date=${date}`
      : "/api/pos/reports/entries";
    const res = await fetch(url);
    if (!res.ok) return;
    const d: Data = await res.json();
    setData(d);
    // `d.today`, not `d.businessDate` — the latter echoes what was asked for,
    // so it can never report that the day rolled underneath us.
    if (!pickedADay.current && date !== d.today) setDate(d.today);
  }, [date]);

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
      if (!showVoided && e.voided) return false;
      if (!q) return true;
      return [e.saleNo, e.what, e.category, e.detail, e.who, e.seq]
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
  }, [data, query, kind, who, category, method, showVoided, sortKey, sortDir]);

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
          <h1 className="text-2xl font-semibold text-brand-500">Entries</h1>
          <p className="text-brand-400 text-sm">
            Everything that happened, in the order it happened. Voided rows stay
            on the list.
          </p>
        </div>
        {/* Picking a date pins the list to it; nothing snaps it back on its
            own after that. "Today" is the way home. */}
        <div className="flex items-center gap-2">
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
          {data && date !== data.today && (
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
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-3 mb-4 flex gap-3 items-center flex-wrap">
        <input
          className="input"
          style={{ minWidth: 220 }}
          placeholder="Ticket, service, tender, SEQ…"
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
        <label className="flex items-center gap-2 text-sm text-brand-400">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          Show voided
        </label>
        <div className="ml-auto text-sm text-brand-400">
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
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.key}
                className="border-t border-black/5"
                style={e.voided ? { opacity: 0.5 } : undefined}
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
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cardView ? 8 : 7} className="px-4 py-10 text-center text-brand-300">
                  {data.entries.length === 0
                    ? "Nothing happened on this day."
                    : "Nothing matches those filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
