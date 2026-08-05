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
 * Yellow takes near-black text rather than white. White on yellow is the one
 * combination here that fails outright — it is unreadable on a bright screen on
 * a counter by a window, which is exactly where this thing lives.
 */
export const WORK_PILLS = [
  {
    value: "waiting",
    label: "Waiting",
    title: "Waiting on us",
    bg: "#ea580c",
    fg: "#fff",
    border: "#ea580c",
  },
  {
    value: "working",
    label: "Working on it",
    title: "Working on it",
    bg: "#facc15",
    fg: "#422006",
    border: "#eab308",
  },
  {
    value: "delivery",
    label: "On delivery",
    title: "Waiting on delivery",
    bg: "#1d4ed8",
    fg: "#fff",
    border: "#1d4ed8",
  },
  {
    value: "ready",
    label: "Ready",
    title: "Ready for pickup",
    bg: "#15803d",
    fg: "#fff",
    border: "#15803d",
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
