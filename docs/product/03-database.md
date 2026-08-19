# 03 — Database

> SQLite via `better-sqlite3`, WAL mode, foreign keys enforced. **39 tables**,
> built by **48 ordered migration files** numbered `001…050` (037–038 were
> retired unused — the runner only cares about filenames it has recorded). Column shapes below were dumped from a live
> database copy with `PRAGMA table_info`, not transcribed by hand.
>
> The migrations themselves are documentation: each carries a prose header
> explaining why the table is shaped the way it is. When this document and a
> migration disagree, read the migration.

## The invariants

These hold across the whole schema and are the product's claim to being a book
of record (expanded in the top-level README):

1. **Money is integer cents** (`*_cents INTEGER`). Rates are basis points.
2. **Ledgers are append-only**: `payments`, `inventory_movements`,
   `drawer_movements`, `account_payments` are never updated or deleted; undo
   is a reversing row pointing at the original (`reverses_*_id`).
3. **Entities soft-delete**: `deleted, deleted_by, deleted_at, deleted_reason`
   on sales, items, products, lots, customers, vehicles, register_checks.
4. **Every mutation is audited** into `audit_log` inside the same transaction,
   with the actor's role *snapshotted at the time*.
5. **`business_date` is explicit** on every money-bearing row; the day rolls
   at a configured hour (default 4 a.m.), never midnight.
6. **Totals freeze on completion**; corrections are new rows, not updates.
7. **Stock is derived**, never stored: on-hand = `SUM(qty_delta)` over
   `inventory_movements`. Lots are a FIFO costing cursor, not a quantity
   authority.
8. **Timestamps are local ISO strings** (`YYYY-MM-DDTHH:MM:SS`), no UTC, no
   offsets — `src/lib/time.ts` owns this.

## Migration mechanics

- Runner: `src/lib/migrations.ts`, invoked by `npm run setup`
  (`scripts/setup.mjs`) — **never on server start**.
- Applied files are recorded in `_migrations (filename PK, applied_at)`;
  reruns skip what is recorded. Files are plain SQL, ordered by name.

---

## Tables by domain

### Identity and access

**`admin_users`** — back-office logins. `username`, `password_hash` (bcrypt),
`must_change_password`. Sessions live in an iron-session cookie, not a table.

**`employees`** — everyone on the floor. `name`, `pin_hash` (bcrypt), `role`
(job label: TIRE / OFFICE / ADMIN), `pos_role` (the authorization ladder:
technician · writer · cashier · accountant · manager · owner · viewer),
`active`, `pos_failed_attempts` + `pos_locked_until` (per-employee PIN
throttle), `hourly_rate_cents` (nullable — null means "not set", distinct
from 0).

**`employee_capabilities`** — per-person named grants layered over the role
ladder (`employee_id + capability` PK, `granted_by/at`, `note`). See
[10 — Security](10-security.md) for the full model.

**`pos_sessions`** — register sessions. `token_hash` (sha256 of a 32-byte
token; the token itself is never stored), `employee_id`, `role_snapshot`,
`created/last_seen/expires_at`, `revoked_at`. Idle expiry is the backstop;
the client lock is the primary.

**`dir_sessions` / `dir_visits`** — the fleet-driver directory's own session
table (same hashed-token pattern) and its visit log (`ok` records failed
logins too).

**`trusted_devices`** — devices excused from the clock-in fence. Hashed
token, human `label`, `user_agent`, `first_ip`, enrolled-by/at,
`last_seen_at`, revocation as a stamp (`revoked_at`, `revoked_by_name`) —
never a delete, because "which device was this and when did we stop trusting
it" is the question asked after a phone walks out.

### Time clock

