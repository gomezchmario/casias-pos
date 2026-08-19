# 13 — Commercialization Checklist

> What converting one shop's system into a sellable product requires. Sizes:
> **S** ≤ a day · **M** = days · **L** = weeks. Sequencing lives in
> [14 — Roadmap](14-roadmap.md); this is the requirements inventory with
> dependencies and risk.

## A. De-Casias-ing (white label)

| Item | Contents | Size | Depends on |
|---|---|---|---|
| A1 Branding settings group | Shop name/address/phone already exist; add logo upload (favicon, badge, receipt mark), product name in titles, cookie-name prefix | M | — |
| A2 Theme tokens | One CSS-variable layer over the three palettes (POS, website, print docs); per-shop values from settings. This is what makes the $199 personalization a configuration instead of custom code | L | A1 |
| A3 Locale/jurisdiction module | Explicit timezone setting (not just OS), overtime rules pluggable (Texas today), editable market-wage table, currency/locale formatting | M | — |
| A4 Constants → settings | The [07](07-configuration.md) list: open hours, staffing floors, PIN policy, fence bounds, grace minutes | M | — |
| A5 First-run wizard | Seeds tenders, categories, quick grid, admin account, company details — instead of inheriting Casias' counter | M | A1 |
| A6 Website generator | Parameterize `casias-web.html` (hours, palette, name, closed dates, stock-search wiring) into a per-shop build | M | A2 |

## B. Packaging and delivery

| Item | Contents | Size | Depends on |
|---|---|---|---|
| B1 Installer | One-command install per OS (service registration, cert generation, `.env`, `setup`); replaces "git clone + npm" | L | — |
| B2 Update channel | Versioned releases, an update command that backs up → migrates → restarts; release notes | L | B1 |
| B3 Licensing | Per-install license key, plan gating (see B4), expiry/grace behavior chosen deliberately (a register that stops on a lapsed card is a decision, not a default) | M | — |
| B4 Feature flags per plan | The time-clock module switch (brochure claim G3); Multi-bay gating when it exists | M | B3 |
| B5 Backup service | Scheduled off-machine backups with restore drill tooling (the scripts exist; the scheduling/verification product does not) | M | B1 |
| B6 Demo mode | Seeded sample shop + one-command reset (`seed-example-day` grown up); safe-by-construction against running on live data | M | A5 |

## C. Product completeness (the brochure gaps)

| Item | Contents | Size |
|---|---|---|
| C1 Payroll week locking | Enable the designed flow (schema shipped): lock on payout, corrections book forward (G2) | M |
| C2 Import tooling | Productize the one-off importers: spreadsheet mapping UI or a supported CSV contract for tires/customers/fleets (G6) | L |
| C3 Thermal receipts | The designed 80 mm stylesheet + a hardware recommendation (G10) | S–M |
| C4 Multi-location | The Multi-bay plan (G1): location on stock/sales/reports, or **rescope the plan** until built — a sold plan with no product is the worst standing item | XL (or a copy change now) |
| C5 Admin back office ES | Extend the i18n pattern to `/admin` (G4) | M |

## D. Operations at n>1 customers

| Item | Contents | Size |
|---|---|---|
| D1 Error tracking + log shipping (opt-in; the no-telemetry stance is a selling point — make it a choice, not an accident) | M |
| D2 Support playbook: the runbook ([09](09-operations.md)) rewritten customer-facing; "basic support" defined | S |
| D3 Fleet of installs inventory: versions, backups-last-verified, licenses | M |
| D4 Security hardening list from [10](10-security.md) §checklist executed per install | M |

## E. Trust and paper

| Item | Contents | Size |
|---|---|---|
| E1 Data export | The "your data exportable, always" brochure line as a button: full-database export + documented schema (03 is most of the documentation) | S–M |
| E2 Customer-facing docs | Install guide, owner's guide (the staff manual exists and is strong), what-we-store/privacy one-pager | M |
| E3 Terms: license, support terms, the no-contract promise in writing | — (counsel) |

## Ordering logic

The dependency spine is **A1→A2→A5→B1→B2**: identity, theme, first-run,
installer, updates. C4 (Multi-bay) is deliberately last or descoped — every
other row makes the second customer possible; C4 makes a third *plan*
possible. B3/B4 can ship minimal (a signed key file and one flag) long before
they are pretty.

Two standing risks to keep in view:

1. **Every install is currently hand-raised.** Until B1/B2 exist, each
   customer multiplies manual operations linearly — the roadmap gates selling
   on them.
2. **The brochure promises ahead of the build** (G1, G2, G3). Either the
   build catches up or the copy steps back; carrying the gap into a signed
   customer is the one unaffordable outcome.
