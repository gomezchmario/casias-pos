# Casias Muffler and Tire Shop — Time Clock + Point of Sale

A single self-hosted application that runs the front counter of a real tire shop in San Antonio: employee time clock, register, inventory, special orders, and the end-of-day cash close-out. It runs on one Windows PC, on localhost, with no cloud services, no external database, and no network dependency — because the shop needs to ring a $15 flat repair when the internet is down.

---

## The problem this replaces

The shop ran its sales on an Excel workbook driven by a VBA quick-entry form. A flat log of one row per service, a separate special-orders sheet, a tire price list, a daily dashboard. It worked, and it had five structural problems that no amount of additional spreadsheet could fix:

1. **No link between sales and inventory.** Selling a tire didn't decrement anything. Stock was a number someone retyped.
2. **No receipts.**
3. **No permissions.** Anyone at the counter could see and change anything.
4. **No record of who changed what.** Rows could be silently edited or deleted, and frequently were.
5. **Money was floats in cells.** With the rounding behaviour you'd expect.

The design constraint that dominated everything else: **most tickets here are $5–$20 and take seconds to ring.** If the register is slower than the VBA form, the project has failed no matter how correct its books are. Several decisions below look over-engineered until you weigh them against that — and several obvious "improvements" were rejected because they cost keystrokes at the counter.

It was built *inside* the shop's existing Next.js time clock rather than as a new app. The employees, PINs, SQLite database, migration runner, audit log and one-click Windows launcher already existed and were already trusted. The time clock still works, untouched, on the same database.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router | Server and client in one deployable; route handlers are the API |
| UI | React 19, TypeScript, Tailwind v4 | — |
| Database | SQLite via `better-sqlite3` | Embedded, single file, synchronous |
| Auth | `iron-session` (admin), custom token sessions (POS) | Two different threat models, see below |
| Hashing | `bcryptjs` | PINs and the admin password |
| Export | `exceljs` | The shop lives in Excel; reports have to land there |
| Process | One Node process, HTTPS via `server.mjs` + mkcert | Camera access requires a secure context |

**Why SQLite and not Postgres.** One PC, one process, one user at a time, and a hard requirement to work with no network. A server database would add an install step, a service to keep running, and a failure mode ("the database service didn't start") to a shop with no IT staff. `better-sqlite3` is also *synchronous*, which removes an entire category of async-transaction bugs — a transaction is a plain function call, and there is no `await` inside one that can interleave with something else.

WAL mode is on, foreign keys are on, and the connection is a module-level singleton.

---

## The six invariants

These are the whole point of the project. Everything else was negotiable.

### 1. Money is integer cents. Never a float, anywhere.

`src/lib/money.ts` owns parsing and formatting. Nothing else divides money.

### 2. Ledgers are append-only

`payments`, `inventory_movements` and `drawer_movements` have **no soft-delete column**. The only way to undo a row is to write a reversing row that points at it.

This is deliberately stronger than a `deleted` flag, and the reason is bug-shaped: with a flag, every report needs `WHERE deleted = 0`, forever, including reports written next year by someone who didn't know. One forgotten clause silently misstates the day's takings. If there is nothing to filter, nothing can forget to filter.

### 3. Entities are soft-deleted, never dropped

`sales`, `products`, `customers`, `vehicles`, `inventory_lots` carry `deleted / deleted_by / deleted_at / deleted_reason` and a human-readable unique key.

### 4. Every mutation writes a before/after JSON diff to `audit_log`

Attributed to the employee **and their role at the time of the action** — a role snapshot, not a join, because a technician promoted to manager in November must not retroactively appear to have been a manager in July. The audit row is written inside the same transaction as the change (`inTx` in `src/lib/tx.ts`), so a change without its audit row is not a state the database can be in.

### 5. `business_date` is not `substr(created_at, 1, 10)`

