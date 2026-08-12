"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TicketDrawer } from "@/components/pos/TicketDrawer";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import {
  FULFILLMENT_LABELS,
  FULFILLMENT_STAGES,
  ORDER_PILLS,
  OURS,
} from "@/lib/fulfillment";
import type { OrderMove, SpecialOrder } from "@/lib/special-orders";
import type { FulfillmentStatus } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import { useLang } from "@/components/pos/LangToggle";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import "./orders.css";

/**
 * The green and blue sheet.
 *
 * What it replaces was a paper list of tires promised to people, kept beside
 * the register, and its failure mode was never that it was wrong — it was that
 * nobody read it. A tire arrived, went in the corner, and stayed there until
 * the customer rang to ask.
 *
 * So this screen is built around exactly one question: WHO IS WAITING ON US.
 * Orders where the ball is in the shop's court come first and are the only
 * coloured rows; orders where the shop is waiting on a supplier sit below,
 * because nobody here can do anything about those today. The lifecycle order
 * (to order → on its way → here → fitted → gone) is not the reading order, and
 * conflating the two is what made the paper version unreadable.
 *
 * Balance is on every row, always, because 'completed' does not mean 'paid' on
 * a special order — the deposit closes the ticket and the rest arrives on
 * pickup. A board that showed only status would let a tire walk out of the shop
 * with half of it unpaid.
 */

type Data = { orders: SpecialOrder[]; history: Record<string, OrderMove[]> };

/**
 * Which of the two screens this is.
 *
 * The board is the counter: who is waiting on us, now. The log is the same
 * records as history — everything ever taken, in a window, with how each one
 * got where it is. They are different questions asked by different people at
 * different desks, and one screen trying to be both was the board getting
 * steadily less readable.
 */
type View = "board" | "log";

const TONE: Record<string, { bg: string; fg: string; border: string }> = {
  // Amber for "somebody here has a job to do", the same amber this app uses
  // everywhere else for money owed and stock gone negative.
  ours: { bg: "#fff7ed", fg: "#b45309", border: "rgba(180,83,9,0.30)" },
  waiting: { bg: "#ffffff", fg: "rgba(10,37,64,0.55)", border: "rgba(0,0,0,0.06)" },
  done: { bg: "#ffffff", fg: "rgba(10,37,64,0.35)", border: "rgba(0,0,0,0.06)" },
};

/**
 * A stage's colours, with a grey fallback.
 *
 * `ORDER_PILLS` is a Partial — 'none' has no entry, because an order is never
 * at it — so the fallback exists to keep a card readable rather than to be
 * used. A stage with no colour reads grey instead of rendering an unstyled
 * word that looks like a bug.
 */
