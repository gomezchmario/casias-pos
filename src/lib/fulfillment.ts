import type { FulfillmentStatus } from "./sales";

/**
 * The vocabulary of a special order, and nothing else.
 *
 * Split out from `special-orders.ts` for one concrete reason: that file opens
 * the database, and both the board and the ticket drawer are browser code. A
 * client component importing a stage label from a module that reaches for
 * better-sqlite3 drags the whole driver into the bundle — or fails the build
 * trying. Types erase; a `const` does not.
 *
 * So the words live here, where either side can read them, and the behaviour
 * lives with the database where it belongs.
 */

/**
 * The lifecycle, in the order it happens.
 *
 * 'none' and 'cancelled' are deliberately outside this list. They are not
 * stages, they are answers to a different question — 'none' means this ticket
 * is not a special order at all, 'cancelled' means it stopped being one. The
 * arithmetic that asks "is this move forwards or backwards?" only makes sense
 * on the ones that are actually a sequence.
 *
 * 'installed' is outside it for a third reason: it was dropped. Fitting was
 * never the thing the board was waiting on — the shop knows perfectly well when
 * it has bolted a tire on, and what it actually needs to track is the customer,
 * who has to be rung and then has to turn up. So the middle of the sequence is
 * now about chasing them rather than about the workshop. The value stays in the
 * type and in the database so old tickets still load; nothing new reaches it.
 */
export const FULFILLMENT_STAGES = [
  "pending",
  "ordered",
  "arrived",
  "no_answer",
  "waiting_pickup",
  "delivered",
] as const;

export type FulfillmentStage = (typeof FULFILLMENT_STAGES)[number];

/**
 * What each stage means at the counter, in the words somebody would use.
 *
 * Written for the person reading the board rather than for the developer:
 * "arrived" is a fact about a tire, but what it means to the shop is that a
 * phone call is owed, and the label says so.
 */
export const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  none: "Not an order",
  pending: "To order",
  ordered: "On its way",
  arrived: "Here — call them",
  // The two stages of chasing somebody. "Called — no answer" is the shop's
  // turn again tomorrow; "Waiting for pickup" is the customer's turn and
  // nothing here can hurry it. Splitting them is the whole point: rolled into
  // one they would mean "we rang once, sometime", which tells the next person
  // on the counter nothing about whether to ring again.
  no_answer: "Called — no answer",
  waiting_pickup: "Waiting for pickup",
  installed: "Fitted",
  delivered: "Picked up",
  cancelled: "Cancelled",
};

/**
 * The order the board reads in, which is NOT the order the lifecycle runs in.
 *
 * Arrived comes first because it is the only stage where the shop is the one
 * holding things up: the tire is in the corner and somebody has to pick up the
 * phone. Waiting on a supplier is further down because nobody here can do
 * anything about it today, and the stages that are finished are at the bottom
 * where they can be scrolled past.
 *
 * A board sorted by date instead would bury the one row that needed doing under
 * a fortnight of rows that did not.
 */
export const BOARD_RANK: Record<FulfillmentStatus, number> = {
  arrived: 0,
  // Straight after Arrived, because it is the same job: somebody has to pick up
  // the phone, and a number that did not answer yesterday is a number to try
  // again today. It ranks above Waiting for pickup for that reason — one is the
  // shop's turn, the other is the customer's.
  no_answer: 1,
  installed: 2,
  waiting_pickup: 3,
  ordered: 4,
  pending: 5,
  delivered: 6,
  cancelled: 7,
  none: 8,
};

/** The stages where the ball is in the shop's court. */
export const OURS: FulfillmentStatus[] = ["arrived", "no_answer", "installed"];

