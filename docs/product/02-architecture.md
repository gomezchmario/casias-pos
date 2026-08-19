# 02 — Architecture

> Companion to the top-level [`README.md`](../../README.md), which carries the
> narrative overview. This document is the structural reference: what lives
> where, what layers exist, and which rules hold the shape together. Counts
> are as of this writing: **48 migration files numbered 001–050 (39 tables), 62 modules in
> `src/lib`, 101 API route handlers, 41 pages, 32 components**.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router | Server routes + client pages; no server components with data logic |
| Language | TypeScript, strict | `npx tsc --noEmit` is the gate before every build |
| UI | React 19, Tailwind CSS v4 | Plus per-area plain CSS files for print documents |
| Database | SQLite via `better-sqlite3` | WAL mode, foreign keys on, synchronous API |
| Sessions | `iron-session` (admin), token cookies (POS, directory, devices) | Four cookie families — see [10 — Security](10-security.md) |
| Hashing | `bcryptjs` (PINs, admin passwords), sha256 (bearer-style tokens) | Tokens are stored only as hashes |
| Export | `exceljs` | Weekly/report exports |
| Runtime | Node.js 22+, one process | Custom `server.mjs`, HTTPS on one port |

## The serving path

`server.mjs` owns the socket:

- One port (3000). A raw TCP server peeks at the first byte of every
  connection: `0x16` (TLS handshake) goes to the HTTPS server; an ASCII letter
  (an HTTP method) goes to a tiny HTTP server that 308-redirects to `https://`
  on the same host — so a phone that typed the address without a scheme still
  arrives.
- HTTPS is load-bearing, not cosmetic: camera (punch photos) and geolocation
  (the clock-in fence) both require a secure context.
- Certificates are self-signed files in `certs/` (gitignored).
- In production the same build is also published at `app.casiastire.shop`
  through a tunnel to this machine — the public URL is this box.

## Layout

```
src/
├── app/
│   ├── (kiosk)/                 Time-clock kiosk (route group, / )
│   ├── admin/                   Back office (iron-session)
│   │   ├── login/
│   │   └── (authed)/            dashboard · employees · permissions · entries
│   │                            schedule · fence · reports · audit · settings
│   ├── pos/
│   │   ├── (shell)/             The locked, role-gated POS shell:
│   │   │                        register · drawer (+/report) · closeout ·
│   │   │                        inventory · movements · orders · customers ·
│   │   │                        fleets/[id] · entries · eod · alarms ·
│   │   │                        reports (+staffing +trends) · demand ·
│   │   │                        standing-still · to-order · web-searches ·
│   │   │                        settings · closeout-v3 · customers/month
│   │   └── sale/[id]/receipt    Printable receipt, outside the shell
│   ├── inventory/               Public rack view (no login)
│   ├── leaderboard/             Public technician leaderboard
│   ├── dir/                     Fleet-driver self-service directory
│   ├── help/                    Bilingual staff manual
│   └── api/                     101 route handlers — see 04 — API Reference
├── components/
│   ├── kiosk/                   Keypad, PinDots, CameraPreview, Clock, ActionButtons
│   ├── admin/                   AdminShell (nav + auth gate)
│   ├── pos/                     PosShell, PaymentPanel, TicketDrawer,
│   │                            TicketDetails, ProductSearch, CashCounter, Charts…
│   └── ui/                      Badge, BackToTop, Modal, ShopLogo…
└── lib/                         62 modules — ALL business logic and ALL SQL
```

## The one structural rule

**No SQL exists above `src/lib/`.** Route handlers parse input, check a
capability, call a domain function, and serialize. Every invariant is enforced
in exactly one module per concept:

| Concern | Module |
|---|---|
| Money parsing/formatting (integer cents) | `money.ts` |
| Business date (day starts at a configurable hour, not midnight) | `business-date.ts` |
| Local time (no UTC anywhere) | `time.ts` |
| Transactions | `tx.ts` (`inTx`) |
| Audit writing | `audit.ts` (inside the same transaction as the change) |
| Capability checks | `roles.ts` (`can(role, capability)`) |
| Sales / payments / inventory / drawer | `sales.ts`, `payments.ts`, `inventory.ts` + `products.ts`, `drawer.ts` |
| Sessions | `session.ts` (admin), `pos-session.ts` (register), `devices.ts` (trusted devices) |
| Fence | `fence.ts` (the one place a punch is judged) |
| Tire-size parsing | `tire-size.ts` (pure, importable by client components) |

A deliberate exception exists in `shifts.ts`: `drawerAdjustFor` is an inline
copy of `drawer.ts`'s net query to avoid a circular import, with a comment
binding the two together. The pair must move in lockstep.

## The four front doors

The application is really four applications sharing one database and one
process, each with its own authentication story:

| Surface | Route group | Auth | Audience |
|---|---|---|---|
| Kiosk | `(kiosk)` at `/` | None to view; PIN per action | The wall tablet |
| Register / POS | `pos/(shell)` | PIN → hashed-token session, idle-locked | Counter staff, role-gated per capability |
| Back office | `admin/(authed)` | Username + password (iron-session) | Owner/admin |
| Public + directory | `/inventory`, `/leaderboard`, `/info`, `/web`, `/dir` | None, or per-fleet slug login | Customers, drivers |

## Client/server split

Pages are `"use client"` almost universally; each screen fetches its data from
one purpose-built endpoint that returns everything the screen needs in a
single round trip (e.g. `/api/pos/register`, `/api/admin/dashboard`,
`/api/pos/reports/eod`). There is no client state library; React `useState` +
a per-page `load()` callback is the pattern, with 60-second polling on the
dashboards that need liveness.

**Role-dependent data is shaped on the server.** Where a manager and an owner
see different figures, the route sends different payloads — never the full
figure with client-side hiding. See [04 — API](04-api.md) and, for the cash
mechanisms specifically, the owner-only document.

## Static documents pipeline

Several public artifacts are *built*, not served from source:

| Source | Builder | Output |
|---|---|---|
| `docs/casias-web.html` (body fragment) | `scripts/build-web.mjs` | `public/web.html` → served at `/web` |
| `docs/treadline-brochure.html` (body fragment) | `scripts/build-brochure.mjs` | `public/info.html` → `/info`, plus `docs/Treadline-Brochure.pdf` (headless Chrome, sheet-count-measured zoom) |
| Manual sources in `src/lib/manual*.ts` | `scripts/build-manual.mts` | `/help` content and printable manuals |

The generated `public/` copies are committed; the PDF is gitignored.

## Print as a first-class surface

Paper documents (receipt, close-out sheet, daily report, staffing report, rack
sheet, statements) each carry their own print stylesheet, letter-sized, with
deliberate page-break rules. Verification of print output is part of the
workflow (see [06 — Coding Standards](06-coding-standards.md): the
authenticated headless-print pipeline).

## Known architectural limits

Stated in the README and repeated here because they shape the roadmap:

- **Single machine, single process, one SQLite file.** Multi-terminal needs a
  concurrency design for open tickets; multi-location needs a data-model
  change (see G1 in [01 — Product Vision](01-product-vision.md)).
- **Local time everywhere.** `time.ts` declares it; the server's OS timezone
  is load-bearing. Deploying to a UTC box silently shifts every business date
  (documented in [08 — Deployment](08-deployment.md)).
- **The build is the deploy.** No blue/green, no rollback beyond git + the
  database backup; browser tabs opened before a deploy keep running old
  bundles until refreshed (the "stale tab" hazard).