function pillOf(status: FulfillmentStatus) {
  const c = ORDER_PILLS[status] ?? { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" };
  return { background: c.bg, color: c.fg, borderColor: c.border };
}

/** The two ends of the line: nothing more will happen to these on its own. */
const CLOSED: FulfillmentStatus[] = ["delivered", "cancelled"];

function toneFor(o: SpecialOrder): keyof typeof TONE {
  if (OURS.includes(o.status)) return "ours";
  if (CLOSED.includes(o.status)) return "done";
  return "waiting";
}

/** "3:40 PM" — enough beside a date to place an event in an afternoon. */
function clock(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Aug 6" — a date short enough to sit in a run of them. */
function shortDay(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "today", "yesterday", "6 days" — the shape a person says out loud. */
function waited(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days`;
}

export default function OrdersPage() {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [data, setData] = useState<Data | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState({ tipCommPerCents: 500, tipCommChargeCents: 100 });
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  /**
   * How far back finished orders reach, once they are asked for.
   *
   * Thirty days rather than everything, because "show finished" on a shop with
   * years of history behind it means the four rows that matter disappear under
   * a thousand that were picked up in 2024. The month is the answer to the
   * question this actually gets opened for — "did that Landsail ever go out?"
   * — and All time is one press away for the rarer one.
   *
   * Measured on `daysWaiting`, which on a finished order is days since it
   * finished. It is the same figure the card already prints.
   */
  const [doneWithin, setDoneWithin] = useState<7 | 30 | 0>(30);

  const [view, setView] = useState<View>("board");
  /** Empty means every order ever taken — see `listOrderLog`. */
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "closed" | FulfillmentStatus>("all");
  const [query, setQuery] = useState("");
  /** Which rows have their history unfolded. */
  const [openHistory, setOpenHistory] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (view === "log") {
      sp.set("view", "log");
      if (from) sp.set("from", from);
      if (until) sp.set("to", until);
    }
    const res = await fetch(`/api/pos/orders?${sp}`);
    if (!res.ok) return;
    setData(await res.json());
  }, [view, from, until]);

  useEffect(() => {
    void load();
  }, [load]);

  // The drawer needs tenders and the commission settings to take the balance
  // on pickup, which is the single most common thing done from this screen.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pos/reports/entries");
      if (!res.ok) return;
      const d = await res.json();
      setMethods(d.paymentMethods ?? []);
      if (d.settings) setSettings(d.settings);
    })();
  }, []);

  /**
   * What just happened, so it can be said out loud and taken back.
   *
   * A move on this board re-sorts and re-filters the whole list — the card
   * leaves the position it was in, and often the screen. Pressed on purpose
   * that is exactly right; pressed by accident, which on a tablet in a shop is
   * a thumb landing on a card while scrolling, the row simply vanished and
   * there was nothing on screen to say what had been done or to which ticket.
   */
  const [lastMove, setLastMove] = useState<{
    saleId: number;
    saleNo: string;
    from: FulfillmentStatus;
    to: FulfillmentStatus;
  } | null>(null);

  /**
   * The move somebody has pressed but not yet agreed to.
   *
   * Every control on a card is asked about before it fires. A stage is a
   * promise to a customer — "here, call them" against "waiting for pickup" is
   * the difference between a phone call that is owed and one that was made —
   * and the board is used at speed, on a tablet, by somebody holding a tire.
   *
   * Undo does NOT come through here. It is already the correction, and asking
   * somebody to confirm that they meant to take back a thing they just said
   * they did not mean is a dialog about a dialog.
   */
  const [pending, setPending] = useState<{
    saleId: number;
    saleNo: string;
    from: FulfillmentStatus;
    to: FulfillmentStatus;
  } | null>(null);

  function askMove(saleId: number, status: FulfillmentStatus) {
    const o = data?.orders.find((x) => x.saleId === saleId);
    if (!o) return;
    setPending({ saleId, saleNo: o.saleNo, from: o.status, to: status });
  }

  async function move(
    saleId: number,
    status: FulfillmentStatus,
    /** Set when this IS the undo, so undoing an undo is not offered. */
    undoing = false,
  ) {
    const wasAt = data?.orders.find((o) => o.saleId === saleId);
    setBusy(saleId);
    setError(null);
    const res = await fetch(`/api/pos/sales/${saleId}/fulfillment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "That didn't move");
      return;
    }
    setPending(null);
    setLastMove(
      undoing || !wasAt
        ? null
        : { saleId, saleNo: wasAt.saleNo, from: wasAt.status, to: status },
    );
    await load();
  }

  /** The card the pending move belongs to, so the dialog can name it. */
  const pendingOrder = pending
    ? (data?.orders.find((o) => o.saleId === pending.saleId) ?? null)
    : null;

  const orders = useMemo(() => {
    if (!data) return [];
    let list = data.orders;

    // The board's own tidy-up: finished and paid drops off unless asked for.
    // The log never hides anything — hiding history is the one thing a log
    // must not do — so this only applies to the board.
    if (view === "board") {
      const finished = (o: SpecialOrder) =>
        (o.status === "delivered" || o.status === "cancelled") && o.balanceCents === 0;
      if (!showDone) list = list.filter((o) => !finished(o));
      // Asked for, but only back as far as the window. An unfinished order is
      // never dropped by this — however long it has sat, it is still waiting on
      // somebody, which is the whole reason the board exists.
      else if (doneWithin > 0)
        list = list.filter((o) => !finished(o) || o.daysWaiting <= doneWithin);
    }

    if (status === "open") list = list.filter((o) => !CLOSED.includes(o.status));
    else if (status === "closed") list = list.filter((o) => CLOSED.includes(o.status));
    else if (status !== "all") list = list.filter((o) => o.status === status);

    const q = query.trim().toLowerCase();
    if (q) {
      const digits = q.replace(/\D/g, "");
      list = list.filter((o) => {
        if (o.saleNo.toLowerCase().includes(q)) return true;
        if (o.what.toLowerCase().includes(q)) return true;
        if (o.customerName?.toLowerCase().includes(q)) return true;
        if (o.vehicle?.toLowerCase().includes(q)) return true;
        if (o.notes?.toLowerCase().includes(q)) return true;
        // Digits-only as well as raw, so 2104213006 finds 210-421-3006.
        // Nobody reads a phone number back with the punctuation.
        if (digits.length >= 3 && o.customerPhone?.replace(/\D/g, "").includes(digits))
          return true;
        return false;
      });
    }
    return list;
  }, [data, showDone, doneWithin, view, status, query]);

  const waitingOnUs = useMemo(
    () => (data?.orders ?? []).filter((o) => OURS.includes(o.status)).length,
    [data],
  );
  const owed = useMemo(
    () =>
      (data?.orders ?? [])
        .filter((o) => o.status !== "cancelled")
        .reduce((s, o) => s + Math.max(0, o.balanceCents), 0),
    [data],
  );

  if (!data) return <div className="text-brand-300">{tr("Loading…")}</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{tr("Orders")}</h1>
          <p className="text-brand-400 text-sm">
            Tires ordered in for somebody. The ones we are holding up are at the
            top.
          </p>
        </div>
        {/* The switch between the two readings. A pair of buttons rather than a
            dropdown because there are exactly two and which one you are on
            changes what every control beneath it means — that has to be legible
            without opening anything. */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(10,37,64,0.15)" }}>
            {(["board", "log"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                className="px-3 py-1.5 text-sm font-medium"
                aria-pressed={view === v}
                style={
                  view === v
                    ? { background: "#0a2540", color: "#fff" }
                    : { color: "rgba(10,37,64,0.6)" }
                }
                onClick={() => setView(v)}
              >
                {v === "board" ? tr("The board") : tr("All orders")}
              </button>
            ))}
          </div>
          {view === "board" && (
            <label className="flex items-center gap-2 text-sm text-brand-400">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => setShowDone(e.target.checked)}
              />{tr("Show finished")}</label>
          )}
          {/* Only once there is something for it to narrow. A window control
              beside an unticked box would be asking how far back to look
              through orders that are not being shown. */}
          {view === "board" && showDone && (
            <div className="ord-seg">
              {([
                [7, "Last week"],
                [30, "30 days"],
                [0, "All time"],
              ] as [7 | 30 | 0, string][]).map(([d, label]) => (
                <button
                  key={d}
                  type="button"
                  className={`ord-seg-btn${doneWithin === d ? " is-on" : ""}`}
                  aria-pressed={doneWithin === d}
                  onClick={() => setDoneWithin(d)}
                >
                  {tr(label)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Everything that narrows the list. On the board it is a search and a
          status; on the log it also takes a window, because the log's whole
          job is answering questions about a period that is over.

          Blank dates mean every order the shop has ever taken, which is the
          right default for a log — a window that started somewhere by itself
          would answer a narrower question than the one being asked, with
          nothing on screen to say so. */}
      <div className="bg-white rounded-2xl shadow-sm p-3 mb-4 flex gap-3 items-center flex-wrap">
        <input
          className="input"
          style={{ minWidth: 240 }}
          placeholder={tr("Ticket, customer, phone, tire, note…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label={tr("Stage")}
        >
          <option value="all">{tr("Any stage")}</option>
          <option value="open">{tr("Still going")}</option>
          <option value="closed">{tr("Finished or cancelled")}</option>
          {(FULFILLMENT_STAGES as readonly FulfillmentStatus[]).map((s) => (
            <option key={s} value={s}>
              {FULFILLMENT_LABELS[s]}
            </option>
          ))}
          <option value="cancelled">{FULFILLMENT_LABELS.cancelled}</option>
        </select>

        {view === "log" && (
          <>
            <span className="text-sm text-brand-300">{tr("Taken between")}</span>
            <input
              type="date"
              className="input"
              value={from}
              max={until || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label={tr("From")}
            />
            <span className="text-brand-300 text-sm">{tr("and")}</span>
            <input
              type="date"
              className="input"
              value={until}
              min={from || undefined}
              onChange={(e) => setUntil(e.target.value)}
              aria-label={tr("To")}
            />
            <button
              type="button"
              className="btn btn-outline"
              style={{ height: 34, fontSize: 13 }}
              disabled={!from && !until}
              onClick={() => {
                setFrom("");
                setUntil("");
              }}
            >{tr("All time")}</button>
          </>
        )}

        <div className="ml-auto text-sm text-brand-400">
          {orders.length} {orders.length === 1 ? tr("order") : tr("orders")}
          {view === "log" && !from && !until && (
            <span className="text-brand-300"> · {tr("all time")}</span>
          )}
        </div>
      </div>

      {/* Two numbers, and only two. How many jobs are ours, and how much of the
          shop's money is out on other people's tires. */}
      <div className="flex gap-4 mb-4 flex-wrap">
        <div
          className="rounded-2xl px-4 py-3 shadow-sm"
          style={{
            background: waitingOnUs > 0 ? "#fff7ed" : "#fff",
            border: `1px solid ${waitingOnUs > 0 ? "rgba(180,83,9,0.30)" : "rgba(0,0,0,0.06)"}`,
          }}
        >
          <div className="text-xs uppercase tracking-wider text-brand-400">
            Waiting on us
          </div>
          <div
            className="text-2xl font-semibold tabular-nums"
            style={{ color: waitingOnUs > 0 ? "#b45309" : "#0a2540" }}
          >
            {waitingOnUs}
          </div>
        </div>
        <div className="rounded-2xl px-4 py-3 shadow-sm bg-white">
          <div className="text-xs uppercase tracking-wider text-brand-400">{tr("Still owed on orders")}</div>
          <div className="text-2xl font-semibold tabular-nums text-brand-500">
            {formatCents(owed)}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/*
        The receipt for the last move, and the way back from it.

        Undo rather than a confirm dialog. Confirming every move would tax the
        common case — a tire in one hand, moving an order forward by one — to
        guard against the rare one, and a dialog pressed forty times a day stops
        being read by the tenth. This costs nothing to whoever meant it and
        gives whoever did not a way out, which is the right trade on a board
        that is used at speed.

        It stays until the next move rather than fading on a timer: a note that
        disappears after four seconds is one somebody notices at the end of the
        fifth.
      */}
      {lastMove && (
        <div
          className="mb-4 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm"
          style={{ background: "#eef6ff", border: "1px solid #bfdbfe", color: "#1e3a5f" }}
        >
          <span>
            <strong>{lastMove.saleNo}</strong> {tr("moved to")}{" "}
            <strong>{FULFILLMENT_LABELS[lastMove.to]}</strong>
          </span>
          <button
            type="button"
            className="btn btn-outline"
            style={{ height: 28, fontSize: 12, padding: "0 12px" }}
            disabled={busy === lastMove.saleId}
            onClick={() => void move(lastMove.saleId, lastMove.from, true)}
          >
            {tr("Undo")} — {tr("put it back to")} {FULFILLMENT_LABELS[lastMove.from]}
          </button>
          <button
            type="button"
            className="text-xs underline ml-auto"
            onClick={() => setLastMove(null)}
          >
            {tr("Dismiss")}
          </button>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-12 text-center text-brand-300">{tr("Nothing on order.")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => {
            const tone = TONE[toneFor(o)];
            return (
              <div
                key={o.saleId}
                className="ord-card rounded-2xl shadow-sm px-4 py-3"
                style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
              >
                {/* Details on the left, stage and money on the right, actions
                    underneath. The controls used to sit BETWEEN the customer's
                    details and the amount, which put the biggest, darkest thing
                    on the card in the middle of the sentence being read. */}
                <div className="ord-top">
                <div className="flex-1 min-w-[16rem]">
                  {/*
                    WHO, first and biggest.

                    This is the line the card exists for. Every stage on the
                    board is some version of "somebody has to ring this person",
                    so the name and the number are the thing being reached for
                    — and they were the smallest, palest text on the card, three
                    rows below a ticket number nobody dials.

                    The ticket number is still here and still the way into the
                    ticket. It has just stopped being the headline, because
                    S-2026-000035 is how the computer refers to Germain Baca and
                    the counter needs it the other way round.
                  */}
                  <div className="ord-who">
                    {o.customerName ?? (
                      <span className="text-brand-300">{tr("no name taken")}</span>
                    )}
                    {o.customerPhone && <span className="ord-phone">{o.customerPhone}</span>}
                  </div>

                  <div className="flex items-baseline gap-2 flex-wrap">
                    <button
                      type="button"
                      className="text-sm underline decoration-black/20 hover:decoration-current"
                      style={{ color: o.balanceCents > 0 ? "#b45309" : "#0a2540" }}
                      onClick={() => setOpenSaleId(o.saleId)}
                    >
                      {o.saleNo}
                    </button>
                    {o.vehicle && (
                      <span className="text-sm text-brand-400">{o.vehicle}</span>
                    )}
                    {/* How long it has sat AT THIS STAGE, not since it was
                        rung. An order placed a month ago that arrived this
                        morning is not a month overdue, and a board that said so
                        would cry wolf until nobody looked at it. */}
                    <span className="text-xs text-brand-300">{waited(o.daysWaiting)}</span>
                  </div>

                  <div className="text-sm text-brand-500 mt-0.5">{o.what || "—"}</div>

                  {o.notes && (
                    <div className="text-sm italic text-brand-300">{o.notes}</div>
                  )}
                </div>

                {/*
                  The stage and the money, side by side at the right-hand end.

                  Two facts about the same order that get read together — "what
                  does this need, and is it paid for" — so they sit as a pair
                  rather than one being buried in the details and the other
                  floating alone.

                  The stage is on the LEFT of the money, which puts it nearer
                  the details it is about and leaves the amount hard against the
                  edge where a column of amounts lines up down the board.

                  The colours come from `ORDER_PILLS`, shared with the
                  Outstanding panel on Main, so a stage does not mean orange on
                  one screen and something else on the next.
                */}
                <div className="ord-right">
                  <div className="ord-stage" style={pillOf(o.status)}>
                    {FULFILLMENT_LABELS[o.status]}
                  </div>
                  <div className="text-right">
                    <div className="ord-money tabular-nums text-brand-500">
                      {formatCents(o.totalCents)}
                    </div>
                    {o.balanceCents !== 0 ? (
                      <div className="tabular-nums text-sm" style={{ color: "#b45309" }}>
                        {formatCents(o.balanceCents)} owing
                      </div>
                    ) : (
                      <div className="text-sm text-brand-300">paid</div>
                    )}
                  </div>
                </div>
                </div>

                {can("manageSpecialOrders") && (
                  <div className="ord-actions">
                    <StageControl
                      status={o.status}
                      busy={busy === o.saleId}
                      canReverse={can("reverseSpecialOrder")}
                      onMove={(s) => askMove(o.saleId, s)}
                    />
                  </div>
                )}

                {/* The order's own history, folded away on every row of both
                    readings. Shut by default, because the board is read to find
                    the next job and an unfolded history on every row would bury
                    it — but one press away, because "when did this actually
                    arrive" and "who rang them last" get asked at the counter
                    with the customer already on the phone. */}
                {(
                  <div className="mt-1">
                    <button
                      type="button"
                      className="text-xs text-brand-300 hover:text-brand-500 underline"
                      aria-expanded={openHistory.has(o.saleId)}
                      onClick={() =>
                        setOpenHistory((s) => {
                          const next = new Set(s);
                          if (next.has(o.saleId)) next.delete(o.saleId);
                          else next.add(o.saleId);
                          return next;
                        })
                      }
                    >
                      {openHistory.has(o.saleId) ? tr("Hide the history") : tr("How it got here")}
                      {(data.history[String(o.saleId)]?.length ?? 0) > 0 &&
                        ` · ${data.history[String(o.saleId)].length}`}
                    </button>

                    {openHistory.has(o.saleId) && (
                      <OrderHistory
                        moves={data.history[String(o.saleId)] ?? []}
                        openedAt={o.openedAt}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/*
        Named in full, both ends of it. "Are you sure?" over a board of four
        near-identical cards is a question nobody can answer — the whole risk
        here is pressing the right button on the wrong row, and the only thing
        that catches it is seeing the ticket number and the customer written
        out before it happens.
      */}
      <ConfirmModal
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void move(pending.saleId, pending.to)}
        busy={busy === pending?.saleId}
        title={pending ? `Move ${pending.saleNo}?` : ""}
        confirmLabel={
          pending ? `Yes — ${FULFILLMENT_LABELS[pending.to]}` : "Yes"
        }
        cancelLabel="No, leave it"
      >
        {pending && (
          <>
            <p>
              <strong className="text-brand-500">{pending.saleNo}</strong>
              {pendingOrder?.customerName ? ` · ${pendingOrder.customerName}` : ""}
              {pendingOrder?.what ? ` · ${pendingOrder.what}` : ""}
            </p>
            <p className="mt-2">
              {tr("Now")}{" "}
              <strong style={pillOf(pending.from)} className="ord-stage-inline">
                {FULFILLMENT_LABELS[pending.from]}
              </strong>{" "}
              {tr("becomes")}{" "}
              <strong style={pillOf(pending.to)} className="ord-stage-inline">
                {FULFILLMENT_LABELS[pending.to]}
              </strong>
            </p>
          </>
        )}
      </ConfirmModal>

      {openSaleId !== null && (
        <TicketDrawer
          key={openSaleId}
          saleId={openSaleId}
          methods={methods}
          commPerCents={settings.tipCommPerCents}
          commChargeCents={settings.tipCommChargeCents}
          onClose={() => setOpenSaleId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

/**
 * The moves worth making from where this order actually is.
 *
 * It used to be "the next stage in the list, as one big button". That reads
 * well until you notice what the list says comes after Here — call them: it is
 * Called — no answer. So the biggest, darkest control on an arrived order —
 * the one a thumb finds first — recorded a phone call that failed, and did it
 * in one tap with the card then jumping out from under the finger.
 *
 * A phone call has two outcomes and neither of them is "the next one". So the
 * two stages where the shop is holding the phone offer both, worded as what
 * happened rather than as where the ticket goes, and the good outcome is the
 * one that looks like the primary action. Everywhere else there genuinely is a
 * single next step, and that stays one button.
 *
 * The dropdown offers backwards moves and cancel only to whoever may make them,
 * rather than offering them to everybody and refusing afterwards. A control
 * that is there but says no is how somebody learns to stop trusting the screen.
 */
function StageControl({
  status,
  busy,
  canReverse,
  onMove,
}: {
  status: FulfillmentStatus;
  busy: boolean;
  canReverse: boolean;
  onMove: (s: FulfillmentStatus) => void;
}) {
  const { t: tr } = useLang();
  const i = (FULFILLMENT_STAGES as readonly string[]).indexOf(status);
  const next = i >= 0 && i < FULFILLMENT_STAGES.length - 1 ? FULFILLMENT_STAGES[i + 1] : null;

  /*
    On the phone-call stages the buttons are the two answers to "did you get
    hold of them?". `no_answer` gets only the good one, because the ticket is
    already sitting at no answer and a second button putting it back where it
    is would do nothing but look pressable.
  */
  const onThePhone = status === "arrived" || status === "no_answer";
  const primary: { to: FulfillmentStatus; label: string } | null = onThePhone
    ? { to: "waiting_pickup", label: tr("They answered") }
    : next
      ? { to: next, label: FULFILLMENT_LABELS[next] }
      : null;
  const secondary: { to: FulfillmentStatus; label: string } | null =
    status === "arrived" ? { to: "no_answer", label: tr("No answer") } : null;

  const shown = [primary?.to, secondary?.to];
  const others = (FULFILLMENT_STAGES as readonly FulfillmentStatus[])
    .filter((s) => s !== status && !shown.includes(s))
    .filter((s) => canReverse || (FULFILLMENT_STAGES as readonly string[]).indexOf(s) > i);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {primary && (
        <button
          type="button"
          className="btn btn-primary whitespace-nowrap"
          disabled={busy}
          onClick={() => onMove(primary.to)}
        >
          {primary.label}
        </button>
      )}
      {/* Quieter than the primary on purpose: both are real answers, but only
          one of them is the one the shop is hoping for, and a failed call
          should not be the easiest thing on the card to hit. */}
      {secondary && (
        <button
          type="button"
          className="btn btn-outline whitespace-nowrap"
          disabled={busy}
          onClick={() => onMove(secondary.to)}
        >
          {secondary.label}
        </button>
      )}
      <select
        className="input"
        value=""
        disabled={busy}
        title={tr("Move this order somewhere else")}
        onChange={(e) => {
          if (e.target.value) onMove(e.target.value as FulfillmentStatus);
        }}
      >
        <option value="">…</option>
        {others.map((s) => (
          <option key={s} value={s}>
            {FULFILLMENT_LABELS[s]}
          </option>
        ))}
        {canReverse && status !== "cancelled" && (
          <option value="cancelled">{FULFILLMENT_LABELS.cancelled}</option>
        )}
      </select>
    </div>
  );
}

/**
 * One order's life, in the order it happened.
 *
 * Read out of the audit log rather than kept in a table of its own — see
 * `orderHistory`. What it answers is the set of questions the board never
 * could: when did this actually arrive, who rang them, and how long did it sit
 * at each stage while somebody's customer waited.
 *
 * The days-in-stage figure is the one worth having. A customer complaining
 * about a fortnight's wait is usually complaining about one stage of it, and
 * until this existed there was no way to say which — or to know whether the
 * supplier was slow or the phone call was late.
 *
 * Oldest first, unlike every other list in this app. This one is a story rather
 * than a feed: it is read from the beginning, and newest-first would make the
 * reader assemble the sequence backwards in their head.
 */
function OrderHistory({ moves, openedAt }: { moves: OrderMove[]; openedAt: string }) {
  const { t: tr } = useLang();

  if (moves.length === 0)
    return (
      <div className="mt-2 text-xs text-brand-300">
        {tr("It has not moved since it was rung.")}
      </div>
    );

  return (
    <div className="mt-2 rounded-xl bg-black/[0.03] p-3">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-1.5">
        {tr("How it got here")}
      </div>
      <table className="w-full text-sm">
        <tbody>
          <tr className="text-brand-300">
            <td className="py-1 whitespace-nowrap tabular-nums" style={{ width: 96 }}>
              {shortDay(openedAt)}
            </td>
            <td className="py-1 pl-3 tabular-nums" style={{ width: 72 }}>
              {clock(openedAt)}
            </td>
            <td className="py-1 pl-3" colSpan={2}>
              {tr("Ticket rung")}
            </td>
          </tr>
          {moves.map((m, i) => (
            <tr key={i} className="border-t border-black/5">
              <td className="py-1 whitespace-nowrap tabular-nums text-brand-300">
                {shortDay(m.at)}
              </td>
              <td className="py-1 pl-3 tabular-nums text-brand-300">{clock(m.at)}</td>
              <td className="py-1 pl-3 text-brand-500">
                {FULFILLMENT_LABELS[m.to]}
                {/* Named only when it went backwards. Forward moves are the
                    sequence doing what it does and saying "from X to Y" on
                    every one of them turns a short story into a wall. */}
                {m.from &&
                  (FULFILLMENT_STAGES as readonly string[]).indexOf(m.to) <
                    (FULFILLMENT_STAGES as readonly string[]).indexOf(m.from) && (
                    <span className="text-xs" style={{ color: "#b45309" }}>
                      {" "}
                      · {tr("back from")} {FULFILLMENT_LABELS[m.from]}
                    </span>
                  )}
                {m.daysInPrevious !== null && m.daysInPrevious > 0 && (
                  <span className="text-xs text-brand-300">
                    {" "}
                    · {tr("after")} {m.daysInPrevious}{" "}
                    {m.daysInPrevious === 1 ? tr("day") : tr("days")}
                  </span>
                )}
              </td>
              <td className="py-1 pl-3 text-right text-xs text-brand-300 whitespace-nowrap">
                {m.byName ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