The shop's day runs 4am to 4am (configurable). A ticket corrected at 12:30am after a 9pm close belongs to the *previous* business day. One helper computes it (`src/lib/business-date.ts`) and everything that buckets money by day goes through it. Midnight-based bucketing would split one night's takings across two days and make the close-out unreconcilable.

### 6. Totals freeze when a sale completes

Payments are taken against a number. A later price correction must not silently rewrite what the customer already owed.

---

## Architecture

```
src/
├── app/
│   ├── (kiosk)/            Time-clock kiosk — the screen bolted to the wall
│   ├── admin/(authed)/     Time-clock admin: employees, entries, payroll reports, audit
│   ├── pos/(shell)/        The register and back office (locked, role-gated)
│   ├── pos/sale/[id]/      Printable receipt (outside the shell — it prints)
│   ├── inventory/          Public rack lookup, no login
│   └── api/                Route handlers — the entire API surface
├── components/
│   ├── kiosk/  admin/  pos/  ui/
└── lib/                    All business logic. No SQL above this layer.
```

**The rule that keeps this honest: no route handler contains SQL.** Routes parse input, call a `lib/` function, and serialise the result. Everything that touches the database lives in `src/lib`, which means the invariants above are enforced in one place per concept rather than at each of ~55 endpoints.

### Two auth systems, on purpose

- **Admin** (`iron-session`, encrypted cookie) — username and password, for the time-clock back office. Sessions are long. The threat model is "someone who isn't the owner opened the laptop."
- **POS** (`src/lib/pos-session.ts`) — employee picker, then PIN, then a hashed token in an httpOnly cookie. The threat model is completely different: *one shared PC, on a counter, that a dozen people use all day.*

That second model is why POS auth is **employee-picker-then-PIN rather than PIN-only**. The time clock's `findEmployeeByPin` bcrypt-compares against every active employee — fine once a day at check-in, far too slow for a register. Picking the name first makes it one comparison.

### The idle lock, and a bug worth describing

The register locks itself when untouched. The first implementation did this as session expiry slid forward on each request — and it did not work. The shell polled `/api/pos/auth/me` on a timer, every poll bought another quarter hour, and a tab left open on an empty counter stayed signed in indefinitely. Sessions were observed alive 22 minutes against a 15-minute setting.

The lesson is a general one: **the server can only measure the gap between requests, and a request is not a person.** The lock now lives client-side in `PosShell`, watching for real keys and taps, and revokes the session itself. Server-side expiry stayed as the backstop for what the client can't cover — closed tab, killed process, pulled power.

Unlocking returns to the same screen rather than dumping the cashier at a login page, because the alternative is that people stop locking it.

### Permissions are capabilities, not roles

Roles are `technician → cashier → manager → owner`, but no route checks a role. `src/lib/roles.ts` maps ~30 *capabilities* to a minimum role, and handlers call `requirePos("voidSale")`. Adding a role, or moving one permission, is a change in one table rather than a grep across the codebase. The admin permissions screen renders from that same table and the same `can()` the server enforces with, so the screen an owner uses to decide who can touch money cannot drift from the rules actually applied.

There are places where the split is finer than it first looks — `discountSale` and `discountAnyAmount` are separate, because "may you discount at all" and "may you discount *this much*" have different answers, and the ceiling itself is a setting rather than a role.

---

## Data model highlights

Sixteen migrations, applied by a runner that records each filename in a table and skips what's already applied. They run only via `npm run setup`, never on server start — a dev server restarting shouldn't reshape the shop's database.

### Sales

`sales` (header: `sale_no`, `business_date`, `status`, frozen totals, cashier, discount) + `sale_items`. **The mechanic lives on the line, not the ticket**, because commission and the leaderboard are per-line — a ticket can easily have a tire from one tech and two flats from another.

