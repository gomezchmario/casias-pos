import { notFound, redirect } from "next/navigation";
import { getPosUser } from "@/lib/pos-session";
import { getSale, listSaleItems } from "@/lib/sales";
import { listPayments, listPaymentMethods } from "@/lib/payments";
import { getSetting } from "@/lib/settings";
import { formatCents, taxIncludedInCents } from "@/lib/money";
import { getDb } from "@/lib/db";
import { localIsoToDate } from "@/lib/time";
import { PrintButton } from "@/components/pos/PrintButton";
import "./receipt.css";

/**
 * The ticket number, not just "Receipt". Reprints get opened in bunches when
 * someone is chasing a figure, and four tabs all saying "Receipt" is four tabs
 * you have to click through.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sale = getSale(parseInt((await params).id, 10));
  return { title: sale ? `Receipt ${sale.sale_no}` : "Receipt" };
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getPosUser();
  if (!user) redirect("/");

  const sale = getSale(parseInt((await params).id, 10));
  if (!sale) notFound();

  const items = listSaleItems(sale.id);
  /**
   * What the customer paid, not how the shop's books got there.
   *
   * A mis-keyed tender or amount is fixed by reversing the row and taking it
   * again — the ledger keeps all three rows, which is the whole point of an
   * append-only ledger. None of that is the customer's business. Handed the
   * lot, they get "Credit Account $210, reversal −$210, Credit Card $210" on a
   * receipt for one payment they made once, which reads like they were charged
   * twice and refunded, and is the sort of thing that gets a shop rung up.
   *
   * So a reversed payment and the reversal that undid it both drop out, and
   * what is left is the payment as it actually stands.
   *
   * NOT on a voided ticket. There every payment is reversed, so netting would
   * leave a receipt with no payment lines at all — and a voided ticket's
   * receipt should show the money going out as plainly as it showed it coming
   * in.
   */
  const allPayments = listPayments(sale.id).filter((p) => p.amount_cents !== 0);
  const undone = new Set(
    allPayments.map((p) => p.reverses_payment_id).filter((id): id is number => id != null),
  );
  const payments =
    sale.status === "voided"
      ? allPayments
      : allPayments.filter((p) => p.reverses_payment_id == null && !undone.has(p.id));
  const methods = new Map(listPaymentMethods().map((m) => [m.id, m.label]));

  // Buying over the counter collects no sales tax, so a purchase receipt shows
  // no tax line rather than one back-calculated from the retail rate.
  const isPurchase = sale.kind === "purchase";
  const taxRate = sale.tax_rate_bp ?? Number(getSetting("tax_rate_bp"));
  const taxCents = taxIncludedInCents(sale.subtotal_cents, taxRate);
  const companyName = getSetting("company_name");
  const companyAddress = getSetting("company_address");
  const companyPhone = getSetting("company_phone");
  const footer = getSetting("receipt_footer");
  const disclaimer = getSetting("receipt_disclaimer").trim();

  // Who served them, and who did the work.
  //
  // Both are read from the employee table by id rather than snapshotted onto
  // the sale, because a receipt is reprinted from live data and a name that
  // changed (marriage, a correction to a typo) should print as it is now. The
  // *attribution* is what is frozen -- the id on the row never moves.
  const nameOf = (id: number | null): string | null => {
    if (id == null) return null;
    const row = getDb().prepare("SELECT name FROM employees WHERE id = ?").get(id) as
      | { name: string }
      | undefined;
    return row?.name ?? null;
  };
  const cashierName = nameOf(sale.cashier_id);
  /*
    The list of everyone who touched the ticket used to be built here and
    printed as one footer line. It is gone: each line now names its own man,
    right underneath itself, which is the same information without asking the
    customer to work out who did what.

    The rule about a written-in Other survives with it, down where the lookup
    now happens: the typed name prints exactly as it was typed, because a
    customer wants to know who worked on their car and "Other" tells them
    nothing. A bare Other with nothing written in prints nothing at all —
    naming it would be worse than a blank.
  */

  /**
   * When it was rung, in words.
   *
   * This line used to print the stored stamp as-is — `2026-08-04T01:06:24` —
   * which is the database's format, not a person's. A customer holding a
   * receipt reads the date to find the day they came in, and a capital T in
   * the middle of it reads as a fault in the paperwork.
   *
   * Formatted on the server on purpose. Doing it in the browser would mean the
   * printed date came from whatever locale and clock the machine at the
   * counter happened to have, and this is a document the shop may have to
   * stand behind months later.
   */
  const fmt = (iso: string): string => {
    const d = localIsoToDate(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };
  const stamp = sale.completed_at ?? sale.opened_at;
  const when = fmt(stamp);
  const businessDay = localIsoToDate(sale.business_date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const businessDayDiffers = stamp.slice(0, 10) !== sale.business_date;

  /**
   * Everything the shop knows about who this was for.
   *
   * The receipt used to print a name and a phone number and drop the rest on
   * the floor. That was backwards: the reason a big ticket is allowed to
   * interrupt a fast counter to ask for these details at all is that somebody
   * will need them later — the customer coming back about a tire, the shop
   * ringing them when the order lands. Collecting a plate and a colour and
   * then not printing them means the paper in the customer's hand cannot
   * settle the question of which car this was.
   *
   * Still every field optional and every one skipped when empty. Small tickets
   * have no customer at all and their receipts stay short.
   */
  const customer = sale.customer_id
    ? (getDb()
        .prepare("SELECT customer_no, name, phone, notes FROM customers WHERE id = ?")
        .get(sale.customer_id) as
        | {
            customer_no: string;
            name: string;
            phone: string | null;
            notes: string | null;
          }
        | undefined)
    : undefined;
  const vehicle = sale.vehicle_id
    ? (getDb()
        .prepare(
          "SELECT year, make, model, color, plate, tire_size, notes FROM vehicles WHERE id = ?",
        )
        .get(sale.vehicle_id) as
        | {
            year: string | null;
            make: string | null;
            model: string | null;
            color: string | null;
            plate: string | null;
            tire_size: string | null;
            notes: string | null;
          }
        | undefined)
    : undefined;

  /** Year Make Model, with the colour in front of it the way people describe a car. */
  const vehicleLine = vehicle
    ? [vehicle.year, vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(" ")
    : "";

  return (
    <div className="receipt-page">
      <PrintButton />

      <div className="receipt">
        {/* A letterhead, not a stack.
            The badge and the shop's details are one thing — who this is from —
            so they sit together on the left and read as a block. The ticket
            number is the opposite: it is what somebody quotes down the phone,
            and it belongs where the eye goes first on a sheet of paper, which
            is the top right corner. Centred under the address it was just
            another line of small print among four of them. */}
        <header className="receipt-head">
          <div className="receipt-ident">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="receipt-logo" />
            <div className="receipt-ident-text">
              <div className="receipt-shop">{companyName}</div>
              {companyAddress && <div className="receipt-addr">{companyAddress}</div>}
              {companyPhone && <div className="receipt-addr">{companyPhone}</div>}
            </div>
          </div>

          <div className="receipt-ref">
            {/* Typewritten and in red, because this is a reference somebody
                reads back character by character over a phone. A monospace
                figure cannot be misread the way a proportional one can — the
                1s, the zeros and the run of them all keep their own width. */}
            <div className="receipt-no">{sale.sale_no}</div>
            {/* The shop's paper reference, directly under its own. Both are
                things somebody reads back to find this job again — one is ours,
                one is theirs — so they are set the same way and sit together.
                It used to be a line in the footer among the staff names. */}
            {sale.po && <div className="receipt-po">PO {sale.po}</div>}
            <div className="receipt-meta">{when}</div>
            {/* The business day, and only when it is not the day on the clock
                above it. A ticket rung at 1am on the 4th against a business day
                of the 3rd is the one case where the two dates disagree, and it
                is exactly the case somebody later needs explained — "why is this
                on Tuesday's numbers". Printing it every time would put a second
                date on every receipt to cover a handful of late nights, and two
                dates with no reason given is how a customer decides the paper is
                wrong. */}
            {businessDayDiffers && (
              <div className="receipt-meta">Business day {businessDay}</div>
            )}
            {isPurchase && <div className="receipt-meta">PURCHASE — PAID OUT IN CASH</div>}
            {sale.status === "voided" && <div className="receipt-void">VOIDED</div>}
          </div>
        </header>

        {/* Two columns, labelled. The old version ran the customer and the car
            together as two unlabelled lines, which is fine when you already
            know what you are looking at and useless to the person who does
            not. A receipt gets read by somebody holding it a month later. */}
        {/* When a note follows, this block's rule drops to a light grey and the
            heavy navy one moves down below the note — so the three of them read
            as one band about this job rather than as two separate sections with
            a stray line of text after them. */}
        {(customer || vehicle) && (
          <section
            className={`receipt-parties${sale.notes ? " receipt-parties-open" : ""}`}
          >
            {customer && (
              <div className="receipt-party">
                <div className="receipt-party-head">Customer</div>
                <div className="receipt-party-name">{customer.name}</div>
                {customer.phone && <div>{customer.phone}</div>}
                {/* The shop's own number for them, printed small. It is what
                    somebody rings the counter and reads out. */}
                <div className="receipt-party-id">{customer.customer_no}</div>
                {customer.notes && <div className="receipt-party-note">{customer.notes}</div>}
              </div>
            )}
            {vehicle && (
              <div className="receipt-party">
                <div className="receipt-party-head">Vehicle</div>
                {vehicleLine && <div className="receipt-party-name">{vehicleLine}</div>}
                {vehicle.plate && <div>Plate {vehicle.plate}</div>}
                {/* Printed because it is the single most re-asked question in
                    a tire shop — "what size does it take" — and the answer is
                    now in the customer's pocket instead of only in the rack. */}
                {vehicle.tire_size && <div>Tire size {vehicle.tire_size}</div>}
                {vehicle.notes && <div className="receipt-party-note">{vehicle.notes}</div>}
              </div>
            )}
          </section>
        )}

        {/* The ticket's note, under the customer and the vehicle it is about.
            This is the details note — what the job is, what was agreed — which
            is the customer's business and reads as part of the same band as who
            the ticket is for. The other note on a ticket, the one the counter
            pins for itself, is deliberately not here and never prints. */}
        {sale.notes && <section className="receipt-note">{sale.notes}</section>}

        <table className="receipt-items">
          <tbody>
            {items.map((i) => {
              // Who did THIS line, rather than a list of everyone who touched
              // the ticket. The old footer line — "Work by Jerry, Franklin" —
              // told a customer with two jobs on one ticket that two men had
              // done something, and left them to guess which did which. Under
              // the line it names, there is nothing to guess.
              const by =
                i.mechanic_id != null
                  ? nameOf(i.mechanic_id)
                  : i.mechanic_name && i.mechanic_name !== "Other"
                    ? i.mechanic_name
                    : null;
              return (
                <tr key={i.id}>
                  <td className="qty">{i.qty > 1 ? `${i.qty}×` : ""}</td>
                  <td className="desc">
                    {i.description}
                    {by && <div className="receipt-worked-by">Worked by {by}</div>}
                  </td>
                  <td className="amt">{formatCents(i.line_total_cents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <table className="receipt-totals">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="amt">{formatCents(sale.subtotal_cents)}</td>
            </tr>
            {/*
              One line, at what the customer was actually charged for tipping --
              the tip plus the terminal tax on it, added together.

              The split is deliberately not shown. The terminal tax taken out of
              a tip is between the shop and the technician; putting it on the
              customer's copy invites a conversation nobody wants to have at the
              counter. Summing them also keeps the receipt's arithmetic honest:
              subtotal plus this line is exactly the total below, which would not
              be true of the tip alone.
            */}
            {sale.tip_cents + sale.comm_cents > 0 && (
              <tr>
                <td>Tip</td>
                <td className="amt">{formatCents(sale.tip_cents + sale.comm_cents)}</td>
              </tr>
            )}
            <tr className="grand">
              <td>{isPurchase ? "Paid out" : "Total"}</td>
              <td className="amt">{formatCents(sale.total_cents)}</td>
            </tr>
            {!isPurchase && (
              <tr className="tax">
                <td>Tax included ({(taxRate / 100).toFixed(2)}%)</td>
                <td className="amt">{formatCents(taxCents)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Drawn when there is money to show OR money still owed.
            It used to be gated on the payments alone, which got it exactly
            backwards: a ticket that collected nothing has no payment rows, so
            the whole block was skipped — and the receipt that most needs to say
            what is owed was the one receipt that said nothing at all. Every
            ticket handed over to be paid at the cashier printed without its
            balance. */}
        {(payments.length > 0 || sale.balance_cents !== 0) && (
          <table className="receipt-totals">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {methods.get(p.method_id) ?? "Payment"}
                    {p.kind !== "payment" ? ` (${p.kind.replace("_", " ")})` : ""}
                    {/* No SEQ. It is the shop's index into its own card batch
                        and means nothing to the customer holding this; their
                        own terminal slip is the copy that matters to them. */}
                  </td>
                  <td className="amt">{formatCents(p.amount_cents)}</td>
                </tr>
              ))}
              {/* Red and filled, unlike every other total on the page.
                  This is the one line that is not a record of what happened but
                  a claim about what still has to — the customer is walking out
                  owing this, and it is the number both sides need to agree on
                  later. Set like the rest of the totals it was a figure among
                  figures, and the money most likely to be forgotten was the
                  quietest thing on the sheet. */}
              {sale.balance_cents !== 0 && (
                <tr className="grand balance-due">
                  <td>Balance due</td>
                  <td className="amt">{formatCents(sale.balance_cents)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* The small print and the line they sign on.

            Pinned to the bottom of the page rather than sitting wherever the
            item list happens to end, because a signature line floating in the
            middle of a half-empty sheet reads as optional, and one that lands
            three lines below the last item on a full sheet reads as a
            footnote. It is the same place on every receipt, which is the only
            way the person at the counter learns to point at it without
            looking.

            Skipped entirely on a purchase: the shop is buying, so there is no
            work to authorise and nothing for the customer to accept. */}
        {!isPurchase && disclaimer && (
          <section className="receipt-sign">
            <div className="receipt-disclaimer">{disclaimer}</div>
            <div className="receipt-sign-lines">
              <div className="receipt-sign-line">
                <div className="receipt-rule" />
                <div className="receipt-sign-label">Customer signature</div>
              </div>
              <div className="receipt-sign-line receipt-sign-date">
                <div className="receipt-rule" />
                <div className="receipt-sign-label">Date</div>
              </div>
            </div>
          </section>
        )}

        <footer className="receipt-foot">
          {/*
            Named on the receipt because it is the customer's copy of who to ask
            for next time -- and because a name on the paper is the quietest
            form of accountability there is.

            Who did the WORK is no longer here beside it. "Work by Jerry,
            Franklin" told a customer with two jobs on one ticket that two men
            had done something and left them to guess which did which; it now
            sits under each line it belongs to.
          */}
          {cashierName && <div>Served by {cashierName}</div>}
          {/* The PO moved up beside the ticket number, where the other
              reference lives — see `.receipt-po`.

              The ticket's note is gone from here entirely, and deliberately.
              It is the shop writing to itself: "DEPOSIT — BALANCE ON PICKUP",
              "customer waiting", "left rim here". Useful on every internal
              screen and nobody's business on the customer's copy — at best it
              is jargon they cannot read, and at worst it is a remark about them
              handed to them in writing. */}
          <div>{footer}</div>
        </footer>
      </div>
    </div>
  );
}
