/**
 * Where the car is, and what that looks like.
 *
 * Split out of the day screen for the same reason `fulfillment.ts` was split
 * out of `special-orders.ts`: `sales.ts` opens the database, so a browser
 * component cannot import a *value* from it without dragging better-sqlite3
 * into the bundle. Types erase; a `const` does not.
 *
 * Now that the close-out prints these too, there is a second and better reason
 * for the file to exist. The board on the counter and the sheet in the folder
 * have to use the same four words. The moment they are two lists, one of them
 * gains a status the other has never heard of, and the paper quietly starts
 * lying about the screen.
 */

/**
 * ONE COLOUR PER MEANING, ACROSS BOTH THIS LIST AND ORDER_PILLS.
 *
 * The two sets share a column. The Outstanding box on Main shows one pill per
 * ticket and picks which set it comes from by whether the ticket is an order or
 * a car — see `shownSide` — so a column of a dozen tickets is a mix of the two,
 * and a colour that means one thing on this list and something else on that one
 * is worse than no colour at all.
 *
 * They used to collide three times. "Ready — call them" here and "Waiting for
 * pickup" over there were the same green, which is the pair somebody has to
 * tell apart most: one is a phone call the shop owes, the other is a customer
 * the shop is waiting on, and nothing can be done about the second.
 *
 * The scheme is by MEANING, so the two lists agree where they genuinely say the
 * same thing:
 *
 *   red     nothing started yet     (an order not placed)
 *   orange  the shop owes work
 *   yellow  work under way
 *   indigo  waiting on a supplier
 *   blue    waiting on a delivery van
 *   green   done — ring the customer
 *   purple  rang them, no answer
 *   teal    told them, waiting on them to come
 *   lime    fitted
 *   grey    finished
 *   rose    cancelled
 *
 * Pale fills with dark text of the same hue, not saturated fills with white. A
 * dozen of these in a column at full strength shouts loudly enough that no
 * single row stands out — which is the one job the column has. Pastel keeps the
 * hues telling each other apart while letting the eye rest.
 *
 * The text is dark in every case, including yellow. White on yellow is the one
 * combination here that fails outright — unreadable on a bright screen on a
 * counter by a window, which is exactly where this lives — and once the fills
 * are pale, white fails on all of them. Dark-on-pale holds for the whole set.
 */
export const WORK_PILLS = [
  {
    value: "waiting",
    label: "Waiting",
    title: "Waiting on us",
    bg: "#ffedd5",
    fg: "#9a3412",
    border: "#fdba74",
  },
  {
    value: "working",
    label: "Working on it",
    title: "Working on it",
    bg: "#fef9c3",
    fg: "#854d0e",
    border: "#fde047",
  },
  {
    value: "delivery",
    label: "On delivery",
    title: "Waiting on delivery",
    bg: "#dbeafe",
    fg: "#1e40af",
    border: "#93c5fd",
  },
  {
    value: "ready",
    label: "Ready — call them",
    title: "Ready for pick up — call them",
    bg: "#dcfce7",
    fg: "#166534",
    border: "#86efac",
  },
  /*
   * The two stages of chasing somebody, and the end of it.
   *
   * "Ready" used to be the last thing this list could say, which meant a car
   * finished at ten in the morning looked exactly the same at six in the
   * evening as it did the moment the work was done — and the board could not
   * tell the difference between a car nobody has rung about and one whose owner
   * has been told twice and is coming Friday.
   *
   * Orange for no answer, because that is the shop's turn again: a number that
   * did not pick up yesterday is a number to try today. Blue for waiting,
   * because it is out of the shop's hands, which is the same thing blue means
   * on the delivery row above. Grey for picked up, because it is finished and
   * a colour would keep pulling the eye back to a row with nothing left to do.
   */
  {
    value: "no_answer",
    label: "Called — no answer",
    title: "Called — no answer",
    // Purple, not the orange it shared with Waiting. Both are the shop's turn
    // again, which is exactly why they need telling apart: one has never been
    // rung, the other has been rung and did not pick up.
    bg: "#ede9fe",
    fg: "#6d28d9",
    border: "#c4b5fd",
  },
  {
    value: "waiting_pickup",
    label: "Waiting for pickup",
    title: "Waiting for pickup",
    // Teal, not the blue it shared with On delivery. Blue means waiting on
    // somebody who is not the customer; this is waiting on the customer, and
    // the difference decides whether anybody picks up a phone.
    bg: "#ccfbf1",
    fg: "#115e59",
    border: "#5eead4",
  },
  {
    value: "picked_up",
    label: "Picked up",
    title: "Picked up",
    bg: "#f1f5f9",
    fg: "#475569",
    border: "#cbd5e1",
  },
] as const;

/**
 * The long form, for paper.
 *
 * The screen can afford "Waiting" because the colour carries the rest of the
 * sentence. A close-out prints in one colour on a mono laser, so the word has
 * to do all of the work by itself — "Waiting on us" and "Waiting on delivery"
 * are opposite instructions and both of them abbreviate to "Waiting".
 */
export function workStatusTitle(value: string | null): string | null {
  return WORK_PILLS.find((p) => p.value === value)?.title ?? null;
}
