/**
 * Tire size parsing. Pure string work, no database.
 *
 * This lives apart from `products.ts` precisely so the register and the
 * inventory screen can import it. `products.ts` pulls in better-sqlite3, which
 * cannot be bundled into a client component — and the counter needs to
 * normalise a size as it is typed, before anything is sent to the server.
 */

/**
 * Put a tire size into one canonical shape: 195-65-15.
 *
 * Dashes, not the 195/65R15 the sidewall uses, because dashes are what the shop
 * writes. The old workbook is 1,300 rows of "175-70-13" and everyone here reads
 * a size that way; matching it means nobody has to translate at the counter.
 *
 * The same tire still arrives as "195/65R15", "195 65 15", "195-65-r15" and
 * "1956515" depending on who is typing. Without this, the rack would hold four
 * separate products for one size and the count on every one of them would be
 * wrong.
 *
 * Anything that does not look like a tire size is cleaned up but passed through
 * rather than mangled — an odd size is better than a silently wrong one. The
 * real list has plenty of them (16-6 8-6.5, a mower tire) and they are still
 * tires somebody has to sell.
 */
export function normalizeTireSize(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return "";

  // Rim is usually 15, but the commercial sizes run on half-inch rims —
  // 19.5, 22.5, 24.5 — and those are real, not typos.
  const RIM = String.raw`\d{2}(?:\.\d)?`;
  const SEP = String.raw`\s*[-/\s]?\s*`;

  // 195/65R15, 195-65-15, LT265/70R17.
  const metric = s.match(
    new RegExp(String.raw`^([A-Z]{0,3})\s*(\d{3})${SEP}(\d{2})${SEP}R?${SEP}(${RIM})$`),
  );
  if (metric) return `${metric[1]}${metric[2]}-${metric[3]}-${metric[4]}`;

  // 1956515, typed straight off the keypad with no separators at all.
  const run = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (run) return `${run[1]}-${run[2]}-${run[3]}`;

  // Flotation: 33X12.50R17, 30-9.50-15. Two-digit overall diameter first.
  const flot = s.match(
    new RegExp(String.raw`^(\d{2})\s*[-X\s]\s*(\d{1,2}\.\d+)${SEP}R?${SEP}(${RIM})$`),
  );
  if (flot) return `${flot[1]}-${flot[2]}-${flot[3]}`;

  // Two-part commercial and trailer sizes: 11-22.5, 9R22.5, 7.5-16, 480-8.
  // "R" here marks radial construction and sits where a separator goes, so it
  // is treated as one -- 9R22.5, 9R-22.5 and 9-22.5 are all the same tire.
  //
  // The R must be able to stand ALONE as the separator. It reads as though it
  // obviously would, which is how this shipped requiring a dash as well and
  // silently passing "11R22.5" straight through unparsed -- and an unparsed
  // size is not a cosmetic problem: rimDiameterOf takes the last dash-separated
  // field, so it read the rim of an 11R22.5 semi tire as 11, filing it on the
  // printed sheet under a rim heading the shop does not own a single tire for.
  // 11R22.5, 11R24.5, 12R22.5 and 9R22.5 are among the most common truck sizes
  // there are.
  const pair = s.match(
    /^([A-Z]{0,3})\s*(\d{1,3}(?:\.\d+)?)\s*(?:R\s*[-\s]?|[-\s])\s*(\d{1,2}(?:\.\d+)?)$/,
  );
  if (pair) return `${pair[1]}${pair[2]}-${pair[3]}`;

  return s;
}

/**
 * The rim the tire mounts on, which is how the racks are physically organised
 * and therefore how the sheet has to be ordered. Returns null for the handful
 * of sizes too odd to parse; those fall to the specialty section rather than
 * inventing a heading for themselves.
 */
export function rimDiameterOf(size: string | null): number | null {
  if (!size) return null;
  const last = size.split("-").pop();
  if (!last) return null;
  const n = Number.parseFloat(last);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Half-inch rims are commercial: 17.5, 19.5, 22.5 and 24.5 are semi and box
 * truck sizes, and there is no passenger tire among them. Used only to
 * pre-tick the specialty box when someone adds a size — the stored flag is
 * whatever they actually chose, because guessing is not the same as knowing.
 */
export function looksSpecialized(rawOrSize: string | null): boolean {
  if (!rawOrSize) return false;
  const rim = rimDiameterOf(normalizeTireSize(rawOrSize));
  return rim !== null && !Number.isInteger(rim);
}

/** Heading for the eighteen-wheeler and specialty block, always sorted last. */
export const SPECIALTY_SECTION = "18-wheeler & specialty";
