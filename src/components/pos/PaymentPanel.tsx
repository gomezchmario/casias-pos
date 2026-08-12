"use client";

import { useEffect, useMemo, useState } from "react";
import { computeTipCommission, formatCents, parseCents } from "@/lib/money";
import type { Sale } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import { useLang } from "@/components/pos/LangToggle";

/*
 * NOTHING HERE TOUCHES SEQ, AND THAT IS THE DESIGN.
 *
 * The card terminal's sequence number is the Nth card charge of the day. The
 * server counts, the server assigns, and this screen — the busiest one in the
 * shop, where a $15 flat has to be two taps — never asks about it. It used to
 * prefill a guess and ask the cashier to confirm it, which is a field, a read
 * of the terminal, and a chance to fat-finger a number that the register could
 * have known on its own.
 *
 * If the register's order and the terminal's batch ever disagree, they are put
 * right on Logs, against the actual list of the day's card charges. Not
 * here, mid-sale, from memory.
 */

/** One tender in a split. */
type TenderLine = { methodId: number; amount: string };

export function PaymentPanel({
  sale,
  methods,
  mechanics,
  commPerCents,
  commChargeCents,
  onError,
  onDone,
}: {
  sale: Sale;
  methods: PaymentMethod[];
  /** The technicians whose work is on this ticket, for attributing a tip. */
  mechanics: { id: number; name: string }[];
  commPerCents: number;
  commChargeCents: number;
  onError: (msg: string | null) => void;
  onDone: (saleId: number) => void;
}) {
  const { t: tr } = useLang();
  /**
   * Who this ticket's customer is billed to, fetched only when the account
   * tender is picked.
   *
   * THE MOMENT THE QUESTION ACTUALLY COMES UP. A driver hands over the keys and
   * says "put it on Williams" — and until now the only way to make that true
   * was to abandon the ticket, open the customer book, link them, and come
   * back. So the answer is offered here, on the one tender where it changes
   * where the money goes, and nowhere else: the panel stays a payment screen.
   */
  const [fleetBox, setFleetBox] = useState<{
    customerName: string;
    fleetId: number | null;
    fleetName: string | null;
    isFleet: boolean;
  } | null>(null);
  const [fleets, setFleets] = useState<{ id: number; name: string }[]>([]);
  const [fleetBusy, setFleetBusy] = useState(false);
  /**
   * Nothing is chosen until somebody chooses it.
   *
   * This used to open on the first method in the list, which is Cash. That is
   * the right guess most of the time and that is exactly what made it
   * dangerous: a ticket rung in four taps and closed without the cashier ever
   * looking at this row books a card sale as cash, and the two errors cancel
   * out on the total. Nothing is short, nothing fails to balance, and the only
   * trace is a drawer that comes up over at close by the amount of a card sale
   * — which reads as a counting mistake and gets recounted rather than found.
   *
   * A default that is usually correct is worse here than no default at all,
   * because being usually correct is what stops anybody checking. `Complete
   * sale` is already disabled while this is unset, so the cost is one tap that
   * was always meant to be deliberate.
   */
  const [methodId, setMethodId] = useState<number | null>(null);
  const [tip, setTip] = useState("");
  const [splitTip, setSplitTip] = useState(false);
  const [busy, setBusy] = useState(false);

  // Who the tip is for. On the overwhelmingly common one-technician ticket
  // there is nothing to ask, so it is answered for them; the picker only
  // appears when the ticket genuinely has more than one person on it.
  const [tipMechanicId, setTipMechanicId] = useState<number | "">(
    mechanics.length === 1 ? mechanics[0].id : "",
  );
  useEffect(() => {
    setTipMechanicId(mechanics.length === 1 ? mechanics[0].id : "");
  }, [mechanics]);

  // Paying with more than one tender. Off by default and deliberately tucked
  // away: it is a handful of tickets a week, and putting it in the main path
  // would slow down the hundreds that are one tap.
  const [splitTender, setSplitTender] = useState(false);
  const [lines, setLines] = useState<TenderLine[]>([]);

  const method = methods.find((m) => m.id === methodId);
  /** The house account, by code rather than by label — labels get renamed. */
  const isAccount = method?.code === "credit_account";

  /*
    Loaded when the account tender is picked, not on mount. Most tickets never
    touch the house account, and the panel opening should not cost two requests
    to answer a question nobody asked.
  */
  useEffect(() => {
    if (!isAccount || !sale.customer_id) return;
    let live = true;
    void (async () => {
      const [cRes, fRes] = await Promise.all([
        fetch(`/api/pos/customers/${sale.customer_id}`),
        fetch("/api/pos/fleets"),
      ]);
      if (!live || !cRes.ok || !fRes.ok) return;
      const c = await cRes.json();
      const f = await fRes.json();
      setFleets(f.fleets.map((x: { id: number; name: string }) => ({ id: x.id, name: x.name })));
      setFleetBox({
        customerName: c.customer.name,
        fleetId: c.customer.fleetId ?? null,
        fleetName: c.fleet?.name ?? null,
        isFleet: c.customer.isFleet === true,
      });
    })();
    return () => {
      live = false;
    };
  }, [isAccount, sale.customer_id]);
  const tipCents = Math.max(0, parseCents(tip) ?? 0);
  const commCents = useMemo(
    () => computeTipCommission(tipCents, commPerCents, commChargeCents),
    [tipCents, commPerCents, commChargeCents],
  );

  // Running the tip separately means the card is charged twice: the goods
  // first, then the tip plus its fee. The ticket total is the same either way.
  const splitting = splitTip && tipCents > 0 && !splitTender;
  const firstChargeCents = sale.subtotal_cents + (splitting ? 0 : tipCents + commCents);
  const secondChargeCents = splitting ? tipCents + commCents : 0;

  const allocatedCents = lines.reduce((s, l) => s + Math.max(0, parseCents(l.amount) ?? 0), 0);
  const remainingCents = sale.subtotal_cents - allocatedCents;

  function startSplit() {
    setSplitTender(true);
    setSplitTip(false);
    setTip("");
    // Two lines is the overwhelmingly common case — usually "the rest in cash".
    setLines([
      { methodId: methods[0]?.id ?? 0, amount: "" },
      { methodId: methods[1]?.id ?? methods[0]?.id ?? 0, amount: "" },
    ]);
  }

  function updateLine(i: number, patch: Partial<TenderLine>) {
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }

  async function complete() {
    if (busy) return;
    if (!splitTender && !method) return;
    onError(null);
    setBusy(true);

    const completeRes = await fetch(`/api/pos/sales/${sale.id}/complete`, {
      method: "POST",
    });
    const completed = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) {
      setBusy(false);
      onError(completed.error || "Could not close the ticket");
      return;
    }

    // Charge against the subtotal the server just froze, not the copy this
    // component rendered from — those are the same number only if nothing
    // changed underneath us, and the ledger has to match the frozen one.
    const frozenSubtotal = (completed.sale as Sale).subtotal_cents;

    if (splitTender) {
      /*
        Zero-amount lines are dropped rather than sent. An empty third tender
        left on the form is not a charge, and posting it would write a $0 row
        into the ledger and spend a sequence number on it — the phantom gap that
        makes a batch impossible to reconcile at the end of the night.
      */
      const parsed = lines.map((l) => ({
        methodId: l.methodId,
        amountCents: Math.max(0, parseCents(l.amount) ?? 0),
      }));
      const total = parsed.reduce((s, p) => s + p.amountCents, 0);

      /*
        Short is allowed; over is not.

        Refusing to close a ticket that was not paid in full was wrong, and it
        was wrong in the direction that hurts: the customer who leaves $20 on a
        $40 job is a real, ordinary afternoon in this shop, and the register's
        answer was to refuse. What actually happened then is that somebody rang
        a $20 ticket instead and the other $20 was never owed by anyone.

        Taking less closes the ticket at its real total and leaves the rest on
        the balance, where Today can chase it. Taking MORE is still refused,
        because at this point in the flow it is arithmetic that went wrong — the
        deliberate overpayment, a deposit against the next job, has its own path
        on the ticket once it is closed and says out loud that it is doing it.
      */
      if (total > frozenSubtotal) {
        setBusy(false);
        onError(
          `The ticket froze at ${formatCents(frozenSubtotal)} but the split adds up to ${formatCents(total)} — take the extra from Today if it is a deposit.`,
        );
        return;
      }

      // Each tender is its own ledger row. If a later one fails, the earlier
      // ones stand and the ticket keeps a balance — which is precisely what the
      // balance column is for, and it shows up on Today rather than vanishing.
      for (const [i, p] of parsed.entries()) {
        if (p.amountCents === 0) continue;
        const res = await fetch(`/api/pos/sales/${sale.id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...p, tipCents: 0 }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setBusy(false);
          onError(
            d.error ||
              `Tender ${i + 1} did not record — the ticket still owes the rest. Finish it from Today.`,
          );
          return;
        }
      }

      setBusy(false);
      onDone(sale.id);
      return;
    }

    const payRes = await fetch(`/api/pos/sales/${sale.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        methodId,
        amountCents: frozenSubtotal + (splitting ? 0 : tipCents + commCents),
        tipCents: splitting ? 0 : tipCents,
        mechanicId: tipMechanicId === "" ? null : tipMechanicId,
      }),
    });
    const paid = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      setBusy(false);
      // The ticket is closed but unpaid — it stays open on the balance report
      // rather than silently vanishing.
      onError(paid.error || "Ticket closed but the payment did not record");
      return;
    }

    if (splitting) {
      const tipRes = await fetch(`/api/pos/sales/${sale.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "tip_adjustment",
          methodId,
          tipCents,
          mechanicId: tipMechanicId === "" ? null : tipMechanicId,
        }),
      });
      const tipped = await tipRes.json().catch(() => ({}));
      if (!tipRes.ok) {
        setBusy(false);
        onError(
          tipped.error ||
            "The sale went through but the tip charge did not — add it from Today.",
        );
        return;
      }
    }

    setBusy(false);
    onDone(sale.id);
  }

  if (splitTender) {
    return (
      <div className="mt-4 pt-4 border-t border-black/10">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-brand-300">{tr("Split it, or take part of it")}</div>
          <button
            type="button"
            className="text-xs text-brand-400 underline"
            onClick={() => setSplitTender(false)}
          >{tr("Cancel split")}</button>
        </div>

        <div className="flex flex-col gap-2 mb-3">
          {lines.map((l, i) => {
            const lineMethod = methods.find((m) => m.id === l.methodId);
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={l.methodId}
                    onChange={(e) => updateLine(i, { methodId: Number(e.target.value) })}
                  >
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input text-right tabular-nums"
                    style={{ width: 110 }}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={l.amount}
                    onChange={(e) => updateLine(i, { amount: e.target.value })}
                  />
                  {lines.length > 2 && (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-800"
                      onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
                      aria-label={`Remove tender ${i + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {/* No SEQ box here, or anywhere on this screen — see the note
                    at the top of the file. Each card line takes the next number
                    of the day as the server writes it, in the order the tenders
                    are posted, which is the order the cards were charged. */}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between mb-1 text-sm">
          <button
            type="button"
            className="text-brand-400 underline"
            onClick={() =>
              setLines((ls) => [...ls, { methodId: methods[0]?.id ?? 0, amount: "" }])
            }
          >{tr("Add another tender")}</button>
          {/* One tap to dump the rest on the current line — the common last
              step, and it removes the mental arithmetic. */}
          {remainingCents > 0 && (
            <button
              type="button"
              className="text-brand-400 underline"
              onClick={() =>
                updateLine(lines.length - 1, {
                  amount: (
                    (Math.max(0, parseCents(lines[lines.length - 1].amount) ?? 0) +
                      remainingCents) /
                    100
                  ).toFixed(2),
                })
              }
            >{tr("Rest on last line")}</button>
          )}
        </div>

        <div className="flex justify-between text-sm text-brand-400 mt-2">
          <span>{tr("Ticket")}</span>
          <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
        </div>
        {/*
          Three states, and the short one is not an error.

          It is worded as what the shop will be left holding — "they will owe"
          rather than "still to allocate" — because those are the same number
          but only one of them is a fact about the customer. The cashier is
          about to close a ticket on it, and needs to read it as a decision
          rather than as a form they have not finished filling in.
        */}
        <div
          className={`flex justify-between text-lg font-semibold mb-3 ${
            remainingCents === 0
              ? "text-green-700"
              : remainingCents < 0
                ? "text-red-700"
                : "text-amber-700"
          }`}
        >
          <span>
            {remainingCents === 0
              ? "Covered"
              : remainingCents < 0
                ? "Over by"
                : "They will owe"}
          </span>
          <span className="tabular-nums">{formatCents(Math.abs(remainingCents))}</span>
        </div>

        <p className="text-xs text-brand-300 mb-3">
          Tips aren&apos;t offered on a split — add one from Today afterwards if they
          leave one.
        </p>

        <button
          type="button"
          className="btn btn-primary w-full"
          style={{ height: 52, fontSize: 17 }}
          onClick={() => void complete()}
          disabled={busy || allocatedCents <= 0 || remainingCents < 0}
        >
          {busy
            ? "Working…"
            : remainingCents > 0
              ? `Take ${formatCents(allocatedCents)} — they owe ${formatCents(remainingCents)}`
              : `Take ${lines.filter((l) => parseCents(l.amount)).length} payments`}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-black/10">
      <div className="grid grid-cols-2 gap-2 mb-3">
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMethodId(m.id)}
            className="btn text-sm"
            style={{
              height: 42,
              background: m.id === methodId ? "#0a2540" : "rgba(10,37,64,0.06)",
              color: m.id === methodId ? "#fff" : "#0a2540",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Billed to ────────────────────────────────────────────────────
          Only on the house account, only when the ticket has a customer, and
          only when that customer is not already a company. Everything else
          about fleets lives in the customer book; what belongs HERE is the one
          sentence a driver says at the counter. */}
      {isAccount && sale.customer_id && fleetBox && !fleetBox.isFleet && (
        <div className="mb-3 rounded-lg px-3 py-2" style={{ background: "rgba(31,122,140,0.08)" }}>
          <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "#146070" }}>
            {tr("Billed to")}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-brand-400">{fleetBox.customerName} →</span>
            <select
              className="input"
              style={{ height: 30, fontSize: 13, maxWidth: 220 }}
              value={fleetBox.fleetId ?? ""}
              disabled={fleetBusy}
              onChange={async (e) => {
                const fleetId = e.target.value ? Number(e.target.value) : null;
                setFleetBusy(true);
                const res = await fetch("/api/pos/fleets", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ customerId: sale.customer_id, fleetId }),
                });
                setFleetBusy(false);
                if (!res.ok) {
                  const d = await res.json().catch(() => ({}));
                  onError(d.error || "Could not set who this is billed to");
                  return;
                }
                onError(null);
                setFleetBox((b) =>
                  b
                    ? {
                        ...b,
                        fleetId,
                        fleetName: fleets.find((f) => f.id === fleetId)?.name ?? null,
                      }
                    : b,
                );
              }}
            >
              <option value="">{tr("Themselves")}</option>
              {fleets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {/* Said plainly, because it is the whole consequence of the picker
              and it is not obvious: the charge leaves this person's name and
              lands on the company's tab. */}
          {fleetBox.fleetId !== null && (
            <div className="text-xs mt-1" style={{ color: "#146070" }}>
              {tr("This charge goes on")} {fleetBox.fleetName ?? tr("the company")}
              {tr("'s account, with the driver's name on it.")}
            </div>
          )}
        </div>
      )}

      {method?.allows_tip === 1 && (
        <>
          <div className="flex gap-2 mb-2">
            <label className="text-xs text-brand-400 flex-1">{tr("Tip")}<input
                className="input mt-1 w-full text-right tabular-nums"
                inputMode="decimal"
                placeholder="0.00"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
              />
            </label>
            <div className="text-xs text-brand-400 flex-1">{tr("Terminal tax")}<div className="input mt-1 w-full text-right tabular-nums bg-black/5">
                {formatCents(commCents)}
              </div>
            </div>
          </div>

          {/*
            Who earned it. Only asked when the ticket cannot answer on its own:
            one technician on the ticket and it is filled in silently, none and
            there is nobody to ask about. Left blank the tip still goes through
            and simply counts for nobody, which is the truth rather than a
            guess -- but it says so, so it is a choice and not an oversight.
          */}
          {tipCents > 0 && mechanics.length > 1 && (
            <label className="text-xs text-brand-400 block mb-2">{tr("Tip goes to")}<select
                className="input mt-1 w-full"
                value={tipMechanicId}
                onChange={(e) =>
                  setTipMechanicId(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">{tr("Nobody in particular")}</option>
                {mechanics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tipCents > 0 && mechanics.length === 1 && (
            <p className="text-xs text-brand-300 mb-2">
              Tip goes to {mechanics[0].name}.
            </p>
          )}
          {tipCents > 0 && mechanics.length === 0 && (
            <p className="text-xs text-brand-300 mb-2">
              No technician on this ticket — this tip won&apos;t count for anyone.
            </p>
          )}

          {tipCents > 0 && method?.is_card === 1 && (
            <label className="flex items-center gap-2 text-xs text-brand-400 mb-2">
              <input
                type="checkbox"
                checked={splitTip}
                onChange={(e) => setSplitTip(e.target.checked)}
              />{tr("Run the tip as a second charge on the card")}</label>
          )}
        </>
      )}

      <div className="flex justify-between text-lg font-semibold text-brand-500 mb-1">
        <span>{splitting ? "Charge 1" : "Charge"}</span>
        <span className="tabular-nums">{formatCents(firstChargeCents)}</span>
      </div>
      {splitting && (
        <div className="flex justify-between text-lg font-semibold text-brand-500 mb-1">
          <span>{tr("Charge 2")}</span>
          <span className="tabular-nums">{formatCents(secondChargeCents)}</span>
        </div>
      )}
      <div className="mb-3" />

      <button
        type="button"
        className="btn btn-primary w-full"
        style={{ height: 52, fontSize: 17 }}
        onClick={() => void complete()}
        disabled={busy || !method}
      >
        {busy ? "Working…" : splitting ? "Take both charges" : "Complete sale"}
      </button>

      {/* A real button now, matching the one below it.
          Splitting a tender and taking a deposit are the same control and were
          hidden behind the same line of small underlined text, which read as a
          footnote — so a customer paying half in cash got rung as two tickets,
          or as one ticket for what they handed over. Both are ordinary here. */}
      {methods.length > 1 && (
        <button
          type="button"
          className="btn btn-outline w-full mt-2"
          style={{ height: 44, fontSize: 14 }}
          onClick={startSplit}
        >{tr("Split payment, or take only part of it")}</button>
      )}
    </div>
  );
}
