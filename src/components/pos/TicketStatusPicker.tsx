"use client";

import { useState } from "react";
import { stockHasMoved } from "@/lib/fulfillment";
import { OrderStockConfirm } from "@/components/pos/OrderStockConfirm";
import { FULFILLMENT_LABELS, FULFILLMENT_STAGES, ORDER_PILLS } from "@/lib/fulfillment";
import type { FulfillmentStatus } from "@/lib/sales";
import { WORK_PILLS, workStatusTitle } from "@/lib/work-status";
import { useLang } from "@/components/pos/LangToggle";

/**
 * What is happening with this ticket, out of two lists.
 *
 * Behind this are two different columns. `work_status` says where the CAR is —
 * waiting, being worked on, ready to hand back. `fulfillment_status` says where
 * the TIRE is — to order, on its way, here, fitted. They were two separate
 * controls in two separate places for exactly that reason, and the reason was
 * right about the database and wrong about the counter: nobody standing at this
 * screen is asking which of the two questions they are answering.
 *
 * BOTH AT ONCE, because the shop routinely has both. A customer leaves the car
 * on Tuesday and the tire it needs has to come off a truck on Thursday; the car
 * is waiting AND the order is on its way, and those are two true facts about one
 * ticket. This control used to make picking one clear the other, which meant
 * saying "the tire is on its way" quietly forgot that there was a car on the lot.
 *
 * THE TABLE STILL DRAWS ONE PILL. A row is one line and a status column that
 * sometimes holds two pills is a column that changes width from row to row —
 * and two pills is also two things to read where the eye wants one. So the row
 * shows the side that is still live (see `shownSide`), carries the other in its
 * tooltip, and the ticket itself is where the full picture is.
 *
 * Native <select> deliberately, not a hand-rolled popover. A menu built out of
 * divs inside a scrolling table is a positioning bug waiting to happen, and it
 * has to reimplement click-outside, escape and keyboard selection that the
 * browser already does correctly.
 */

/**
 * Cancelled last, and outside `FULFILLMENT_STAGES` for the reason that list
 * gives: it is not a stage, it is the answer that the ticket stopped being an
 * order. It belongs in the dropdown all the same — it is one of the two ways
 * out — but the arithmetic that asks "is this move forwards or backwards?" must
 * never see it as position five.
 */
const ALL_STAGES = [...FULFILLMENT_STAGES, "cancelled"] as const;

/** Which of the two questions a control is answering. */
type Side = "vehicle" | "order";

/**
 * Which side the row shows when the ticket has both.
 *
 * The live one wins, and an order stops being live once it is delivered or
 * cancelled. That is the rule because of what the two facts mean once they are
 * finished: a delivered order is a thing that already happened, while a car
 * still marked Waiting is a car still sitting outside. Showing the finished one
 * would put "Gone" on the row of a ticket whose customer is in the waiting room.
 */
function shownSide(workStatus: string | null, fulfillmentStatus: FulfillmentStatus): Side | null {
  const settled = fulfillmentStatus === "delivered" || fulfillmentStatus === "cancelled";
  if (fulfillmentStatus !== "none" && !(settled && workStatus)) return "order";
  return workStatus ? "vehicle" : null;
}

type Look = { label: string; bg: string; fg: string; border: string };

function lookOf(
  side: Side,
  workStatus: string | null,
  fulfillmentStatus: FulfillmentStatus,
): Look | null {
  if (side === "vehicle") {
    const p = WORK_PILLS.find((w) => w.value === workStatus);
    return p ? { label: p.label, bg: p.bg, fg: p.fg, border: p.border } : null;
  }
  const l = ORDER_PILLS[fulfillmentStatus];
  return l ? { label: FULFILLMENT_LABELS[fulfillmentStatus], ...l } : null;
}

