# 10 — Security

> The model, the mechanisms, the known gaps, and the hardening checklist for
> commercial deployment. This document is safe to share; the cash-control
> instruments an owner uses against internal theft are in the internal
> owner-controls document and referenced here only by name.

## Authentication surfaces

Four cookie families, four threat models:

| Surface | Credential | Session | Cookie |
|---|---|---|---|
| Back office | Username + password (bcrypt), `must_change_password` supported | iron-session, 12 h, encrypted | `casias_admin` |
| Register (POS) | 4-digit PIN (bcrypt) per employee | 32-byte token, sha256-stored, idle-expiring, revocable | `casias_pos` |
| Fleet directory | Per-company slug + PIN | Same hashed-token pattern | own cookie |
| Trusted device | Enrolled from the admin panel, on the device | 2-year token, sha256-stored, revocation is a stamp | `casias_device` |

All cookies: `httpOnly`, `sameSite: lax`, `secure` in production. Tokens are
never stored — only sha256 hashes, so a leaked database opens nothing.

**Register lock:** client-driven idle lock (real activity, default 15 min)
revokes the session; server expiry is the backstop for what a client can't
report. Unlock returns to the screen in use.

## Authorization: capabilities, not roles

`src/lib/roles.ts` defines a rank ladder — technician (0); writer, cashier,
accountant (1); manager (2); owner (3); viewer (3, see below) — and **52
named capabilities**, each mapped to a minimum rank:

`viewInventory · searchProducts · ringSale · takePayment · editSeq ·
editOwnOpenSale · discountSale · discountAnyAmount · manageSpecialOrders ·
reverseSpecialOrder · editCompletedSale · reopenClosedDay · voidSale ·
correctPayment · refund · cashPurchase · overrideCommission · overrideStock ·
receiveInventory · adjustInventory · deleteProduct · deleteEmptyProduct ·
manageCustomers · deleteCustomer · manageCreditAccounts · deleteEntry ·
viewBusinessReports · managePermissions · viewDay · viewLog · closeShift ·
viewCloseout · manageDirectory · browseRegister · deleteRegisterCheck ·
skipBlindCount · drawerCash · hideDrawerMovement · editDrawerMovement ·
viewReports · viewTechIncomeCash · viewCosts · quoteTire · reviewPricing ·
reviewAlarms · viewCostCode · writeNotice · managePayroll · manageEmployees ·
manageSettings · manageProducts · manageQuickButtons`

Structure around the ladder:

- **`WITHHELD`** — named subtractions (the service writer gives up `viewLog`,
  `closeShift`, `viewReports`: the takings are not the forecourt's business).
- **`GRANTED`** — named additions (the accountant, at cashier rank, takes the
  customer book and house accounts without inheriting voids and close-outs).
  WITHHELD beats GRANTED; a contradiction reads as no.
- **`VIEWER_MAY`** — the read-only demo account is owner-*rank* so every
  screen opens, then an **allowlist** of 14 read capabilities is the whole of
  what it can do. Allowlist, not blocklist: a new capability defaults to
  refused for the viewer instead of quietly allowed. (Two write capabilities
  once landed in this list by editing accident; the file now carries the
  warning.)
- **Per-employee grants** (`employee_capabilities` table) layer on top for
  individuals.
- Handlers ask `requirePos("capability")`; roles never appear in routes. The
  permissions screen renders from the same table the server enforces with.
- Role-sensitive figures are removed **server-side** (e.g. technician
  earnings blanked below rank; the closeout route strips owner-only alarm
  rows "because the page is not where the secret is kept").

## Clock integrity

- Photo on every punch (missing camera flags the entry rather than blocking).
- The geofence: server-judged (`fence.ts` — the browser's coordinates are a
  claim, so the client never decides), untrusted devices must be inside;
  trusted devices bypass and are never asked for location; optional
  trusted-only mode refuses everything unenrolled — and refuses to switch on
  while nothing is enrolled (the lockout rail).
- Deliberate **fail-open** stances: no fence configured, a half-configured
  fence, or an unreadable device row all allow the punch. The failure mode of
  wrongly refusing is an empty payroll at 7 a.m. Location is spoofable by a
  determined person; the fence is a lock, and "locks keep honest men honest"
  (the owner's stated standard).
- Every punch records how it passed (`fence_verdict`) and where from.

## Public surface

- `api/public/*` — field-by-field whitelists written out by hand, with the
  never-list named in the file (`default_cost_cents`, `cost_code`,
  `supplier`). The stock search answers one bit and refuses partial-size
  probes.
- Punch photos are served only through an admin-gated route, never from a
  public directory.
- The public directory (`/dir`) authenticates per fleet and logs failures.

## Known gaps (the honest list)

| # | Gap | Notes |
|---|---|---|
| S1 | **`POST /api/pos/auth/kiosk`, `checkin/lookup`, `checkin/submit` take a bare PIN with no pre-identified employee.** Per-employee lockout exists but keys on the matched employee; a scripted sweep of the 10,000 PIN space against the *public* URL is the standing risk. Mitigations shipped: fence/trusted-only gate `checkin/submit`. Not yet: a device/IP-level throttle on the kiosk auth route — **top of the hardening list** | High priority |
| S2 | `pos/auth/kiosk` compares the typed PIN against every active employee (first match wins) — cost grows with roster and collisions are possible in principle | Design debt |
| S3 | Admin login has no rate limit | Do with S1 |
| S4 | No TOTP/second factor on the back office; enrolment of trusted devices flows through it | Roadmap |
| S5 | Self-signed certs locally; the tunnel terminates public TLS. Fine today; the VPS path replaces both (Caddy/LE) | Planned |
| S6 | No security headers pass (CSP, frame-ancestors…) has been done | Unaudited |
| S7 | Test accounts live in production data (read-only by design, but still) | Debt |
| S8 | `SESSION_SECRET` has a dev fallback constant if `.env` is missing — setup generates a real one, but the fallback exists in code | Verify at deploy |

## Hardening checklist for a commercial install

1. Device/IP throttle on the three PIN endpoints (S1) + admin login (S3).
2. Enforce `NODE_ENV=production` and a generated `SESSION_SECRET` (S8) in the
   installer.
3. Security-header pass behind the proxy (S6).
4. TOTP on the back office (S4).
5. Per-install cookie names and secrets (currently `casias_*` — see
   [07 — Configuration](07-configuration.md)).
6. Review `public/leaderboard` exposure per customer (staff names are
   published; a buyer may not want that).
7. The VPS checklist in [08 — Deployment](08-deployment.md) (firewall, Caddy,
   TZ, backups off-box, restore drill).
