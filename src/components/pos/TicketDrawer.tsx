"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { usePosAuth } from "@/components/pos/PosShell";
import {
  apportionCents,
  computeTipCommission,
  formatCents,
  parseCents,
} from "@/lib/money";
import { PaymentPanel } from "@/components/pos/PaymentPanel";
import { PayoutPanel } from "@/components/pos/PayoutPanel";
import { TicketDetails, type KnownDetails } from "@/components/pos/TicketDetails";
import { FULFILLMENT_LABELS, FULFILLMENT_STAGES } from "@/lib/fulfillment";
import type { FulfillmentStatus, Sale, SaleItem } from "@/lib/sales";
import type { Payment, PaymentMethod, TipSplit } from "@/lib/payments";

type Mechanic = { id: number; name: string };
/** A technician on THIS ticket, with how much of it they did — which is what a
 *  tip split by work done divides by. */
type TicketMechanic = Mechanic & { lineCount: number };
type Detail = {
  sale: Sale;
  /** Who opened the ticket, as opposed to who worked it or who took the money. */
  cashierName: string | null;
  customer: KnownDetails["customer"];
  vehicle: KnownDetails["vehicle"];
  items: SaleItem[];
  payments: Payment[];
  /** Only those who worked this ticket — who a tip can be attributed to. */
  mechanics: TicketMechanic[];
  /** The whole floor — who a line can be moved to. */
  roster: Mechanic[];
};

