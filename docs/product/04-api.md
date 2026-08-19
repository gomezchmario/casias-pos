# 04 — API Reference

> Every route handler under `src/app/api` — **101 files** as of this writing.
> Conventions first, then each surface. Guards were extracted from the route
> files themselves; request bodies are the routes' own TypeScript shapes.
> Where a response is a large page-payload, its top-level keys are listed and
> the consuming page named — the route file remains the authority for nested
> shapes.

## Conventions

- **JSON in, JSON out.** Mutations are `POST`/`PATCH`/`PUT`/`DELETE` with a
  JSON body; malformed JSON returns `400 {"error": "Invalid JSON"}`.
- **Errors** are `{"error": string}` with 400/401/403/404/409 as appropriate;
  the strings are written for the person at the counter, not for a log.
- **Money is integer cents** in both directions; dates are `YYYY-MM-DD`
  business dates; timestamps are local ISO strings.
- **Guards.** Four kinds:
  - `requireAdminApi()` — iron-session admin cookie (`casias_admin`); 401
    when absent.
  - `requirePos(capability)` — POS token cookie (`casias_pos`) plus a named
    capability check (see [10 — Security](10-security.md)); 401 without a
    session, 403 without the capability.
  - `dirSession()` — fleet-directory token cookie.
  - **None** — the public surface and the kiosk PIN routes (the PIN itself is
    the credential).
- **Role-shaped responses.** A handful of routes return different figures to
  different roles, shaped **on the server**. They are marked ⛨ below and
  described fully only in the owner-only document.

---

## Kiosk (no session; PIN is the credential)

