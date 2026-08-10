"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TicketDrawer } from "@/components/pos/TicketDrawer";
import { usePosAuth } from "@/components/pos/PosShell";
import { formatCents } from "@/lib/money";
import { FULFILLMENT_LABELS, FULFILLMENT_STAGES, OURS } from "@/lib/fulfillment";
import type { SpecialOrder } from "@/lib/special-orders";
import type { FulfillmentStatus } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import { useLang } from "@/components/pos/LangToggle";

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

type Data = { orders: SpecialOrder[] };

const TONE: Record<string, { bg: string; fg: string; border: string }> = {
  // Amber for "somebody here has a job to do", the same amber this app uses
  // everywhere else for money owed and stock gone negative.
  ours: { bg: "#fff7ed", fg: "#b45309", border: "rgba(180,83,9,0.30)" },
  waiting: { bg: "#ffffff", fg: "rgba(10,37,64,0.55)", border: "rgba(0,0,0,0.06)" },
  done: { bg: "#ffffff", fg: "rgba(10,37,64,0.35)", border: "rgba(0,0,0,0.06)" },
};

function toneFor(o: SpecialOrder): keyof typeof TONE {
  if (OURS.includes(o.status)) return "ours";
  if (o.status === "delivered" || o.status === "cancelled") return "done";
  return "waiting";
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

  const load = useCallback(async () => {
    const res = await fetch("/api/pos/orders");
    if (!res.ok) return;
    setData(await res.json());
  }, []);

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

  async function move(saleId: number, status: FulfillmentStatus) {
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
    await load();
  }

  const orders = useMemo(() => {
    if (!data) return [];
    if (showDone) return data.orders;
    return data.orders.filter(
      (o) =>
        !((o.status === "delivered" || o.status === "cancelled") && o.balanceCents === 0),
    );
  }, [data, showDone]);

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
        <label className="flex items-center gap-2 text-sm text-brand-400">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />{tr("Show finished")}</label>
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

      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm px-4 py-12 text-center text-brand-300">{tr("Nothing on order.")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => {
            const tone = TONE[toneFor(o)];
            return (
              <div
                key={o.saleId}
                className="rounded-2xl shadow-sm px-4 py-3 flex gap-4 items-start flex-wrap"
                style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
              >
                <div className="flex-1 min-w-[16rem]">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <button
                      type="button"
                      className="font-semibold underline decoration-black/20 hover:decoration-current"
                      style={{ color: o.balanceCents > 0 ? "#b45309" : "#0a2540" }}
                      onClick={() => setOpenSaleId(o.saleId)}
                    >
                      {o.saleNo}
                    </button>
                    <span
                      className="text-xs uppercase tracking-wider font-semibold"
                      style={{ color: tone.fg }}
                    >
                      {FULFILLMENT_LABELS[o.status]}
                    </span>
                    {/* How long it has sat AT THIS STAGE, not since it was
                        rung. An order placed a month ago that arrived this
                        morning is not a month overdue, and a board that said so
                        would cry wolf until nobody looked at it. */}
                    <span className="text-xs text-brand-300">{waited(o.daysWaiting)}</span>
                  </div>

                  <div className="text-sm text-brand-500 mt-0.5">{o.what || "—"}</div>

                  {/* The phone number is not decoration on this screen — on an
                      arrived order it is the next action, so it is spelled out
                      rather than hidden behind the ticket. */}
                  <div className="text-sm text-brand-400">
                    {o.customerName ?? (
                      <span className="text-brand-300">no name taken</span>
                    )}
                    {o.customerPhone && ` · ${o.customerPhone}`}
                    {o.vehicle && ` · ${o.vehicle}`}
                  </div>

                  {o.notes && (
                    <div className="text-sm italic text-brand-300">{o.notes}</div>
                  )}
                </div>

                <div className="text-right">
                  <div className="tabular-nums text-brand-500 font-semibold">
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

                {can("manageSpecialOrders") && (
                  <StageControl
                    status={o.status}
                    busy={busy === o.saleId}
                    canReverse={can("reverseSpecialOrder")}
                    onMove={(s) => void move(o.saleId, s)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

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
 * One big button for the next stage, and a small select for everything else.
 *
 * The overwhelming majority of moves on this board are forward by exactly one,
 * done by somebody with a tire in their other hand — so that move is a button
 * with the words on it and no menu to open. Anything else is rarer, is usually
 * a correction, and can afford a dropdown.
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

  const others = (FULFILLMENT_STAGES as readonly FulfillmentStatus[])
    .filter((s) => s !== status && s !== next)
    .filter((s) => canReverse || (FULFILLMENT_STAGES as readonly string[]).indexOf(s) > i);

  return (
    <div className="flex items-center gap-2">
      {next && (
        <button
          type="button"
          className="btn btn-primary whitespace-nowrap"
          disabled={busy}
          onClick={() => onMove(next)}
        >
          {FULFILLMENT_LABELS[next]}
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
