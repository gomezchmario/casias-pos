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
 * Deliberately the same colours as `WORK_PILLS`, carrying the same meaning:
 * orange is the shop holding things up, blue is out of the shop's hands, green
 * is done and go and get them. The two lists are different questions — where is
 * the car, where is the tire — but they now share one dropdown in one column,
 * and giving them separate palettes would mean learning the colours twice to
 * read one panel.
 *
 * Orange for BOTH 'pending' and 'arrived', because both are jobs somebody here
 * has to do: one is a supplier who has not been rung yet, the other is a
 * customer who has not been. Only 'ordered' is genuinely somebody else's turn.
 *
 * Grey — not a fifth colour — for 'delivered' and 'cancelled'. Those two are the
 * answers that mean nobody has to do anything, and they are the reason a ticket
 * drops off the panel entirely; a colour would put them back in the eye of
 * somebody scanning the screen for work.
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
  pending: { bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
  ordered: { bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  arrived: { bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
  // Orange like Arrived, because it is the same job unfinished — the shop still
  // owes somebody a phone call. Green like Fitted for Waiting for pickup: the
  // shop has done everything it can and is waiting on the customer.
  no_answer: { bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
  waiting_pickup: { bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  installed: { bg: "#dcfce7", fg: "#166534", border: "#86efac" },
  delivered: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
  cancelled: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
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