/**
 * A stage as one coloured pill, for the Outstanding panel on Main.
 *
 * ONE COLOUR PER MEANING, SHARED WITH `WORK_PILLS` — see the long note there.
 *
 * The two lists ask different questions, where is the car and where is the
 * tire, but they share one column on Main: the Outstanding panel shows one pill
 * per ticket and picks the list by whether the ticket is an order. So the
 * colours are assigned by what a row MEANS rather than by which list it came
 * from, and the two agree wherever they genuinely say the same thing — 'arrived'
 * here and 'ready' there are both "it is done, ring the customer", and both are
 * green.
 *
 * They used to collide instead of agree. 'arrived' shared orange with a car
 * merely waiting on us, 'waiting_pickup' shared green with a car that still
 * needed ringing, 'installed' shared green with 'waiting_pickup', and
 * 'cancelled' shared grey with 'delivered' — a job that never happened painted
 * the same as one that finished.
 *
 * Pale fills with dark text, matching `WORK_PILLS` shade for shade. The panel
 * stacks a dozen of these in a column and at full strength the whole column
 * shouts, which leaves nothing standing out — the opposite of what a board is
 * for.
 *
 * 'none' is absent because it is not a stage. A ticket that is not an order has
 * nothing to paint here, and giving it a swatch would invite a future reader to
 * draw one.
 */
export const ORDER_PILLS: Partial<
  Record<FulfillmentStatus, { bg: string; fg: string; border: string }>
> = {
  // Red, because it is the only stage where nothing has been set in motion yet:
  // the customer has paid a deposit and the tire has not been ordered from
  // anybody. Every other stage on this board is work in progress; this one is
  // work not started, and it is the one that should catch an eye first.
  pending: { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  // Indigo, not blue: blue is a delivery van on the way here, this is a
  // supplier who has not sent one yet. Both are out of the shop's hands and
  // they are chased differently.
  ordered: { bg: "#e0e7ff", fg: "#3730a3", border: "#a5b4fc" },
  // Green, the same green as a car that is Ready — call them. They are the
  // same instruction to the same person: the thing is done, ring the customer.
  // Sharing it is the point of colouring by meaning rather than by list.
  arrived: { bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  // Purple, and its own colour rather than the green of Arrived. Both mean a
  // phone call is owed, which is exactly what makes them worth telling apart on
  // a board somebody scans from across the counter: Arrived is a call nobody has
  // made, no answer is a call already made once, and the second needs a
  // different decision from the first.
  no_answer: { bg: "#ede9fe", fg: "#6d28d9", border: "#c4b5fd" },
  // Teal, matching the car's Waiting for pickup, and no longer the green of
  // Ready — call them. That pair was the one worth separating most: a call the
  // shop owes against a customer the shop is waiting on.
  waiting_pickup: { bg: "#ccfbf1", fg: "#115e59", border: "#5eead4" },
  // Lime, so a tire on the car reads differently from one still on the rack
  // waiting to be collected.
  installed: { bg: "#ecfccb", fg: "#3f6212", border: "#bef264" },
  delivered: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
  // Rose. Cancelled and picked up were the same grey, and one of them is a job
  // that never happened.
  cancelled: { bg: "#ffe4e6", fg: "#9f1239", border: "#fda4af" },
};

/**
 * Has the tire actually left the building?
 *
 * This is what decides when a special order takes stock off the rack, and it is
 * NOT when the ticket completes. A special order is completed the moment the
 * deposit is taken, days before the tire exists here -- decrementing then books
 * a sale out of a rack that never held it, drives the count negative, and drops
 * a row into the oversell review queue that no amount of counting can resolve.
 * A day's import made eight of those before this existed.
 *
 * 'arrived' is deliberately still false. The tire is in the corner by then, and
 * it got there by being received, which is its own movement in. Taking it out
 * again the same moment would net the receipt to nothing and lose the fact that
 * the shop is holding a tire it has not yet fitted.
 *
 * 'none' is true because an ordinary ticket is not an order at all: the customer
 * is standing there and the tire goes on the car now.
 */
export function stockHasMoved(status: FulfillmentStatus): boolean {
  return status === "none" || status === "installed" || status === "delivered";
}
