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
 * The colours are the whole interface at counter distance — nobody reads four
 * small words across a room, they read four colours. So they are picked to be
 * told apart at a glance and in that order:
 *
 *   orange  waiting on us       — the shop owes them something
 *   yellow  working on it       — under way, in hand
 *   blue    waiting on delivery — out of the shop's hands, nothing to chase
 *   green   ready for pickup    — done, go and get them
 *
 * Pale fills with dark text of the same hue, not saturated fills with white.
 * A screen showing a dozen outstanding tickets at once is a dozen of these in a
 * column, and at full strength that column shouts loudly enough that no single
 * row stands out — which is the one job it has. Pastel keeps the hues telling
 * each other apart while letting the eye rest.
 *
 * The text is dark in every case, including yellow. White on yellow is the one
 * combination here that fails outright — it is unreadable on a bright screen on
 * a counter by a window, which is exactly where this thing lives — and once the
 * fills are pale, white fails on all four. Dark-on-pale is the only rule that
 * holds for the whole set.
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
    bg: "#ffedd5",
    fg: "#9a3412",
    border: "#fdba74",
  },
  {
    value: "waiting_pickup",
    label: "Waiting for pickup",
    title: "Waiting for pickup",
    bg: "#dbeafe",
    fg: "#1e40af",
    border: "#93c5fd",
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
