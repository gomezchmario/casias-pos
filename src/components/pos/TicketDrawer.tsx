"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
import { DiscountTicket } from "@/components/pos/DiscountTicket";
import { TicketStatusPicker } from "@/components/pos/TicketStatusPicker";
import type { Sale, SaleItem } from "@/lib/sales";
import type { Payment, PaymentMethod, TipSplit } from "@/lib/payments";
import { useLang } from "@/components/pos/LangToggle";

type Mechanic = { id: number; name: string };
/** A technician on THIS ticket, with how much of it they did — which is what a
 *  tip split by work done divides by. */
type TicketMechanic = Mechanic & { lineCount: number };
type Detail = {
  sale: Sale;
  /** Who opened the ticket, as opposed to who worked it or who took the money. */
  cashierName: string | null;
  today: string;
  customer: KnownDetails["customer"];
  vehicle: KnownDetails["vehicle"];
  items: SaleItem[];
  payments: Payment[];
  /** Only those who worked this ticket — who a tip can be attributed to. */
  mechanics: TicketMechanic[];
  /** The whole floor — who a line can be moved to. */
  roster: Mechanic[];
  /** The lines that are tires, and so the only ones somebody can be credited
   *  for fitting. Resolved server-side; see the route. */
  tireItemIds: number[];
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
  const { t: tr } = useLang();
  const { can } = usePosAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The cashier ceiling on a discount. Null for anybody who has no ceiling. */
  const [discountMax, setDiscountMax] = useState<number | null | undefined>(undefined);
  /**
   * Show the corrections, or show the ticket as it stands. OFF by default.
   *
   * A ticket that has been corrected a few times carries every step of it: the
   * payment that was wrong, the reversal that took it back, the one that
   * replaced it, and a struck line for anything taken off. All of that is the
   * truth and none of it can be deleted — it is an append-only ledger and that
   * is the point — but it is not what somebody opening the ticket is asking.
   * They want to know what this ticket IS: what was sold, what was paid, what
   * is owed. S-2026-000542 had seven payment rows adding up to three live ones.
   *
   * So the default view nets it out and the eye brings the working back. The
   * figures are identical either way — hiding a reversal also hides the row it
   * reverses, and the pair sums to zero — so the balance can never depend on
   * which way this is set. That is the one property that makes hiding safe.
   */
  const [showFixes, setShowFixes] = useState(false);

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

  // The ceiling is a shop setting, so it is asked for rather than assumed. Only
  // by somebody who can discount at all — for everyone else the control is not
  // drawn and the answer would be unused.
  useEffect(() => {
    if (!can("discountSale")) return;
    void (async () => {
      const res = await fetch(`/api/pos/sales/${saleId}/discount`);
      if (!res.ok) return;
      setDiscountMax((await res.json()).maxCents ?? null);
    })();
  }, [saleId, can]);

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
              number reads on Logs — so opening a ticket confirms what the
              list already said instead of quietly changing its mind about it.
              Owed, not "open": see the note beside the same colour on Logs. */}
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
      headerAction={
        /*
          An eye, not a checkbox with a sentence: it sits in a header six
          pixels from the close button and has to be readable at a glance
          without a label. Dimmed when off, solid and boxed when on, so the
          state is visible from across the counter.
        */
        <button
          type="button"
          onClick={() => setShowFixes((v) => !v)}
          aria-pressed={showFixes}
          className={`td-eye${showFixes ? " is-on" : ""}`}
          title={
            showFixes
              ? tr("Hide the corrections and show the ticket as it stands")
              : tr("Show every correction made to this ticket")
          }
          aria-label={showFixes ? tr("Hide corrections") : tr("Show corrections")}
        >
          {showFixes ? "👁" : "👁"}
        </button>
      }
      width={620}
    >
      {!detail ? (
        <div className="text-brand-300">{tr("Loading…")}</div>
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
            >{tr("Print receipt")}</a>
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

          {/* The sticky note that used to live on the monitor.
              Same yellow and same pin as the board on Main, because it is the
              same kind of message — one person telling the next what they need
              to know — only about this ticket instead of about the day.

              NOT the details note further down. That one describes the job and
              prints on the customer's receipt; this never leaves the building.
              Anybody who can ring a ticket can write it: a sticky note only a
              manager may write goes straight back onto the monitor. */}
          <PinnedNote
            note={detail.sale.pinned_note}
            by={detail.sale.pinned_note_by}
            at={detail.sale.pinned_note_at}
            canWrite={can("ringSale")}
            busy={busy}
            onSave={(note) =>
              send(`/api/pos/sales/${saleId}/note`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note }),
              })
            }
          />

          {/* Reassignable on a live ticket by anyone who can ring one. A void
              has no credit left to move, so there it is read-only. */}
          <Lines
            items={showFixes ? detail.items : detail.items.filter((i) => !i.voided)}
            /* A struck line is a correction like any other: it says what the
               ticket used to claim, not what it sold. Hidden with the rest of
               the working unless somebody asks. */
            mechanics={detail.roster}
            editable={detail.sale.status !== "voided" && can("ringSale")}
            busy={busy}
            /* Fitting credit is offered only where the two jobs actually come
               apart: a tire the shop had to order, sold one day and mounted
               another. Walk-in work is fitted by whoever sold it. */
            fittable={
              detail.sale.fulfillment_status !== "none" ? detail.tireItemIds : []
            }
            onReassign={(itemId, mechanicId, mechanicName) =>
              void send(`/api/pos/sales/${saleId}/items/${itemId}/mechanic`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mechanicId, mechanicName }),
              })
            }
            onFitted={(itemId, mechanicId) =>
              void send(`/api/pos/sales/${saleId}/items/${itemId}/mount`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mechanicId }),
              })
            }
            /* Any ticket that is not voided. It used to be finished ones only,
               on the reasoning that an open ticket should be fixed at the
               register — true when the register is where you are, and useless
               when you have the ticket open in front of you from Today or the
               orders board. A voided ticket stays read-only: there is nothing
               left on it to price. `updateItem` enforces the rank itself; this
               only decides what is drawn. */
            repriceable={detail.sale.status !== "voided" && can("editCompletedSale")}
            /* Taking a line off a ticket, which had no way in from here at
               all — the only route was the register, and a ticket opened from
               Today or the orders board is not at the register. A voided line
               is struck, not deleted: the stock it moved goes back and the row
               stays as the record that it once said this. */
            onRemoveLine={(itemId, reason) =>
              send(
                `/api/pos/sales/${saleId}/items/${itemId}?reason=${encodeURIComponent(reason)}`,
                { method: "DELETE" },
              )
            }
            onReprice={(itemId, qty, unitPriceCents, description) =>
              send(`/api/pos/sales/${saleId}/items/${itemId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ qty, unitPriceCents, description }),
              })
            }
          />
          <Money
            showFixes={showFixes}
            sale={detail.sale}
            payments={detail.payments}
            methods={methods}
            // Manager and up. The library enforces this too — this only decides
            // whether the control is drawn.
            canCorrect={can("correctPayment")}
            busy={busy}
            onCorrect={(paymentId, patch) =>
              send(`/api/pos/payments/${paymentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              })
            }
          />

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
                roster={detail.roster}
                onSaleChanged={() => void load()}
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
              label={tr("Details")}
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

          {/* What is happening with this ticket, on every ticket.

              Ordering a tire in is decided AFTER the line is rung, not before:
              the size goes on the ticket, the rack gets checked, and only then
              does it turn out there are two of that size and they want four. So
              the control is here on the ticket rather than a choice made when it
              was opened. The same is true of the car — a customer decides to
              leave it while the ticket is already up on the screen.

              Offered whatever is on the ticket. It used to appear only where a
              line pointed at the price list, on the theory that a flat repair
              has no business having a lifecycle. That was true of tires and
              wrong about the shop: a customer leaves the car for an oil change
              just as readily, and a ticket with nothing rung on it yet is
              exactly the one somebody dropped a key off for. */}
          {(can("ringSale") || can("manageSpecialOrders")) &&
            detail.sale.status !== "voided" &&
            detail.sale.kind !== "purchase" && (
              <TicketStatusPanel
                sale={detail.sale}
                canSet={can("ringSale")}
                canOrder={can("manageSpecialOrders")}
                canReverse={can("reverseSpecialOrder")}
                onChanged={() => {
                  void load();
                  onChanged();
                }}
                onError={setError}
              />
            )}

          {/* SEQ is not edited here any more. It lives on the payment, not the
              ticket — a split tender has two swipes and two sequence numbers,
              which one field on the header cannot hold, and nothing ever read
              the header's copy anyway. The place to fix one is Logs, where
              the whole day's charges are listed against the batch being
              reconciled. */}

          {detail.sale.status === "completed" && can("takePayment") && (
            <TipAdjustment
              methods={methods}
              mechanics={detail.mechanics}
              roster={detail.roster}
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

          {/*
            EVERYTHING THAT CORRECTS THIS TICKET, IN ONE PLACE.

            These four grew up separately and each centred itself its own way —
            two hugged the left edge, two sat in the middle — so the bottom of
            the drawer read as a pile of leftover links rather than a set of
            things you can do. They are the same KIND of act: undoing or
            adjusting something already recorded. Grouping them says so, and a
            single rule above the group separates them from the ticket itself,
            which is what everything above is.

            The order is how likely each is to be the right answer, with the
            irreversible one last and alone under its own line.
          */}
          {(() => {
            const live = detail.sale.status !== "voided";
            const tippable =
              live &&
              can("correctPayment") &&
              detail.payments.some(
                (p) =>
                  p.tip_cents > 0 &&
                  p.kind !== "reversal" &&
                  !detail.payments.some((r) => r.reverses_payment_id === p.id),
              );
            const refundable =
              detail.sale.status === "completed" &&
              can("voidSale") &&
              detail.sale.paid_cents > 0;
            const discountable =
              live &&
              detail.sale.kind !== "purchase" &&
              can("discountSale") &&
              discountMax !== undefined;
            const voidable = live && can("voidSale");
            const reopenable =
              detail.sale.status === "completed" && can("editCompletedSale");
            return tippable || refundable || discountable || voidable || reopenable;
          })() && (
          <div className="td-fix">
            <div className="td-fix-label">{tr("Fix something on this ticket")}</div>

          {/* A tip that should not be on the ticket, taken off the row that
              carries it. One control per tipped payment, because a ticket can
              have more than one and "which tip" has no good abstract answer.

              Manager and up — see `removeTip`. This is somebody's money. */}
          {detail.sale.status !== "voided" &&
            can("correctPayment") &&
            detail.payments
              .filter(
                (p) =>
                  p.tip_cents > 0 &&
                  p.kind !== "reversal" &&
                  !detail.payments.some((r) => r.reverses_payment_id === p.id),
              )
              .map((p) => (
                <div key={`tip-${p.id}`} className="flex flex-col gap-1">
                  {/*
                    Moving it comes FIRST, because it is nearly always the
                    right answer. A tip on the wrong name is not a tip that
                    should not exist — the customer meant it, somebody earned
                    it, and the only thing wrong is which technician it landed
                    on. Offering only "take it off" made removal the obvious
                    move and left the money to be re-added by hand, on today,
                    by somebody who might forget the second half.
                  */}
                  <MoveTip
                    tipCents={p.tip_cents}
                    currentId={p.mechanic_id}
                    roster={detail.roster}
                    busy={busy}
                    onMove={async (mechanicId, reason) =>
                      send(`/api/pos/payments/${p.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tipToMechanicId: mechanicId, reason }),
                      })
                    }
                  />
                  <RemoveTip
                    tipCents={p.tip_cents}
                    busy={busy}
                    onRemove={async (reason) =>
                      send(`/api/pos/payments/${p.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ removeTip: true, reason }),
                      })
                    }
                  />
                </div>
              ))}

          {/* Money back on a ticket that stands, which is not a void — see
              `RefundTicket`. Only where something was actually collected: a
              refund on a ticket nobody paid is not a refund, it is a discount,
              and it has its own path. */}
          {detail.sale.status === "completed" &&
            can("voidSale") &&
            detail.sale.paid_cents > 0 && (
              <RefundTicket
                methods={methods}
                paidMethodIds={[
                  ...new Set(
                    detail.payments
                      .filter((p) => p.amount_cents > 0)
                      .map((p) => p.method_id),
                  ),
                ]}
                maxCents={detail.sale.paid_cents}
                busy={busy}
                onRefund={async (methodId, amountCents, reason) =>
                  send(`/api/pos/sales/${saleId}/payments`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "refund", methodId, amountCents, reason }),
                  })
                }
              />
            )}

          {detail.sale.status !== "voided" &&
            detail.sale.kind !== "purchase" &&
            can("discountSale") &&
            discountMax !== undefined && (
              <DiscountTicket
                subtotalCents={detail.sale.subtotal_cents}
                currentCents={detail.sale.discount_cents}
                maxCents={discountMax}
                busy={busy}
                onSet={async (amountCents, reason) =>
                  send(`/api/pos/sales/${saleId}/discount`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amountCents, reason }),
                  })
                }
              />
            )}

          {/*
            Reopening, so a ticket can be added to after it was paid.

            `addItem` has always refused a finished ticket with the words
            "Reopen it to add lines" and there was no way to do it — a customer
            back at the counter for a valve stem two minutes after paying meant
            a second ticket for a dollar, or the line written onto the next job.

            The money does not move and the stock does not move: the payments
            stay where they are, and completing again only books stock for the
            lines that were ADDED, because applySaleMovements skips anything
            that already went out. That guard is what makes this offerable.
          */}
          {detail.sale.status === "completed" && can("editCompletedSale") && (
            <ReopenTicket
              paidCents={detail.sale.paid_cents}
              /* Its own day, not today: reopening last Tuesday's ticket changes
                 last Tuesday's figures, and that day has been counted. */
              staleDay={detail.sale.business_date !== detail.today}
              businessDate={detail.sale.business_date}
              busy={busy}
              onReopen={async (reason) =>
                send(`/api/pos/sales/${saleId}/reopen`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reason }),
                })
              }
            />
          )}

          {/* Alone under its own rule. Voiding is the one act here that
              cannot be walked back by another control on this list. */}
          {detail.sale.status !== "voided" && can("voidSale") && (
            <div className="td-fix-danger">
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
            </div>
          )}
          </div>
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
  fittable,
  onReassign,
  onFitted,
  repriceable,
  onReprice,
  onRemoveLine,
}: {
  items: SaleItem[];
  mechanics: Mechanic[];
  editable: boolean;
  busy: boolean;
  /** Line ids that may name a fitter — tires on an ordered ticket. Empty on
   *  everything else, which is the overwhelming majority of tickets. */
  fittable: number[];
  onReassign: (
    itemId: number,
    mechanicId: number | null,
    mechanicName: string | null,
  ) => void;
  onFitted: (itemId: number, mechanicId: number | null) => void;
  /** Manager and up, on any ticket that is not voided — see `updateItem`. */
  repriceable: boolean;
  /** Strike a line off the ticket — see `voidItem`. */
  onRemoveLine: (itemId: number, reason: string) => Promise<boolean>;
  onReprice: (
    itemId: number,
    qty: number,
    unitPriceCents: number,
    description: string,
  ) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  /** Which line is being re-priced, and what is typed into it. */
  const [pricing, setPricing] = useState<number | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  /**
   * What the line SAYS, which is the field people actually come here to fix.
   *
   * A tire rung as the wrong size, a service typed with a customer's name in
   * it, "TEST" left on a real ticket — none of those are price problems, and
   * until now the only way to correct one was to void the line and ring it
   * again, which moves stock and leaves two lines where the customer bought
   * one thing.
   */
  const [descr, setDescr] = useState("");
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
          <Fragment key={i.id}>
          <tr className="border-t border-black/5">
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
                  <option value="">{tr("No mechanic")}</option>
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
            {/* The money, and the way to fix it.
                A completed ticket's total is frozen on purpose — payments were
                taken against it — but "frozen" cannot mean "wrong forever". A
                tire rung at 290 that was really 250 has to be correctable, and
                the honest way is to change the LINE: the subtotal is the sum of
                the lines, so re-pricing one keeps that true where an override
                of the total would quietly break it.

                The edit re-freezes the ticket and writes a before/after audit
                row, and every one of them is named on the close-out. */}
            <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
              {formatCents(i.line_total_cents)}
              {repriceable && !i.voided && pricing !== i.id && (
                <button
                  type="button"
                  className="ml-2 text-xs text-brand-300 underline decoration-brand-300/40 underline-offset-2 hover:text-brand-500 hover:decoration-current transition-colors"
                  title={tr("Correct what this line says, how many, or the price")}
                  onClick={() => {
                    setPricing(i.id);
                    setQty(String(i.qty));
                    setPrice((i.unit_price_cents / 100).toFixed(2));
                    setDescr(i.description);
                  }}
                >
                  fix
                </button>
              )}
            </td>
          </tr>

          {pricing === i.id && (
            <tr>
              <td colSpan={3} className="pb-2">
                <div className="p-2 rounded-lg bg-white border border-black/10">
                  <p className="text-xs text-brand-400 mb-2">
                    Corrects this line and re-freezes the ticket.{" "}
                    {/* Said before it happens, because the number it moves is
                        one the day has already counted. */}
                    The change is listed on tonight&apos;s close-out with your
                    name on it.
                  </p>
                  {/* First, because it is what people open this to change.
                      Full width: a tire's description is long and a box that
                      shows half of it is a box you cannot proofread. */}
                  <input
                    className="input w-full mb-2"
                    style={{ height: 34, fontSize: 13 }}
                    title={tr("What this line says")}
                    value={descr}
                    onChange={(e) => setDescr(e.target.value)}
                  />
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      className="input tabular-nums"
                      style={{ height: 34, fontSize: 13, width: 56 }}
                      inputMode="numeric"
                      title={tr("How many")}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                    <span className="text-xs text-brand-300">×</span>
                    <input
                      className="input tabular-nums"
                      style={{ height: 34, fontSize: 13, width: 96 }}
                      inputMode="decimal"
                      placeholder="0.00"
                      title={tr("Price each")}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    <span className="text-xs text-brand-400">
                      ={" "}
                      {formatCents(
                        Math.max(0, parseInt(qty, 10) || 0) * (parseCents(price) ?? 0),
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ height: 34, fontSize: 13, flex: 1 }}
                      onClick={() => setPricing(null)}
                    >{tr("Cancel")}</button>
                    {/* In here rather than on every row: removing a line is
                        rarer than correcting one and much harder to undo, and
                        a delete beside every line on a busy ticket is a delete
                        somebody eventually hits by accident. */}
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ height: 34, fontSize: 13, color: "#b91c1c", borderColor: "rgba(185,28,28,0.3)" }}
                      disabled={busy}
                      onClick={async () => {
                        const why = window.prompt(
                          `Take "${i.description}" off this ticket?\n\nSay why — it goes on the log and any stock comes back.`,
                        );
                        if (!why || !why.trim()) return;
                        if (await onRemoveLine(i.id, why.trim())) setPricing(null);
                      }}
                    >{tr("Remove")}</button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ height: 34, fontSize: 13, flex: 1 }}
                      disabled={
                        busy ||
                        !Number.isInteger(parseInt(qty, 10)) ||
                        parseInt(qty, 10) < 1 ||
                        parseCents(price) === null ||
                        !descr.trim() ||
                        (parseInt(qty, 10) === i.qty &&
                          parseCents(price) === i.unit_price_cents &&
                          descr.trim() === i.description)
                      }
                      onClick={async () => {
                        const cents = parseCents(price);
                        const n = parseInt(qty, 10);
                        if (cents === null || !Number.isInteger(n)) return;
                        if (await onReprice(i.id, n, cents, descr.trim())) setPricing(null);
                      }}
                    >
                      {busy ? "Working…" : "Change the price"}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          )}
          {/*
            Who bolted them on, when that is not who sold them.

            A sub-row rather than a third control on the line above, because the
            line above answers "what was rung and for how much" and this answers
            something else entirely — and because on the tickets that do NOT
            have it, which is nearly all of them, it costs nothing at all.

            Read-only lines show it only when somebody is named. An empty
            "Fitted by —" under every tire on a voided ticket would be four
            lines of nothing.
          */}
          {fittable.includes(i.id) && !i.voided && (editable || i.mount_mechanic_id !== null) && (
            <tr>
              <td colSpan={3} className="pb-1.5">
                <div className="flex items-center gap-2 pl-2 text-xs text-brand-300">
                  <span>{tr("Fitted by")}</span>
                  {editable ? (
                    <select
                      className="input py-1 text-xs"
                      style={{ width: 150 }}
                      title="Who mounted and balanced these, if it was not whoever sold them"
                      disabled={busy}
                      value={i.mount_mechanic_id ?? ""}
                      onChange={(e) =>
                        onFitted(
                          i.id,
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    >
                      <option value="">Whoever sold it</option>
                      {/* Same reason as the seller select above: somebody who
                          has left still holds the credit on old tickets, and
                          dropping their name would let the next touch of this
                          row quietly write it back to nobody. */}
                      {i.mount_mechanic_id !== null &&
                        !mechanics.some((m) => m.id === i.mount_mechanic_id) && (
                          <option value={i.mount_mechanic_id}>
                            {nameOf(i.mount_mechanic_id)}
                          </option>
                        )}
                      {/* The seller is not on this list. Crediting somebody for
                          fitting a tire they sold moves money from them to
                          themselves and books them a service they did not
                          separately do — the server refuses it, and offering it
                          here would only be a way to find that out. */}
                      {mechanics
                        .filter((m) => m.id !== i.mechanic_id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span>{nameOf(i.mount_mechanic_id)}</span>
                  )}
                  {/* What it is worth, said out loud. This is the only place
                      anybody finds out that naming a fitter moves real money
                      off the seller, and a control that quietly reassigns $140
                      without saying so is one people set by accident. */}
                  {i.mount_mechanic_id !== null && (
                    <span>
                      {formatCents(Math.min(i.mount_unit_cents * i.qty, i.line_total_cents))}{" "}
                      of this line goes to them
                    </span>
                  )}
                </div>
              </td>
            </tr>
          )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Money({
  sale,
  payments,
  methods,
  canCorrect,
  onCorrect,
  busy,
  showFixes,
}: {
  sale: Sale;
  payments: Payment[];
  /** Show the working, or show what the ticket comes to. See the drawer's eye. */
  showFixes: boolean;
  methods: PaymentMethod[];
  /** Manager and up — see `correctPayment`. */
  canCorrect: boolean;
  onCorrect: (
    paymentId: number,
    patch: { methodId?: number; amountCents?: number; reason: string },
  ) => Promise<boolean>;
  busy: boolean;
}) {
  const { t: tr } = useLang();
  const label = (id: number) => methods.find((m) => m.id === id)?.label ?? "Payment";
  const [editing, setEditing] = useState<number | null>(null);
  const [methodId, setMethodId] = useState<number>(0);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  // Already undone by something, so there is nothing left to re-tender — the
  // money on it has been taken back out and the replacement is its own row.
  const reversed = new Set(
    payments.map((p) => p.reverses_payment_id).filter((id): id is number => id != null),
  );

  /*
    WHAT THE TICKET COMES TO, RATHER THAN HOW IT GOT THERE.

    A reversal and the row it reverses are equal and opposite, so dropping BOTH
    changes nothing about the arithmetic — which is what makes this safe to
    hide. Drop only one of them and the column stops adding up to the balance,
    and a payment panel that does not add up is worse than a cluttered one.

    S-2026-000542 is the case that prompted it: seven rows, of which two pairs
    cancelled, leaving three that were true. The eye brings the other four back.
  */
  const liveRows = payments.filter((p) => p.kind !== "reversal" && !reversed.has(p.id));
  const shownRows = showFixes ? payments : liveRows;
  const hiddenCount = payments.length - liveRows.length;

  // Only a plain payment nobody has already reversed. A refund or a tip
  // adjustment says something specific about money that moved, and correcting
  // one would be answering a question nobody asked.
  const fixable = canCorrect
    ? payments.filter(
        (p) => p.kind === "payment" && !reversed.has(p.id) && sale.status !== "voided",
      )
    : [];

  return (
    /* One element, not a fragment. The drawer stacks its sections with a
       `gap-5`, so returning the box and the links as two children put twenty
       pixels of the drawer's own spacing between them — on top of any margin
       here — and no amount of adjusting the margin could close it. Wrapped,
       they are one section and the spacing between them is this file's to
       decide. */
    <div>
      <div className="rounded-xl bg-black/[0.03] p-3 text-sm">
        <Row label={tr("Subtotal")} value={formatCents(sale.subtotal_cents)} />
        {/* Broken out here, unlike on the customer's receipt: this is the shop's
            own screen, and the person looking at it is the one who needs to know
            what was kept back. */}
        {sale.tip_cents !== 0 && <Row label={tr("Tip")} value={formatCents(sale.tip_cents)} />}
        {sale.comm_cents !== 0 && (
          <Row label={tr("Terminal tax")} value={formatCents(sale.comm_cents)} />
        )}
        <Row label={tr("Total")} value={formatCents(sale.total_cents)} strong />
        <div className="mt-2 pt-2 border-t border-black/10">
          {shownRows.map((p) => (
            <Row
              key={p.id}
              /* No SEQ on this line. It is the card batch's business, it means
                 nothing without the batch beside you, and it is read and fixed
                 in one place: the card charges on Logs. */
              label={`${label(p.method_id)}${p.kind !== "payment" ? ` · ${p.kind.replace("_", " ")}` : ""}`}
              value={formatCents(p.amount_cents)}
              muted
              /* Struck through only when the working is on show, where the
                 point is to tell a row that stands from one that was undone.
                 With the eye closed nothing here has been undone. */
              undone={showFixes && (p.kind === "reversal" || reversed.has(p.id))}
            />
          ))}
          {shownRows.length === 0 && (
            <div className="text-brand-300">{tr("Nothing collected on this ticket.")}</div>
          )}
          {/* Said, rather than silently omitted. A panel that quietly drops
              four rows is a panel somebody stops trusting the moment they
              notice; one that says how many it is holding back, and offers the
              eye, is one they can check. */}
          {!showFixes && hiddenCount > 0 && (
            <div className="td-money-hidden">
              {hiddenCount}{" "}
              {hiddenCount === 1 ? tr("corrected row hidden") : tr("corrected rows hidden")}
              {" — "}
              {tr("open the eye above to see them")}
            </div>
          )}
        </div>
        {sale.balance_cents !== 0 && (
          <Row label={tr("Balance due")} value={formatCents(sale.balance_cents)} strong />
        )}
      </div>

      {/* Outside the grey box, under it.
          Inside, it sat on the payment row itself and read as part of the
          figures — a control mixed in with a column of amounts, on the one
          panel where every other thing is a number to be trusted. Out here it
          is plainly a thing you do to the ticket rather than something the
          ticket says. */}
      {/* A column, not a row. These were inline, so a ticket paid on two
          tenders ran both links together into one unbroken sentence —
          "Wrong tender on the Credit Card?Wrong tender on the Cash?" — which
          reads as gibberish and gives neither a click target you can aim at.
          One per line, each only as wide as its own words. */}
      {/*
        ALWAYS OFFERED, never behind the eye.

        These were folded away with the reversal rows on the reasoning that
        they are tools rather than figures. That was wrong in a way that cost
        real work: correcting a tender is one of the most common repairs on a
        ticket, and hiding it behind a control nobody had been told about made
        it look as though the ability had been removed. The eye hides what
        ALREADY HAPPENED to a ticket. It must never hide what you can DO to one.
      */}
      {fixable.length > 0 && (
        <div className="mt-2 flex flex-col items-start gap-1.5">
          {fixable.map((p) => (
            <Fragment key={p.id}>
              {editing !== p.id && (
                <button
                  type="button"
                  className="w-fit text-left text-xs text-brand-300 underline decoration-brand-300/40 underline-offset-2 hover:text-brand-500 hover:decoration-current transition-colors"
                  title={tr("The customer paid, but this row says the wrong thing about it")}
                  onClick={() => {
                    setEditing(p.id);
                    // Seeded with what is already there, so a correction to one
                    // of the two does not quietly change the other.
                    setMethodId(p.method_id);
                    setAmount((p.amount_cents / 100).toFixed(2));
                    setReason("");
                  }}
                >
                  {/* Named only when there is more than one to choose between.
                      On the ordinary single-payment ticket the tender is the
                      line directly above, and repeating it here would be the
                      same word twice. */}
                  {fixable.length > 1
                    ? `Wrong tender or amount on the ${label(p.method_id)}?`
                    : "Wrong tender or amount?"}
                </button>
              )}

              {/* Stretched, unlike the links above it. The column aligns its
                  children to the start so each link is only as wide as its own
                  text; the form is a form and wants the whole panel. */}
              {editing === p.id && (
                <div className="w-full self-stretch p-2 rounded-lg bg-white border border-black/10">
                  {/* Says what it will do before it does it. This writes two
                      ledger rows rather than editing one, and somebody who
                      expects a quiet correction should not find that out from
                      the day's tender report. */}
                  <p className="text-xs text-brand-400 mb-2">
                    Puts the {formatCents(p.amount_cents)} back off{" "}
                    {label(p.method_id)} and takes it again as this. Both rows
                    stay on {p.business_date}, so the day does not move — only
                    what this payment says. The customer&apos;s receipt shows
                    the corrected line, not the working.
                  </p>
                  <div className="flex gap-2 mb-2">
                    <select
                      className="input flex-1"
                      style={{ height: 34, fontSize: 13, paddingBlock: 0 }}
                      value={methodId}
                      onChange={(e) => setMethodId(Number(e.target.value))}
                    >
                      {/* Its own tender included, and selected. Correcting only
                          the amount is as ordinary as correcting only the
                          tender, and a list that excluded the current one would
                          force a tender change on somebody who only mis-typed a
                          figure. */}
                      {methods
                        .filter((m) => m.active || m.id === p.method_id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                    <input
                      className="input tabular-nums"
                      style={{ height: 34, fontSize: 13, width: 96 }}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <input
                    className="input w-full mb-2"
                    style={{ height: 34, fontSize: 13 }}
                    placeholder="Why — e.g. rung to account, customer swiped"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ height: 34, fontSize: 13, flex: 1 }}
                      onClick={() => setEditing(null)}
                    >{tr("Cancel")}</button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ height: 34, fontSize: 13, flex: 1 }}
                      disabled={
                        busy ||
                        !methodId ||
                        !reason.trim() ||
                        // Nothing typed, nothing changed, or a figure that is
                        // not a figure — all three leave nothing to send.
                        parseCents(amount) === null ||
                        (parseCents(amount) ?? 0) <= 0 ||
                        (methodId === p.method_id && parseCents(amount) === p.amount_cents)
                      }
                      onClick={async () => {
                        const cents = parseCents(amount);
                        if (cents === null) return;
                        // Only what actually differs. Sending a field that has
                        // not moved would have the library reverse and re-take
                        // a payment to say exactly what it already said.
                        const ok = await onCorrect(p.id, {
                          methodId: methodId === p.method_id ? undefined : methodId,
                          amountCents: cents === p.amount_cents ? undefined : cents,
                          reason: reason.trim(),
                        });
                        if (ok) setEditing(null);
                      }}
                    >
                      {busy ? "Working…" : "Change it"}
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
  undone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  /** A row that was reversed, or the reversal itself. Struck, not hidden. */
  undone?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-0.5 ${strong ? "font-semibold text-brand-500" : muted ? "text-brand-400" : ""}${undone ? " td-undone" : ""}`}
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
  roster,
  commPerCents,
  commChargeCents,
  busy,
  onAdd,
}: {
  methods: PaymentMethod[];
  mechanics: TicketMechanic[];
  /**
   * The whole roster, offered only when the ticket names nobody. Names and ids
   * only — a roster entry has no line count on this ticket by definition, and
   * the splits that need one are not offered in that case.
   */
  roster?: { id: number; name: string }[];
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
  const { t: tr } = useLang();
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
  /**
   * Who a late tip can go to. The ticket's own people when it has any, the
   * whole roster when it has none — because a tip credited to nobody is a
   * technician not being paid, and the server refuses one. See `takePayment`.
   */
  const tipCandidates: { id: number; name: string }[] =
    mechanics.length > 0 ? mechanics : (roster ?? []);
  const tipNeedsAName = tipCents > 0 && goesTo === "";
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
      <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{tr("Tip added later")}</div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-brand-400 flex-1">{tr("Amount")}<input
            className="input mt-1 w-full text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-brand-400 flex-1">{tr("Tender")}<select
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
            Logs, which is the one screen where the batch is in front of
            somebody and the one place SEQ is edited. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || tipCents <= 0 || tipNeedsAName}
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
        >{tr("Add")}</button>
      </div>

      {/* Same rule as the register: answered for them on the one-technician
          ticket, asked on every other — including the ticket that names
          nobody, where the list becomes the whole roster rather than an
          apology. */}
      {mechanics.length !== 1 && (
        <label className="text-xs text-brand-400 block mt-2">
          {mechanics.length === 0
            ? tr("Nobody is on this ticket — who is the tip for?")
            : tr("Tip goes to")}
          <select
            className="input mt-1 w-full"
            value={goesTo}
            style={tipNeedsAName ? { borderColor: "#f59e0b" } : undefined}
            onChange={(e) => setGoesTo(e.target.value)}
          >
            <option value="">{tr("Choose somebody…")}</option>
            {/* The splits sit above the names, because when two people worked a
                ticket a shared tip is the normal case and one person taking all
                of it is the exception. Offered only when the ticket actually
                has people to split between — a split over the whole roster
                would divide a tip among technicians who never touched the car. */}
            {mechanics.length > 1 && (
              <>
                <option value="equal">Split equally between all {mechanics.length}</option>
                <option value="lines">
                  Split by work done ({mechanics.map((m) => m.lineCount).join(" / ")} lines)
                </option>
              </>
            )}
            {tipCandidates.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
                {mechanics.length > 1 ? " — all of it" : ""}
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
  const { t: tr } = useLang();
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
        <label className="text-xs text-brand-400 flex-1">{tr("Amount")}<input
            className="input mt-1 w-full text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs text-brand-400 flex-1">{tr("Tender")}<select
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
        >{tr("Take")}</button>
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
  const { t: tr } = useLang();
  const [arming, setArming] = useState(false);
  const [reason, setReason] = useState("");

  if (!arming) {
    return (
      <button
        type="button"
        className="td-fix-open td-fix-open-danger"
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
        <label className="text-xs text-red-800 flex-1">{tr("Reason")}<input
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
        >{tr("Void")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>{tr("Cancel")}</button>
      </div>
    </div>
  );
}

/**
 * What is happening with this ticket, in one control.
 *
 * There were two of these, in two places. The stage of an order lived here as a
 * row of buttons — next stage, un-mark, cancel — and where the car was lived on
 * the Outstanding panel as a dropdown, and neither screen could set the other's.
 * A cashier who wanted to say "they left the car AND we have to order the tire"
 * had to know which of the two facts each screen owned.
 *
 * Now it is one control holding both lists — a ticket can say the car is
 * waiting AND the tire is on its way, because that is routinely true — and the
 * panel it sits in is the only thing that changes: amber and headed
 * "Outstanding order" when the shop owes somebody a tire, quiet and headed
 * "Status" when it does not.
 */
function TicketStatusPanel({
  sale,
  canSet,
  canOrder,
  canReverse,
  onChanged,
  onError,
}: {
  sale: Sale;
  canSet: boolean;
  canOrder: boolean;
  canReverse: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const { t: tr } = useLang();
  const isOrder = sale.fulfillment_status !== "none";
  const [open, setOpen] = useState(false);

  /* Most tickets never answer either of these. A car is dropped off, four tires
     go on, it is paid for and it leaves, and nothing about it is outstanding at
     any point. Left permanently expanded, the panel put a heading, a sentence,
     a two-way switch and a dropdown above the Pay button on every one of them —
     four controls' worth of screen asking a question the ticket does not have.

     So it starts as a button, and only for the tickets that have said nothing.
     The moment either side has an answer the ticket IS outstanding in some way,
     the button has done its job, and the panel stands open for good — nobody
     should have to click to find out where a car is once somebody has said. */
  if (!open && !isOrder && !sale.work_status) {
    return (
      /* Grey, full width, matching Details directly below it. Both are "the
         other thing on this screen" next to Pay, and they should read as a pair
         rather than as two different kinds of control. */
      <button
        type="button"
        className="btn w-full"
        style={{ background: "#4b5563", color: "#fff" }}
        onClick={() => setOpen(true)}
      >{tr("Outstanding order")}</button>
    );
  }

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        background: isOrder ? "#fff7ed" : "#f8fafc",
        border: `1px solid ${isOrder ? "rgba(180,83,9,0.25)" : "rgba(15,23,42,0.10)"}`,
      }}
    >
      {/* Heading above the controls rather than beside them. Side by side the
          picker got whatever was left of the row, which was narrow enough to
          break "Outstanding order" and "Cancel the order" over two lines each. */}
      <div className="mb-2">
        <div
          className="text-xs uppercase tracking-wider"
          style={{ color: isOrder ? "#92400e" : "#64748b" }}
        >
          {isOrder ? "Outstanding order" : "Status"}
        </div>
        {/* The one sentence somebody needs at the counter, and only when it
            applies. A tire on order is NOT off the rack yet, and the person
            about to promise it to a second customer is the person looking at
            this panel. */}
        <div className="text-xs mt-0.5" style={{ color: isOrder ? "#b45309" : "#94a3b8" }}>
          {isOrder
            ? "Nothing comes off the racks until it is fitted."
            : "Where the car is, or a tire the shop still owes."}
        </div>
      </div>
      <TicketStatusPicker
        saleId={sale.id}
        workStatus={sale.work_status}
        fulfillmentStatus={sale.fulfillment_status}
        canSet={canSet}
        canOrder={canOrder}
        canReverse={canReverse}
        size="full"
        onChanged={onChanged}
        onError={onError}
      />
    </div>
  );
}

/** "Aug 7, 10:40 PM" — enough to judge whether a note has gone stale. */
function noteWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A note pinned to one ticket, in the same yellow as the counter's notice board.
 *
 * Nothing at all when there is no note and nobody may write one; a quiet link
 * when there is none and somebody may. A permanently visible empty box is
 * furniture, and furniture stops being read — the value of this strip is that
 * opening a ticket tells you at a glance whether there is something to know
 * about it.
 *
 * The name and the time are the accountability here rather than a permission.
 * Everybody can write, and everybody can see who did.
 */
function PinnedNote({
  note,
  by,
  at,
  canWrite,
  busy,
  onSave,
}: {
  note: string | null;
  by: string | null;
  at: string | null;
  canWrite: boolean;
  busy: boolean;
  onSave: (note: string | null) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    return (
      <div
        className="rounded-xl p-3"
        style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}
      >
        <textarea
          className="input w-full"
          rows={3}
          autoFocus
          maxLength={500}
          placeholder={tr("Anything the next person on the counter needs to know…")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            className="btn btn-outline"
            style={{ height: 34, fontSize: 13, flex: 1 }}
            onClick={() => setEditing(false)}
          >{tr("Cancel")}</button>
          {/* Clearing is saving nothing, not a separate delete. The note is gone
              when there is nothing to say, which is how a whiteboard behaves. */}
          {note && (
            <button
              type="button"
              className="btn btn-outline-danger"
              style={{ height: 34, fontSize: 13, flex: 1 }}
              disabled={busy}
              onClick={async () => {
                if (await onSave(null)) setEditing(false);
              }}
            >{tr("Take it down")}</button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 34, fontSize: 13, flex: 1 }}
            disabled={busy || !draft.trim()}
            onClick={async () => {
              if (await onSave(draft.trim())) setEditing(false);
            }}
          >
            {busy ? "Saving…" : "Pin it"}
          </button>
        </div>
      </div>
    );
  }

  if (!note) {
    if (!canWrite) return null;
    return (
      <button
        type="button"
        className="text-xs text-brand-300 underline decoration-brand-300/40 underline-offset-2 hover:text-brand-500 hover:decoration-current transition-colors w-fit"
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
      >{tr("Pin a note to this ticket")}</button>
    );
  }

  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3"
      style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: "22px" }}>
        📌
      </span>
      <div className="flex-1 min-w-0">
        {/* Newlines somebody typed are newlines on the note. */}
        <div className="text-amber-900 whitespace-pre-wrap text-sm">{note}</div>
        {by && (
          <div className="text-xs text-amber-700/80 mt-1">
            {by}
            {at ? ` · ${noteWhen(at)}` : ""}
          </div>
        )}
      </div>
      {canWrite && (
        <button
          type="button"
          className="text-sm text-amber-800 hover:underline shrink-0"
          onClick={() => {
            setDraft(note);
            setEditing(true);
          }}
        >{tr("Edit")}</button>
      )}
    </div>
  );
}

/**
 * Give money back on a ticket that stands.
 *
 * DELIBERATELY NOT A VOID, and the difference is the whole reason this control
 * exists separately. A void says the ticket should never have existed: it
 * reverses every payment, puts the tires back on the rack, and takes the sale
 * out of the day. A refund says the sale happened — the customer had the work
 * done, paid for it, and has now brought something back or been given money for
 * a complaint. The ticket stays completed, because it is true that it completed.
 *
 * Getting these the wrong way round is the classic register error and it costs
 * in both directions: void a real sale and the day's takings drop by money the
 * shop actually kept; refund a ticket that should never have been rung and the
 * stock never comes back.
 *
 * The tender is asked for rather than assumed. Money going back out has to leave
 * the same place it came in — cash out of the drawer, a card refunded on the
 * terminal — and the close-out counts each of those separately, so guessing here
 * would put the day out by the refund on two tenders at once.
 *
 * Armed behind a press for the same reason the void is: it is the second most
 * expensive button on the screen.
 */
function RefundTicket({
  methods,
  paidMethodIds,
  maxCents,
  busy,
  onRefund,
}: {
  methods: PaymentMethod[];
  /** Tenders actually used on this ticket — see the note below. */
  paidMethodIds: number[];
  /** What was collected. Refunding more than that is arithmetic gone wrong. */
  maxCents: number;
  busy: boolean;
  onRefund: (methodId: number, amountCents: number, reason: string) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [arming, setArming] = useState(false);
  const [methodId, setMethodId] = useState<number>(paidMethodIds[0] ?? 0);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const cents = parseCents(amount);
  const valid =
    methodId > 0 && cents !== null && cents > 0 && cents <= maxCents && reason.trim().length > 0;

  if (!arming) {
    return (
      <button
        type="button"
        className="td-fix-open"
        style={{ color: "#b45309" }}
        onClick={() => {
          setMethodId(paidMethodIds[0] ?? methods[0]?.id ?? 0);
          setAmount("");
          setReason("");
          setArming(true);
        }}
      >{tr("Refund on this ticket")}</button>
    );
  }

  return (
    <div className="rounded-xl p-3" style={{ background: "#fffbeb" }}>
      <div className="text-sm mb-2" style={{ color: "#78350f" }}>
        The sale stays as it is. This writes money going back out — it does not
        put stock back on the rack.{" "}
        {maxCents > 0 && <>Up to {formatCents(maxCents)} was collected.</>}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs" style={{ color: "#78350f" }}>
          Back on
          {/* Every tender is offered, with the ones actually used on this ticket
              first. Usually the money goes back the way it came, and a shop that
              took cash and is handing cash back should not have to hunt. But a
              card refunded as cash out of the drawer is a real afternoon, so the
              rest are still there. */}
          <select
            className="input mt-1"
            value={methodId}
            onChange={(e) => setMethodId(Number(e.target.value))}
          >
            {[...methods]
              .sort(
                (a, b) =>
                  Number(paidMethodIds.includes(b.id)) - Number(paidMethodIds.includes(a.id)),
              )
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {paidMethodIds.includes(m.id) ? " — paid on this" : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs" style={{ color: "#78350f" }}>{tr("How much")}<input
            className="input mt-1 w-28 text-right tabular-nums"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-xs flex-1" style={{ color: "#78350f", minWidth: 180 }}>{tr("Reason")}<input
            className="input mt-1 w-full"
            placeholder="Tire came back · adjustment agreed with the customer"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          style={{ background: "#b45309", color: "#fff" }}
          disabled={busy || !valid}
          onClick={() => void onRefund(methodId, cents!, reason.trim())}
        >{tr("Refund")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>{tr("Cancel")}</button>
      </div>
      {cents !== null && cents > maxCents && (
        <div className="text-xs mt-2" style={{ color: "#a71d24" }}>
          Only {formatCents(maxCents)} was ever collected on this ticket.
        </div>
      )}
    </div>
  );
}

/**
 * Take a tip back off, on the row that carries it.
 *
 * Here rather than in a panel of its own because a tip belongs to a payment and
 * a ticket can have several — asking "which tip" in the abstract would be a
 * question with no good way to answer it. On the row, there is nothing to
 * choose.
 *
 * A reason is required and it is not ceremony: this moves somebody's money off
 * their own name, and the person it comes off is entitled to know who did it and
 * why. See `removeTip`.
 */
/**
 * Move a tip from the technician it landed on to the one who earned it.
 *
 * The fault this answers: the technician on a line can be corrected after the
 * ticket is paid, and the tip cannot follow it, because the tip was chosen at
 * payment time against whatever name the ticket carried then. Both halves end
 * up looking right on their own screens and the money is on the wrong person.
 *
 * Shows who has it now, so the manager is choosing against a fact rather than
 * a memory — and names whoever is on the ticket's LINES first, since that is
 * the answer nine times in ten.
 *
 * A reason is required, as it is for a removal, and for a stronger version of
 * the same reason: this takes money off one person's name and puts it on
 * another's, and both of them are entitled to know who did it and why.
 */
function MoveTip({
  tipCents,
  currentId,
  roster,
  busy,
  onMove,
}: {
  tipCents: number;
  currentId: number | null;
  roster: Mechanic[];
  busy: boolean;
  onMove: (mechanicId: number, reason: string) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [arming, setArming] = useState(false);
  const [to, setTo] = useState<number | "">("");
  const [reason, setReason] = useState("");

  const currentName = currentId
    ? (roster.find((m) => m.id === currentId)?.name ?? "Gone")
    : tr("nobody");

  if (!arming)
    return (
      <button
        type="button"
        className="td-fix-open"
        onClick={() => setArming(true)}
      >
        {tr("Move the")} {formatCents(tipCents)} {tr("tip to somebody else")}
      </button>
    );

  return (
    <div className="rounded-xl bg-black/[0.03] p-3">
      <div className="text-xs text-brand-400 mb-2">
        {tr("Credited to")} <strong>{currentName}</strong>{tr(" right now.")}{" "}
        {tr(
          "It comes off them and goes to whoever you pick, for the same amount, on the day it was rung — the ticket and the day's takings do not change.",
        )}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs text-brand-400">
          {tr("To")}
          <select
            className="input mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">{tr("Pick a technician")}</option>
            {roster
              .filter((m) => m.id !== currentId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs text-brand-400 flex-1">
          {tr("Reason")}
          <input
            className="input mt-1 w-full"
            placeholder="Jose did the work — the line was reassigned after the tip"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || to === "" || !reason.trim()}
          onClick={() => void onMove(Number(to), reason.trim())}
        >
          {tr("Move it")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>
          {tr("Cancel")}
        </button>
      </div>
    </div>
  );
}

/**
 * Put a finished ticket back into the open state.
 *
 * A reason is required, as it is for every other act in this group, and for a
 * sharper version of the same reason: this one changes what a day sold after
 * that day was counted, and "why" is the only part of it that cannot be
 * reconstructed from the rows afterwards.
 *
 * A ticket from an earlier day says so before it happens. Not refused — the
 * shop has real reasons to correct an old ticket — but the person doing it
 * should know they are moving a figure somebody has already signed for.
 */
function ReopenTicket({
  paidCents,
  staleDay,
  businessDate,
  busy,
  onReopen,
}: {
  paidCents: number;
  staleDay: boolean;
  businessDate: string;
  busy: boolean;
  onReopen: (reason: string) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [arming, setArming] = useState(false);
  const [reason, setReason] = useState("");

  if (!arming)
    return (
      <button type="button" className="td-fix-open" onClick={() => setArming(true)}>
        {tr("Reopen this ticket to add lines")}
      </button>
    );

  return (
    <div className="rounded-xl bg-black/[0.03] p-3">
      <div className="text-xs text-brand-400 mb-2">
        {tr(
          "The ticket goes back to open so lines can be added. The payments stay where they are and the tires already fitted stay out of stock — finishing it again only books what you add.",
        )}
        {paidCents > 0 && (
          <>
            {" "}
            {tr("It has")} <strong>{formatCents(paidCents)}</strong>{" "}
            {tr("collected on it, which stays collected.")}
          </>
        )}
      </div>
      {staleDay && (
        <div
          className="text-xs mb-2 rounded-lg px-2 py-1.5"
          style={{ background: "rgba(217,119,6,0.12)", color: "#7c2d12" }}
        >
          {tr("This ticket belongs to")} {businessDate}, {tr("not today")} —{" "}
          {tr("that day has already been counted, and adding to it changes what it sold.")}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="text-xs text-brand-400 flex-1">
          {tr("Reason")}
          <input
            className="input mt-1 w-full"
            autoFocus
            placeholder="Customer came back for a valve stem"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            if (await onReopen(reason.trim())) setArming(false);
          }}
        >
          {tr("Reopen it")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>
          {tr("Cancel")}
        </button>
      </div>
    </div>
  );
}

function RemoveTip({
  tipCents,
  busy,
  onRemove,
}: {
  tipCents: number;
  busy: boolean;
  onRemove: (reason: string) => Promise<boolean>;
}) {
  const { t: tr } = useLang();
  const [arming, setArming] = useState(false);
  const [reason, setReason] = useState("");

  if (!arming)
    return (
      <button
        type="button"
        className="td-fix-open"
        onClick={() => setArming(true)}
      >
        Take the {formatCents(tipCents)} tip off
      </button>
    );

  return (
    <div className="rounded-xl bg-black/[0.03] p-3">
      <div className="text-xs text-brand-400 mb-2">
        The {formatCents(tipCents)} comes back off the ticket and off whoever it
        was credited to. The sale itself is untouched, and it stays on the day it
        was rung.
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-brand-400 flex-1">{tr("Reason")}<input
            className="input mt-1 w-full"
            placeholder="Entered twice · typed 20 instead of 2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !reason.trim()}
          onClick={() => void onRemove(reason.trim())}
        >{tr("Take it off")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setArming(false)}>{tr("Cancel")}</button>
      </div>
    </div>
  );
}