Line items snapshot their description, unit cost *and* list price at the moment of sale. The snapshot matters: flagging edited prices by comparing against `products.price_cents` at read time seems obviously right and is quietly wrong. The day a tire goes from $170 to $175, every honest sale ever rung at $170 starts showing as edited. A report that cries wolf across a year of clean sales gets ignored inside a week — and then it isn't there for the one sale that mattered.

### Payments, and the forgotten-tip problem

`payments` is a separate append-only table, so one ticket can have split or partial payments. `kind` ∈ `payment / tip_adjustment / refund / reversal / deposit`, with negative amounts for money going back out.

This is the fix for the shop's most common bookkeeping mess: a tip remembered an hour after the customer left. In the spreadsheet that became a phantom $2 sale, which inflated the day's ticket count and attributed revenue to nothing. Here it's a `tip_adjustment` row pointing at the original sale.

**Commission rides on the payment, not the sale**, precisely because the tip can arrive later. The default is `ceil(tip / 500) * 100` — the shop's $1-per-$5 rule — with divisor and charge in `settings`, never hardcoded.

### Void vs. refund — three distinct operations

Conflating these is the classic POS bug:

- **Void an open ticket** — status change only. No inventory moved yet, nothing to undo.
- **Void a completed ticket** — status change, *plus* a reversal payment per original payment, *plus* a `void_return` inventory movement per original movement (same lot, same cost). Originals are never touched, so daily totals net to zero for free.
- **Refund later** — a new negative payment and return movements. The sale stays `completed`, because it happened.

### Inventory

`products → inventory_lots → inventory_movements`. **Stock is derived from the append-only ledger, never stored on the product.** There is no count column to drift out of step with the reasons it changed. `inventory_lots.qty_remaining` exists as a FIFO cursor rather than an authority, and an integrity check proves the two still agree.

Decrementing is wired into `completeSale` and restoring into `voidSale` rather than left to callers — a route that completed a sale and forgot to move stock would look identical to a working one until the counts drifted far enough to notice, which is the failure the spreadsheet already had.

**Used tires are a product with almost every field empty.** A used tire carries only its size: no brand, no DOT, no cost, no price, because the price is decided at the counter from the tire's condition and the customer. One row per size, not per tire. `createProduct` and `updateProduct` *refuse* those fields for used stock rather than dropping them silently, because a price stored "just in case" is a number someone eventually trusts. Batteries have the same shape — Large, Medium, Small, no group size, no CCA — for the same reason.

Overselling stays possible, as a flagged manager decision, when the shop switch allows it. A hard block doesn't stop the tire leaving the shop; it stops the sale being *rung against the product*, turning a flagged row in a review queue into no record at all.

### Cash that isn't a sale

A manager empties the till at 3pm because there's $400 sitting in a wooden box in a tire shop. That's not income, not an expense, not a refund — the same money in a different place — and it used to appear as a $400 shortage at close.

`drawer_movements` is a separate table rather than a `payments` row, and that's the whole design. `payments` is the revenue ledger and everything trusts it: day totals, expected-by-method, tips, the method breakdown, the EOD variance. A withdrawal in there means adding "and not a withdrawal" to every one of those queries and every query written afterwards, forever. Revenue queries don't join this table, so they cannot be wrong about it.

### Mid-shift register checks

The close-out answers "was tonight right." It doesn't answer "when did it go wrong," and on the nights that matters that's the only useful question. Anyone can count the drawer at noon and log it; the check is signed, prints on the close-out, and is flagged if it didn't balance. Four clean checks and a short close localise a loss to a two-hour window.

The expected figure is **frozen onto the row** at the moment of counting — otherwise a late tip booked at 8pm rewrites what the noon count was measured against and turns a check that balanced into one that never did.

---

## Notable design decisions

