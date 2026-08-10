import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { quoteTire } from "@/lib/tire-quote";

/**
 * A price to say out loud, and nothing else.
 *
 * The counter's own quoter does its arithmetic in the browser, because the
 * person using it is on the phone and the number has to move as they type. It
 * can afford to: that page is behind a PIN, and the markup is the shop's own to
 * look at.
 *
 * This one cannot. The inventory board has no login — see the whitelist at the
 * top of `api/public/inventory` — and shipping `marginBp` to it would publish
 * the shop's markup to anybody who opened the network tab, whatever the screen
 * showed. So the cost comes in, the chain runs here, and only the three numbers
 * a customer is allowed to hear go back.
 *
 * The same `quoteTire` either way, so the board and the counter can never quote
 * the same tire differently.
 */
export async function POST(req: NextRequest) {
  let body: { costCents?: unknown; freightCents?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const costCents = Number(body.costCents);
  const freightCents = Number(body.freightCents ?? 0);
  if (!Number.isFinite(costCents) || costCents < 0)
    return NextResponse.json({ error: "Bad cost" }, { status: 400 });

  const q = quoteTire({
    costCents: Math.round(costCents),
    freightCents: Number.isFinite(freightCents) ? Math.round(freightCents) : 0,
    marginBp: Number(getSetting("quote_margin_bp")),
    taxRateBp: Number(getSetting("tax_rate_bp")),
    mountBalanceCents: Number(getSetting("quote_mount_balance_cents")),
    roundToCents: Number(getSetting("quote_round_to_cents")),
  });

  // Three fields, named one by one, for the same reason the inventory endpoint
  // names its six: returning `q` would hand back the margin and the tax split
  // the moment somebody adds a field to `Quote`.
  return NextResponse.json({
    sellCents: q.sellCents,
    setOfTwoCents: q.setOfTwoCents,
    setOfFourCents: q.setOfFourCents,
  });
}
