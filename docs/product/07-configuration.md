# 07 — Configuration

> Two halves: what is configurable today (the 41 keys of `SettingsMap` in
> `src/lib/settings.ts`, stored as strings in the `settings` table, edited
> from `/admin/settings` and the POS settings screen), and what is **hardcoded
> today but must become configuration** before Treadline ships to a second
> shop. The second half is the working inventory for
> [13 — Commercialization](13-commercialization.md).

## Settings that exist (all 41, with shipped defaults)

### Identity and paper

| Key | Default | Meaning |
|---|---|---|
| `company_name` | Casias Muffler and Tire Shop | Printed on receipts and documents |
| `company_address` | 8715 Grissom Rd, San Antonio, TX 78251 | Receipts, statements |
| `company_phone` | (210) 543-0909 | Receipts, statements |
| `receipt_footer` | "Thank you for your business!" | Receipt tail |
| `receipt_disclaimer` | Full authorization/as-is/liability paragraph | Above the signature line; blanking removes the signature block |

### The day and the clock

| Key | Default | Meaning |
|---|---|---|
| `week_start_day` | 4 (Thursday) | The one definition of the week — payroll and every report |
| `business_day_start_hour` | 4 | The day rolls at 4 a.m., not midnight |
| `auto_close_hour` | 21 | Forgotten punches close (flagged) at 9 p.m. |
| `photo_retention_days` | 90 | Punch-photo purge window |
| `break_auto_deduct_minutes` | 0 | Off |
| `timeclock_fence_lat` / `timeclock_fence_lng` | "" | Empty = no fence; set from a phone standing at the shop |
| `timeclock_fence_radius_m` | 250 | Metres |
| `timeclock_fence_set_by` / `timeclock_fence_set_at` | "" | Attribution |
| `timeclock_trusted_only` | 0 | The strictest mode; server refuses to enable with no trusted device |

### Register and money

| Key | Default | Meaning |
|---|---|---|
| `tax_rate_bp` | 825 | 8.25%; prices are tax-inclusive |
| `register_float_cents` | 10000 | The standing change fund |
| `discount_cashier_max_cents` | 1500 | Cashier discount ceiling; managers above |
| `customer_prompt_threshold_cents` | 0 | Ticket value that prompts for customer details |
| `pos_idle_lock_seconds` | 900 | Register self-lock |
| `allow_oversell` | 1 | The sale goes through; the oversell surfaces for review |
| `tip_comm_per_cents` / `tip_comm_charge_cents` | 500 / 100 | $1 commission per $5 of tip |
| `mount_credit_cents` | 3500 | Per-tire fitter credit |

### Quoting and margins

| Key | Default |
|---|---|
| `quote_margin_bp` | 2000 (20%) |
| `quote_mount_balance_cents` | 3500 |
| `quote_round_to_cents` | 1000 (next $10) |
| `assumed_tire_markup_bp` | 2000 — margin fallback when cost is unknown |
| `assumed_history_markup_bp` | 2000 — same, for imported history |

### Studies, notices, housekeeping

| Key | Default | Meaning |
|---|---|---|
| `tire_demand_enabled` | switchable | The walked-out study's register button — a study, not a feature, deliberately off when not being run |
| `search_log_retention_days` | 180 | Search-exhaust retention |
| `last_inventory_check` / `last_inventory_check_by` | "" | Stamped by a full count |
| `inventory_alarm_cleared` / `inventory_alarm_cleared_by` | "" | Quiets the staleness colour **without** faking a count |
| `pos_notice` / `pos_notice_by` / `pos_notice_at` | "" | The board above the register; empty = no board |

Also configurable as **data** rather than settings: payment methods (add/
retire tenders, card flag, tip flag, order), quick buttons (the whole
register grid), service categories, service costs, employee capabilities.

## Hardcoded today — the white-label debt

Everything below is baked into source and must move into configuration,
theming, or packaging before a second shop can run this. Each row names where
it lives.

### Identity

| What | Where |
|---|---|
| Product/package name `casias-tire-shop-timeclock` | `package.json` |
| Shop badge/logo files | `public/logo*.png`, `.webp`, `src/app/apple-icon.png`; `ShopLogo` component |
| Favicon (drawn from the Casias badge) | `src/app/icon.svg` |
| Page titles "· Casias Tire Shop" | `src/app/layout.tsx` metadata template |
| Cookie names `casias_admin`, `casias_pos`, `casias_device` | `session.ts`, `pos-session.ts`, `devices.ts` |
| The public website (entirely Casias) | `docs/casias-web.html` → `/web` |
| The brochure's shop references | `docs/treadline-brochure.html` |
| localStorage keys (`casias-lang`, `treadline-*`) | website/brochure scripts |

### Palette and theme

POS navy/amber, website navy/gold/cream, brochure ink/amber are all literal
hex values across Tailwind classes, inline styles, and per-area CSS. There is
no token layer; "your shop's colors" (the $199 service) is custom code today.

### Locale and jurisdiction

| What | Where |
|---|---|
| Timezone = the OS clock | `time.ts` doctrine; deployment contract |
| Texas overtime rule (40 h/week, no daily OT) | staffing report |
| San Antonio market wage table (incl. named competitors) | staffing report |
| 8:00–18:30/17:30 open hours | website `CLOSE`/`OPEN` constants; staffing constants (OPEN_HOUR 8, CLOSE_HOUR 19) |
| One-off closed dates | website `CLOSED_ON` list |
| USD formatting, `en-US` assumptions | `money.ts`, date rendering |
| Spanish as the second language | the entire i18n table is EN→ES specifically |

### Operational constants worth promoting to settings

| What | Where |
|---|---|
| Saturday-at-3/hr staffing floor of 4 techs | `reports-bi.ts` `staffingNeed` (owner's instruction, hardcoded) |
| Lunch = the empty hour heuristic; 10-hour paid day | staffing constants |
| PIN length 4, lockout 5 tries/5 min | `pin.ts`, `pos-session.ts` |
| Fence bounds (25–5000 m), device cookie 2-year life | `fence` route, `devices.ts` |
| Web-search 60-second dedup | `products.ts` |
| Chrome executable paths | `scripts/build-brochure.mjs`, verification scripts |
| Cert file paths `certs/*.pem` | `server.mjs` |
| Port 3000 | `server.mjs` default |

### Seeded data that is really Casias'

Payment methods list (SNAP, the shop's financing partner), quick buttons,
service categories and costs, admin username — all correct as *defaults for
one shop*, but a new install needs a first-run flow rather than inheriting
Casias' counter.

## The shape of the fix (recorded here, executed later)

Not work for this phase — see [13 — Commercialization](13-commercialization.md)
and [14 — Roadmap](14-roadmap.md) — but the direction is: a `branding` settings
group + uploaded logo assets; a CSS token layer over the three palettes; a
locale/jurisdiction module (timezone explicit, overtime rules pluggable, wage
table editable); constants promoted to settings where an owner would ever
change them; and a first-run setup wizard that seeds tenders, categories, and
the grid instead of copying Casias'.