**Server-side data gating, not CSS.** The daily dashboard is often left open on a counter anyone can walk past. Technician *dollar* figures are blanked server-side for anyone below owner and the *shares* are computed server-side, because handing the page the cents to divide would ship the exact number being withheld. This is explicitly presentational — the shop's total is on that page several ways and multiplying by a share recovers the dollars — and the code says so. The point is what a screen shows at a glance, not secrecy from someone doing arithmetic. Tips are deliberately *not* gated: the cashier usually counted that tip into someone's hand an hour ago, and hiding it would be theatre.

**The public rack lookup ships a field whitelist, written out by hand.** `/inventory` answers "do we have a 215 55 17" with no login, from a phone at the bay. The route names each field that may leave rather than spreading and deleting, because `{...product, cost: null}` is one careless refactor away from leaking the next column somebody adds. Cost, the internal price code and the supplier never leave.

**Three clocks that look like one.** `created_at` (when the row was written), `business_date` (which day's money it is), and `fulfillment_at` (when a special order last moved). Special orders needed their own, because `updated_at` moves when someone takes fifty cents off the price, and "how long has this tire sat with nobody calling the customer" is a different question.

**Names are re-cased, but not title-cased.** Employees get typed in as ADRAIN, adrain, Adrain, and the shouting then appears on the leaderboard next to properly typed names. `properName` re-cases only words that carry no case information; a word already mixed is left alone, because blanket title-casing turns McCoy into Mccoy — not tidier, wrong, and wrong in a way the person whose name it is can't fix by retyping it.

**Free-text mechanic names don't create employees.** Someone occasionally needs to note who did one $20 mount when it wasn't staff. Creating an employee row would put that person permanently in the PIN picker, the payroll list and every per-fitter report. Instead the line carries an optional name, `mechanic_id` and `mechanic_name` are mutually exclusive, and one function settles which wins. All written-in names collapse to a single "Other" row on reports — "Miguel", "miguel" and "Miguel R" are three strings and one person, and ranking them separately would invent precision the data doesn't have.

---

## Running it

**Requirements:** Node.js 22+.

```bash
npm install
npm run setup      # .env.local, database, migrations, seed admin + employees
npm run dev        # http://localhost:3000
# or
npm run build && npm start    # HTTPS via server.mjs, needs certs/
```

Or double-click `start.bat`, which does all of the above and opens the browser — the shop's actual deployment process.

| Path | What |
|---|---|
| `/` | Time-clock kiosk |
| `/admin` | Time-clock back office |
| `/pos/register` | The register |
| `/pos` | Today: podium, live entries, outstanding balances |
| `/pos/eod` | End-of-day close-out (printable) |
| `/pos/inventory` | Stock, receiving, printable rack sheet |
| `/pos/orders` | Special-order board |
| `/inventory` | Public rack lookup, no login |

**Migrations run only on `npm run setup`.** After pulling schema changes, run it.

**Backups:** `node scripts/backup-db.mjs [dest]`. It uses SQLite's `VACUUM INTO` rather than a file copy — the database is in WAL mode, and copying `timeclock.db` alone can silently miss hours of sales still sitting in the WAL. Then it verifies with `integrity_check` and row counts.

**Not in this repo, by design:** `data/` (the database carries PIN hashes and every sale), `certs/` (private key), `uploads/` (employee photos), `.env.local`.

---

## Honest limitations

- **One machine, no redundancy.** The database exists in one place. Off-machine backup is a scheduled copy, not replication.
- **No automated tests.** Verification has been manual, per phase, against the real workbook. This is the gap I'd close first, starting with `money.ts`, `business-date.ts` and the void/reversal paths — pure functions with exact expected values and the highest cost of being wrong.
- **No concurrency story beyond SQLite's.** Correct for one register; a second terminal would need thought about open-ticket locking, not about the database.
- **Payroll periods aren't locked yet.** The schema is there. Until it's wired up, an edit made in August can still change a July payout report; the design is that a locked week reads frozen lines and later edits book an adjustment into the current period.
- **Receipts are letter-size only.** The 80mm thermal stylesheet waits on the shop choosing hardware.
