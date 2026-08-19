# 17 — Treadline Brand

> The commercial identity, as established by the brochure — the only place it
> fully exists today — and the rules for extending it. The separation that
> matters: **Treadline** is the product; **Casias** is the first customer.
> The code currently wears the customer's badge (gap G9); this document is
> the target state.

## Name and voice

- **Treadline** — one word, capital T, never "TreadLine" or "Tread Line".
  The wordmark sets it spaced uppercase: `T R E A D L I N E`.
- Tagline of record: **"The complete tire shop system."**
- Voice: plain, concrete, shop-floor first person plural where natural.
  Claims are verifiable and specific ("rung in four taps, kept forever"),
  never superlative ("best", "revolutionary" do not appear). Pain is named
  in the customer's own words, then answered with the screen that fixes it.
  Spanish is a full first-class rendering in idiomatic shop Spanish, not a
  translation gesture.
- Product vocabulary (use these, not synonyms): *ticket* (not order/invoice),
  *ring* (not process), *the rack* (inventory), *the drawer*, *close-out*,
  *the board* (special orders), *punch* (the clock), *tender* (payment
  method), *the fence* (clock-in area).

## The mark

The Treadline logo (inline SVG in the brochure): a rounded-square **amber
tile** carrying a navy **"m" of three tread grooves** — read it as tire tread
seen head-on. Clear space of one groove-width around the tile; never redrawn
with text baked in; the wordmark sits beside it in the display face.

## Palette (from the brochure's tokens)

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0a2540` | The navy — text, structure, the product's "ink" |
| `--amber` | `#ffc83d` | The one loud color: attention, the mark, highlights |
| `--amber-deep` | `#e0a91d` | Amber's pressed/edge state |
| Paper | `#ffffff` / near-white | Documents and cards |
| Alarm red | reserved | Money that does not balance; nothing else |

The discipline is the brand: **amber is spent on one thing per surface**, red
means unbalanced money and is never decoration, and everything else stays
quiet. (The shop-facing POS uses the same discipline with the customer's own
navy/gold — see [05 — UI Standards](05-ui-standards.md); under A2 theming,
customer palettes skin the product while these rules hold.)

## Typography

Display: heavy geometric sans, tight leading, sentence-case headlines with a
period. Body: the system stack. Numbers: mono/tabular for money everywhere.
No serif anywhere in product or collateral.

## Applications today (and their state)

| Surface | State |
|---|---|
| Brochure `/info` + PDF (EN/ES) | **The reference artifact** — canonical voice, mark, palette |
| The software UI | Wears **Casias** branding (badge, favicon, titles, cookies) — re-badging is A1/A2 in [13](13-commercialization.md) |
| `README.md` | Neutral "Shop System" naming — rename with A1 |
| Shop website `/web` | Deliberately **Casias-branded** (customer property, the model for A6's per-shop generator) |
| This suite | Treadline-first |

## Rules for new material

1. Every claim in marketing must map to a Shipped row in
   [11 — Feature Matrix](11-feature-matrix.md) — the brochure audit (G1–G10)
   is the cautionary list.
2. EN and ES ship together or the piece waits.
3. Screenshots come from the demo dataset, never a customer's live data.
4. The customer's brand appears on *their* surfaces (receipts, website,
   their POS theme); Treadline's appears on the product's own voice
   (brochure, docs, installer, release notes). The two never mix on one
   surface.
5. Print is part of brand: anything a prospect might hold gets the same
   care as `/info` (measured sheets, real margins, no browser headers).
