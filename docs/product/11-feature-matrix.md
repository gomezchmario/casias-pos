# 11 — Feature Matrix

> Every feature area, its status in code, and the brochure/plan claim it
> backs. Statuses: **Shipped** (in daily production use) · **Partial** ·
> **Designed** (schema or design exists, not enabled) · **Service** (a human
> promise, not software) · **Missing**.
>
> Plans: **S** = Shop $199/mo · **T** = Time clock +$49/mo · **M** = Multi-bay
> $299/mo.

## Register (S)

| Feature | Status | Notes |
|---|---|---|
| Quick-button grid, self-configured | Shipped | `quick_buttons`, managed in-app |
| Free-text lines, typed prices | Shipped | |
| Per-line technician credit + separate fitter credit | Shipped | `mechanic_id` + `mount_mechanic_id` |
| Service writers creditable on tire sales | Shipped | Inventory tab offers counter staff; Services tab stays floor-only |
| Split/partial/later payments, configurable tenders | Shipped | Append-only `payments` |
| Tips (incl. late tips) + commission with override | Shipped | Commission from settings |
| Discounts with cashier ceiling / manager above | Shipped | Two capabilities + a setting |
| Customer & vehicle capture, threshold-prompted | Shipped | Hidden by default on New Sale |
| Receipts (letter) | Shipped | Fleet-driver receipts show "Billed to" company |
| Receipts (80 mm thermal) | Designed | Awaits hardware decision |
| Purchases/buybacks (`kind: purchase`) | Shipped | Own payout panel |
| Idle lock | Shipped | |
| Tire quoter | Shipped | Settings-driven chain, public endpoint |
| Lost-sale button (walked-out study) | Shipped | Switchable by design (`tire_demand_enabled`) |

## Inventory (S)

| Feature | Status | Notes |
|---|---|---|
| Derived stock over an append-only ledger | Shipped | |
| FIFO lots and landed cost | Shipped | |
| Rim-grouped rack view + printable count sheet | Shipped | |
| Used-tire general pool (unsized load → sized listing → pool-backed sales) | Shipped | Migrations 045+ |
| Oversells surface until reviewed | Shipped | |
| Receive incl. create-on-receive | Shipped | |
| Standing-still / to-order / insights reports | Shipped | |
| Public stock page + website one-bit size search | Shipped | Search archive + miss study feed |
| Batteries, misc, sensors | Shipped | |

## Orders, customers, fleets (S)

| Feature | Status | Notes |
|---|---|---|
| Special-order board (stages, colors, calls, confirm+undo, full history) | Shipped | |
| Customer book, vehicles, pinned notes | Shipped | |
| House accounts: credit approval, unnamed-tab refusal, charge review | Shipped | |
| Statements + monthly account sheet with reconciliation | Shipped | |
| Fleet accounts: company roll-up, per-driver, printed statement | Shipped | |
| Fleet self-service directory (slug + PIN) | Shipped | |

## Cash control (S)

| Feature | Status | Notes |
|---|---|---|
| Blind, per-tender close-out; owner may skip the cover | Shipped | |
| Float double-count guard; counted-vs-standing float | Shipped | |
| Midday register checks, frozen expectations | Shipped | Owner edit = strike + copy on original clock |
| Drawer movements with undo; overdraw guard | Shipped | |
| Tips-aware verdicts (short-covered-by-tips) | Shipped | |
| One-page signed sheet + Daily Report behind it | Shipped | 15 sections + appendices |
| Owner-level cash instruments | Shipped | Internal doc only |
| Alarm log (signed dismissals) | Shipped | |
| Card-batch reconciliation by sequence | Shipped | |

## Reports (S)

| Feature | Status | Notes |
|---|---|---|
| Today screen, day log, standings | Shipped | Earnings role-blanked |
| Management reports (margin, movers, heatmaps, staffing need) | Shipped | |
| Trends document; monthly tire reports; Excel export | Shipped | |
| Printable staffing report (bilingual, wages appendix) | Shipped | Wage table is San Antonio-hardcoded |
| "Reads your numbers and writes the sentence" | Partial | True on several panels (attachment, comparisons); not a general engine |
| Website search study page | Shipped | |

## Time clock (T)

| Feature | Status | Notes |
|---|---|---|
| PIN punch + photo; flagged auto-close; signed corrections | Shipped | |
| One PIN, both jobs (kiosk → register) | Shipped | |
| Silent wall screen | Shipped | |
| Timesheets, week totals, wage costing | Shipped | `hourly_rate_cents` |
| Scheduler with data-suggested staffing | Shipped | |
| Clock-in geofence + trusted devices + trusted-only toggle | Shipped | Fail-open rails |
| Punch-out from close-out | Shipped | |
| **Module switch ("turning it off changes nothing else")** | **Missing** | No flag exists — packaging claim (G3) |
| Payroll week locking | **Designed** | Schema shipped; flow not enabled (G2) |

## Multi-bay (M)

| Feature | Status |
|---|---|
| Stock across locations | **Missing** — no location concept in schema (G1) |
| Group reporting | **Missing** (G1) |
| Priority support | Service |
| Quarterly trends free first year | Service (the trends doc itself is Shipped) |

## Services sold alongside

| Promise | Backing today |
|---|---|
| Full setup $250 (import, configure, count in) | One-off engineer scripts (G6) — real but not repeatable tooling |
| As it comes $99 | `npm run setup` + manual config |
| Brand personalization $199 (colors, website, logo) | Custom work per customer; no theming layer (G5) |
| Training / basic support | Human |
| Demo visit ("twenty tickets on a tablet") | No demo mode/reset; seed scripts are developer-grade (G8) |

## Platform

| Feature | Status | Notes |
|---|---|---|
| Bilingual floor + kiosk + manual + website + brochure | Shipped | Admin back office English-only (G4) |
| Audit log with role snapshots | Shipped | |
| Public pages (inventory, leaderboard, website, brochure) | Shipped | |
| Staff manual in-app + print | Shipped | |
| Installer / updates / licensing / multi-tenant | Missing | See [13](13-commercialization.md) |
| Automated tests / CI | Missing | See [06](06-coding-standards.md) |
