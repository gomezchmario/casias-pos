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
import { useLang } from "@/components/pos/LangToggle";

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

/**
 * How many, with a way to change it that is not the keyboard.
 *
 * The box on its own is right for four, which somebody types. It is wrong for
 * the far commoner two and three, where a tap beats selecting a digit and
 * replacing it — and on a touch screen at a counter, selecting a digit inside a
 * 72px box is a small target reached with a thumb that has tire dressing on it.
 *
 * Stacked rather than either side, and the pair is exactly as tall as the box,
 * so the row keeps one baseline and one height whichever card it sits in. Plus
 * on top because up is more, which is the only thing about this anybody should
 * have to work out.
 *
 * `tabIndex={-1}` deliberately: tabbing through this row should go price, how
 * many, Add, the same three stops it has always had. Somebody working the
 * keyboard is typing the number anyway, and two extra stops between the field
 * and the button would slow down the path this screen is actually built for.
 */
function QtyBox({
  value,
  onChange,
  onBlur,
  onStep,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onStep: (delta: number) => void;
}) {
  const { t: tr } = useLang();
  return (
    <div className="qty-box">
      <input
        className="input text-center tabular-nums"
        inputMode="numeric"
        title={tr("How many")}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={onBlur}
      />
      <div className="qty-step">
        <button type="button" onClick={() => onStep(1)} tabIndex={-1} aria-label={tr("One more")}>
          +
        </button>
        <button type="button" onClick={() => onStep(-1)} tabIndex={-1} aria-label={tr("One fewer")}>
          −
        </button>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const { t: tr } = useLang();
  const { can, user } = usePosAuth();
  /**
   * Is this the forecourt, rather than the counter?
   *
   * A service writer meets the vehicle, writes up the work, and leaves the
   * ticket for the customer to pay inside — so the ordinary ending of a ticket
   * for him is the one that is an exception for everybody else. The two buttons
   * swap weight rather than one of them disappearing: he can still take money
   * when he is covering the register, it is just not what the screen offers him
   * first.
   *
   * Keyed on the role rather than a setting, because it is a fact about the job
   * somebody is doing, not a preference. A cashier borrowing his tablet gets
   * the cashier's register the moment they PIN in.
   */
  const writing = user.role === "writer";
  /** Payment brought forward on a writer's screen. Always on for everyone else. */
  const [takingPayment, setTakingPayment] = useState(false);
  const [data, setData] = useState<RegisterData | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  /**
   * Whether the tender chosen below is the house account.
   *
   * Lifted out of the payment panel because it changes what the DETAILS panel
   * above must do: a tab needs a name and a number to chase later, so choosing
   * it opens that panel, keeps it open, and makes those two boxes required.
   */
  const [accountTender, setAccountTender] = useState(false);
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
  /**
   * How many, as TEXT rather than a number.
   *
   * It was a number with `Math.max(1, …)` on every keystroke, which meant the
   * box could never be empty: clearing it put a 1 straight back, so typing 2
   * over it gave you 12 or 21 depending on where the caret was. The only way to
   * ring two tires was to notice the field, select the 1, and overtype it —
   * which nobody did, so tires went out one line at a time or in the wrong
   * quantity.
   *
   * Held as a string so it can legally be empty while somebody is typing, and
   * read through `qtyNum` at the moment a line is actually posted.
   */
  const [qty, setQty] = useState("1");
  const qtyNum = Math.max(1, parseInt(qty, 10) || 1);
  /* Steps off `qtyNum` rather than the raw text, so − on an empty box gives 1
     instead of doing nothing, and it floors at one: zero of something is not a
     line, it is a line that should not have been added. */
  const stepQty = (delta: number) => setQty(String(Math.max(1, qtyNum + delta)));
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
  /**
   * "It's on order" and "they left the car", answered before there is a ticket.
   *
   * Both questions get asked while the customer is still standing there and
   * before anything has been rung, so the two buttons that set them are on
   * screen from the moment the register loads. What they must NOT do is open a
   * ticket to have somewhere to put the answer: a mis-tap would leave a numbered
   * $0 ticket with no lines on it sitting on the day for good, and a ticket
   * nobody can explain is worse than a flag set a few seconds late.
   *
   * So the answer waits here in the browser until the first line is rung, and
   * rides onto the ticket the moment one exists. Nothing reaches the database
   * until there is a sale to attach it to.
   */
  const [pendingOrder, setPendingOrder] = useState(false);
  const [pendingVehicle, setPendingVehicle] = useState(false);
  // The ticket just closed, kept only so a receipt can be printed on request.
  const [lastSale, setLastSale] = useState<{ id: number; saleNo: string } | null>(null);
  /**
   * The ticket number this register picked up rather than opened.
   *
   * Said out loud on screen, because the alternative is somebody walking up to
   * a register that already has four lines on it and adding a new customer's
   * flat to the last customer's ticket. The adoption is the right behaviour —
   * see the effect below — and it is exactly the kind of right behaviour that
   * has to announce itself.
   */
  const [resumed, setResumed] = useState<string | null>(null);
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
   * Pick up a ticket somebody already started instead of opening a second one.
   *
   * A draft happens when a ticket is rung and then walked away from — the
   * customer goes to fetch a card, somebody switches user, the tab gets closed.
   * Coming back to a blank register and ringing the same job again leaves the
   * first one behind for good: a numbered ticket with lines on it that nobody
   * will ever complete, sitting on the day as money the shop appears to be owed.
   * That is the whole reason the Pending box exists on Main, and this is the
   * other half of the fix — stop making them.
   *
   * TODAY'S ONLY, and of the kind the register is currently in. A draft from
   * last Tuesday is something to clear up on Main with time to look at it, not
   * something to silently resume with a customer standing at the counter. And a
   * cashback ticket is not a sale, so neither may adopt the other.
   *
   * Newest first, because if there are somehow two, the one somebody was most
   * recently working on is the one they meant to come back to.
   *
   * Runs once, on load. Not after a sale completes: `reset` clears the ticket
   * deliberately and re-adopting there would make finishing a sale impossible.
   */
  useEffect(() => {
    if (!data || sale) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/pos/sales?scope=open");
      if (!res.ok) return;
      const d = (await res.json().catch(() => ({}))) as { sales?: Sale[] };
      const kind = buying ? "purchase" : "sale";
      const draft = (d.sales ?? []).find(
        (s) => s.kind === kind && s.business_date === data.businessDate,
      );
      if (!draft || cancelled) return;

      // Its lines as well as its header. Adopting the header alone would show an
      // empty ticket carrying a total, which reads as a bug.
      const full = await fetch(`/api/pos/sales/${draft.id}`);
      if (!full.ok || cancelled) return;
      const detail = (await full.json().catch(() => ({}))) as {
        sale?: Sale;
        items?: SaleItem[];
      };
      if (!detail.sale || cancelled) return;
      setSale(detail.sale);
      setItems(detail.items ?? []);
      setResumed(detail.sale.sale_no);
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on `sale`: this is a once-on-load adoption, and
    // re-running it every time the ticket changes would fight the register.
  }, [data, buying]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!res.ok) {
        setBusy(false);
        setError(d.error || "Could not add that line");
        return;
      }
      let landed = d.sale as Sale;

      // Whatever was answered before the ticket existed goes on it now. After
      // the line rather than before it, so a ticket is never created for the
      // sake of a flag — the line is what brings it into being, and the flag
      // follows it in.
      for (const [want, path, payload] of [
        [pendingOrder, "fulfillment", { marked: true }],
        [pendingVehicle, "work-status", { workStatus: "waiting" }],
      ] as const) {
        if (!want) continue;
        const r = await fetch(`/api/pos/sales/${landed.id}/${path}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const rd = await r.json().catch(() => ({}));
        if (r.ok) landed = rd.sale as Sale;
      }
      setPendingOrder(false);
      setPendingVehicle(false);

      setBusy(false);
      setSale(landed);
      setItems(d.items);
      setDescription("");
      setAmount("");
      setCategoryId(null);
      setPicked(null);
      setQty("1");
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
    [busy, ensureSale, mechanicId, otherName, pendingOrder, pendingVehicle],
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
   *
   * SERVICES ONLY, despite the name. The tire half of the register no longer
   * posts anything by itself whatever this says — see `onPickProduct` for why
   * the quantity box made that impossible to keep.
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
   * A tire came off the search. It LOADS. It never rings.
   *
   * Picking a priced tire used to post it to the ticket immediately, on the
   * argument that one tap is what makes this quicker than the VBA form it
   * replaced. That argument was about the wrong tap. Nobody sells one tire:
   * they sell two, or four, and the quantity box sits beside the search — so
   * every multiple-tire sale meant the line was already on the ticket at
   * quantity one before there was any chance to say how many. The way out was
   * to void the line and ring it again, and what people did instead was ring
   * four separate lines, or ring one and quietly get the count wrong.
   *
   * So it stages: the name, the shelf price and the category are filled in, the
   * quantity box is right there, and nothing reaches the ticket until somebody
   * presses Add. One extra press per tire, in exchange for the quantity being
   * decided before the line exists rather than after.
   */
  function onPickProduct(p: FoundProduct) {
    const cat =
      p.condition === "used"
        ? (data?.tireCategories.used_tire ?? null)
        : p.condition === "new"
          ? (data?.tireCategories.new_tire ?? null)
          : null;
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
    setQty("1");
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
      void addLine(description.trim(), cents, categoryId, picked?.id ?? null, qtyNum);
      return;
    }
    setAmount((cents / 100).toFixed(2));
    amountRef.current?.focus();
  }

  function onQuickService(label: string, desc: string, catId: number | null) {
    const cents = parseCents(amount);
    // `qtyNum`, not 1. This posted a single line whatever the how-many box
    // said, so setting 4 and tapping MOUNT & B rang one — silently, with the 4
    // still on screen looking as though it had been taken.
    if (cents !== null && cents >= 0 && readyToAutoAdd) {
      void addLine(desc || label, cents, catId, null, qtyNum);
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
    void addLine(description.trim(), cents, categoryId, picked?.id ?? null, qtyNum);
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
   * order paid in instalments looks like. Nothing collected and something owed
   * is what puts it in the Pending box on Main, and it is settled from the
   * ticket drawer whenever the customer reaches the cashier.
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
   * Say the tire is not on the rack.
   *
   * THIS HAS TO BE SET BEFORE THE MONEY IS TAKEN. `completeSale` reads the flag
   * to decide whether to book the tires out, so a ticket marked afterwards has
   * already had stock come off a rack that never held it. That is why the
   * control is up beside the total rather than down with the lifecycle in the
   * drawer -- the drawer is for the ones nobody caught in time.
   *
   * The flag is the whole answer to "they paid for it but we still owe them a
   * tire". Payment and fulfilment are separate facts here: the ticket completes,
   * the deposit or the full amount is banked, and it stays on the orders board
   * until somebody says the tire went on the car.
   */
  async function markOrder(on: boolean) {
    if (busy) return;
    // No ticket yet: remember it and stop. See the note on `pendingOrder`.
    if (!sale) {
      setPendingOrder(on);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pos/sales/${sale.id}/fulfillment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marked: on }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not mark this as an order");
      return;
    }
    setSale(d.sale);
  }

  /**
   * Say the customer has left the car.
   *
   * The other half of the same question the order flag answers, asked of the
   * vehicle instead of the tire: what is this shop still holding? A car dropped
   * off for an oil change at nine is exactly as easy to lose track of as a tire
   * on order, and until this existed the only way to record it was to open the
   * ticket again from Main after the sale had already closed.
   *
   * 'waiting' rather than anything cleverer, because that is what is true the
   * moment somebody hands over a key: waiting on us. Whoever picks the job up
   * moves it along from the board.
   */
  async function markVehicle(on: boolean) {
    if (busy) return;
    if (!sale) {
      setPendingVehicle(on);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pos/sales/${sale.id}/work-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workStatus: on ? "waiting" : null }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not set this ticket's status");
      return;
    }
    setSale(d.sale);
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
    setQty("1");
    setError(null);
  }

  // Printing is offered, not forced — most tickets here are $5–$20 and the
  // customer doesn't want paper. The link stays up until the next ticket is
  // rung, which is long enough to catch the one that does.

  function finishTicket(finishedSaleId: number) {
    setLastSale(sale ? { id: finishedSaleId, saleNo: sale.sale_no } : null);
    setSale(null);
    setItems([]);
    // The ticket that was picked up is finished, so the notice goes with it —
    // the next one on this screen is a fresh ticket like any other.
    setResumed(null);
    // And the payment panel folds away again. A writer who took the money on
    // one ticket is back outside for the next one.
    setTakingPayment(false);
    setDescription("");
    setAmount("");
    setCategoryId(null);
    setBuying(false);
    setPendingOrder(false);
    setPendingVehicle(false);
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
    return <div className="text-brand-300">{tr("Loading register…")}</div>;
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
            <div className="text-sm text-green-800/70">{tr("Paid and closed. This notice clears itself in a minute.")}</div>
          </div>
          <a
            href={`/pos/sale/${lastSale.id}/receipt`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800"
          >{tr("Print a receipt")}</a>
          <button
            type="button"
            aria-label={tr("Close this notice")}
            title={tr("Close this notice")}
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
            <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{tr("Cashback")}</div>
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
            {/* "Inventory", not "Tires". This half sells everything that comes
                off a shelf and gets counted — new tires, used sizes, batteries
                and now sensors — and calling it Tires had people ringing the
                other three through the service box as free text, where they
                carry no product and move no stock. */}
            {(
              [
                ["service", "Services"],
                ["tire", "Inventory"],
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
              <div className="text-xs uppercase tracking-wider text-brand-300">{tr("From stock")}</div>
              <label className="flex items-center gap-1.5 text-xs text-brand-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyInStock}
                  onChange={(e) => setOnlyInStock(e.target.checked)}
                />{tr("Only show current stock")}</label>
            </div>
          </div>
          {/* The mechanic used to be a third column here and a dropdown down in
              the service card — the same one selection, drawn twice, in two
              places, either of which could be the one somebody was looking at.
              It is now a keypad of its own below both. */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "minmax(0,1fr) 106px" }}
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
                >{tr("Clear")}</button>
              </div>
            ) : (
              <ProductSearch
                onPick={onPickProduct}
                placeholder={tr("Size, brand or name…")}
                filter={stockFilter}
                actions={tireActions}
              />
            )}
            <QtyBox
              value={qty}
              onChange={setQty}
              onBlur={() => setQty(String(qtyNum))}
              onStep={stepQty}
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
              {/* Same money field as the service half. Both halves of this
                  screen are one screen to whoever is standing at it, and a
                  dollar sign on one price box and not the other reads as a
                  fault rather than as a difference. */}
              <div className="money-field">
                <span className="money-field-sign">$</span>
                <input
                  ref={amountRef}
                  className="input text-right tabular-nums"
                  placeholder="0.00"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => {
                    const c = parseCents(amount);
                    if (c !== null) setAmount((c / 100).toFixed(2));
                  }}
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
              </div>
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
                <div className="self-center text-xs text-brand-300">{tr("Priced at the counter")}</div>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitManual}
                disabled={busy}
              >{tr("Add")}</button>
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
                    ? `Selling off the shelf price of ${formatCents(picked.price_cents)}. This line will be flagged on Logs and the close-out.`
                    : "Price is off the rack. Set how many, pick who fitted it, then Add."
                  : "Used tires are priced at the counter — enter the price, set how many, then Add."
                : "Find the tire, set how many, then Add. Nothing reaches the ticket until you do. Used tires, batteries and sensors are rung here too."}
            </span>
          </p>
          {/* Here rather than over on the ticket, because this is the half of
              the register where somebody has just failed to find the tire. The
              question is asked at the moment it occurs to them, under the box
              they searched in, instead of across the counter next to the money.
              Its counterpart lives in the service card for the same reason.

              Offered before there is a ticket, not after: "we'll have to order
              it" is usually the first thing settled, so waiting for a line to be
              rung took the offer off the screen for exactly as long as it was
              wanted. Pressing it opens the ticket. */}
          {!purchasing && can("manageSpecialOrders") &&
            !pendingOrder && sale?.is_special_order !== 1 && (
              <button
                type="button"
                className="mt-2 text-xs underline text-amber-800 hover:text-amber-900"
                onClick={() => void markOrder(true)}
                disabled={busy}
              >
                Not on the rack? Order it in
              </button>
            )}
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
          {/* Price, how many, Add. The how-many box is the same 72px cell as
              the one in the tire card and sits in the same place relative to
              the thing it counts, because it is the same question — four mount
              and balances is as ordinary as four tires, and until now the only
              way to ring them was to press the button four times. */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "130px 106px minmax(0,1fr)" }}
          >
            <div className="money-field">
              <span className="money-field-sign">$</span>
              <input
                ref={amountRef}
                className="input text-right tabular-nums"
                placeholder="0.00"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                /* Tidied when you leave it, not while you type: reformatting
                   mid-keystroke fights the caret and turns "1" into "1.00"
                   before the 5 arrives. Anything unparseable is left exactly as
                   typed so the mistake stays visible. */
                onBlur={() => {
                  const c = parseCents(amount);
                  if (c !== null) setAmount((c / 100).toFixed(2));
                }}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
              />
            </div>
            <QtyBox
              value={qty}
              onChange={setQty}
              onBlur={() => setQty(String(qtyNum))}
              onStep={stepQty}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitManual}
              disabled={busy}
            >{tr("Add")}</button>
          </div>
          {/* The counterpart to "Order it in" over in the tire card. A car gets
              left for work, not for a tire off the rack, so the question belongs
              to this half of the register and is asked while the work is being
              rung.

              Offered before there is a ticket, not after. Somebody hands over a
              key first and gets told the price second, so waiting for a line to
              be rung meant the question was not on screen at the moment it was
              being answered. Pressing it opens the ticket. */}
          {!purchasing && !pendingVehicle && !sale?.work_status && (
            <button
              type="button"
              className="mt-3 text-xs underline text-amber-800 hover:text-amber-900"
              onClick={() => void markVehicle(true)}
              disabled={busy}
            >
              Is the client leaving their vehicle?
            </button>
          )}
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
            {/* Wraps rather than squeezes. On a narrow window the sentence on
                the right used to be crushed against the label with no gap at
                all -- "MECHANICnobody picked" -- and then broken over two
                cramped lines. Held at its natural width it drops underneath the
                label instead, which costs one line and stays readable. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
              <div className="text-xs uppercase tracking-wider text-brand-300">{tr("Mechanic")}</div>
              {/* Says the answer in words next to the label, so the state
                  survives being read from across the counter at an angle where
                  which button is filled is not obvious. */}
              <div className="text-xs shrink-0 max-w-full">
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
                title={tr("Somebody who is not on the floor list")}
              >{tr("Other")}</button>
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
                title={tr("Ring this line against nobody")}
              >{tr("No mechanic")}</button>
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

            {/* Mode-dependent, because the two halves of the register post
                differently now. A service still rings itself off a price
                button; a tire always waits on Add — see `onPickProduct`. */}
            <p className="text-xs text-brand-300 mt-2">
              {mode === "tire"
                ? "It belongs to the line, not the ticket, so it is asked again for each one."
                : readyToAutoAdd
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
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{tr("Price")}</div>
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
          <div className="text-xs uppercase tracking-wider text-brand-300 mb-2">{tr("Service")}</div>
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
              drawer on Logs, and for the same reason: on a screen where
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
                /*
                  THE TICKET'S OWN CUSTOMER, PREFILLED. The panel used to start
                  empty on every ticket, which is right for one that is seconds
                  old and wrong for one picked back up: a resumed ticket already
                  carrying somebody showed blank boxes while the rest of the
                  screen quietly billed them, and the first person to notice
                  reasonably asked why it was being billed to a customer who
                  "was not there". The panel now says who is on the ticket.
                */
                requireCustomer={accountTender}
                onSaved={setSale}
                onError={setError}
              />
            </div>
          )}

          {/* The Cashback toggle used to sit here. It moved to the mode
              buttons on the left, where choosing what kind of ticket this is
              belongs — see the note there. */}

          {/* Says the register picked this ticket up rather than opened it.
              Amber, not red: nothing has gone wrong, but the lines already on
              screen belong to somebody else's job and adding to them by mistake
              is the one error this whole behaviour could cause. */}
          {resumed && sale && (
            <div className="mb-3 rounded-xl px-3 py-2 text-xs" style={{ background: "#fff7ed", color: "#92400e" }}>{tr("Carrying on")}{" "}<strong>{resumed}</strong>, left unfinished on this
              register. Check the lines below are the ones you meant before
              adding to it.
            </div>
          )}

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
              <div className="text-sm text-brand-300 py-8 text-center">{tr("Tap a service, then a price.")}</div>
            )
          ) : (
            <div className="flex flex-col divide-y divide-black/5">
              {liveItems.map((i) => (
                <div key={i.id} className="py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {/* The count goes in FRONT of the description, the same way
                        the ticket drawer and the receipt write it.

                        Without it two mount-and-balances at $15 read as one
                        line saying "Mount & balance   $30.00", and the only
                        way to tell that from a single $30 line is to know what
                        a mount and balance costs. The customer is told $30
                        either way, so nothing is caught until the receipt
                        prints the ×2 that the ticket never showed — by which
                        point the sale is complete and the fix is an edit with
                        a reason on it. */}
                    <div className="text-sm text-brand-500 truncate">
                      {i.qty > 1 ? `${i.qty}× ` : ""}
                      {i.description}
                    </div>
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
              <span>{tr("Total")}</span>
              <span className="tabular-nums">{formatCents(sale.subtotal_cents)}</span>
            </div>
          )}

          {/* The customer panel used to sit here, under the total. It moved up
              to directly beneath the ticket number — see the note there. */}

          {/* The two things this ticket can still owe after the money is taken:
              a tire the shop has to fetch, and a car the shop is holding.

              Only the states are drawn here. The two offers that turn them ON
              live in the entry cards on the left, each in the half of the
              register it belongs to — see the note on each. What is left is a
              read-out of what this ticket already owes, which is a fact about
              the ticket and so belongs on the ticket.

              Above the payment panel and not below it, because the order flag is
              the last thing that is still true to say before the money moves:
              once the ticket completes, the flag decides whether the tires came
              off the racks, and setting it afterwards leaves the count already
              wrong.

              Coloured to match the drawer and the Outstanding panel, so the
              places this state is visible read as one thing.

              Drawn from the held answer as well as the saved one, so pressing
              either offer looks the same whether or not a line has been rung
              yet. A button that appeared to do nothing until the first line
              would just get pressed again. */}
          {!purchasing && (
            <div className="mt-3 flex flex-col gap-2 empty:mt-0">
              {can("manageSpecialOrders") && (pendingOrder || sale?.is_special_order === 1) && (
                <div
                  className="rounded-xl px-3 py-2.5"
                  style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.25)" }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-amber-900">{tr("On order — we owe them the tire")}</span>
                    <button
                      type="button"
                      className="text-xs underline text-amber-800 hover:text-amber-900"
                      onClick={() => void markOrder(false)}
                      disabled={busy}
                    >
                      We have it
                    </button>
                  </div>
                  <div className="mt-0.5 text-xs text-amber-800">
                    Take the money as normal. It stays on the Outstanding panel even
                    once it is paid.
                  </div>
                </div>
              )}
              {(pendingVehicle || sale?.work_status) && (
                <div
                  className="rounded-xl px-3 py-2.5"
                  style={{ background: "#fff7ed", border: "1px solid rgba(180,83,9,0.25)" }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-amber-900">{tr("Vehicle is here — waiting on us")}</span>
                    <button
                      type="button"
                      className="text-xs underline text-amber-800 hover:text-amber-900"
                      onClick={() => void markVehicle(false)}
                      disabled={busy}
                    >{tr("They took it")}</button>
                  </div>
                  <div className="mt-0.5 text-xs text-amber-800">
                    It stays on the Outstanding panel until somebody says it is done,
                    paid or not.
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

          {/* On a writer's screen the money is one click away, not gone.
              He is outside at the car and the customer pays inside, so a
              payment form is the wrong first thing to put under his thumb —
              but he covers the register at lunch, so it cannot be taken off
              him either. Shown from the start for everybody else. */}
          {sale &&
            liveItems.length > 0 &&
            (!writing || takingPayment) &&
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
                onTenderChange={setAccountTender}
                onError={setError}
                onDone={finishTicket}
              />
            ))}

          {/* Work done, money not collected.
              For a cashier this is the exception — the customer coming back
              Friday with the rest — so it sits under the payment panel,
              outlined rather than filled: findable without being the thing a
              thumb lands on when the money is on the counter. It used to be
              small underlined text, which is the treatment a footnote gets, and
              tickets that should have closed owing forty dollars got rung for
              nothing instead.

              For a WRITER it is the ordinary ending, so it is the solid button
              and it comes first. Same action, same dialog, same ledger — only
              the weight on the screen changes with whose job it is. */}
          {sale && liveItems.length > 0 && sale.kind !== "purchase" && (
            /* Two lines, not one long one.
               The button says the ACTION and the amount sits under it, because
               they are answers to different questions — what this does, and how
               much the customer is about to be told to pay — and running them
               together made a button too wide to read at a glance on a tablet
               held one-handed at a car window.

               Red throughout. This app already uses red for the ending that
               leaves money owed, and it is no less true for being the ordinary
               ending of a writer's ticket. */
            /* A gap above it on a writer's screen, where this button follows
               the total directly rather than a payment panel. Butted straight
               up against the figure it reads as part of the same block, and the
               one thing that must not happen at a car window is pressing the
               ending of a ticket while looking at its total. */
            <div className={writing ? "mt-3" : undefined}>
              <button
                type="button"
                className={
                  writing ? "btn btn-danger w-full" : "btn btn-outline-danger w-full mt-2"
                }
                style={
                  writing ? { height: 52, fontSize: 17 } : { height: 44, fontSize: 14 }
                }
                onClick={() => setAskUnpaid(true)}
                disabled={busy}
              >
                {writing
                  ? "Create Ticket"
                  : `Close it unpaid — customer owes ${formatCents(sale.subtotal_cents)}`}
              </button>
              {writing && (
                <div
                  className="text-center mt-1 font-semibold tabular-nums"
                  style={{ color: "#a71d24", fontSize: 14 }}
                >
                  {formatCents(sale.subtotal_cents)} to pay at cashier
                </div>
              )}
            </div>
          )}

          {/* The way to the money, for a writer who is manning the register.
              Only until it is opened: once the panel is on screen it says
              everything this button would. */}
          {writing && !takingPayment && sale && liveItems.length > 0 && (
            <button
              type="button"
              className="btn btn-outline w-full mt-2"
              style={{ height: 44, fontSize: 14 }}
              onClick={() => setTakingPayment(true)}
            >{tr("Taking the money here instead")}</button>
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
                  setQty("1");
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

      {/* One wording for both roles, because it is one act.
          It used to read "Close without payment? — Yes, they owe it", which is
          the voice of a cashier deciding to let somebody leave owing money. That
          is sometimes what this is, but the ordinary case at this shop is
          simpler and happens at both ends of the building: the work is written
          up here and the customer pays at the cashier. Naming it that way makes
          the dialog true for the writer at the car AND for the cashier who is
          handing somebody a ticket to settle in a minute.

          What it must NOT lose is the two consequences, which are the whole
          reason there is a dialog at all: the tires leave the racks now, and the
          total stops being editable. */}
      <ConfirmModal
        open={askUnpaid}
        onCancel={() => setAskUnpaid(false)}
        onConfirm={() => void leaveUnpaid()}
        title={tr("Create the ticket to pay at the cashier?")}
        confirmLabel="Create it"
        cancelLabel="Go back"
        busy={busy}
      >
        <p>
          The ticket is finished at{" "}
          <strong>{sale ? formatCents(sale.subtotal_cents) : ""}</strong> with
          nothing collected — the customer pays at the cashier later. Any tires
          on it come off the racks now.
        </p>
        <p className="mt-2">
          It sits in <strong>{tr("Pending")}</strong> on Main until the money is taken,
          and the total is frozen.
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