### `POST /api/checkin/lookup`
Body `{pin}` → `200 {ok, employee:{id,name}, state, todayMinutes, since, shift}`
(clock state, hours so far, today's scheduled shift) or `404` for an unknown
PIN. Viewer-role PINs are refused — a read-only account cannot appear on
payroll.

### `POST /api/checkin/submit`
Body `{pin, action: "check_in"|"check_out"|"break_start"|"break_end",
photoData?, lat?, lng?, accuracy?}`.
Order of refusals: PIN format → unknown PIN → viewer → illegal state
transition (409) → **the fence** (403 with `fence: "no_location" | "too_far"
| "untrusted_device"` and a plain-words `error`; nothing is written). On
success writes the entry (photo saved, missing photo flags the entry, fence
verdict + coordinates recorded) → `{ok, employee, action, timestamp, flagged}`.

### `POST /api/pos/auth/kiosk`
Body `{pin}` → mints a POS session cookie for the employee (the "one PIN,
both jobs" hand-off from kiosk to register). Applies per-employee PIN
throttling (`pos_failed_attempts`/`pos_locked_until`).

---

## POS auth

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/pos/auth/me` | GET | session only | `{user:{employeeId,name,role}, capabilities}` — what the shell renders from |
| `/api/pos/auth/logout` | POST | session only | Revokes the token server-side and clears the cookie |

---

## POS — sales

### `GET /api/pos/register` — `browseRegister`
The register screen in one round trip: `{quickButtons, paymentMethods,
mechanics[{id,name,clock}], serviceWriters[{id,name,clock}], businessDate,
tireCategories, usedPoolProductId, settings:{tipCommPerCents,
tipCommChargeCents, customerPromptThresholdCents}}`. Mechanics are the floor
(`role LIKE 'TIRE%'`); serviceWriters are `pos_role = 'writer'` — sent
separately so the Inventory tab can offer both while Services offers only the
floor.

### `/api/pos/sales`
- **GET** — `browseRegister`. `?scope=open` lists open tickets (adoption of
  the day's draft).
- **POST** — `ringSale`. Body `{isSpecialOrder?, customerId?, kind?:
  "sale"|"purchase"}` → creates the ticket header, mints `sale_no`.

### `/api/pos/sales/[id]`
- **GET** — `viewInventory`. The ticket in full for the drawer/receipt:
  `{sale, items, payments, customer, vehicle, mechanics (who worked it),
  roster (everyone who could), tireItemIds, cashierName, today}`.
- **PATCH** — `editOwnOpenSale`. Header edits (customer/vehicle details,
  po…): "own open sale" is the rule — a cashier edits their ticket, managers
  edit any.

### Ticket lines
| Route | Method | Guard | Body |
|---|---|---|---|
| `/sales/[id]/items` | POST | `ringSale` | `{description, qty, unitPriceCents, productId?, categoryId?, mechanicId?, mechanicName?}` — stock decrements ride in the same transaction for tracked products |
| `/sales/[id]/items/[itemId]` | PATCH | `ringSale` | qty/price/description edits while open |
| `/sales/[id]/items/[itemId]` | DELETE | `ringSale` | Line void (soft), stock returns |
| `/sales/[id]/items/[itemId]/mechanic` | PATCH | `ringSale` | Re-credit a line |
| `/sales/[id]/items/[itemId]/mount` | PATCH | `ringSale` | The second credit: fitter + per-unit mount money |

### Ticket lifecycle
| Route | Method | Guard | Notes |
|---|---|---|---|
| `/sales/[id]/complete` | POST | `ringSale` | Freezes totals; refuses an unbalanced ticket unless it is going on account |
| `/sales/[id]/reopen` | POST | `editCompletedSale` | Reopen a completed ticket (manager+) |
| `/sales/[id]/void` | POST | `voidSale` | Open: status flip. Completed: reversing payments + return movements, originals untouched |
| `/sales/[id]/discount` | POST/GET | `discountSale` | Body `{amountCents, reason}`; cashiers capped by `discount_cashier_max_cents`, managers above |
| `/sales/[id]/note` | PATCH | `ringSale` | The pinned note |
| `/sales/[id]/work-status` | PATCH | `ringSale` | Bay status + vehicle in/out stamps |
| `/sales/[id]/customer` | POST | `editOwnOpenSale` | Attach/create customer+vehicle from the Take-their-details panel |
| `/sales/[id]/fulfillment` | PATCH/GET | `manageSpecialOrders` | Order-board stage moves (confirm + undo pattern); GET is the "how it got here" history |
| `/api/pos/orders` | GET | `viewDay` | The special-order board itself: every open order grouped by stage, with waits |

### `POST /api/pos/sales/[id]/payments` — `takePayment`
Body `{kind: "payment"|"tip_adjustment"|"refund"|"purchase_payout", methodId,
amountCents, tipCents?, mechanicId? (who the tip is for), split?:
"equal"|"lines", commCents? (override), note?, reason?}`. Splits, partials,
later tips and refunds are all rows here; commission is computed from
settings unless overridden. House-account charges require an attached,
credit-approved customer.

### `PATCH /api/pos/payments/[id]` — `editSeq`
Corrects a payment's terminal sequence / tender after the fact: reversal +
re-take on the **original business date** (audited as `payment.correct`).

---

## POS — drawer, shifts, close

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/pos/drawer` | GET | `viewDay` | `{businessDate, movements (role-filtered ⛨), netCents}` — net is summed off the rows this response carries |
| `/api/pos/drawer` | POST | `drawerCash` | `{amountCents, kind, reason, note?, reverseId?, acknowledgeOverdraw?, hidden? ⛨}` — reversal via `reverseId`; overdraw guard offers "record anyway" |
| `/api/pos/drawer/[id]` | PATCH | `editDrawerMovement` | Rename (reason only) |
| `/api/pos/drawer/[id]` | DELETE | `editDrawerMovement` | Hard delete for a row where no cash moved (tombstoned in `entry_deletions`) |
| `/api/pos/shifts` | GET/POST | `viewDay` / `closeShift` | The day's drawer sessions |
| `/api/pos/shifts/[id]/close` | POST | `closeShift` | Close with counts |
| `/api/pos/shifts/float` | POST | `closeShift` | Record the counted opening float (vs the standing figure) |
| `/api/pos/hours` | GET/POST | `viewCloseout` / `closeShift` | Who is on the clock; punch-out from the close-out |
| `/api/pos/register-checks` | GET | `viewDay` | The day's counts, oldest first |
| `/api/pos/register-checks` | POST | `closeShift` | `{counts:[{methodId,countedCents}], note?}` — expected frozen server-side at count time |
| `/api/pos/register-checks` | PATCH | `deleteRegisterCheck` (owner) | `{id, counts}` — strike + corrected copy on the original clock |
| `/api/pos/register-checks` | DELETE | `deleteRegisterCheck` (owner) | `{id, reason}` — soft strike |

## POS — reports ⛨

| Route | Guard | Feeds |
|---|---|---|
| `GET /api/pos/reports/eod` | `viewCloseout` | The Daily Report document and legacy EOD: `{reconciliation ⛨, byCashier, dayTotals, offRack, outstanding, trend, entries, drawer ⛨, hiddenDrawerCents ⛨, registerChecks, shifts…}` — cash line and drawer rows are shaped per role |
| `POST /api/pos/reports/eod` | `closeShift` | Close actions from the sheet |
| `GET /api/pos/reports/closeout` | `viewCloseout` | Close-out V2/V3 payload; drawer block and Collected are folded per role ⛨; owner-only exception rows stripped at the edge |
| `GET /api/pos/reports/daily` | `viewDay` | The Today screen |
| `GET /api/pos/reports/standings` | `viewDay` | Technician standings; sensitive earnings blanked server-side below rank |
| `GET /api/pos/reports/business` | `viewBusinessReports` | The management reports page (margin, movers, staffing need, heatmaps) |
| `GET /api/pos/reports/trends` | `viewBusinessReports` | The trends document |
| `GET /api/pos/reports/document` | `viewBusinessReports` | The printable business report |
| `GET /api/pos/reports/tires` | `viewReports` | Monthly tire units in/out |
| `GET /api/pos/reports/entries` | `viewLog` | The consecutive day log |
| `POST /api/pos/reports/entries/delete` | `deleteEntry` | Hard delete + tombstone |
| `GET /api/pos/web-searches` | `viewReports` | Website stock-search study `{from,to,sizes[],totals}` |
| `GET/POST /api/pos/tire-demand` | `viewReports` / `ringSale` | The walked-out study: report / record (`{size, qty?, note?}`; refused when the study is off) |

## POS — inventory

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/pos/inventory` | GET | `viewInventory` | The rack: sections by rim, groups by size, batteries, misc, `?all=1` includes out-of-stock |
| `/api/pos/inventory` | POST | `adjustInventory` | Records a full count (`last_inventory_check`) |
| `/api/pos/inventory/receive` | POST | `receiveInventory` | `{productId? | usedSize? | usedPool? | fromPool? | newTire{...}, qty, unitCostCents?, supplier?, reference?}` — pool receives, listing out of the pool, and create-on-receive |
| `/api/pos/inventory/adjust` | POST | `adjustInventory` | `{productId, qtyDelta | countedQty, reason, note?}` |
| `/api/pos/inventory/movements` | GET | `viewInventory` | Ledger browse + monthly summaries |
| `/api/pos/inventory/oversells` | GET/POST | `adjustInventory` | Unreviewed oversells; sign-off |
| `/api/pos/inventory/insights` | GET | `viewReports` | Rack insights (dead stock excludes the used pool) |
| `/api/pos/inventory/standing-still` | GET | `viewReports` | Sizes asleep 45/90/120 days |
| `/api/pos/inventory/to-order` | GET | `viewReports` | Reorder + low stock, printable |
| `/api/pos/products` | GET/POST | `searchProducts` / `manageProducts` | Search logs misses to `product_searches`; create |
| `/api/pos/products/[id]` | GET/PATCH/DELETE | `viewInventory` / `manageProducts` / `deleteProduct` | Read / edit / soft-delete |
| `/api/pos/quick-buttons` (+`/[id]`) | GET/POST/PATCH | `manageQuickButtons` | The grid, self-served |

## POS — customers, fleets, directory admin

| Route | Method | Guard |
|---|---|---|
| `/api/pos/customers` | GET `ringSale` (register search) / POST `manageCustomers` |
| `/api/pos/customers/list` | GET `viewLog` — the book with balances |
| `/api/pos/customers/[id]` | GET/PATCH `viewLog` / DELETE `deleteCustomer` |
| `/api/pos/customers/[id]/vehicles` | POST `manageCustomers` |
| `/api/pos/vehicles/[id]` | PATCH/DELETE `manageCustomers` |
| `/api/pos/customers/[id]/account` | GET/POST `manageCreditAccounts` — statement data; record a payment against the account |
| `/api/pos/customers/account-month` | GET `manageCreditAccounts` — the monthly sheet with reconciliation |
| `/api/pos/accounts` | GET `manageCreditAccounts` — all accounts, balances |
| `/api/pos/fleets` | GET `ringSale` / POST `ringSale` — fleet list for the register; create |
| `/api/pos/fleets/[id]` | GET `manageCreditAccounts` — company roll-up, per-driver |
| `/api/pos/directory` | GET `manageDirectory` — driver-directory admin |
| `/api/pos/directory/[id]` | POST/PATCH/DELETE `manageDirectory` — issue/rotate/revoke a fleet's directory access |

## POS — everything else

| Route | Method | Guard | Notes |
|---|---|---|---|
| `/api/pos/alarms` | GET/POST | `reviewAlarms` | The alarm log; acting on one writes `alarm_actions` |
| `/api/pos/notice` | GET/PUT | `viewDay` / `writeNotice` | The board above the register |
| `/api/pos/costs` | GET/POST | `manageSettings` | Per-service costs (`service_costs`) |
| `/api/pos/settings` | GET/PATCH | `manageSettings` | The POS-exposed subset of settings |
| `/api/pos/settings/inventory-alarm` | POST | `manageSettings` | Clears the count-staleness colour without faking a count |
| `/api/pos/permissions` | GET/POST | `managePermissions` | The capability grid, rendered from the same table the server enforces |

---

## Admin (`requireAdminApi` on every route)

| Route | Methods | Notes |
|---|---|---|
| `/api/auth/login` | POST | `{username,password}` → iron-session cookie; `mustChangePassword` honored |
| `/api/auth/logout` | POST | Destroys the session |
| `/api/auth/me` | GET | Session echo |
| `/api/auth/change-password` | POST | `{currentPassword,newPassword}` |
| `/api/admin/dashboard` | GET | One response: employees+state, hours, today's schedule, late-against-schedule, week chart, recent/flagged entries |
| `/api/admin/schedule` | GET/POST | Week roster read; upsert/clear/copy-week (`ON CONFLICT DO NOTHING` on copy) |
| `/api/admin/fence` | GET/POST/PATCH | Read; set-from-here/clear (validated lat/lng/radius 25–5000 m); PATCH toggles trusted-only — **refused while no device is trusted** |
| `/api/admin/devices` | GET/POST/DELETE | List (+`thisDevice`); enroll the requesting browser (`{label}`); revoke (`{id}`) — all audited |
| `/api/employees` | GET/POST | Roster; create with PIN |
| `/api/employees/[id]` | GET/PATCH/DELETE | Includes role, pos_role, active, `hourly_rate_cents` |
| `/api/employees/[id]/reset-pin` | POST | `{pin}` |
| `/api/entries` | GET/POST | Time entries browse; manual entry (`fence_verdict: "manual"`) |
| `/api/entries/[id]` | PATCH/DELETE | Corrections keep the original underneath (`edited_by_admin_id/at`) |
| `/api/photos/[filename]` | GET | Punch photos — session-gated, never public |
| `/api/settings` | GET/PATCH | The full `SettingsMap` |
| `/api/audit` | GET | The audit log, filterable |
| `/api/reports/weekly` | GET | The admin week report |
| `/api/reports/export` | GET | Excel export (`exceljs`) |

---

## Public (no session — every field whitelisted by hand)

### `GET /api/public/inventory`
The rack for the public page: per-size groups with **six named fields per
tire** (id, name, brand, model, ply, price, on-hand). Never present, by
listed rule in the file: `default_cost_cents`, `cost_code`, `supplier`.
`?all=1` includes out-of-stock. Ships `lastCheck` so a stock figure carries
its age.

### `GET /api/public/stock?size=`
The website's one-bit search: whole-size queries only (partials are refused
as `{ok:false}` — a substring probe cannot walk the rack). → `{ok, size
(normalized), inStock}`. Side effects: every ask archived to `web_searches`
(60-second same-size handrail); misses additionally logged to
`product_searches` with a NULL employee.

### `GET /api/public/quote`
The tire quoter: cost → margin → mount & balance → tax → rounding, all from
settings; returns the quote breakdown without ever exposing cost.

### `GET /api/public/leaderboard`
Technician leaderboard for the public page — names and rankings only.

---

## Fleet directory (`dirSession` cookie)

| Route | Methods | Notes |
|---|---|---|
| `/api/dir/[slug]/login` | POST | Fleet slug + PIN → directory session; visits (including failures) logged to `dir_visits` |
| `/api/dir/logout` | POST | — |
| `/api/dir/profile` | GET | The company's own drivers/vehicles/billing view |
| `/api/dir/drivers` (+`/[id]`) | POST/PATCH | Self-service driver management |
| `/api/dir/vehicles` (+`/[id]`) | POST/PATCH | Self-service vehicle management |

---

## Coverage note

Route count and guard names in this document are extracted from source; if a
route is added or a guard changes, this file changes in the same commit (see
the maintenance rule in the [suite index](README.md)).