export function TicketDrawer({
  saleId,
  methods,
  commPerCents,
  commChargeCents,
  onClose,
  onChanged,
}: {
  saleId: number;
  methods: PaymentMethod[];
  commPerCents: number;
  commChargeCents: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = usePosAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pos/sales/${saleId}`);
    if (!res.ok) {
      setError("Could not load that ticket");
      return;
    }
    setDetail(await res.json());
  }, [saleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(url, init);
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "That didn't work");
      return false;
    }
    await load();
    onChanged();
    return true;
  }

  return (
    <Modal
      open
      onClose={onClose}
      /* Labelled and sized up. The number alone at the top of the panel read as
         a code rather than a heading — on a screen where every other bold
         string is a service or a tender, "S-2026-000240" needs the word in
         front of it to say what kind of thing it is. Same navy as the primary
         buttons, which is the colour this app uses for "this is the subject",
         not decoration. */
      title={
        <span className="flex items-baseline gap-2 text-brand-500">
          <span className="text-xl font-bold tracking-wide">TICKET</span>
          {/* Amber while money is still owed on it, matching how the same
              number reads on Entries — so opening a ticket confirms what the
              list already said instead of quietly changing its mind about it.
              Owed, not "open": see the note beside the same colour on Entries. */}
          <span
            className="text-xl font-semibold tabular-nums"
            style={
              detail && detail.sale.balance_cents > 0
                ? { color: "#b45309" }
                : undefined
            }
          >
            {detail ? detail.sale.sale_no : "—"}
          </span>
        </span>
      }
      width={620}
    >
      {!detail ? (
        <div className="text-brand-300">Loading…</div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Provenance, above everything else on the ticket. Small, because it
              is read once and only when something is off — but present, because
              "who rang this" was previously answerable only from the audit log,
              which is not a place anybody goes mid-shift. */}
          {/* Reprint.

              There was no way to get a receipt back once a ticket was closed.
              The register offers one for sixty seconds after the sale and then
              takes the offer away, which covers exactly one case — the customer
              who wants paper and says so immediately — and none of the others:
              the one who comes back for it, the warranty claim, the fleet
              account that needs a copy, the printer that was out of paper. A
              receipt is a document the shop can always produce, so it is
              reachable from the ticket forever.

              A plain link, opening in its own tab, because the receipt page has
              its own Print button and its own paper layout. */}
          <div className="-mt-2 flex items-baseline gap-3 text-xs text-brand-300">
            <a
              href={`/pos/sale/${saleId}/receipt`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 font-semibold underline"
              style={{ color: "#2563eb" }}
            >
              Print receipt
            </a>
            <span>·</span>
            <span>
            Rung by {detail.cashierName ?? "someone no longer on the books"} on{" "}
            {detail.sale.business_date}
            {/* A void is the one thing about a ticket's state worth saying in
                words, because it means the whole thing did not happen. Whether
                it is "open" or "completed" is not said here any more — it is
                the distinction that was misleading people, and what is left of
                it is the amount below. */}
            {detail.sale.status === "voided" && " · voided"}
            {detail.sale.balance_cents > 0 &&
              ` · ${formatCents(detail.sale.balance_cents)} still owing`}
            </span>
          </div>

          {/* Reassignable on a live ticket by anyone who can ring one. A void
              has no credit left to move, so there it is read-only. */}
          <Lines
            items={detail.items}
            mechanics={detail.roster}
            editable={detail.sale.status !== "voided" && can("ringSale")}
            busy={busy}
            onReassign={(itemId, mechanicId, mechanicName) =>
              void send(`/api/pos/sales/${saleId}/items/${itemId}/mechanic`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mechanicId, mechanicName }),
              })
            }
          />
          <Money sale={detail.sale} payments={detail.payments} methods={methods} />

          {error && <div className="text-sm text-red-700">{error}</div>}

          {/*
            An open ticket is finished here, with the same panel the register
            uses -- not a second, simpler payment form that would drift away
            from it. A ticket started at the counter and abandoned when the
            customer went to move their car has to be closable from Today, or
            it sits open forever and every day's numbers are wrong after it.
          */}
          {detail.sale.status === "open" &&
            detail.items.some((i) => !i.voided) &&
            can("takePayment") &&
            (detail.sale.kind === "purchase" ? (
              <PayoutPanel
                sale={detail.sale}
                methods={methods}
                onError={setError}
                onDone={() => {
                  void load();
                  onChanged();
                }}
              />
            ) : (
              <PaymentPanel
                sale={detail.sale}
                methods={methods}
                mechanics={detail.mechanics}
                commPerCents={commPerCents}
                commChargeCents={commChargeCents}
                onError={setError}
                onDone={() => {
                  void load();
                  onChanged();
                }}
              />
            ))}

          {detail.sale.status === "open" && !detail.items.some((i) => !i.voided) && (
            <p className="text-sm text-brand-300">
              Nothing on this ticket to charge for. Void it, or add a line at the
              register.
            </p>
          )}

          {/*
            A completed ticket that still owes money -- a special order paid off
            in instalments, or a split where the second tender failed. Not the
            same path as closing a ticket: this one is already closed and its
            total is frozen, so all that is left is money against a balance.
          */}
          {detail.sale.status === "completed" &&
            detail.sale.balance_cents > 0 &&
            can("takePayment") && (
              <BalancePayment
                balanceCents={detail.sale.balance_cents}
                methods={methods}
                busy={busy}
                onPay={(methodId, amountCents) =>
                  send(`/api/pos/sales/${saleId}/payments`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ methodId, amountCents }),
                  })
                }
              />
            )}

          {/* Who the ticket is for — the same panel the register uses, not a
              second one that would drift away from it.

              This replaced a lone Note box. The note was the only thing about a
              ticket that could be fixed after the fact, which made no sense:
              the details most worth adding late are the ones nobody had time
              for at the counter. A $400 set of tires goes out with no name on
              it because there were three people waiting, and the moment there
              is a gap to put the name in — or the customer rings back with
              their number — there was nowhere to put it. The note field is
              still here; it is inside this panel, along with everything else.

              Deliberately NOT restricted to open tickets. A completed ticket's
              totals are frozen and stay frozen — this writes nothing that
              touches money, and "who was this for" is a question answered late
              far more often than it is answered at the counter. Voided is the
              exception: there is nothing to be for. */}
          {can("editOwnOpenSale") && detail.sale.status !== "voided" && (
            <TicketDetails
              sale={detail.sale}
              /* Zero, so the panel never opens itself on amount here. The
                 register's threshold exists to catch a big ticket while the
                 customer is still standing there; in the drawer the decision
                 has already been made by whether there is anything to show. */
              thresholdCents={0}
              known={{ customer: detail.customer, vehicle: detail.vehicle }}
              /* Folded away, always — even when there IS a customer on the
                 ticket. It used to open itself whenever it had something to
                 show, which sounded right and read wrong: the drawer is
                 opened to take a payment, and seven text boxes unfurling
                 above the Amount field pushed the one thing anybody came here
                 for off the bottom of the screen. What the ticket knows is a
                 tap away and the button says so. */
              startOpen={false}
              /* "Details", flat. The register's wording is an instruction to
                 somebody with a customer at the counter; here the ticket is an
                 hour old and there is nobody to take anything from. */
              label="Details"
              /* Full size, so it sits level with Pay and Void rather than
                 looking like a shrunken version of them. */
              compact={false}
              onSaved={() => {
                void load();
                onChanged();
              }}
              onError={setError}
            />
          )}

          {/* Ordering a tire in is decided AFTER the line is rung, not before:
              the size goes on the ticket, the rack gets checked, and only then
              does it turn out there are two of that size and they want four.
              So the control is here on the ticket rather than a choice made
              when it was opened. */}
          {can("manageSpecialOrders") &&
            detail.sale.status !== "voided" &&
            detail.sale.kind !== "purchase" && (
              <SpecialOrderPanel
                sale={detail.sale}
                busy={busy}
                canReverse={can("reverseSpecialOrder")}
                onSend={(body) =>
                  send(`/api/pos/sales/${saleId}/fulfillment`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  })
                }
              />
            )}

          {/* SEQ is not edited here any more. It lives on the payment, not the
              ticket — a split tender has two swipes and two sequence numbers,
              which one field on the header cannot hold, and nothing ever read
              the header's copy anyway. The place to fix one is Entries, where
              the whole day's charges are listed against the batch being
              reconciled. */}

          {detail.sale.status === "completed" && can("takePayment") && (
            <TipAdjustment
              methods={methods}
              mechanics={detail.mechanics}
              commPerCents={commPerCents}
              commChargeCents={commChargeCents}
              busy={busy}
              onAdd={(methodId, tipCents, mechanicId, split) =>
                send(`/api/pos/sales/${saleId}/payments`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    kind: "tip_adjustment",
                    methodId,
                    tipCents,
                    mechanicId,
                    split,
                  }),
                })
              }
            />
          )}

          {detail.sale.status !== "voided" && can("voidSale") && (
            <VoidTicket
              busy={busy}
              onVoid={async (reason) => {
                const ok = await send(`/api/pos/sales/${saleId}/void`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reason }),
                });
                return ok;
              }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * The ticket's lines, each with the mechanic it pays.
 *
 * The mechanic used to be invisible here, which made this drawer the one place
 * you could look at a ticket in full and still not see the thing most likely to
 * be wrong about it. Now it is a dropdown: whoever opened the ticket can see
 * the attribution and fix it in one move, without leaving the ticket or finding
 * a manager.
 *
 * Saved on change rather than behind an edit/save pair. There is exactly one
 * field, its old value is still on screen if the wrong name is picked, and a
 * save button here would be a second click on the most common correction in the
 * shop. A voided line is text, not a control -- there is no credit on it to
 * move.
 */
function Lines({
  items,
  mechanics,
  editable,
  busy,
  onReassign,
}: {
  items: SaleItem[];
  mechanics: Mechanic[];
  editable: boolean;
  busy: boolean;
  onReassign: (
    itemId: number,
    mechanicId: number | null,
    mechanicName: string | null,
  ) => void;
}) {
  /**
   * What this line says about who did it, in words.
   *
   * Three answers, not two: an employee, a written-in Other, or nobody. A line
   * rung against Other with "Miguel" on it must not read as "—" here, because
   * this drawer is where somebody goes to find out what happened on a ticket,
   * and a blank would send them to void it and ring it again.
   */
  const labelOf = (i: SaleItem) =>
    i.mechanic_id !== null
      ? (mechanics.find((m) => m.id === i.mechanic_id)?.name ?? "Gone")
      : (i.mechanic_name ?? null);
  const nameOf = (id: number | null) =>
    id === null ? null : (mechanics.find((m) => m.id === id)?.name ?? "Gone");
  return (
    <table className="w-full text-sm">
      <tbody>
        {items.map((i) => (
          <tr key={i.id} className="border-t border-black/5">
            <td className={`py-1.5 ${i.voided ? "line-through text-brand-300" : ""}`}>
              {i.qty > 1 ? `${i.qty}× ` : ""}
              {i.description}
            </td>
            <td className="py-1.5 pl-2" style={{ width: 150 }}>
              {editable && !i.voided ? (
                <select
                  className="input py-1 text-xs w-full"
                  title="Who did this line"
                  disabled={busy}
                  // "other" is its own value rather than an absent id, because
                  // Other and nobody are both stored with a null mechanic_id
                  // and a select keyed only on the id would collapse them —
                  // which would silently strip the name off every Other line
                  // the first time anything on the row was touched.
                  value={
                    i.mechanic_id !== null
                      ? i.mechanic_id
                      : i.mechanic_name !== null
                        ? "other"
                        : ""
                  }
                  onChange={(e) =>
                    onReassign(
                      i.id,
                      e.target.value === "" || e.target.value === "other"
                        ? null
                        : Number(e.target.value),
                      // Reassigning to Other from here keeps whatever was
                      // already written on it, so picking the wrong row and
                      // picking back does not quietly erase a name.
                      e.target.value === "other" ? (i.mechanic_name ?? "") : null,
                    )
                  }
                >
                  <option value="">No mechanic</option>
                  <option value="other">
                    {i.mechanic_name && i.mechanic_name !== "Other"
                      ? `Other — ${i.mechanic_name}`
                      : "Other"}
                  </option>
                  {/* A mechanic who has since been deactivated still holds the
                      lines they worked. Their name has to stay in the list, or
                      the select would fall back to "No mechanic" and the first
                      touch of any other control on the row would write that
                      back — quietly stripping the credit off an old ticket. */}
                  {!mechanics.some((m) => m.id === i.mechanic_id) &&
                    i.mechanic_id !== null && (
                      <option value={i.mechanic_id}>{nameOf(i.mechanic_id)}</option>
                    )}
                  {mechanics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-brand-300">{labelOf(i) ?? "—"}</span>
              )}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {formatCents(i.line_total_cents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Money({
  sale,
  payments,
  methods,
}: {
  sale: Sale;
  payments: Payment[];
  methods: PaymentMethod[];
}) {
  const label = (id: number) => methods.find((m) => m.id === id)?.label ?? "Payment";
  return (
    <div className="rounded-xl bg-black/[0.03] p-3 text-sm">
      <Row label="Subtotal" value={formatCents(sale.subtotal_cents)} />
      {/* Broken out here, unlike on the customer's receipt: this is the shop's
          own screen, and the person looking at it is the one who needs to know
          what was kept back. */}
      {sale.tip_cents !== 0 && <Row label="Tip" value={formatCents(sale.tip_cents)} />}
      {sale.comm_cents !== 0 && (
        <Row label="Terminal tax" value={formatCents(sale.comm_cents)} />
      )}
      <Row label="Total" value={formatCents(sale.total_cents)} strong />
      <div className="mt-2 pt-2 border-t border-black/10">
        {payments.map((p) => (
          <Row
            key={p.id}
            /* No SEQ on this line. It is the card batch's business, it means
               nothing without the batch beside you, and it is read and fixed
               in one place: the card charges on Entries. */
            label={`${label(p.method_id)}${p.kind !== "payment" ? ` · ${p.kind.replace("_", " ")}` : ""}`}
            value={formatCents(p.amount_cents)}
            muted
          />
        ))}
        {payments.length === 0 && (
          <div className="text-brand-300">Nothing collected on this ticket.</div>
        )}
      </div>
      {sale.balance_cents !== 0 && (
        <Row label="Balance due" value={formatCents(sale.balance_cents)} strong />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-0.5 ${strong ? "font-semibold text-brand-500" : muted ? "text-brand-400" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Notes are editable after the fact on purpose. The reason a ticket was priced
 * the way it was is often remembered an hour later, and the alternative -- a
 * cashier not writing it down at all -- is worse. Every edit is audited.
 */
/**
 * The forgotten-tip fix, at the counter. This books an adjustment against the
 * original ticket instead of ringing the phantom second sale the spreadsheet
 * forced on them.
 */
function TipAdjustment({
  methods,
  mechanics,
  commPerCents,
  commChargeCents,
  busy,
  onAdd,
}: {
  methods: PaymentMethod[];
  mechanics: TicketMechanic[];
  commPerCents: number;
  commChargeCents: number;
  busy: boolean;
  onAdd: (
    methodId: number,
    tipCents: number,
    mechanicId: number | null,
    split: TipSplit | null,
  ) => Promise<boolean>;
}) {
  const tipMethods = useMemo(() => methods.filter((m) => m.allows_tip === 1), [methods]);
  const [methodId, setMethodId] = useState<number>(tipMethods[0]?.id ?? 0);
  const [amount, setAmount] = useState("");
  /**
   * One control for two different answers, because to the person at the counter
   * it is one question — "who is this for?" — and two selects side by side, one
   * naming people and one naming rules, would be two questions where the shop
   * has one. "" is nobody, "equal" and "lines" are splits, anything else is an
   * employee id.
   */
  const [goesTo, setGoesTo] = useState<string>(
    mechanics.length === 1 ? String(mechanics[0].id) : "",
  );

  const tipCents = Math.max(0, parseCents(amount) ?? 0);
  const commCents = computeTipCommission(tipCents, commPerCents, commChargeCents);
  const split: TipSplit | null =
    goesTo === "equal" || goesTo === "lines" ? goesTo : null;

  /**
   * What each person is about to be credited, worked out with the same function
   * the ledger uses. Shown before the button is pressed rather than after,
   * because a split is the one thing on this panel a cashier cannot check by
   * arithmetic in their head once odd amounts are involved — and a tip that
   * lands somewhere unexpected is discovered on payday.
   */
  const preview = useMemo(() => {
    if (!split || tipCents <= 0) return null;
    const weights = mechanics.map((m) => (split === "equal" ? 1 : m.lineCount));
    const parts = apportionCents(tipCents, weights);
    return mechanics.map((m, i) => ({ name: m.name, cents: parts[i] }));
  }, [split, tipCents, mechanics]);

  if (tipMethods.length === 0) return null;

  return (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        Tip added later
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-brand-400 flex-1">
          Amount
          <input
            className="input mt-1 w-full text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-brand-400 flex-1">
          Tender
          <select
            className="input mt-1 w-full"
            value={methodId}
            onChange={(e) => setMethodId(Number(e.target.value))}
          >
            {tipMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {/* No SEQ field. A late tip on a card is a real swipe and does get a
            sequence number, but the server takes the next one of the day when
            the row is written. Asking the cashier for it here only ever meant
            asking them to retype something the register already knew. If the
            slips were keyed in out of order, they get straightened out on
            Entries, which is the one screen where the batch is in front of
            somebody and the one place SEQ is edited. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || tipCents <= 0}
          onClick={async () => {
            if (
              await onAdd(
                methodId,
                tipCents,
                split !== null || goesTo === "" ? null : Number(goesTo),
                split,
              )
            ) {
              setAmount("");
            }
          }}
        >
          Add
        </button>
      </div>

      {/* Same rule as the register: only asked when the ticket has more than
          one technician on it and so cannot answer for itself. */}
      {mechanics.length > 1 && (
        <label className="text-xs text-brand-400 block mt-2">
          Tip goes to
          <select
            className="input mt-1 w-full"
            value={goesTo}
            onChange={(e) => setGoesTo(e.target.value)}
          >
            <option value="">Nobody in particular</option>
            {/* The splits sit above the names, because when two people worked a
                ticket a shared tip is the normal case and one person taking all
                of it is the exception. */}
            <option value="equal">Split equally between all {mechanics.length}</option>
            <option value="lines">
              Split by work done ({mechanics.map((m) => m.lineCount).join(" / ")} lines)
            </option>
            {mechanics.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name} — all of it
              </option>
            ))}
          </select>
        </label>
      )}

      {preview && (
        <div className="mt-2 text-xs text-brand-400 flex flex-wrap gap-x-4 gap-y-1">
          {preview.map((p) => (
            <span key={p.name}>
              {p.name} <strong className="tabular-nums">{formatCents(p.cents)}</strong>
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-brand-300 mt-2">
        Charges {formatCents(tipCents + commCents)} — terminal tax{" "}
        {formatCents(commCents)}
        {mechanics.length === 1 ? `, ${mechanics[0].name} gets the rest` : ""}. Books to
        today, on this ticket.
        {/* Said out loud because it is the thing a technician would otherwise
            suspect: the tax does not grow because a tip was shared. */}
        {split && " The terminal tax is worked out on the whole tip, then shared too."}
      </p>
    </div>
  );
}

/**
 * Money against a ticket that is already closed and still owes -- a special
 * order being paid off, or a split tender where the second leg failed.
 *
 * Separate from the payment panel on purpose. That one's job is to freeze a
 * total and close a ticket; this one must do neither, because the ticket is
 * closed and its total is frozen already. Merging them would mean a component
 * that sometimes completes a sale and sometimes must not.
 */
function BalancePayment({
  balanceCents,
  methods,
  busy,
  onPay,
}: {
  balanceCents: number;
  methods: PaymentMethod[];
  busy: boolean;
  onPay: (methodId: number, amountCents: number) => Promise<boolean>;
}) {
  const [methodId, setMethodId] = useState<number>(methods[0]?.id ?? 0);
  // Prefilled with the whole balance, because paying it off is what nearly
  // everyone is here to do. Overwritten when it's a part payment.
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2));

  const cents = Math.max(0, parseCents(amount) ?? 0);
  const over = cents > balanceCents;

  return (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
        Take a payment — {formatCents(balanceCents)} outstanding
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-brand-400 flex-1">
          Amount
          <input
            className="input mt-1 w-full text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-brand-400 flex-1">
          Tender
          <select
            className="input mt-1 w-full"
            value={methodId}
            onChange={(e) => setMethodId(Number(e.target.value))}
          >
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {/* No SEQ field. A card payment against a balance is a real swipe and
            does get a sequence number — the server hands it the next one of the
            day, like every other charge. Nobody types one anywhere. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || cents <= 0}
          onClick={async () => {
            if (await onPay(methodId, cents)) setAmount("");
          }}
        >
          Take
        </button>
      </div>
      {/* Allowed, but said out loud. Overpaying is usually a typo; occasionally
          it is a deposit on the next job, and refusing it outright would send
          that money somewhere the books cannot see. */}
      {over && (
        <p className="text-xs text-amber-700 mt-2">
          That is {formatCents(cents - balanceCents)} more than is owed — the ticket
          will end up in credit.
        </p>
      )}
    </div>
  );
}

function VoidTicket({
  busy,
  onVoid,
}: {
  busy: boolean;
  onVoid: (reason: string) => Promise<boolean>;
}) {
  const [arming, setArming] = useState(false);
  const [reason, setReason] = useState("");

  if (!arming) {
    return (
      <button
        type="button"
        className="text-sm text-red-700 hover:text-red-900 underline self-center"
        onClick={() => setArming(true)}
      >
        Void this ticket
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-red-50 p-3">
      <div className="text-sm text-red-800 mb-2">
        Voiding reverses every payment on this ticket. Nothing is deleted.
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-red-800 flex-1">
          Reason
          <input
            className="input mt-1 w-full"
            placeholder="Why is this being voided?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          style={{ background: "#a71d24", color: "#fff" }}
          disabled={busy || !reason.trim()}
          onClick={() => void onVoid(reason.trim())}
        >
          Void
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Whether this ticket is a tire the shop has promised to get, and how far along
 * that promise is.
 *
 * Deliberately small and near the bottom of the drawer. Most tickets are not
 * special orders and never will be — a $15 flat repair rung in eight seconds
 * should not have a lifecycle staring at it — so when the answer is no, this is
 * one quiet button and nothing else.
 *
 * Once it IS an order, the next stage is offered here as well as on the board,
 * because the moment the customer is standing at the counter collecting the
 * tire is the moment the ticket is open on screen, and sending somebody to
 * another tab to say so is how a board stops being true.
 */
function SpecialOrderPanel({
  sale,
  busy,
  canReverse,
  onSend,
}: {
  sale: Sale;
  busy: boolean;
  canReverse: boolean;
  onSend: (body: { marked?: boolean; status?: FulfillmentStatus }) => Promise<boolean>;
}) {
  const status = sale.fulfillment_status;

  /**
   * A ticket that is not an order shows nothing at all.
   *
   * The "Ordering this in" button that used to sit here is gone, along with the
   * Orders tab it fed. Nearly every ticket in this shop is a flat repair, and a
   * control offering to give one a multi-stage lifecycle was on screen a
   * thousand times for every time it was wanted.
   *
   * The rest of this panel stays. Any ticket already part-way through — a tire
   * on order with a deposit against it — keeps its status and its buttons, so
   * nothing already promised to a customer gets stranded with no way to
   * advance or cancel it. Nothing new can enter that state from here.
   */
  if (status === "none") return null;

  const i = (FULFILLMENT_STAGES as readonly string[]).indexOf(status);
  const next =
    i >= 0 && i < FULFILLMENT_STAGES.length - 1 ? FULFILLMENT_STAGES[i + 1] : null;

  return (
    <div
      className="rounded-xl px-3 py-2.5 flex items-center gap-3 flex-wrap"
      style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.25)" }}
    >
      <div className="flex-1 min-w-[10rem]">
        <div className="text-xs uppercase tracking-wider text-amber-800">
          Special order
        </div>
        <div className="font-semibold text-amber-900">{FULFILLMENT_LABELS[status]}</div>
      </div>
      {next && (
        <button
          type="button"
          className="btn btn-primary text-sm"
          disabled={busy}
          onClick={() => void onSend({ status: next })}
        >
          {FULFILLMENT_LABELS[next]}
        </button>
      )}
      {/* Un-marking is offered only while nothing has been ordered yet — after
          that the way out is Cancel, on the board, which leaves a trail and is
          a manager's to pull. A deposit stranded on a ticket that has quietly
          stopped appearing on any list is the failure this prevents. */}
      {status === "pending" && (
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={busy}
          onClick={() => void onSend({ marked: false })}
        >
          Not an order
        </button>
      )}
      {canReverse && status !== "cancelled" && status !== "pending" && (
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={busy}
          onClick={() => void onSend({ status: "cancelled" })}
        >
          Cancel order
        </button>
      )}
    </div>
  );
}
