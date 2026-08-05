// Money is INTEGER CENTS. Never a float. See money.ts.

/**
 * "A guy on the phone wants a 275/60R20. What do I tell him?"
 *
 * This is the COTIZADOR tab of the shop's spreadsheet, moved somewhere it can
 * be used with a customer waiting. The shop does not stock every tire; most
 * quotes are for something that has to be ordered, so the only number anyone
 * has to work from is what the supplier is charging today. This turns that into
 * a price to say out loud.
 *
 * THE CHAIN, AND WHERE IT CAME FROM
 *
 * Transcribed from column G of that sheet, which is the column that is actually
 * correct. Columns E and F are the ones people had been reading off, and both
 * are broken: `F14` sums the freight and forgets the buy price entirely, and
 * `E19` has had its formula overwritten with a hardcoded 0. Neither announces
 * itself -- they produce a number, just the wrong one -- which is a decent
 * argument for this living in code with a test rather than in a grid where the
 * next person to click a cell can silently erase the formula behind it.
 *
 *   subtotal = cost + freight
 *   margin   = subtotal x 20%
 *   tax      = 8.25% of (subtotal + margin)
 *   total    = subtotal + margin + tax + mount-and-balance
 *   sell     = total rounded UP to the next $10
 *
 * TWO THINGS IN THERE THAT LOOK LIKE MISTAKES AND ARE NOT
 *
 * Mount and balance is added AFTER tax and is not taxed. That is what the sheet
 * does, and it is consistent with the rest of this system: every price the shop
 * quotes is tax-inclusive, so the $35 already has its own tax inside it. Taxing
 * it again here would charge the customer 8.25% twice on the same $35.
 *
 * The rounding is UP, never to nearest. $119.44 becomes $120, and so does
 * $110.01. That is a pricing decision, not a display one -- the shop would
 * rather quote a round number and keep the difference than shave the margin to
 * make the arithmetic pretty. It is also why the quote must be computed here
 * and not re-derived for display somewhere else: rounding applied twice, or
 * applied to nearest in one place and up in another, is how a quoted price and
 * a rung price come to differ by ten dollars in front of a customer.
 */

export type QuoteInputs = {
  /** What the supplier is charging the shop for the tire. */
  costCents: number;
  /** Freight, if the supplier bills it separately. Usually 0. */
  freightCents: number;
  /** The shop's markup, in basis points. 2000 = 20%. */
  marginBp: number;
  /** 825 = 8.25%. */
  taxRateBp: number;
  /** Mount and balance, added after tax. Not taxed — see above. */
  mountBalanceCents: number;
  /** Round the total up to a multiple of this. 1000 = the next $10. 0 = off. */
  roundToCents: number;
};

export type Quote = {
  subtotalCents: number;
  marginCents: number;
  taxCents: number;
  mountBalanceCents: number;
  /** Before rounding. Shown so the rounding is visible rather than mysterious. */
  rawTotalCents: number;
  /** What rounding up added. */
  roundingCents: number;
  /** The number to say out loud, per tire. */
  sellCents: number;
  setOfTwoCents: number;
  setOfFourCents: number;
};

const ZERO: Quote = {
  subtotalCents: 0,
  marginCents: 0,
  taxCents: 0,
  mountBalanceCents: 0,
  rawTotalCents: 0,
  roundingCents: 0,
  sellCents: 0,
  setOfTwoCents: 0,
  setOfFourCents: 0,
};

export function quoteTire(input: QuoteInputs): Quote {
  // No cost, no quote — and specifically a quote of ZERO rather than a quote of
  // "$35 mount and balance", which is what falling through the chain would
  // produce. A tool that answers "$40" to an empty box is one somebody reads a
  // price off before noticing they never typed the cost in.
  if (!Number.isFinite(input.costCents) || input.costCents <= 0) return ZERO;

  const subtotalCents = input.costCents + Math.max(0, input.freightCents || 0);
  const marginCents = Math.round((subtotalCents * Math.max(0, input.marginBp)) / 10000);
  const taxCents = Math.round(
    ((subtotalCents + marginCents) * Math.max(0, input.taxRateBp)) / 10000,
  );
  const mountBalanceCents = Math.max(0, input.mountBalanceCents || 0);
  const rawTotalCents = subtotalCents + marginCents + taxCents + mountBalanceCents;

  const step = Math.max(0, Math.round(input.roundToCents || 0));
  const sellCents = step > 0 ? Math.ceil(rawTotalCents / step) * step : rawTotalCents;

  return {
    subtotalCents,
    marginCents,
    taxCents,
    mountBalanceCents,
    rawTotalCents,
    roundingCents: sellCents - rawTotalCents,
    sellCents,
    // Multiples of the ROUNDED price, matching the sheet. Rounding once and
    // multiplying is not the same as multiplying and rounding once: a set of
    // four off a $119.44 tire is $480 here and $478 the other way, and the
    // second one invites the question "so why is one tire not $119.50".
    setOfTwoCents: sellCents * 2,
    setOfFourCents: sellCents * 4,
  };
}