**`time_entries`** — the punches. `employee_id`, `type` (`check_in`,
`check_out`, `break_start`, `break_end`), local `timestamp`, `photo_path`,
`flagged` + `flag_reason` (no photo, auto-closed shift…), admin-edit
attribution (`edited_by_admin_id/at`), and since migration 049 the fence
record: `lat`, `lng`, `accuracy_m`, `fence_verdict`
(`inside`/`trusted`/`off`/`manual`). Location is kept on *allowed* punches
too — a record of failures alone can't answer "was he really here on the
3rd," and null means "nobody asked," never "somewhere else."

**`schedule_shifts`** — the roster: `employee_id`, `work_date`,
`start_minute`/`end_minute` (minutes from midnight), `break_minutes`
(default 60). Paid hours are derived, never stored.

**`entry_deletions`** — a tombstone ledger for hard-removed rows (kind +
target id + reason + who/when), so even a true deletion leaves a record that
it happened.

### Sales

**`sales`** — the ticket header. `sale_no` (human key from `counters`),
`business_date`, `status` (`open`/`completed`/`voided`), `kind`
(`sale`/`purchase` — buybacks are purchases), `fulfillment_status` +
`fulfillment_at` + `is_special_order` (the order board), `work_status` +
`vehicle_in_at`/`out_at` (the bay), `cashier_id`, `customer_id`/`vehicle_id`,
frozen money (`subtotal/tip/comm/total/paid/balance_cents`, `tax_rate_bp`
snapshotted), discount block (`discount_cents/reason/by/at`), void block,
soft-delete block, `pinned_note` (+by/at), `seq` (card terminal sequence),
`po`.

**`sale_items`** — the lines. Snapshots at ring time: `description`,
`unit_price_cents`, `unit_cost_cents` (FIFO landed cost), `list_price_cents`
(the rack price then, so discounts are measurable forever), `category_id`.
Attribution is per-line: `mechanic_id` (+ free-text `mechanic_name` for
"Other"), and a second credit `mount_mechanic_id` + `mount_unit_cents` so the
seller and the fitter of the same tire are both paid. Line voids are their
own block — a line can die without its ticket.

**`service_categories`** — the five-plus buckets everything is rung against
(`new_tire`, `used_tire`, services…). **`quick_buttons`** — the configurable
register grid (label, kind, amount, category, optional product).
**`counters`** — named sequences (`sale_no`, `customer_no`, `lot_no`…).

**`payment_methods`** — configurable tenders: `code`, `label`, `kind`,
`is_card` (drives reconciliation), `allows_tip`, `sort_order`, `active`.

### Money

**`payments`** — append-only. `sale_id`, `method_id`, `kind` (`payment`,
`tip_adjustment`, `refund`, `reversal`, `deposit`), signed `amount_cents`,
`tip_cents`, `comm_cents` (+`comm_overridden`), `seq` (terminal sequence per
payment), `reverses_payment_id`, `taken_by`, `mechanic_id` (who the tip is
for), `business_date`, `shift_id`.

**`shifts`** — the drawer's day: `shift_no`, `opening_float_cents`,
`float_counted_at/by` (a *counted* float versus a standing figure),
open/close attribution. **`shift_counts`** — per-tender counts at close.

**`register_checks` / `register_check_counts`** — midday counts. The header
carries who/when plus soft-delete (strike with reason); the counts freeze
`expected_cents` per tender **at the moment of counting**, so later bookings
can't rewrite whether a count balanced. Owner-only edit is implemented as
strike-plus-corrected-copy carrying the original clock (see
`replaceRegisterCheck` in `src/lib/register-checks.ts`).

**`drawer_movements`** — non-sale cash (`withdrawal`/`deposit`/`reversal`,
signed amount, reason, `reverses_id`). Deliberately not payment rows so no
revenue query can ever include a bank run. Carries an owner-level visibility
flag documented only in the internal owner-controls document.

**`account_payments`** — money received against a house account (customer- or
fleet-level), append-only with reversals; never allocated to specific
tickets, because that is not how a monthly account is settled.
**`account_charge_reviews`** — a manager's sign-off row per on-account charge.