export function TicketStatusPicker({
  saleId,
  workStatus,
  fulfillmentStatus,
  canSet,
  canOrder,
  canReverse,
  size = "pill",
  onChanged,
  onError,
}: {
  saleId: number;
  workStatus: string | null;
  fulfillmentStatus: FulfillmentStatus;
  /** May say where the car is. `ringSale`. */
  canSet: boolean;
  /** May turn a ticket into an order and move it along. `manageSpecialOrders`. */
  canOrder: boolean;
  /** May move an order backwards or cancel it. `reverseSpecialOrder`. */
  canReverse: boolean;
  /** `pill` for a table cell, `full` for a panel. */
  size?: "pill" | "full";
  onChanged: () => void;
  onError?: (msg: string) => void;
}) {
  const { t: tr } = useLang();
  const [busy, setBusy] = useState(false);
  /**
   * The stage this ticket is being moved to, held while the stock question is
   * asked. Null when nothing is pending.
   *
   * Only ever set for a move that actually books stock — see stockHasMoved. A
   * ticket walking from To order to Ordered touches no racks and gets no
   * dialog; the shop should not be asked a question with no consequences.
   */
  const [pendingStage, setPendingStage] = useState<FulfillmentStatus | null>(null);
  /** Which list the panel is showing. Null until somebody flips the switch. */
  const [viewing, setViewing] = useState<Side | null>(null);

  const isOrder = fulfillmentStatus !== "none";
  const shown = shownSide(workStatus, fulfillmentStatus);
  const look = shown ? lookOf(shown, workStatus, fulfillmentStatus) : null;

  // Both facts spelled out, for the tooltip. The row only has room for one pill
  // and the other one is not a secret — this is what hovering is for.
  const bothTitle =
    [
      workStatus ? workStatusTitle(workStatus) : null,
      isOrder ? FULFILLMENT_LABELS[fulfillmentStatus] : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Say what is happening with this ticket";

  // Somebody who cannot touch a ticket can still be reading this screen, and
  // where the car is is not a secret from them. Show the state, drop the
  // control. Nothing at all when nothing is set: a read-only dash is a column
  // of dashes.
  if (!canSet && !canOrder) {
    if (!look) return null;
    return (
      <span
        className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight"
        style={{ background: look.bg, color: look.fg }}
        title={bothTitle}
      >
        {look.label}
      </span>
    );
  }

  const patch = async (url: string, body: unknown): Promise<boolean> => {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    onError?.(d.error || "Could not change this ticket's status");
    return false;
  };

  const setWork = async (next: string | null) => {
    if (workStatus === next) return;
    setBusy(true);
    try {
      if (await patch(`/api/pos/sales/${saleId}/work-status`, { workStatus: next })) onChanged();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Does moving to `next` book tires in and out?
   *
   * The same test the library uses, so the dialog appears exactly when the
   * stock actually moves and never when it does not. A ticket that has already
   * moved its stock is not asked again — going from Fitted to Gone changes
   * nothing on the racks.
   */
  const movesStock = (next: FulfillmentStatus) =>
    !stockHasMoved(fulfillmentStatus) && stockHasMoved(next);

  const commitOrder = async (next: FulfillmentStatus, alreadyStockedItemIds?: number[]) => {
    setBusy(true);
    try {
      const ok =
        next === "none"
          ? await patch(`/api/pos/sales/${saleId}/fulfillment`, { marked: false })
          : await patch(`/api/pos/sales/${saleId}/fulfillment`, {
              status: next,
              alreadyStockedItemIds,
            });
      if (ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const setOrder = async (next: FulfillmentStatus) => {
    if (fulfillmentStatus === next) return;
    // The stock question first, when there is stock to ask about.
    if (next !== "none" && movesStock(next)) {
      setPendingStage(next);
      return;
    }
    setBusy(true);
    try {
      // Marking and staging are one act here. The route turns a plain ticket
      // into an order on the way past, so "this needs ordering" is one pick
      // rather than a toggle followed by a stage. Coming back off is the other
      // call: `setFulfillment` refuses 'none' on purpose.
      const ok =
        next === "none"
          ? await patch(`/api/pos/sales/${saleId}/fulfillment`, { marked: false })
          : await patch(`/api/pos/sales/${saleId}/fulfillment`, { status: next });
      if (ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  /**
   * The order is done, and so is the car.
   *
   * Two calls rather than one, because handing the customer their tire settles
   * both facts at once: the tire is fitted, so there is nothing left to keep the
   * car for. Making somebody go and clear the vehicle separately is how a lot
   * ends up full of tickets that say Waiting about cars that drove off on
   * Tuesday. Releasing it here is also what stamps the ticket's release time.
   */
  const fulfil = async (alreadyStockedItemIds?: number[]) => {
    setBusy(true);
    try {
      if (
        !(await patch(`/api/pos/sales/${saleId}/fulfillment`, {
          status: "delivered",
          alreadyStockedItemIds,
        }))
      )
        return;
      if (workStatus) await patch(`/api/pos/sales/${saleId}/work-status`, { workStatus: null });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  /** The button that hands the tire over, asking about the racks on the way. */
  const askThenFulfil = () => {
    if (movesStock("delivered")) setPendingStage("delivered");
    else void fulfil();
  };

  const pick = (v: string) => {
    if (v.startsWith("f:")) void setOrder(v.slice(2) as FulfillmentStatus);
    else if (v.startsWith("w:")) void setWork(v.slice(2) || null);
  };

  const stageOf = (s: string) => (ALL_STAGES as readonly string[]).indexOf(s);
  const here = stageOf(fulfillmentStatus);
  /**
   * Taking an order back off a ticket the shop has already acted on says it was
   * wrong about something the customer has been told — the same act as walking a
   * stage backwards, and a manager's for the same reason. Anybody may do it
   * while the order is still only pending.
   */
  const orderUnderWay = isOrder && fulfillmentStatus !== "pending";

  const workOptions = (
    <>
      {WORK_PILLS.map((p) => (
        <option key={p.value} value={`w:${p.value}`} disabled={!canSet}>
          {p.title}
        </option>
      ))}
      <option value="w:" disabled={!canSet}>
        No vehicle here
      </option>
    </>
  );

  const orderOptions = (
    <>
      {ALL_STAGES.map((s) => (
        <option
          key={s}
          value={`f:${s}`}
          // Going back a stage says the shop was wrong about something it has
          // already told the customer, and cancelling usually means a deposit has
          // to go back. Both are a manager's to pull.
          disabled={
            !canOrder ||
            (!canReverse &&
              (s === "cancelled" ||
                fulfillmentStatus === "cancelled" ||
                (here >= 0 && stageOf(s) < here)))
          }
        >
          {FULFILLMENT_LABELS[s]}
        </option>
      ))}
      <option value="f:none" disabled={!canOrder || (orderUnderWay && !canReverse)}>
        {FULFILLMENT_LABELS.none}
      </option>
    </>
  );

  /* The stock question. Rendered by both sizes, because a ticket is fulfilled
     from the panel and from the pill in the orders table, and only one of those
     having the guard would make the other the way round it. */
  const stockDialog = (
    <OrderStockConfirm
      saleId={saleId}
      open={pendingStage !== null}
      onCancel={() => setPendingStage(null)}
      onConfirm={(ids) => {
        const stage = pendingStage;
        setPendingStage(null);
        if (!stage) return;
        if (stage === "delivered") void fulfil(ids);
        else void commitOrder(stage, ids);
      }}
    />
  );

  if (size === "full") {
    /**
     * Two halves of one switch, because at this size there is room to show that
     * there are two questions before showing the answer to either.
     *
     * The switch moves the VIEW and nothing else — clicking a half writes
     * nothing. It used to set that list's first state, which was one tap saved
     * back when a ticket could only be one thing; now that it can be both, a tap
     * meant to go and look at the order half would have turned the ticket into
     * an order. The dot says which side already has an answer, so flipping over
     * is never a blind move.
     */
    const side: Side = viewing ?? shown ?? "vehicle";
    const value = side === "vehicle" ? `w:${workStatus ?? ""}` : `f:${fulfillmentStatus}`;
    const sideLook = lookOf(side, workStatus, fulfillmentStatus);

    const half = (s: Side, label: string, set: boolean) => {
      const on = side === s;
      const dot = lookOf(s, workStatus, fulfillmentStatus);
      return (
        <button
          type="button"
          onClick={() => setViewing(s)}
          disabled={busy}
          className="flex-1 px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          // The same slate as the Details button, not the status colour. This
          // switch answers "which list", the pill under it answers "which
          // status" — painting the lit half in the status colour made two
          // controls in the same pastel blue stacked on each other, and the eye
          // read them as one thing that had been drawn twice.
          style={{
            background: on ? "#4b5563" : "#fff",
            color: on ? "#fff" : "rgba(15,23,42,0.45)",
          }}
        >
          {label}
          {set && dot && (
            <span
              className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ background: on ? "#fff" : dot.fg }}
            />
          )}
        </button>
      );
    };

    return (
      <div className="flex flex-col gap-2">
        {stockDialog}
        <div
          className="flex overflow-hidden rounded-lg"
          style={{ border: "1px solid rgba(15,23,42,0.15)" }}
        >
          {half("vehicle", "Vehicle", workStatus !== null)}
          <div style={{ width: 1, background: "rgba(15,23,42,0.15)" }} />
          {half("order", "Outstanding order", isOrder)}
        </div>

        <select
          value={value}
          disabled={busy}
          aria-label={side === "vehicle" ? "Where the vehicle is" : "How far along the order is"}
          className="cursor-pointer rounded-lg px-2.5 py-1.5 text-sm font-semibold outline-none disabled:opacity-50"
          style={{
            background: sideLook ? sideLook.bg : "#fff",
            color: sideLook ? sideLook.fg : "rgba(15,23,42,0.55)",
            border: `1px solid ${sideLook ? sideLook.border : "rgba(15,23,42,0.15)"}`,
          }}
          onChange={(e) => pick(e.target.value)}
        >
          {side === "vehicle" ? workOptions : orderOptions}
        </select>

        {/* The two ways an order ends, out of the dropdown and onto their own
            buttons. They are the only two stages somebody is looking for when
            they walk over to close a ticket out, and hunting for "Gone" at the
            bottom of a list of five is the slowest way to say the customer has
            their tire. Shown on both halves of the switch, not just the order
            one: whoever is releasing the car is usually the same person handing
            over the tire, and they should not have to find the right tab first.
            Each disappears once it is the answer. */}
        {isOrder && (
          <div className="flex gap-2">
            {fulfillmentStatus !== "delivered" && (
              <button
                type="button"
                onClick={askThenFulfil}
                disabled={busy || !canOrder}
                title="The customer has the tire and the car can go. This is the last stage, and it is what takes the tires off the racks."
                className="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }}
              >{tr("Fulfil the order")}</button>
            )}
            {fulfillmentStatus !== "cancelled" && (
              <button
                type="button"
                onClick={() => void setOrder("cancelled")}
                disabled={busy || !canReverse}
                title={
                  canReverse
                    ? "They are not having it after all. Whatever they put down has to go back to them separately."
                    : "A manager cancels orders — there is usually a deposit to return."
                }
                className="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: "#fff", color: "#9f1239", border: "1px solid rgba(159,18,57,0.30)" }}
              >
                Cancel the order
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Untouched tickets get a quiet outline rather than a filled pill. Present
  // enough to be found, faint enough that a panel of eight untouched tickets
  // does not look like it is trying to tell you something.
  const paint = {
    background: look ? look.bg : "transparent",
    color: look ? look.fg : "rgba(120,53,15,0.55)",
    border: `1px solid ${look ? look.border : "rgba(120,53,15,0.20)"}`,
  };

  const value = shown === "order" ? `f:${fulfillmentStatus}` : shown === "vehicle" ? `w:${workStatus}` : "";

  /**
   * A bare <select> takes the width of its widest option — and the headings in
   * there are several times the width of the word "Fitted". In a table that
   * turns every pill in the column into a stretched slab wide enough to shove
   * the next column off the row.
   *
   * So the pill you see is a plain span sized by its own label, and the select
   * lies invisibly on top of it doing the actual work. The browser still gives
   * the real menu, real keyboard handling and real click-outside; it just does
   * not get a say in how wide the row is.
   */
  return (
    <span className="relative inline-block align-middle">
      {stockDialog}
      <span
        className="block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight whitespace-nowrap"
        style={paint}
      >
        {look ? look.label : "Set status…"}
      </span>
      <select
        value={value}
        disabled={busy}
        title={bothTitle}
        aria-label="Ticket status"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        onChange={(e) => pick(e.target.value)}
      >
        {/* Only reachable while the ticket has no status at all — it is the
            placeholder the pill is showing, not a way back to nothing. Each
            list carries its own way out at the bottom. */}
        <option value="" disabled>
          Set status…
        </option>
        <optgroup label={tr("Vehicle")}>{workOptions}</optgroup>
        <optgroup label={tr("Outstanding order")}>{orderOptions}</optgroup>
      </select>
    </span>
  );
}
