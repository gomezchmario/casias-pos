# Shop System — Point of Sale, Inventory and Time Clock

A self-hosted point-of-sale and workforce system for independent tire and auto service shops. It runs the front counter end to end: ringing sales, taking payment, tracking stock, managing special orders and house accounts, reconciling the drawer and the card terminal at close, and recording the hours the staff worked.

It is a single application on a single machine. No cloud account, no external database, no network dependency. The register keeps working when the internet does not.

---

## Contents

- [What it does](#what-it-does)
- [Technology](#technology)
- [Deployment model](#deployment-model)
- [Architecture](#architecture)
- [Security and access control](#security-and-access-control)
- [Data integrity guarantees](#data-integrity-guarantees)
- [Data model](#data-model)
- [Reporting and printed documents](#reporting-and-printed-documents)
- [Operations](#operations)
- [Scope and current limitations](#scope-and-current-limitations)

---

## What it does

### Register

- Configurable quick-button grid for the shop's common services and price points, editable from the app without a code change.
- Free-text lines with typed prices for anything the grid does not cover.
- Per-line technician attribution, plus a separate fitter credit so one line can pay two people — the person who sold a set of tires and the person who mounted them days later.
- Split and partial payment across any number of tenders on one ticket.
- Configurable payment methods (cash, card, SNAP, financing, purchase order, house account, and others), each flagged as card or not so the card batch can be reconciled against a sequence number.
- Customer and vehicle capture, prompted above a configurable ticket value and always skippable.
- Printable receipts.

### Inventory

- Products, lots and an append-only movement ledger. Stock on hand is derived from the ledger rather than stored, so no count can drift out of step with the reasons it changed.
- FIFO cost allocation for landed cost and margin.
- Stock decrements automatically on sale completion and restores automatically on void, inside the same transaction as the sale.
- New and used tires are modelled separately. A used tire carries only its size — no brand, cost or shelf price — because it is priced at the counter from its condition; the system refuses to store fields that would invite a number nobody can stand behind.
- Overselling is permitted as a flagged, attributable manager decision when the shop enables it, and surfaces in a review queue.
- Low-stock and negative-stock warnings, ordered worst-first.
- Printable rack sheet for walking the aisles on a clipboard.
- Public stock lookup at a login-free URL, served through a hand-written field whitelist so cost, internal price codes and supplier never leave the building.
- An optional lost-sale study: a faded button on every register screen records the size a customer asked for and left without — the demand signal no sales system captures by construction — reported by units wanted with current stock beside each size.

### Special orders

- A special order is an ordinary ticket with a fulfilment status, not a parallel money model, so a deposit and a balance behave exactly as they do anywhere else.
- Status board covering ordered → arrived → customer called → ready → collected, with the states the counter actually uses.
- Fulfilment asks whether the arriving tire was already booked into stock by hand, shows that product's full movement history as evidence, and gates the answer behind an explicit confirmation — the one fact the database cannot infer and the one that silently corrupts a count.

### Customers and house accounts

- Customer book with vehicles, full ticket history, and a pinned note visible to everyone.
- Filters for customers who owe money, customers running a tab, and tabs nobody approved.
- Credit approval is an explicit, recorded decision, shown at the register the moment the customer is attached to a ticket.
- House accounts are derived from the payment ledger rather than stored, so voided tickets and corrected tenders remove their own charges with no reconciling entry.
- Account payments record amount, the date the money actually arrived, how it was paid and which bank account it landed in. Corrections are written as reversing entries, never erasures.
- Per-customer printable statement, and a monthly account sheet with opening balance, charges, payments and closing balance — four columns that must reconcile, with the identity checked and reported.

### Close-out and reconciliation

- Blind drawer count: expected figures stay covered until the count is logged, so a count is a count rather than a transcription.
- Per-tender variance with direction and magnitude, plus automatic detection of the classic wrong-tender error — two tenders out by the same amount in opposite directions — naming the candidate tickets.
- Mid-shift register checks, signed and frozen against the expectation at the moment of counting, so a loss can be localised to a two-hour window rather than to a whole day.
- Cash movements in and out of the drawer are tracked separately from revenue, so a bank run is never a shortage.
- Card batch confirmation gated in sequence: count, log, settle, print.
- One-page signed close-out plus a detailed financial report, formatted for letter paper and designed to be filed.

### Workforce

- PIN-based employee clock-in and clock-out on a kiosk screen.
- Optional photo capture at punch.
- Timesheet correction with full attribution, payroll periods and exportable reports.
- Per-technician performance board — units sold by category, income share, and change against the comparable prior period — readable by day, week or month, with the day view comparing each technician against their own last shift rather than against a calendar day they may not have worked.

### Day-to-day reporting

- Daily figures split by what was sold and what was collected, which are deliberately different numbers.
- Consecutive event log for the day: every line rung and every movement of money, in the order it happened, searchable by ticket, customer, phone, service, tender or card sequence number.
- Tip and commission summaries.
- Monthly tire reports: units sold and units received, with tax backed out and order-versus-stock attribution.
- Price-override report showing every line sold away from the rack price.
- Excel export.

### Management reporting

A separate owner-level screen, organised by the decision each panel feeds rather than by where the data lives, over any date window with the equivalent preceding window computed for comparison.

- **Money** — revenue and collections over time, ticket count, average ticket, gross margin and discounts given, each against the same length of time before it.
- **What sells** — sales mix and payment mix, margin by category, and the best sellers by units.
- **When** — a week-by-hour heatmap of ticket volume, takings by day of the week averaged over how many of each the window held, and the busiest hours. This is the report that settles a rota.
- **Who** — per-technician units, tickets, tips and share of takings, over the same window as everything else on the page.
- **The racks** — stock at cost by brand and rim size, capital tied up in stock that has not moved, and what has reached its reorder point with how fast it has been selling.
- **Owed** — ticket balances and house-account balances aged into 30-day buckets, kept in separate columns because they are chased by different people.
- **Customers** — new against returning, repeat share, and who spends the most, bounded by how many tickets took a name at all.
- **Missed** — sizes asked for and not in stock, from the counter's own lost-sale study, alongside register searches that returned nothing.
- **Control** — voids, refunds, price overrides, post-completion edits, oversells and register logs that did not balance, attributed by name.

Margin is computed only over lines that carry a recorded cost — a flat repair has none and never should — and the coverage percentage is printed beside every margin figure rather than left to be assumed. Charts are hand-drawn SVG with no external dependency. The whole page prints to letter paper.

---

## Technology

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS v4 |
| Database | SQLite via `better-sqlite3`, WAL mode, foreign keys enforced |
| Sessions | `iron-session` (back office), token sessions in httpOnly cookies (register) |
| Hashing | `bcryptjs` |
| Export | `exceljs` |
| Runtime | Node.js 22+, single process, HTTPS |

Roughly 48 domain modules, 70 API route handlers, 26 screens, 31 tables and 30 ordered migrations.

**Why SQLite.** One machine, one process, no IT staff on site. A server database adds an install step, a service that must stay running, and a failure mode the shop cannot diagnose. `better-sqlite3` is also synchronous, which removes an entire category of interleaved-transaction bug: a transaction is a plain function call with nothing that can suspend inside it.

---

## Deployment model

A single Node process on one Windows PC, serving HTTPS on localhost. HTTPS is required rather than cosmetic — camera access for punch photos needs a secure context.

The shop's own deployment is a double-clicked launcher that starts the server with no visible window, so there is nothing on the taskbar for somebody to close at the end of a shift. Output is written to a log file for diagnosis. The process is safe to launch twice; a second launch detects the running server and exits.

Nothing leaves the machine. There is no telemetry, no vendor callback and no external service in the request path.

---

## Architecture

```
src/
├── app/
│   ├── (kiosk)/            Time-clock kiosk — the wall-mounted screen
│   ├── admin/(authed)/     Back office: employees, timesheets, payroll, audit
│   ├── pos/(shell)/        Register and shop back office, locked and role-gated
│   ├── pos/sale/[id]/      Printable receipt, outside the shell
│   ├── inventory/          Public stock lookup, no login
│   └── api/                Route handlers — the entire API surface
├── components/             kiosk · admin · pos · shared UI
└── lib/                    All business logic
```

**No SQL exists above `src/lib/`.** Route handlers parse input, call a domain function and serialise the result. Every rule in this document is therefore enforced in one place per concept rather than repeated across 67 endpoints, and a new endpoint inherits the guarantees rather than having to remember them.

Migrations are ordered files applied by a runner that records each filename and skips what is already applied. They run on an explicit setup command, never on server start, so restarting the application can never reshape the shop's database.

---

## Security and access control

### Two session systems

The back office and the register have genuinely different threat models and are treated as such.

- **Back office** — username and password, encrypted session cookie, long sessions. The risk is somebody who is not the owner opening the machine.
- **Register** — employee picker, then PIN, then a hashed token in an httpOnly cookie. The risk is a shared PC on a counter that a dozen people use all day.

Choosing the name before the PIN is a deliberate performance decision: it turns authentication into a single hash comparison instead of one per active employee.

### Idle lock

The register locks itself when nobody is using it. The lock is driven by real keyboard and pointer activity in the client and revokes the session directly; server-side expiry remains as the backstop for what a client cannot report — a closed tab, a killed process, a power cut. Server-measured inactivity alone is not sufficient, because the gap between requests is not the gap between people.

Unlocking returns to the screen the user was on rather than to a login page, because a lock that costs work is a lock people stop using.

### Capabilities, not role checks

Roles form a ladder — technician, service writer, cashier, manager, owner — with an accountant role that sits at cashier rank on the floor and carries owner-level authority over customer accounts only.

No route handler tests a role. The system defines 43 named capabilities mapped to a minimum rank, with explicit grant and denial lists for the cases a ladder cannot express, and handlers ask for the capability they need. The permissions screen renders from the same table the server enforces with, so what an owner sees when deciding who may touch money cannot drift from the rules actually applied.

Sensitive figures are withheld on the server, not hidden in CSS. Where a page must not show technician earnings, the amounts are blanked before the response is built rather than filtered in the browser.

---

## Data integrity guarantees

These are the properties the system is built to hold, and the reason it is trustworthy as a book of record.

**1. Money is integer cents.** No floating-point value represents money anywhere in the system. One module owns parsing and formatting.

**2. Ledgers are append-only.** Payments, inventory movements and drawer movements have no delete flag and are never updated. The only way to undo a row is to write a reversing row that points at it. This is stronger than a soft-delete column: with a flag, every report ever written must remember to exclude deleted rows, and one omission silently misstates the day's takings. With nothing to filter, nothing can forget to filter.

**3. Entities are soft-deleted, never dropped.** Sales, products, customers, vehicles and lots retain who deleted them, when and why, along with a human-readable key.

**4. Every mutation is audited.** A before/after JSON diff is written to the audit log, attributed to the employee *and to the rank they held at the time* — a snapshot, not a join, so a promotion cannot retroactively rewrite who was authorised to do what. The audit entry is written inside the same transaction as the change, so a change without its audit record is not a state the database can reach.

**5. The business day is explicit.** The shop's day runs on a configurable boundary rather than on midnight. A ticket corrected at 12:30am after a 9pm close belongs to the previous business day. One helper computes this and everything that buckets money by day goes through it; midnight bucketing would split a night's takings across two days and make the close-out impossible to reconcile.

**6. Totals freeze on completion.** Payment is taken against a specific number. A later price correction is recorded as a correction and never silently rewrites what the customer owed.

**7. Voids, refunds and corrections are three different operations.**

| Operation | Effect |
|---|---|
| Void an open ticket | Status change only. Nothing has moved. |
| Void a completed ticket | Status change, plus a reversing payment per original payment, plus a return movement per original stock movement. Originals untouched; the day nets to zero without special-casing. |
| Refund later | A new negative payment and return movements. The sale remains completed, because it happened. |
| Correct a payment | The original is reversed and re-taken saying the right thing, on the original business date, so the day the money moved does not change. |

An on-demand integrity check reconciles sale headers against their line items, and recorded payment totals against the payment ledger. Mismatches are reported, never silently repaired.

---

## Data model

**Sales.** A header carrying the ticket number, business date, status, fulfilment status, cashier, discount and frozen totals; plus line items that snapshot their description, cost and rack price at the moment of sale. The snapshot matters: comparing against the current product price at read time would make every honest sale rung before a price change appear to have been discounted.

**Technician attribution lives on the line**, not the ticket, because commission and performance are per-line — a single ticket routinely carries a tire from one technician and two repairs from another.

**Payments** are a separate append-only table so a ticket can carry split, partial and later payments. Kinds are payment, tip adjustment, refund, reversal and deposit, with negative amounts for money going out. Because a tip is frequently remembered after the customer has left, commission rides on the payment rather than on the sale; a late tip is an adjustment pointing at the original ticket rather than a phantom sale that would inflate the day's ticket count.

**Inventory** runs products → lots → movements. Lots exist as a FIFO cursor for costing rather than as an authority on quantity; stock is always derived from the ledger, and an integrity check proves the two agree.

**Drawer movements** are their own table rather than payment rows. Revenue queries do not join it, so no revenue query can ever be wrong about a bank run. Adding withdrawals to the payment ledger would mean every current and future revenue query carrying an exclusion clause.

**House accounts** derive their charge side from the payment ledger, so a voided ticket or a corrected tender removes its own charge automatically. Payments against an account are stored separately and are never allocated to a specific ticket, because that is not how a monthly account is settled.

**Register checks** freeze the expected figure onto the row at the moment of counting, so a late booking cannot retroactively turn a check that balanced into one that never did.

---

## Reporting and printed documents

Printed output is treated as a product, not an afterthought. Everything intended for paper is laid out for letter size with its own stylesheet, and screen layout is free to differ from print layout where the two are read differently.

- **Receipt** — customer-facing, per ticket.
- **Close-out** — a fixed one-page sheet ending in a signature block that always lands on the same rule, followed by a detailed financial report. The sheet is identical every night by design, so the eye learns where the numbers are.
- **Account statement** — per customer, on shop letterhead.
- **Monthly account sheet** — opening, charges, payments and closing per account, with a reconciliation check.
- **Rack sheet** — printable inventory for a physical count.
- **Monthly tire reports** — units sold and units received with tax backed out.
- **Excel export** — for anything that has to leave the building in a spreadsheet.

A bilingual (English and Spanish) in-app staff manual ships with the system, written against the real interface, with a print build for paper copies.

---

## Operations

**Requirements:** Node.js 22 or later. Windows, macOS or Linux; the shop deployment is Windows.

```bash
npm install
npm run setup      # environment file, database, migrations, seed accounts
npm run dev        # development server
npm run build && npm start   # production, HTTPS
```

| Path | Screen |
|---|---|
| `/` | Time-clock kiosk |
| `/admin` | Back office |
| `/pos` | Today: performance, live activity, outstanding balances |
| `/pos/register` | The register |
| `/pos/entries` | Consecutive event log for the day |
| `/pos/customers` | Customer book and house accounts |
| `/pos/inventory` | Stock, receiving, printable rack sheet |
| `/pos/movements` | Stock movement history and monthly tire reports |
| `/pos/orders` | Special-order board |
| `/pos/eod` | Close-out |
| `/pos/reports` | Management reports |
| `/inventory` | Public stock lookup, no login |
| `/help` | Staff manual, English and Spanish |

**Migrations** run on `npm run setup`. Run it after applying an update.

**Backups** are taken with `node scripts/backup-db.mjs [destination]`, which uses SQLite's `VACUUM INTO` rather than a file copy. A plain copy of the database file can silently omit hours of sales still held in the write-ahead log. The script then verifies the copy with an integrity check and a row-count comparison.

**Excluded from version control by design:** the database (it holds PIN hashes and every sale), TLS private keys, uploaded photographs, and the environment file.

---

## Scope and current limitations

Stated plainly, because a system of record should be honest about its edges.

- **Single machine.** The database exists in one place. Resilience is a scheduled off-machine backup, not replication. A multi-terminal deployment would require a concurrency design for open tickets; the database layer itself would not need to change.
- **Automated test coverage is limited.** Verification to date has been manual and per-feature against real shop data. The highest-value coverage — money arithmetic, business-date bucketing, and the void and reversal paths — is the first work planned.
- **Payroll period locking is designed and not yet enabled.** The schema exists. Until it is switched on, an edit made in a later month can still alter an earlier payout report; the intended behaviour is that a locked week reads frozen lines and later edits book an adjustment into the current period.
- **Receipts are letter-size.** An 80mm thermal stylesheet is designed and awaits a hardware decision.

---

## Status

In daily production use at a working tire and muffler shop, handling live sales, inventory, house accounts and cash reconciliation.
