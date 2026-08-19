# 12 — Technical Debt Register & Known Issues

> Recorded, not fixed — that is this phase's rule. Each item carries where it
> lives, why it matters, and a size (S/M/L of focused work). Security gaps
> live in [10 — Security](10-security.md); white-label hardcoding in
> [07 — Configuration](07-configuration.md); this register holds everything
> else plus the cross-references.

## Architecture & code

| # | Item | Where | Why it matters | Size |
|---|---|---|---|---|
| D1 | **Four generations of close-out surfaces** live side by side: `pos/eod`, `pos/closeout`, `pos/closeout-v3`, and the current `pos/drawer` (+`/drawer/report`) | `src/app/pos/(shell)/` | Confuses navigation and maintenance; only drawer is canonical. Retire or redirect the older three after confirming nothing links to them | M |
| D2 | Closeout API sends owner-grade figures (margin) to every `viewCloseout` caller — the route's own comment marks it "fix-later" | `api/pos/reports/closeout` | Known payload-shaping debt; page hides, server should | S |
| D3 | Deliberate inline copy of the drawer-net query to break an import cycle | `shifts.ts` ↔ `drawer.ts` | Two must move in lockstep; comment binds them, tests don't | S |
| D4 | No automated tests, no CI | repo-wide | The money paths deserve the first unit tests (see [06](06-coding-standards.md)) | L |
| D5 | No error tracking/log aggregation; server log is a file on the shop PC | ops | Fine for one shop; blind for ten | M |
| D6 | `README.md` header counts drift (says 70 routes/30 migrations; reality 104/50) | README | Update alongside this suite | S |
| D7 | Migration numbering gap 037–038 | `migrations/` | Harmless; document (done) so nobody "fixes" it | — |
| D8 | Accessibility unaudited (contrast, keyboard-only register flow) | POS/kiosk | See [05 — UI Standards](05-ui-standards.md) | M |
| D9 | Hardcoded Chrome executable paths in build/verify scripts | `scripts/build-brochure.mjs` etc. | Breaks on any machine without that path | S |

## Data

| # | Item | Where | Why it matters | Size |
|---|---|---|---|---|
| D10 | **Duplicate owner accounts** — "Mario Gomez" (#4) and "Mario" (#36), both admin, both active; payments have already needed moving between them | `employees` | Attribution noise in every by-cashier report; needs an owner decision (merge/retire #36), then a sweep like the audited one already done for one payment | S |
| D11 | Test accounts in production data (Test Viewer active by design; Test Manager inactive) | `employees` | Viewer is load-bearing for verification; document, exclude from reports where it could ever appear | S |
| D12 | Backfilled time-clock history (5 weeks, simulated from ticket activity) predates real punching | `time_entries` | Fine for the staffing study it was made for; must never be read as attendance evidence — flagged rows say so | — |
| D13 | Imported sales history has known holes (three stretches nobody wrote down) and cashier/hours attribution that is not real | historical data | Compare per trading day; never measure people by imported cashier fields | — |
| D14 | `sale_items.cost_code`-adjacent data: 15 mis-filed service lines once broke cost reports; per-row category exclusions now guard it | `costs.ts` | The named-exclusion list is data-coupled; revisit when categories are cleaned | S |

## Product surface

| # | Item | Why it matters | Size |
|---|---|---|---|
| D15 | Brochure gaps G1–G10 ([01 — Product Vision](01-product-vision.md)) — sold-but-missing (Multi-bay), stated-but-disabled (payroll lock), packaging without flags (time clock) | The commercial honesty list | L (see roadmap) |
| D16 | `scripts/` mixes 15 tools with ~30 one-off incident scripts | An engineer can run history by accident; move to `scripts/archive/` | S |
| D17 | `docs/` mixes build **sources** (brochure, website) with generated HTML/PDF artifacts and screenshots | Sources deserve a `docs/src/`-style separation; generated PDFs shouldn't sit beside them ungitignored (some are committed) | S |
| D18 | The staffing report's market-wage appendix hardcodes named competitors' pay | Right for Casias; wrong shipped to anyone else | S (with 07) |
| D19 | Owner phone/admin habits: owner sometimes operates under a manager account (see D10) — capability design assumes people use their own | Process, not code | — |

## Known issues (live behaviors worth knowing)

| # | Issue |
|---|---|
| K1 | **Stale tabs after deploy** run the old client until hard-refreshed — the single most recurring support fact; one historical 219-page print traced to it |
| K2 | The close-out signature block sits at exactly page height on some days' data; a long alert line can push signatures to sheet 2 (measured; a few mm of slack is the fix when wanted) |
| K3 | Register "3 register logs did not balance" alarm counts stored variances; historical checks made before a rule change keep their stored verdicts (owner can strike/correct via the register log fold) |
| K4 | Late-against-schedule uses a fixed 15-minute grace with no knob |
| K5 | Geolocation indoors can take up to the 10 s kiosk timeout on some phones — the punch then proceeds under fence rules (by design, but visible as a pause) |
| K6 | `DISPOSAL` (2 historical lines, $30) still shows on What-things-cost — the named exclusion list covers `DISPOSAL FEE`, a different string; awaiting the owner's call |

## Process debt

- Verification evidence lives in commit messages and session scratch rather
  than a repeatable test suite (D4 is the fix).
- Production data corrections are manual-with-audit; fine at one shop, needs
  tooling at ten.
- No dependency-update or vulnerability-scan cadence (`npm audit` unscheduled).
