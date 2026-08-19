# 14 — Roadmap

> Phased, with priorities, blockers, risks and effort. Item codes reference
> [13 — Commercialization](13-commercialization.md) (A/B/C/D/E),
> [12 — Technical Debt](12-technical-debt.md) (D#) and
> [10 — Security](10-security.md) (S#). Effort is focused work, not calendar.

## Phase 1 — Stabilization & record (now)

*Goal: know what we have; stop carrying it in one head.*

| Work | Items | Effort | Status |
|---|---|---|---|
| This documentation suite | Steps 1–5 of the commercialization brief | days | **This commit** |
| README count refresh | D6 | S | next |
| Owner decisions queued | D10 (duplicate Mario), K6 (DISPOSAL row), C4 copy-or-build | — | awaiting owner |
| Test-server deploy for future code work | per owner's instruction: no code edits until it exists | S | blocker for Phase 2 |
| First tests over money paths + CI skeleton | D4 | M | can start on test server |
| Housekeeping: scripts/ archive split, docs/ source split | D16, D17 | S | with first code window |

**Risks:** none — this phase is reversible by definition.

## Phase 2 — Commercial readiness (sell to shop #2 safely)

*Goal: a second install that doesn't require the author.*

| Priority | Work | Items | Effort |
|---|---|---|---|
| P0 | PIN-surface throttling + admin rate limit | S1–S3 | S–M |
| P0 | Branding group + theme tokens + first-run wizard | A1, A2, A5 | L |
| P0 | Installer + update channel | B1, B2 | L |
| P1 | Locale/jurisdiction module; constants→settings | A3, A4 | M |
| P1 | Payroll locking enabled | C1 | M |
| P1 | Licensing + time-clock plan flag | B3, B4 | M |
| P1 | Backup service + demo mode | B5, B6 | M |
| P2 | Import tooling v1 (CSV contract) | C2 | M–L |
| P2 | Data export button; customer docs | E1, E2 | M |
| P2 | Website generator; thermal receipts | A6, C3 | M |
| P2 | Retire legacy close-out routes; closeout payload shaping | D1, D2 | S–M |

**Blockers:** the test server (owner-gated); brochure decision on G1/G3
(copy vs build) before external sales collateral is reprinted.
**Risks:** theming underestimation (three palettes, print included — the
reason A2 is L); every week of Phase 2 done on the live shop's repo instead
of the test server risks the production register — hence the gate.

## Phase 3 — Growth features

*Goal: the plans as sold, and depth for bigger shops.*

| Work | Items | Effort |
|---|---|---|
| Multi-location (Multi-bay as sold): location on stock/sales/reports, group roll-ups | C4 | XL |
| Advanced reporting: the "writes the sentence" engine generalized; scheduled report emails | — | L |
| Customer communications: order-board SMS/call logging beyond notes | — | M–L |
| Admin back office in Spanish | C5 | M |
| Accounting export (QuickBooks-shaped CSV at minimum) | — | M |
| Multi-terminal concurrency design (open-ticket locking) | README limitation | L |
| Error tracking / fleet inventory across installs | D-ops 1, 3 | M |

**Risk:** C4 touches the deepest invariant set (every report buckets by
day; adding location multiplies every grouping). It gets a design document
of its own before a line of code.

## Phase 4 — Enterprise

*Not designed; recorded as direction:* multi-shop owners with consolidated
books; hosted/managed offering (the VPS path productized); role/SSO
integrations; API for accountants; hardware bundles (thermal, cash drawer,
barcode).

## Standing rules across phases

- The production shop is the reference install: nothing ships to it that
  hasn't run on the test server first (owner's instruction, Phase 1's gate).
- Docs move with code — the maintenance rule in the [index](README.md).
- The brochure is re-audited against [11 — Feature Matrix](11-feature-matrix.md)
  whenever either changes; gaps G1–G10 shrink from both ends but never sit
  silently.
