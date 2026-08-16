import { NextRequest, NextResponse } from "next/server";
import { inventoryBySize } from "@/lib/products";
import { normalizeTireSize } from "@/lib/tire-size";

/**
 * The website's stock search: one question in, one bit out.
 *
 * The whole response is "we have that size today" or "we do not", plus the
 * caller's own size echoed back. Never on this endpoint: prices, brands,
 * models, counts, or any list of sizes. The public inventory endpoint next
 * door exists for the shop's own second screen and names what the rack
 * holds; this one exists for a customer on the website, and the owner's
 * instruction for it was exact — they may learn that we have their size,
 * and everything past that is a phone call.
 *
 * Matching is whole-size only, on purpose. The register's search happily
 * answers substrings ("2055" finds every 205/55), which is right for a
 * cashier and wrong here: a two-digit probe repeated over the keypad would
 * read the entire rack out of an endpoint built to say one bit. A query
 * that does not parse into a complete size is answered "incomplete", never
 * with matches.
 *
 * The used general pool never answers. It has no size, so no size query can
 * honestly match it — and the page says in words, right under the box, that
 * unsized used stock exists and a phone call is what searches it.
 */

const digitsOf = (s: string) => s.replace(/[^0-9.]/g, "");

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("size") ?? "").trim().slice(0, 40);
  const size = normalizeTireSize(raw);
  const digits = digitsOf(size);

  // A complete size parses into dash-joined parts: 195-65-15, 11-22.5,
  // 480-8. What the parser leaves without a dash — "205", "kenda", half a
  // size — is refused rather than matched loosely; see above for why.
  if (!size.includes("-") || digits.length < 4) {
    return NextResponse.json({ ok: false });
  }

  // Digit-string equality forgives a lettered prefix the caller did not
  // type: LT265-70-17 on the rack still answers a plain "265 70 17". It is
  // still whole-size equality, not a substring — the probe argument above
  // stays closed.
  const inStock = inventoryBySize().some(
    (g) =>
      g.total > 0 &&
      (normalizeTireSize(g.size) === size || digitsOf(g.size) === digits),
  );

  return NextResponse.json({ ok: true, size, inStock });
}
