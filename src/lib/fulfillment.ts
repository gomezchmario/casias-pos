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
 * on the five that are actually a sequence.
 */
export const FULFILLMENT_STAGES = [
  "pending",
  "ordered",
  "arrived",
  "installed",
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
  installed: "Fitted",
  delivered: "Gone",
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
  installed: 1,
  ordered: 2,
  pending: 3,
  delivered: 4,
  cancelled: 5,
  none: 6,
};

/** The stages where the ball is in the shop's court. */
export const OURS: FulfillmentStatus[] = ["arrived", "installed"];
