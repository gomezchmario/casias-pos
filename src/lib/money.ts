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