**`payroll_periods` / `payroll_lines`** — the pay-week freeze design:
periods with `locked_at/by`, lines with per-employee totals and adjustments.
**Schema present; locking not yet enabled in app flow** (gap G2 in
[01 — Product Vision](01-product-vision.md)).

**`service_costs`** — per-service internal cost (`description_key` PK), so
service margin is computable; maintained from the POS settings screen.

### Inventory

**`products`** — everything sellable that is counted: `sku`, `name`, `kind`
(tire/battery/misc), `tire_size` (normalized dash form; the used general pool
row has none by design), `brand`/`model`/`ply`, `condition` (new/used),
`price_cents`, `default_cost_cents`, `track_inventory`/`track_lots`,
`reorder_point`, `specialized` (18-wheeler section), `supplier`,
`discounted`, soft-delete block.

**`inventory_lots`** — FIFO costing cursor: `unit_cost_cents`,
`qty_received`/`qty_remaining`, supplier/reference, `is_default`, receiver,
soft-delete.

**`inventory_movements`** — the stock ledger. Signed `qty_delta`, `reason`
(receive/sale/void-return/adjust/count…), `sale_id`/`sale_item_id` backrefs,
`reverses_movement_id`, `oversold` flag + `reviewed_by/at` (oversells surface
until a manager signs them off), `unit_cost_cents` at movement time.

