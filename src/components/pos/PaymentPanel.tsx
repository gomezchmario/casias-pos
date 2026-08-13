"use client";

import { useEffect, useMemo, useState } from "react";
import { computeTipCommission, formatCents, parseCents } from "@/lib/money";
import type { Sale } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import { useLang } from "@/components/pos/LangToggle";
import { usePosAuth } from "@/components/pos/PosShell";
import { DiscountTicket } from "@/components/pos/DiscountTicket";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

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
  roster,
  commPerCents,
  commChargeCents,
  onTenderChange,
  onError,
  onDone,
  onSaleChanged,
}: {
  sale: Sale;
  methods: PaymentMethod[];
  /** The technicians whose work is on this ticket, for attributing a tip. */
  mechanics: { id: number; name: string }[];
  /**
   * The whole roster, used only when the ticket names nobody.
   *
   * Kept separate from `mechanics` on purpose. Fifteen names offered on a
   * ticket that already says who did the work is how the wrong one gets
   * picked, so the short list wins whenever there is one; this is the fallback
   * for the ticket that has nobody on it at all, where the alternative is a
   * tip credited to nobody. See the guard in `takePayment`.
   */
  roster?: { id: number; name: string }[];
  commPerCents: number;
  commChargeCents: number;
  /** True while the house account is the chosen tender — see the register. */
  onTenderChange?: (isAccount: boolean) => void;
  onError: (msg: string | null) => void;
  onDone: (saleId: number) => void;
  /**
   * The ticket changed underneath the panel — a discount came off it.
   *
   * The total on this panel is the number the payment is taken against, so it
   * cannot be allowed to go stale by even one render: a cashier who takes a
   * discount off and then presses a Complete button still showing the old
   * figure has charged the customer the undiscounted price.
   */
  onSaleChanged?: (sale: Sale) => void;
}) {
  const { t: tr } = useLang();
  const { can } = usePosAuth();
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
  /**
   * The cashier's ceiling on a discount, or null for somebody who has none.
   *
   * `undefined` while it is being asked for, which is why the control waits
   * for it: rendering a discount box before the ceiling is known would offer a
   * limit of nothing and then refuse whatever was typed into it.
   */
  const [discountMax, setDiscountMax] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!can("discountSale")) return;
    void (async () => {
      const res = await fetch(`/api/pos/sales/${sale.id}/discount`);
      if (res.ok) setDiscountMax((await res.json()).maxCents ?? null);
    })();
  }, [can, sale.id]);
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
  useEffect(() => {
    onTenderChange?.(isAccount);
  }, [isAccount, onTenderChange]);

  /**
   * The car on this ticket, fetched only when the house account is chosen.
   *
   * The panel does not otherwise care which car it is — it is taking money.
   * The account is the exception: a company being billed for work on eleven
   * trucks needs them told apart on the statement months later, and a plate
   * changes hands where a VIN does not. Asked for at the one moment it matters
   * rather than loaded on every ticket.
   */
  const [ticketVehicle, setTicketVehicle] = useState<
    { id: number; vin: string | null; label: string } | null | undefined
  >(undefined);
  useEffect(() => {
    if (!isAccount) return;
    void (async () => {
      const res = await fetch(`/api/pos/sales/${sale.id}`);
      if (!res.ok) { setTicketVehicle(null); return; }
      const d = await res.json();
      const v = d.vehicle;
      setTicketVehicle(
        v
          ? {
              id: v.id,
              vin: v.vin ?? null,
              label: [v.year, v.make, v.model].filter(Boolean).join(" ") || v.plate || "the vehicle",
            }
          : null,
      );
    })();
  }, [isAccount, sale.id]);

  /** Asked once, before the charge goes on the tab. */
  const [vinAsk, setVinAsk] = useState(false);
  const [vinAcked, setVinAcked] = useState(false);

  const tipCents = Math.max(0, parseCents(tip) ?? 0);

  /**
   * Who this tip can go to: the ticket's own technicians, or the whole roster
   * when the ticket names none.
   */
  const tipCandidates = mechanics.length > 0 ? mechanics : (roster ?? []);
  /**
   * A tip with nobody named cannot be taken — the server refuses it, so the
   * button is disabled rather than letting somebody press it and read an error
   * with a customer's card already in their hand.
   */
  const tipNeedsAName = tipCents > 0 && tipMechanicId === "";
  const commCents = useMemo(
    () => computeTipCommission(tipCents, commPerCents, commChargeCents),
    [tipCents, commPerCents, commChargeCents],
  );

  /*
    WHAT THE CUSTOMER OWES FOR THE GOODS, WHICH IS NOT THE SUBTOTAL.

    This panel charged sale.subtotal_cents — the price before any discount — so
    a discount was recorded on the ticket and then simply not taken off the
    money. S-2026-000497 was rung at $160, discounted to $140, and charged
    $160: the customer paid full price, and the ticket was left reading $20
    overpaid because the payment exceeded a total that had come down.

    Not total_cents either, which already includes the tip and the commission —
    this panel adds those itself a line below, and using it would charge the tip
    twice. The goods are the subtotal less the discount, and every figure on
    this panel that means "the ticket" is that number.
  */
  const goodsCents = sale.subtotal_cents - sale.discount_cents;

  // Running the tip separately means the card is charged twice: the goods
  // first, then the tip plus its fee. The ticket total is the same either way.
  const splitting = splitTip && tipCents > 0 && !splitTender;
  const firstChargeCents = goodsCents + (splitting ? 0 : tipCents + commCents);
  const secondChargeCents = splitting ? tipCents + commCents : 0;

  const allocatedCents = lines.reduce((s, l) => s + Math.max(0, parseCents(l.amount) ?? 0), 0);
  const remainingCents = goodsCents - allocatedCents;

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

    /*
      A VIN IS NOT REQUIRED, AND IT IS ALMOST ALWAYS WANTED.

      Only on the house account, because that is the tender where the shop is
      going to have to say months later which of a company's eleven trucks the
      work was on — and a plate changes hands while a VIN does not.

      An ask rather than a refusal, and the reason is on the screen: this shop
      tires lawnmowers, skid steers and trailers, and plenty of them have no VIN
      to give. A rule that cannot be satisfied is a rule people learn to defeat.
      So it stops once, says why, and takes yes for an answer.
    */
    if (isAccount && !vinAcked && ticketVehicle !== undefined && !ticketVehicle?.vin) {
      setVinAsk(true);
      return;
    }

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

    // Charge against the figure the server just froze, not the copy this
    // component rendered from — those are the same number only if nothing
    // changed underneath us, and the ledger has to match the frozen one.
    //
    // Less the discount, for the reason given at goodsCents: the frozen
    // subtotal is what the goods cost, not what is owed for them.
    const frozen = completed.sale as Sale;
    const frozenSubtotal = frozen.subtotal_cents - frozen.discount_cents;

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
          <span className="tabular-nums">{formatCents(goodsCents)}</span>
        </div>
        {/* Named out loud when there is one. A ticket that silently reads less
            than the lines above it is a ticket somebody re-adds by hand. */}
        {sale.discount_cents > 0 && (
          <div className="flex justify-between text-xs text-brand-300">
            <span>{tr("after discount of")} {formatCents(sale.discount_cents)}</span>
            <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
          </div>
        )}
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
          disabled={busy || allocatedCents <= 0 || remainingCents < 0 || tipNeedsAName}
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

      {/*
        THE DISCOUNT LIVES BEHIND "OTHER".

        It had no home on the register at all — the only way to take money
        off a ticket was to open it again from Logs afterwards, which is
        both slower and a different screen from the one the customer is
        standing at. It sits under Other rather than beside every tender
        because a discount is not a way of paying: putting it next to Cash
        and Card would make it look like one, and the tender row is the one
        place on this panel that must not gain a fourth meaning.

        Applying one re-reads the ticket, so the total the Complete button
        charges against is the discounted one.
      */}
      {method?.code === "other" &&
        can("discountSale") &&
        discountMax !== undefined && (
          <div className="mb-2">
            <DiscountTicket
              subtotalCents={sale.subtotal_cents}
              currentCents={sale.discount_cents}
              maxCents={discountMax}
              busy={busy}
              onSet={async (amountCents, reason) => {
                const res = await fetch(`/api/pos/sales/${sale.id}/discount`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ amountCents, reason }),
                });
                const d = await res.json().catch(() => ({}));
                if (!res.ok) {
                  onError(d.error || "Could not take that off");
                  return false;
                }
                onError(null);
                if (d.sale) onSaleChanged?.(d.sale);
                return true;
              }}
            />
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
          {/* One technician on the ticket and it is answered for them. Any
              other number and it is asked, including none — where the list is
              the whole roster, because "nobody" is not an answer the shop
              accepts any more. */}
          {tipCents > 0 && mechanics.length !== 1 && (
            <label className="text-xs text-brand-400 block mb-2">
              {mechanics.length === 0
                ? tr("Nobody is on this ticket — who is the tip for?")
                : tr("Tip goes to")}
              <select
                className="input mt-1 w-full"
                value={tipMechanicId}
                style={tipNeedsAName ? { borderColor: "#f59e0b" } : undefined}
                onChange={(e) =>
                  setTipMechanicId(e.target.value === "" ? "" : Number(e.target.value))
                }
              >
                <option value="">{tr("Choose somebody…")}</option>
                {tipCandidates.map((m) => (
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
        disabled={busy || !method || tipNeedsAName}
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
      <ConfirmModal
        open={vinAsk}
        onCancel={() => setVinAsk(false)}
        onConfirm={() => {
          setVinAsk(false);
          setVinAcked(true);
          void complete();
        }}
        title="No VIN on this vehicle"
        confirmLabel="Put it on the account anyway"
        cancelLabel="Go back and add it"
        acknowledge="I know this charge will have no VIN against it"
      >
        <p>
          {ticketVehicle
            ? `There is no VIN recorded for ${ticketVehicle.label}.`
            : "There is no vehicle on this ticket at all."}
        </p>
        <p className="mt-2">
          On a company account this is the one thing that tells eleven trucks
          apart on a statement months from now. A plate changes hands; a VIN does
          not. <strong>If this is a fleet customer, go back and add it.</strong>
        </p>
        <p className="mt-2 text-brand-400">
          Carry on if there is genuinely no VIN to give — a lawnmower, a trailer,
          a skid steer.
        </p>
      </ConfirmModal>

    </div>
  );
}
