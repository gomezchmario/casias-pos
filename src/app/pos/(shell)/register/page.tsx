"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePosAuth } from "@/components/pos/PosShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatCents, parseCents } from "@/lib/money";
import { PaymentPanel } from "@/components/pos/PaymentPanel";
import { PayoutPanel } from "@/components/pos/PayoutPanel";
import { OrderedTire } from "@/components/pos/OrderedTire";
import {
  ProductSearch,
  type FoundProduct,
  type SearchAction,
} from "@/components/pos/ProductSearch";
import { TicketDetails } from "@/components/pos/TicketDetails";
import { normalizeTireSize } from "@/lib/tire-size";
import type { Sale, SaleItem } from "@/lib/sales";
import type { PaymentMethod } from "@/lib/payments";
import type { QuickButton } from "@/lib/quick-buttons";
import "./register.css";

type RegisterData = {
  quickButtons: QuickButton[];
  paymentMethods: PaymentMethod[];
  mechanics: { id: number; name: string }[];
  businessDate: string;
  tireCategories: { new_tire?: number; used_tire?: number };
  settings: {
    tipCommPerCents: number;
    tipCommChargeCents: number;
    customerPromptThresholdCents: number;
  };
};

export default function RegisterPage() {
  const { can } = usePosAuth();
  const [data, setData] = useState<RegisterData | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [mechanicId, setMechanicId] = useState<number | "">("");
  /**
   * The Other mechanic, and the name written on it.
   *
   * `null` means Other is not selected at all. A string means it is, and the
   * string is what gets written on the line — empty for plain "Other", or
   * whatever was typed, which is a label on the same bucket rather than a
   * different mechanic. This is the shop's real answer for a cousin covering a
   * Saturday or a new hire nobody has set up yet: the ticket and the receipt
   * say who did it, and the leaderboard counts it as Other, because it is work
   * the shop cannot pay a commission on and should not pretend it can.
   *
   * Kept separate from `mechanicId` rather than folded into it because the two
   * are different kinds of answer, and a sentinel id would eventually be joined
   * against `employees` by something and come back empty.
   */
  const [otherName, setOtherName] = useState<string | null>(null);
  // What kind of work this line is -- new tire, used tire, oil, disposal, other.
  // Carried from the quick button that was tapped, because that is the only
  // place the shop states it, and every report that separates new from used
  // tires reads this and nothing else.
  const [categoryId, setCategoryId] = useState<number | null>(null);
  // The stock item this line is for, when there is one. This is the link
  // between the register and the racks: `completeSale` only moves inventory for
  // lines that carry a product, so a tire rung as free text sells nothing and
  // the count silently drifts -- which is precisely the failure the spreadsheet
  // already had. Free-text lines stay possible on purpose; a flat has no
  // product and never will.
  const [picked, setPicked] = useState<FoundProduct | null>(null);
  // How many of the picked item. Only ever shown for stock — a flat is one
  // flat, and a quantity box on it is a box people fat-finger.
  const [qty, setQty] = useState(1);
  /**
   * Whether the shelf price on a picked tire may be typed over.
   *
   * A new tire has a price the shop set deliberately, and the register's job is
   * to charge it. Leaving the box open invites the number to be adjusted at the
   * counter — a dollar here to match a competitor, a rounding there — and those
   * are exactly the sales nobody can find afterwards when the margin looks
   * wrong. So the price is shown, and locked, and unlocking it is a visible act.
   *
   * Used tires are not covered by this: they have no shelf price at all, the
   * counter is where the price is decided, so their box is always open.
   */
  const [priceUnlocked, setPriceUnlocked] = useState(false);
  // On by default at the register. Ringing a sale is the one job here, and you
  // cannot fit a tire that is not on the rack -- an out-of-stock size in the
  // list is a wrong answer offered faster than the right one. It stays a
  // checkbox rather than a hard filter because the shop oversells knowingly all
  // the time: the tire is on the truck, or it is on the rack and the count is
  // wrong. One tap gets the whole catalogue back.
  const [onlyInStock, setOnlyInStock] = useState(true);
  // The "we don't carry this one" box. Manager-gated, because it writes a row
  // to the price list that every future search and report will read.
  const [orderingTire, setOrderingTire] = useState(false);
  // Carried from the search that opened the box, so the size arrives typed.
  const [orderSize, setOrderSize] = useState("");
  /**
   * Which register is on screen: the service one or the tire one.
   *
   * These were four cards stacked on top of each other, all live at once, and
   * the shop could not use it. The two jobs have nothing in common except that
   * they both end in a price — a service is picked off a grid of eight buttons
   * everybody knows by heart, a tire is searched for by size and comes off a
   * rack — and showing both at once meant the one you wanted was always the
   * half of the screen you were not looking at.
   *
   * Services is the default because that is most of the day. Nearly every
   * ticket in the shop is a flat or a mount at $5–$20; tires are the bigger
   * money but the rarer ticket, and defaulting to the rare one would cost a tap
   * on the common one all day long.
   */
  const [mode, setMode] = useState<"service" | "tire">("service");
  // Closing a ticket the customer has not paid for. Asked in a dialog because
  // it is the one button here that ends with money owed rather than money in.
  const [askUnpaid, setAskUnpaid] = useState(false);
  // Buying over the counter rather than selling. Set before the ticket exists,
  // because it decides what kind of ticket gets opened.
  const [buying, setBuying] = useState(false);
  // The ticket just closed, kept only so a receipt can be printed on request.
  const [lastSale, setLastSale] = useState<{ id: number; saleNo: string } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // The cashback panel has its own amount box. Its own ref too: two inputs
  // sharing one ref means whichever mounted last silently owns the focus, and
  // the bug that produces looks like the keyboard randomly jumping columns.
  const payoutAmountRef = useRef<HTMLInputElement>(null);

  // The note used to be a lone input here. It moved into TicketDetails, which
  // is the panel that holds everything else about who a ticket is for --
  // "customer waiting" belongs beside the name and the plate, not on its own.

  useEffect(() => {
    fetch("/api/pos/register")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setError("Could not load the register"));
  }, []);

  /**
   * The "ticket closed" banner takes itself down after a minute.
   *
   * It has to go away on its own. It is pinned across the top of the screen, so
   * a banner that waited to be dismissed would still be sitting there over the
   * next three tickets, naming a sale nobody is looking at any more — and the
   * receipt button on it would print the wrong one. A minute is long enough to
   * hand back change and decide whether they want paper.
   *
   * Keyed on the sale's id rather than the object so that closing a second
   * ticket restarts the clock instead of inheriting the first one's remainder.
   */
  useEffect(() => {
    if (!lastSale) return;
    const t = setTimeout(() => setLastSale(null), 60_000);
    return () => clearTimeout(t);
  }, [lastSale?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureSale = useCallback(async (): Promise<Sale | null> => {
    if (sale) return sale;
    const res = await fetch("/api/pos/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: buying ? "purchase" : "sale" }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "Could not start a ticket");
      return null;
    }
    setSale(d.sale);
    return d.sale as Sale;
  }, [sale, buying]);

  const addLine = useCallback(
    async (
      desc: string,
      cents: number,
      catId: number | null,
      productId: number | null = null,
      qty = 1,
    ) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setLastSale(null);
      const s = await ensureSale();
      if (!s) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/pos/sales/${s.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc,
          qty,
          unitPriceCents: cents,
          mechanicId: mechanicId === "" ? null : mechanicId,
          // Null and "" are different answers on the way out too: null is
          // nobody, "" is Other with nothing written in, which the server
          // stores as the word.
          mechanicName: otherName,
          categoryId: catId,
          productId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(d.error || "Could not add that line");
        return;
      }
      setSale(d.sale);
      setItems(d.items);
      setDescription("");
      setAmount("");
      setCategoryId(null);
      setPicked(null);
      setQty(1);
      // Back to "No mechanic" after every line, including one added by hand.
      //
      // The alternative — leaving the last name selected — is what a register
      // usually does, and it is wrong here: the commission and the leaderboard
      // are per LINE, so a name left sitting in the box quietly claims every
      // line rung after it. On a four-line ticket split between two fitters
      // that is not a typo, it is somebody else's money, and nothing on the
      // screen looks wrong at the time.
      //
      // Clearing it costs one tap per line and makes every attribution
      // deliberate. It is also what makes the auto-add gate below coherent:
      // the gate is "a mechanic was chosen for THIS line", which is only true
      // if choosing one does not persist past the line it was chosen for.
      setMechanicId("");
      // And Other folds back up with it, for the same reason. Leaving the name
      // in the box would leave it belonging to a line that has already gone.
      setOtherName(null);
    },
    [busy, ensureSale, mechanicId, otherName],
  );

  /**
   * Is this line ready to ring itself?
   *
   * A line needs a description, a price AND a mechanic before the register will
   * post it on its own. The first two were always required; the mechanic is the
   * new one, and it is the whole point of the gate.
   *
   * The register used to fire the moment it had a description and a price, so
   * tapping a service and then a price rang the line before anyone had chosen
   * who did the work — and the line was already on the ticket by the time the
   * cashier reached for the dropdown. The only fix from there was to void it and
   * ring it again, so in practice the lines went out unassigned and the
   * leaderboard undercounted every fitter.
   *
   * An unassigned line is still perfectly legal — plenty of them are genuinely
   * nobody's, and Add posts one deliberately. What is not allowed is the
   * register deciding on its own that a line has no mechanic.
   */
  // Other counts as an answer. It is a deliberate statement about who did the
  // work, so a line carrying it is as ready to ring itself as one carrying a
  // name off the grid.
  const readyToAutoAdd = mechanicId !== "" || otherName !== null;

  /** What to call the mechanic on this line, in words. */
  const mechanicLabel =
    mechanicId !== ""
      ? ((data?.mechanics ?? []).find((m) => m.id === mechanicId)?.name ?? null)
      : otherName === null
        ? null
        : otherName.trim() || "Other";

  /** A shelf price is showing and has not been deliberately opened up. */
  const priceLocked =
    picked !== null && picked.price_cents > 0 && !priceUnlocked;

  /**
   * A tire came off the search.
   *
   * Priced stock rings straight through -- one tap, which is the only way this
   * competes with the VBA form. A used size has no price by design (it is set at
   * the counter from the tire's condition), so that one loads the line and waits
   * for a number instead of guessing one.
   *
   * With no fitter chosen, a priced tire loads the same way rather than ringing:
   * everything is filled in, including the price off the rack, and it waits on
   * Add. Nothing is retyped — the only thing missing is the name.
   */
  function onPickProduct(p: FoundProduct) {
    const cat =
      p.condition === "used"
        ? (data?.tireCategories.used_tire ?? null)
        : p.condition === "new"
          ? (data?.tireCategories.new_tire ?? null)
          : null;
    if (p.price_cents > 0 && readyToAutoAdd) {
      void addLine(p.name, p.price_cents, cat, p.id, qty);
      return;
    }
    setPicked(p);
    setDescription(p.name);
    setCategoryId(cat);
    setAmount(p.price_cents > 0 ? (p.price_cents / 100).toFixed(2) : "");
    // Every pick starts locked again. Unlocking is a decision about one tire,
    // and letting it carry to the next one is how a whole afternoon of tires
    // goes out at a price nobody meant to set.
    setPriceUnlocked(false);
    amountRef.current?.focus();
  }

  /** Put the search box back. The way out of a tire picked by mistake. */
  function clearPicked() {
    setPicked(null);
    setDescription("");
    setCategoryId(null);
    setQty(1);
  }

  function onQuickAmount(cents: number) {
    // Two clicks per line is the whole point: pick a service, pick a price.
    // The category came in with the service tap and is still held in state, so
    // finishing with a price keeps it — this is the order nearly every line is
    // rung in, and losing the category here would mean losing it on most lines.
    //
    // Three clicks when nobody is picked yet: the price lands in the box and
    // the line waits on Add, so the fitter can still be chosen after the fact.
    if (description.trim() && readyToAutoAdd) {
      void addLine(description.trim(), cents, categoryId, picked?.id ?? null, qty);
      return;
    }
    setAmount((cents / 100).toFixed(2));
    amountRef.current?.focus();
  }

  function onQuickService(label: string, desc: string, catId: number | null) {
    const cents = parseCents(amount);
    if (cents !== null && cents >= 0 && readyToAutoAdd) {
      void addLine(desc || label, cents, catId);
      return;
    }
    setDescription(desc || label);
    setCategoryId(catId);
    amountRef.current?.focus();
  }

  function submitManual() {
    const cents = parseCents(amount);
    if (!description.trim()) {
      setError("Enter what the line is for");
      return;
    }
    if (cents === null || cents < 0) {
      setError("Enter a valid price");
      return;
    }
    void addLine(description.trim(), cents, categoryId, picked?.id ?? null, qty);
  }

  async function voidLine(item: SaleItem) {
    if (!sale) return;
    const res = await fetch(
      `/api/pos/sales/${sale.id}/items/${item.id}?reason=${encodeURIComponent("Removed at register")}`,
      { method: "DELETE" },
    );
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "Could not remove that line");
      return;
    }
    setSale(d.sale);
    setItems(d.items);
  }

  /**
   * Close the ticket with nothing paid against it.
   *
   * This CLOSES the sale rather than leaving it open, which is the whole point:
   * the tires are on the car and the work is done, so the stock has to come off
   * the racks and the total has to freeze at what was quoted. An open ticket
   * would do neither, and a price change next week would silently rewrite what
   * the customer owes.
   *
   * The ledger already handles the rest — no payment rows means `paid_cents` is
   * zero and `balance_cents` is the full total, which is exactly what a special
   * order paid in instalments looks like. It shows as owing on Main and can be
   * settled from the ticket drawer whenever they come back with the money.
   */
  async function leaveUnpaid() {
    if (!sale || busy) return;
    setBusy(true);
    setError(null);
    // No explicit save of the details panel first. Clicking this button blurs
    // whatever field was in focus, which sends them; and the details route
    // happily edits a closed ticket, so a slow save that lands after the
    // completion still lands on the right sale.
    const res = await fetch(`/api/pos/sales/${sale.id}/complete`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not close the ticket");
      return;
    }
    setAskUnpaid(false);
    finishTicket(sale.id);
  }

  /**
   * Move between the service register and the tire one.
   *
   * Clears whatever line was half-built, because it belonged to the register
   * being left. A description typed as a service and then priced as a tire is a
   * line nobody can explain a month later.
   */
  function switchMode(next: "service" | "tire") {
    if (next === mode) return;
    setMode(next);
    setDescription("");
    setAmount("");
    setCategoryId(null);
    setPicked(null);
    setQty(1);
    setError(null);
  }

  // Printing is offered, not forced — most tickets here are $5–$20 and the
  // customer doesn't want paper. The link stays up until the next ticket is
  // rung, which is long enough to catch the one that does.

  function finishTicket(finishedSaleId: number) {
    setLastSale(sale ? { id: finishedSaleId, saleNo: sale.sale_no } : null);
    setSale(null);
    setItems([]);
    setDescription("");
    setAmount("");
    setCategoryId(null);
    setBuying(false);
    setError(null);
  }

  // Untracked stock (a can of oil, a disposal fee) has no count to be out of,
  // so it is never hidden — only things the racks are actually meant to hold.
  //
  // Used sizes are never hidden either, for a different reason: a used tire can
  // arrive without anybody receiving it. Somebody leaves their old set behind at
  // a change and an hour later the next customer wants one off it. The count
  // reads zero because the count is about what was written down, not about what
  // is leaning against the wall — so hiding the row would make the one tire the
  // shop can definitely sell the one tire the register refuses to find.
  const stockFilter = useMemo(
    () =>
      onlyInStock
        ? (p: FoundProduct) =>
            p.track_inventory !== 1 || p.on_hand > 0 || p.condition === "used"
        : undefined,
    [onlyInStock],
  );

  /**
   * Give a used size a row, then put it on the ticket.
   *
   * Get-or-create on the server, which is what makes this safe to offer every
   * time the size is missing from the list: press it on a size that has been
   * selling since March and you get back that same row, count and all, rather
   * than a second 215-55-16 for the counter to pick the wrong one of.
   */
  async function ringUsedTire(size: string) {
    const res = await fetch("/api/pos/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "tire", condition: "used", tireSize: size }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "Could not add that size");
      return;
    }
    onPickProduct(d.product);
  }

  /**
   * The two tires the search can never find, offered where it fails to find
   * them.
   *
   * Both were unreachable from here. A used size had no path at all — the shop
   * takes a customer's old set in at a change and sells one off it an hour
   * later, and the register could not name the thing being sold. A tire being
   * ordered in had a link above the box, which is a place nobody looks after
   * the list has come back empty.
   *
   * Only on something that reads as a size. Typing a brand is not a request to
   * invent a product, and "sell a used vantage" is not a tire anybody can hand
   * to a customer.
   */
  function tireActions(raw: string, shown: FoundProduct[]): SearchAction[] {
    if (!can("manageProducts")) return [];
    const size = normalizeTireSize(raw);
    if (!size) return [];
    const acts: SearchAction[] = [];
    // Stands down when the used row is already on screen. Two ways to sell the
    // same used 215-55-16, a foot apart, is a decision the counter has to stop
    // and make in front of a customer.
    if (!shown.some((p) => p.condition === "used" && p.tire_size === size)) {
      acts.push({
        key: `used-${size}`,
        label: `Sell a used ${size}`,
        hint: "Priced here at the counter — a used tire carries no set price",
        run: () => void ringUsedTire(size),
      });
    }
    acts.push({
      key: `order-${size}`,
      label: `Order in a new ${size}`,
      hint: "Goes on this ticket and on the price list; racks stay at none",
      run: () => {
        setOrderSize(size);
        setOrderingTire(true);
      },
    });
    return acts;
  }

  const amountButtons = useMemo(
    () => data?.quickButtons.filter((b) => b.kind === "amount") ?? [],
    [data],
  );
  const serviceButtons = useMemo(
    () => data?.quickButtons.filter((b) => b.kind !== "amount") ?? [],
    [data],
  );

  if (!data) {
    return <div className="text-brand-300">Loading register…</div>;
  }
  if (!can("ringSale")) {
    return <div className="text-brand-400">Your account can&apos;t ring sales.</div>;
  }

  const liveItems = items.filter((i) => !i.voided);

  // Buying, not selling. Everything in the left-hand column is priced to sell —
  // the shelf prices, the service grid, the stock search — and none of it means
  // anything when the shop is the one handing money over. It comes off the
  // screen rather than sitting there greyed out, because a $100 shelf button
  // within reach of a $45 buyback is a mistake waiting for a busy Saturday.
  const purchasing = buying || sale?.kind === "purchase";

  // The technicians actually on this ticket, in the order their work was rung.
  // A tip belongs to one of these people and nobody else, so this is what the
  // payment panel offers rather than the shop's whole roster -- a list of
  // fifteen names to pick from would guarantee the wrong one gets picked.
  const ticketMechanics = [
    ...new Set(
      liveItems
        .map((i) => i.mechanic_id)
        .filter((id): id is number => id != null),
    ),
  ]
    .map((id) => data.mechanics.find((m) => m.id === id))
    .filter((m): m is { id: number; name: string } => m != null);

  return (
    <>
      {/* The ticket just closed. This used to be a small green note tucked into
          the top of the ticket panel, which is the one place on the screen
          nobody looks at after a sale ends -- the panel empties out and the eye
          goes back to the buttons on the left. Half the time the receipt was
          asked for a moment later and the note had already been scrolled past
          or built over by the next ticket.

          So it is across the whole width, above everything, with the receipt as
          a real button rather than a line of underlined text. It closes on
          demand and, failing that, on its own after a minute. */}
      {lastSale && (
        <div className="mb-5 flex items-center gap-4 rounded-2xl bg-green-50 px-5 py-4 shadow-sm ring-1 ring-green-600/15">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-green-900">
              {lastSale.saleNo} done
            </div>
            <div className="text-sm text-green-800/70">
              Paid and closed. This notice clears itself in a minute.
            </div>
          </div>
          <a
            href={`/pos/sale/${lastSale.id}/receipt`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800"
          >
            Print a receipt
          </a>
          <button
            type="button"
            aria-label="Close this notice"
            title="Close this notice"
            className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-green-900/50 hover:bg-green-600/10 hover:text-green-900"
            onClick={() => setLastSale(null)}
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
      <div>
        {purchasing && (
          <div className="bg-white rounded-2xl shadow-sm p-4 text-sm text-brand-400">
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">
              Cashback
            </div>
            <p>
              The shop is buying, so the selling controls are put away. Type what
              you are buying and what you are paying for it on the right, add as
              many lines as you need, then pay out.
            </p>
            <p className="mt-2">
              None of it counts as a sale: no commission, no technician, and
              nobody&apos;s week moves. It comes out of the drawer and shows on the
              close-out.
            </p>
          </div>
        )}

        {/* Which of the two registers is on screen. Big, and the only thing
            above the working area, because it changes everything below it —
            a small toggle for a change this large is how somebody ends up
            typing a tire size into the service box and wondering why the
            racks never move. */}
        {!purchasing && (
          <div
            className="grid gap-2 mb-4"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            {(
              [
                ["service", "Services"],
                ["tire", "Tires"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="btn"
                style={{
                  height: 52,
                  fontSize: 17,
                  fontWeight: 600,
                  background: mode === value ? "#0a2540" : "#fff",
                  color: mode === value ? "#fff" : "#0a2540",
                  boxShadow: mode === value ? undefined : "0 1px 2px rgba(10,37,64,0.10)",
                }}
                onClick={() => switchMode(value)}
                aria-pressed={mode === value}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Cashback is not here. It lives at the foot of the ticket panel — see
            the note beside it there. */}

        {/* Selling from the racks. A tire rung through here carries its product,
            which is the only thing that makes stock come down when the ticket is
            paid — a free-text "NEW 215-55-17" sells nothing off the shelf. */}
        {!purchasing && mode === "tire" && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="text-xs uppercase tracking-wider text-brand-300">From stock</div>
              <label className="flex items-center gap-1.5 text-xs text-brand-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyInStock}
                  onChange={(e) => setOnlyInStock(e.target.checked)}
                />
                Only show current stock
              </label>
            </div>
          </div>
          {/* The mechanic used to be a third column here and a dropdown down in
              the service card — the same one selection, drawn twice, in two
              places, either of which could be the one somebody was looking at.
              It is now a keypad of its own below both. */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "minmax(0,1fr) 72px" }}
          >
            {picked ? (
              <div className="picked-tire">
                <div className="min-w-0 flex-1">
                  <div className="picked-tire-name">{picked.name}</div>
                  {picked.track_inventory === 1 && (
                    <div className="picked-tire-stock">{picked.on_hand} on hand</div>
                  )}
                </div>
                <button
                  type="button"
                  className="picked-tire-clear"
                  onClick={clearPicked}
                >
                  Clear
                </button>
              </div>
            ) : (
              <ProductSearch
                onPick={onPickProduct}
                placeholder="Size, brand or name…"
                filter={stockFilter}
                actions={tireActions}
              />
            )}
            <input
              className="input text-center tabular-nums"
              inputMode="numeric"
              title="How many"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          {/* A used tire has no price until somebody has looked at it, so this
              row appears once one is picked and takes the number decided at the
              counter. It lives here rather than in the service register's
              free-text row because that row is not on screen in this mode — and
              because a used tire priced through the service box would lose its
              product link and quietly stop moving stock, which is the exact
              drift the spreadsheet already had. */}
          {picked && (
            <div
              className="grid gap-3 mt-3"
              style={{ gridTemplateColumns: "130px minmax(0,1fr) auto" }}
            >
              <input
                ref={amountRef}
                className="input text-right tabular-nums"
                placeholder="0.00"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
                readOnly={priceLocked}
                title={
                  priceLocked
                    ? "This is the shelf price. Tick Edit price to change it."
                    : undefined
                }
                style={
                  priceLocked
                    ? { background: "rgba(10,37,64,0.04)", cursor: "not-allowed" }
                    : undefined
                }
              />
              {/* The tire's name used to be repeated here, a hand's width below
                  where it already says which tire is picked, and it was the only
                  thing in the row that could not be acted on. The lock belongs
                  in its place: it sits against the box it governs, so what the
                  tick does is obvious without reading anything. */}
              {picked.price_cents > 0 ? (
                // Styled as a pill that lights up amber when it is on, because
                // an unlocked price is a state the ticket is in, not a setting
                // that was toggled once. A bare checkbox reads as neither, and
                // this one has to be noticeable from across the counter — it is
                // the difference between the shop's price and somebody's.
                <label
                  className="self-center justify-self-start inline-flex items-center gap-2 text-xs cursor-pointer select-none rounded-lg px-2.5 py-1.5 transition-colors"
                  style={{
                    background: priceUnlocked ? "rgba(255,200,61,0.22)" : "transparent",
                    color: priceUnlocked ? "#7c4a03" : "rgba(10,37,64,0.55)",
                  }}
                  title={
                    priceUnlocked
                      ? "This line will be flagged as sold off the shelf price."
                      : "Unlock to charge something other than the shelf price."
                  }
                >
                  <input
                    type="checkbox"
                    className="accent-amber-500"
                    checked={priceUnlocked}
                    onChange={(e) => {
                      setPriceUnlocked(e.target.checked);
                      // Locking again puts the shelf price back. Half-typed
                      // numbers left behind by a change of mind are how a tire
                      // goes out at $4 instead of $145.
                      if (!e.target.checked) {
                        setAmount((picked.price_cents / 100).toFixed(2));
                      } else {
                        amountRef.current?.focus();
                        amountRef.current?.select();
                      }
                    }}
                  />
                  <span className="whitespace-nowrap">
                    {priceUnlocked ? "Price edited" : "Edit price"}
                  </span>
                </label>
              ) : (
                <div className="self-center text-xs text-brand-300">
                  Priced at the counter
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitManual}
                disabled={busy}
              >
                Add
              </button>
            </div>
          )}
          {/* Amber once the price is open, because at that point the sentence
              is a consequence rather than an instruction, and it has to be
              read before Add is pressed — not discovered on the close-out. */}
          <p
            className="text-xs mt-2"
            style={{ color: priceUnlocked ? "#b45309" : undefined }}
          >
            <span className={priceUnlocked ? "" : "text-brand-300"}>
              {picked
                ? picked.price_cents > 0
                  ? priceUnlocked
                    ? `Selling off the shelf price of ${formatCents(picked.price_cents)}. This line will be flagged on Entries and the close-out.`
                    : "Price is off the rack. Pick who fitted it, then Add."
                  : "Used tires are priced at the counter — enter the price and add."
                : readyToAutoAdd
                  ? "Picking a priced tire rings it straight through and takes it off the rack. Used tires and batteries are rung here too."
                  : "Pick the fitter and a priced tire rings straight through. Used tires and batteries are rung here too."}
            </span>
          </p>
        </div>
        )}

        {!purchasing && mode === "service" && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          {/* Two rows, not four columns. Four fixed columns plus their gaps came
              to more than this card is wide, so the description column was
              squeezed to nothing and the Add button overflowed the card and slid
              under the ticket panel — clipped and unclickable. Giving the
              description its own row means the layout cannot run out of width
              however narrow the window gets, and `minmax(0,…)` below stops a
              long mechanic name doing the same thing again. */}
          <input
            className="input w-full mb-3"
            placeholder="What's it for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && amountRef.current?.focus()}
          />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "130px minmax(0,1fr)" }}
          >
            <input
              ref={amountRef}
              className="input text-right tabular-nums"
              placeholder="0.00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitManual()}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitManual}
              disabled={busy}
            >
              Add
            </button>
          </div>
        </div>
        )}

        {/* Who did the work — a keypad, not a dropdown, and above the prices.
            Three things drove this. It is the same kind of choice as a service
            and a price, so it should be the same kind of control: a name is
            one tap instead of open-scan-tap, and on a screen where a whole
            ticket is four taps a dropdown was the slowest thing on it. It is
            ONE control now rather than one per register, so there is no longer
            a version of this selection that somebody might be looking at while
            the other one is the live one. And it is the only field on this
            screen that has to be re-answered for every single line, which
            makes it the one most likely to be left on the last person's
            name — so it is now impossible to not see what it currently says.

            Above the prices because a price is what FINISHES a line and rings
            it. Anything that has to be true before the line is rung has to be
            above the button that rings it, or it is being asked for after the
            answer was needed. */}
        {!purchasing && (
          <div
            className="bg-white rounded-2xl shadow-sm p-4 mb-4"
            style={{
              // The card itself carries the state. Nothing picked is not a
              // neutral condition here -- it means the next tap will not ring
              // anything, it will sit and wait for Add -- so the card is tinted
              // and ringed until somebody is chosen. It goes quiet the moment
              // one is, and comes back by itself after every line.
              boxShadow: mechanicLabel === null ? "0 0 0 2px rgba(255,200,61,0.55)" : undefined,
              background: mechanicLabel === null ? "#fffdf5" : undefined,
            }}
          >
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-brand-300">
                Mechanic
              </div>
              {/* Says the answer in words next to the label, so the state
                  survives being read from across the counter at an angle where
                  which button is filled is not obvious. */}
              <div className="text-xs">
                {mechanicLabel === null ? (
                  <span style={{ color: "#b45309" }}>
                    nobody picked — the line will wait for Add
                  </span>
                ) : (
                  <span className="font-semibold text-brand-500">
                    {mechanicLabel}
                    {/* Says out loud that a written-in name is still Other, so
                        nobody types one and then goes looking for it on the
                        leaderboard next week. */}
                    {otherName !== null && otherName.trim() !== "" && (
                      <span className="text-brand-300"> — counts as Other</span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="keypad">
              {data.mechanics.map((m) => {
                const on = mechanicId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="btn"
                    style={{
                      height: 56,
                      fontSize: 15,
                      fontWeight: 600,
                      // Filled navy when chosen, outlined when not. The same
                      // navy as the price grid on purpose: these are the two
                      // halves of one line, and a third colour would have
                      // implied a third kind of thing.
                      background: on ? "#0a2540" : "#fff",
                      color: on ? "#fff" : "#0a2540",
                      border: on ? "2px solid #0a2540" : "2px solid rgba(10,37,64,0.15)",
                      // The amber ring is the shop's attention colour, and it
                      // is what makes the picked name findable at a glance in
                      // a grid of eight.
                      boxShadow: on ? "0 0 0 3px rgba(255,200,61,0.65)" : undefined,
                    }}
                    // Tapping the picked name again clears it. Faster than
                    // hunting for a "none" cell, and it means the control has
                    // no state a single tap cannot get out of.
                    onClick={() => {
                      setMechanicId(on ? "" : m.id);
                      setOtherName(null);
                    }}
                    disabled={busy}
                  >
                    {m.name}
                  </button>
                );
              })}
              {/* The one cell that is a real answer without being a person.
                  Selected like any other name — it just opens a box as well,
                  because the whole point is that Other can carry a label. */}
              <button
                type="button"
                className="btn"
                style={{
                  height: 56,
                  fontSize: 15,
                  fontWeight: 600,
                  background: otherName !== null ? "#0a2540" : "#fff",
                  color: otherName !== null ? "#fff" : "#0a2540",
                  border:
                    otherName !== null
                      ? "2px solid #0a2540"
                      : "2px solid rgba(10,37,64,0.15)",
                  boxShadow:
                    otherName !== null ? "0 0 0 3px rgba(255,200,61,0.65)" : undefined,
                }}
                onClick={() => {
                  setMechanicId("");
                  setOtherName(otherName === null ? "" : null);
                }}
                disabled={busy}
                title="Somebody who is not on the floor list"
              >
                Other
              </button>
              {/* Deliberately last and deliberately unlike the others: it is
                  not a person, and unlike Other it is not a claim either. It
                  says nobody did this. Dashed and grey so the eye skips it
                  while looking for a name. */}
              <button
                type="button"
                className="btn"
                style={{
                  height: 56,
                  fontSize: 13,
                  fontWeight: 600,
                  background: "transparent",
                  color: "rgba(10,37,64,0.45)",
                  border: "2px dashed rgba(10,37,64,0.20)",
                }}
                onClick={() => {
                  setMechanicId("");
                  setOtherName(null);
                }}
                disabled={busy}
                title="Ring this line against nobody"
              >
                No mechanic
              </button>
            </div>

            {/* Open only while Other is chosen, and optional even then. Nothing
                typed is a complete answer — the line is Other — so the box
                never blocks a sale; it is there for the times somebody wants
                the ticket and the receipt to say a name. */}
            {otherName !== null && (
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(10,37,64,0.10)" }}>
                <input
                  className="input w-full"
                  placeholder="Who was it? (optional — leave blank for just “Other”)"
                  value={otherName}
                  maxLength={60}
                  onChange={(e) => setOtherName(e.target.value)}
                  // Escape backs out of Other entirely rather than just
                  // clearing the text, because a blank box and no box look the
                  // same and mean different things.
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOtherName(null);
                  }}
                  disabled={busy}
                  autoFocus
                />
                <p className="text-xs text-brand-300 mt-2">
                  Whatever you write shows on the ticket and the receipt. It still
                  counts as Other on the leaderboard — a name here is a note, not
                  somebody on the payroll.
                </p>
              </div>
            )}

            <p className="text-xs text-brand-300 mt-2">
              {readyToAutoAdd
                ? "A price now finishes the line and rings it. This clears after every one."
                : "It belongs to the line, not the ticket, so it is asked again for each one."}
            </p>
          </div>
        )}

        {/* Prices belong to the service register only.

            These are the shop's service prices — $5 to $35, the amounts a flat
            or a rotation is rung at. No tire has ever cost that. A used one goes
            out somewhere around fifty and a new one at three times the top
            button, so on the tire register the whole grid is eight wrong
            answers, offered in the largest type on the screen, right where the
            correct one has to be typed.

            They were shown for used tires on the reasoning that a used price is
            genuinely chosen at the counter and a tap beats typing. True about
            the choosing; wrong about the buttons, because none of them is a
            number anybody would choose. What they actually did was make the
            tire register look like the service one at the moment the two are
            least alike — so it read as a screen waiting for a service, and it
            put a $20 button one slip of the thumb from a $60 tire. */}
        {!purchasing && mode === "service" && (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Price</div>
          <div className="keypad">
            {amountButtons.map((b) => (
              <button
                key={b.id}
                type="button"
                className="btn"
                style={{ background: "#0a2540", color: "#fff", height: 56, fontSize: 18 }}
                onClick={() => onQuickAmount(b.amount_cents ?? 0)}
                disabled={busy}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {!purchasing && mode === "service" && (
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">Service</div>
          <div className="keypad">
            {serviceButtons.map((b) => (
              <button
                key={b.id}
                type="button"
                className="btn"
                style={{
                  background: "rgba(255,200,61,0.22)",
                  color: "#0a2540",
                  height: 56,
                  fontSize: 14,
                  fontWeight: 600,
                }}
                onClick={() =>
                  onQuickService(b.label, b.description ?? b.label, b.category_id)
                }
                disabled={busy}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      <div>
        <div className="bg-white rounded-2xl shadow-sm p-4 sticky" style={{ top: 16 }}>
          {/* "TICKET S-2026-000118", not a bare number. Same treatment as the
              drawer on Entries, and for the same reason: on a screen where
              every other string is a service or a tender, the number needs the
              word in front of it to say what kind of thing it is. */}
          {/* Barely any gap under the header on purpose: the details hang off
              the ticket number, and space between them would read as two
              separate things stacked rather than one belonging to the other.
              The room is all kept underneath, where the lines start. */}
          <div className="flex items-baseline justify-between mb-1">
            <div className="flex items-baseline gap-2 font-semibold text-brand-500">
              {sale ? (
                <>
                  <span className="tracking-wide">TICKET</span>
                  <span className="tabular-nums">{sale.sale_no}</span>
                </>
              ) : (
                <span>{buying ? "Cashback" : "New ticket"}</span>
              )}
            </div>
            <div className="text-xs text-brand-300">{data.businessDate}</div>
          </div>

          {/* Who the ticket is for, directly under its number and indented to
              hang off it — the details belong to the ticket as a whole, which
              the position now says without needing a label to.

              Above the lines rather than below them, because that is the order
              the counter works in: a job big enough to want a name gets the
              name taken while the customer is still talking, and the lines go
              on afterwards. Underneath the lines it sat below the fold on any
              ticket with more than about four of them, which on a set of tires
              is every one of them.

              Not on a cashback ticket. The shop buying a used tire off somebody
              has no vehicle and no P.O., and the one field that would apply —
              who it came from — is not what this panel is for. */}
          {sale && sale.kind !== "purchase" && (
            <div className="mb-3 pl-3">
              <TicketDetails
                // Keyed on the ticket so a new one starts with empty boxes
                // rather than inheriting the last customer's name — which is
                // the single most expensive thing this panel could get wrong.
                key={sale.id}
                sale={sale}
                thresholdCents={data.settings.customerPromptThresholdCents}
                onSaved={setSale}
                onError={setError}
              />
            </div>
          )}

          {/* The Cashback toggle used to sit here. It moved to the mode
              buttons on the left, where choosing what kind of ticket this is
              belongs — see the note there. */}

          {(buying || sale?.kind === "purchase") && (
            <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
              Cash leaves the drawer. This is not a sale: it earns no commission and
              counts against nobody&apos;s week.
            </div>
          )}

          {/* The cashback line is typed right here rather than in the sales
              column to the left. Everything over there -- the quick prices, the
              service grid, the stock search -- is priced to SELL, and a payout
              typed into a form built for selling is how a $45 buyback gets rung
              at the $100 shelf price. One box, one amount, one button. */}
          {purchasing && (
            <div className="flex flex-col gap-2 mb-3">
              <input
                className="input text-sm"
                placeholder="What are you buying? (used 205-55-16, scrap…)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && payoutAmountRef.current?.focus()}
              />
              <input
                ref={payoutAmountRef}
                className="input text-right tabular-nums"
                placeholder="0.00"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
              />
              <button
                type="button"
                className="btn w-full"
                style={{ height: 48, fontSize: 16, background: "#a71d24", color: "#fff" }}
                onClick={submitManual}
                disabled={busy}
              >
                {busy ? "Working…" : "Add what you paid"}
              </button>
            </div>
          )}

          {liveItems.length === 0 ? (
            purchasing ? null : (
              <div className="text-sm text-brand-300 py-8 text-center">
                Tap a service, then a price.
              </div>
            )
          ) : (
            <div className="flex flex-col divide-y divide-black/5">
              {liveItems.map((i) => (
                <div key={i.id} className="py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-brand-500 truncate">{i.description}</div>
                    {i.mechanic_id && (
                      <div className="text-xs text-brand-300">
                        {data.mechanics.find((m) => m.id === i.mechanic_id)?.name}
                      </div>
                    )}
                  </div>
                  <div className="text-sm tabular-nums text-brand-500">
                    {formatCents(i.line_total_cents)}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:text-red-800"
                    onClick={() => void voidLine(i)}
                    aria-label={`Remove ${i.description}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {sale && (
            <div className="mt-3 pt-3 border-t border-black/10 flex justify-between text-lg font-semibold text-brand-500">
              <span>Total</span>
              <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
            </div>
          )}

          {/* The customer panel used to sit here, under the total. It moved up
              to directly beneath the ticket number — see the note there. */}

          {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

          {sale &&
            liveItems.length > 0 &&
            (sale.kind === "purchase" ? (
              <PayoutPanel
                sale={sale}
                methods={data.paymentMethods}
                onError={setError}
                onDone={finishTicket}
              />
            ) : (
              <PaymentPanel
                sale={sale}
                methods={data.paymentMethods}
                mechanics={ticketMechanics}
                commPerCents={data.settings.tipCommPerCents}
                commChargeCents={data.settings.tipCommChargeCents}
                onError={setError}
                onDone={finishTicket}
              />
            ))}

          {/* Work done, money not collected. Deliberately understated and
              underneath the payment panel: it is a real part of the shop's day
              — the customer who is coming back Friday with the rest — but it is
              never the button you want if the money is on the counter, and a
              second big button beside "Complete sale" is one mis-tap away from
              a ticket nobody ever chases. */}
          {sale && liveItems.length > 0 && sale.kind !== "purchase" && (
            <button
              type="button"
              // Red, because of what it is rather than how dangerous it is:
              // this is the one button on the screen that ends a ticket with
              // money still owed, and it should read as a debt being created
              // even while it stays small enough not to compete with Complete
              // sale.
              className="w-full mt-2 text-xs text-red-700 underline hover:text-red-900"
              onClick={() => setAskUnpaid(true)}
              disabled={busy}
            >
              Close it unpaid — customer owes {formatCents(sale.subtotal_cents)}
            </button>
          )}

          {/* Cashback, at the very foot of the ticket and centred.
              It was a full-width button here once, sitting directly above the
              money, where it was the most prominent control on the panel and
              the least used one — a handful of buybacks a week keeping station
              next to every sale of the day. This is the opposite end of that:
              last thing on the panel, small, pale enough to be missed by
              anybody not looking for it.

              Only on an empty ticket. Once lines are on it the shop has already
              decided which direction the money is going, and a switch that
              would throw them away does not belong within reach of the
              Complete sale button. */}
          {!sale && can("cashPurchase") && (
            <div className="mt-4 pt-3 border-t border-black/5 text-center">
              <button
                type="button"
                className="text-xs underline"
                // Red once buying is on: at that point it is no longer the way
                // in, it is the way out, and the one thing on screen that says
                // the register is in the mode you probably did not want.
                style={{ color: buying ? "#a71d24" : "#CCC2AA" }}
                onClick={() => {
                  // Anything half-typed belonged to the other kind of ticket.
                  setDescription("");
                  setAmount("");
                  setCategoryId(null);
                  setPicked(null);
                  setQty(1);
                  setError(null);
                  setBuying((b) => !b);
                }}
                aria-pressed={buying}
              >
                {buying ? "← Back to selling" : "Cashback — the shop is buying"}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={askUnpaid}
        onCancel={() => setAskUnpaid(false)}
        onConfirm={() => void leaveUnpaid()}
        title="Close without payment?"
        confirmLabel="Yes, they owe it"
        cancelLabel="Go back"
        busy={busy}
      >
        <p>
          The ticket closes for <strong>{sale ? formatCents(sale.subtotal_cents) : ""}</strong>{" "}
          with nothing paid, and any tires on it come off the racks.
        </p>
        <p className="mt-2">
          It shows as owing on Main until somebody takes the money, and the total
          is frozen now — a price change later will not move what they owe.
        </p>
      </ConfirmModal>

      <OrderedTire
        open={orderingTire}
        onClose={() => setOrderingTire(false)}
        onCreated={onPickProduct}
        showCosts={can("viewCosts")}
        initialSize={orderSize}
      />
      </div>
    </>
  );
}