**`product_searches`** — register searches that found nothing (or nothing in
stock): raw + normalized query, result/in-stock flags, `employee_id`
(nullable — null marks the website's stock search), `business_date`. Feeds
the "what walked out" study, with read-side dedup.

**`tire_demand`** — the deliberate lost-sale study: size raw+normalized,
`qty` (tires wanted, not asks), note, recorded-by. Its migration (030)
explains why it is not `product_searches`.

**`web_searches`** — the website stock-search archive: `query` as typed,
`size_norm`, `answer` (`yes`/`no`/`incomplete`), dated. Write-side handrail:
the same size is not written twice inside sixty seconds. No reader owes it
anything yet; it exists to be studied later.

### Customers

**`customers`** — the book. `customer_no`, name/phone/notes, `pinned_note`
(+by/at), `credit_approved` (may charge on account), fleet linkage
(`is_fleet` marks the company row, `fleet_id` points members at it), billing
fields for statements, address/email, and the driver-directory credentials
(`dir_slug`, `dir_pin_hash`, set-by/at). Soft-delete block.

**`vehicles`** — per-customer: year/make/model/plate/color/vin, `tire_size`,
notes, soft-delete.

### System

**`settings`** — key/value strings; typed façade and defaults in
`src/lib/settings.ts` (41 keys — every one documented in
[07 — Configuration](07-configuration.md)).

**`audit_log`** — the sink for every mutation: actor (admin or employee, with
name and **role snapshot**), `action` (a closed TypeScript union in
`src/lib/audit.ts`), target type/id, `details`, `before_json`/`after_json`,
local timestamp.

**`alarm_actions`** — the alarm log: every exception raised (code + kind),
what was done about it, by whom, with role, and the note they wrote.
Dismissing an alarm signs it; nothing is silenced.

**`_migrations`** — the runner's record.

---

## Indexes

Indexes exist on the hot paths (payments by sale/date, movements by
product/sale/lot, oversold-unreviewed partial index, searches by normalized
query + date, entries by fence verdict, trusted devices by revocation, sales
by date/status). The migration files are authoritative; new queries that scan
should add theirs in the migration that introduces them.

## Integrity checking

An on-demand check reconciles sale headers against line items and recorded
payment totals against the ledger; stock similarly reconciles lots against
movements. Mismatches are **reported, never silently repaired**.

## Backup contract

`scripts/backup-db.mjs` uses `VACUUM INTO` (never a file copy — WAL can hold
hours of sales), then verifies integrity and row counts. See
[08 — Deployment](08-deployment.md) for cadence and restore drill.

---

## Appendix — the migrations, in order

Each file's own first line, kept here as the index into the essays. Files
marked *(fk-off)* open with a foreign-keys-off pragma for a table rebuild.

| # | File | What it added |
|---|---|---|
| 001 | `001_initial.sql` | Time clock — initial schema |
| 002 | `002_pos.sql` | Point of Sale: sales, items, payments, products, lots, movements, methods, categories, searches, payroll, counters |
| 003 | `003_purchases.sql` | Cash purchases — the shop buying goods (mostly used tires) |
| 004 | `004_shifts.sql` | Shifts and the end-of-day count |
| 005 | `005_tire_sections.sql` | Where a tire sits on the rack sheet |
| 006 | `006_shop_details.sql` | Shop details for the top of a receipt |
| 007 | `007_tips.sql` | Tips, tip-taking tenders, the drawer float |
| 008 | `008_drawer.sql` | Non-sale cash in and out of the drawer |
| 009 | `009_discounts.sql` | Money taken off a ticket |
| 010 | `010_batteries.sql` | Batteries |
| 011 | `011_list_price.sql` | The shelf price at ring time |
| 012 | `012_customer_details.sql` | Car color; customer-search indexes |
| 013 | `013_special_orders.sql` | Order-board staleness stamps |
| 014 | `014_work_status.sql` | Where the car is |
| 015 | `015_register_checks.sql` | Midday counts with frozen expectations |
| 016 | `016_other_mechanic.sql` | Free-text mechanic name |
| 017 | `017_vehicle_dates.sql` | Vehicle in/out stamps |
| 018 | `018_mount_credit.sql` | The fitter's separate credit |
| 019 | `019_misc.sql` | The misc shelf |
| 020 | `020_discount_flag.sql` | "Meant to be cheap" product flag |
| 021 | `021_pickup_stages.sql` | Fulfillment stages *(fk-off)* |
| 022 | `022_service_writer.sql` | The writer role *(fk-off)* |
| 023 | `023_ticket_note.sql` | Pinned ticket note |
| 024 | `024_customer_note.sql` | Pinned customer note |
| 025 | `025_credit_approved.sql` | Who the shop carries on account |
| 026 | `026_drawer_hidden.sql` | Owner-level movement visibility (doctrine since revised — see the code) |
| 027 | `027_accountant.sql` | The accountant role *(fk-off)* |
| 028 | `028_account_charge_review.sql` | Sign-off on unapproved-account charges |
| 029 | `029_entry_deletions.sql` | Tombstones for struck rows |
| 030 | `030_tire_demand.sql` | The walked-out study |
| 031 | `031_employee_capabilities.sql` | Per-person capability grants |
| 032 | `032_service_costs.sql` | What a service costs the shop |
| 033 | `033_fleets.sql` | Fleets: company accounts with drivers |
| 034 | `034_company_details.sql` | Billing fields for companies |
| 035 | `035_float_counted.sql` | Counted vs assumed float |
| 036 | `036_alarms.sql` | Signed alarm dismissals |
| 037–038 | — | Retired unused (numbering gap, by design) |
| 039 | `039_viewer_role.sql` | The viewer role *(fk-off)* |
| 040 | `040_vehicle_vin.sql` | VIN |
| 041 | `041_directory.sql` | The fleet self-service directory |
| 042 | `042_financing_aff.sql` | Second financing provider |
| 043 | `043_tender_order.sql` | Tender button order |
| 044 | `044_assumed_markup.sql` | Assumed markup for unrecorded years |
| 045 | `045_used_pool.sql` | The used-tire general pool (+ legacy fold-in) |
| 046 | `046_employee_wage.sql` | Hourly rates |
| 047 | `047_schedule.sql` | The roster |
| 048 | `048_web_searches.sql` | The website search archive |
| 049 | `049_timeclock_fence.sql` | Punch location + fence verdict |
| 050 | `050_trusted_devices.sql` | Trusted devices |
