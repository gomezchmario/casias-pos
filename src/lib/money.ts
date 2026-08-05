// Money is INTEGER CENTS everywhere in the POS. Never a float.

export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return `${neg ? "-" : ""}$${s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * Parse user input into cents. Accepts "15", "15.5", "$15.00", "1,500.00".
 * Returns null for anything it can't read — callers must reject, not coerce.
 */
export function parseCents(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "." || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * The shop charges a flat fee for every slice of tip/cashback taken out on a
 * card — $1 per $5 by default, rounded UP. $8 of tip costs $2.
 */
export function computeTipCommission(
  tipCents: number,
  perCents: number,
  chargeCents: number,
): number {
  if (tipCents <= 0 || perCents <= 0 || chargeCents <= 0) return 0;
  return Math.ceil(tipCents / perCents) * chargeCents;
}

/**
 * Divide whole cents by weight so the parts sum back to exactly the total.
 *
 * Largest remainder: everyone gets their floor, and the cents left over go to
 * whoever came closest to another one, ties broken by position so the same input
 * always gives the same output. Rounding each share independently instead would
 * leave a stray cent that either vanishes from the ledger or gets invented into
 * it, and a split tip that does not add up to the tip is a bug somebody finds a
 * month later while reconciling payroll.
 *
 * It lives in this shared module rather than beside the ledger code that calls
 * it because the tip panel shows the cashier what the split is about to be
 * BEFORE it is written. A preview computed by different arithmetic than the
 * write is a preview that can lie, and it would lie exactly on the odd amounts
 * where somebody is most likely to be watching.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (totalCents * w) / sum);
  const parts = exact.map((e) => Math.floor(e));
  const leftover = totalCents - parts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < leftover; k++) parts[byRemainder[k % byRemainder.length].i]++;
  return parts;
}

/**
 * Prices are tax-INCLUSIVE, so tax is backed out of the total rather than
 * added to it. 825 basis points = 8.25%.
 */
export function taxIncludedInCents(totalCents: number, taxRateBp: number): number {
  if (totalCents <= 0 || taxRateBp <= 0) return 0;
  return Math.round((totalCents * taxRateBp) / (10000 + taxRateBp));
}

export function preTaxCents(totalCents: number, taxRateBp: number): number {
  return totalCents - taxIncludedInCents(totalCents, taxRateBp);
}

/**
 * What the shop paid, written so it can sit on the counter facing the customer.
 * $140 becomes "P140", tacked onto the end of a tire name where a ply or spec
 * code would normally live — which is the whole point, because that is a place
 * the eye already skips. It is there so whoever is haggling knows the floor.
 *
 * Lives here, and is called on the SERVER, on purpose. The disguise is only
 * worth anything against someone reading the screen over your shoulder; it is
 * worth nothing against anyone who opens devtools. So the raw cost must not be
 * sent to a browser that is only entitled to the code — the server computes the
 * string and sends that, and `default_cost_cents` still goes null to everyone
 * without `viewCosts`. Rendering the code client-side from the cents would have
 * quietly handed every cashier the exact figure.
 *
 * Whole dollars, because the cents are noise when you are deciding how far down
 * you will go — but kept when they are not zero, rather than rounding away real
 * money.
 */
export function costCode(cents: number): string {
  const dollars = cents / 100;
  return `P${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
