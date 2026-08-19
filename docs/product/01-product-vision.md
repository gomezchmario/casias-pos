# 01 — Product Vision

> Sources: the brochure (`docs/treadline-brochure.html`, served at `/info`,
> bilingual EN/ES), the top-level `README.md`, and the codebase as of this
> writing. The brochure is treated as the business requirements; this document
> also records **where the brochure and the code disagree**, because a promise
> set nobody has audited is a liability, not a vision.

## What Treadline is

**"The complete tire shop system."** Point of sale, inventory, cash control and
time clock in one self-hosted application, built for independent tire and auto
service shops — and built *from* one: every screen exists because a real shop
lost money without it. The close-out was written the week a drawer came up $200
short; the order board after a customer waited three weeks for a tire that was
already in the corner.

The product's core argument, in the brochure's own structure:

1. **Your shop already works — it just can't prove it.** Handwritten tickets,
   rack-walking, unexplained shortages, payroll from memory. Each pain is
   paired with the screen that answers it.
2. **Four taps and the car is moving.** Register speed as a hard requirement:
   most tickets are under $20 and under a minute.
3. **It counts tires, not "items."** Rim-grouped racks, collapsible used
   stock, oversells surfaced not hidden, per-tire history.
4. **The tire that came in on Thursday.** The special-order board: stages as
   colors, calls owed, nothing falls through.
5. **The company that sends you eleven trucks.** Fleet accounts: per-driver
   history, collectable tabs, printed statements.
6. **The screen that pays for the software.** The blind close-out: covered
   expected figures, per-tender counts, one sheet to sign.
7. **The numbers that run the week.** Reports that write the sentence, not
   just the chart; append-only books; signed changes; the alarm log.
8. **Who was here, and for how long.** The time clock: one PIN for clock and
   register, photo on every punch, flagged (never guessed) hours.

## Target customer

Small and medium independent tire and auto-service shops:

- 3–20 staff; one location (today — see gaps below for Multi-bay).
- Owner-operated; the owner is the buyer, the administrator, and the person
  the cash controls exist for.
- Technologically modest. The product's writing style — plain sentences,
  middle-school reading level, no jargon — is a deliberate requirement, as is
  bilingual EN/ES throughout the floor-facing screens.
- Often running today on a cash drawer, a spreadsheet, and one person who
  remembers everything.
- No IT staff: hence single-machine, SQLite, no cloud dependency, and a
  register that keeps working when the internet does not.

## Pricing and packaging (per the brochure)

| Plan | Price | Contents |
|---|---|---|
| **Shop** | $199/mo | Register, receipts, split tenders; tire inventory; special orders board; fleet accounts and statements; close-out and alarm log; full reports and trends |
| **Time clock** | +$49/mo | Kiosk punch with the register PIN; photo on every punch; timesheets and week totals; schedule with suggested staffing |
| **Multi-bay** | $299/mo | Everything in Shop; priority support; stock across locations; group reporting; quarterly trends/performance reports free first year |

One-time services:

| Service | Price | Contents |
|---|---|---|
| **Full setup** | $250 | Configured to the shop's own buttons/prices/words; inventory loaded and counted in; customers and fleets imported |
| **As it comes** | $99 | Installed with standard setup; shop adds its own data |
| **Brand personalization** | $199 | The system in the shop's colors; a website with live stock search; a logo drawn and added to the UI |

Every plan: counter-staff training, basic support, no contract, no hardware —
runs on existing computer/phone/tablet and printer.

**Go-to-market motion:** the demo visit — "We'll bring a tablet, ring your next
twenty tickets on it, show you how it works, and leave. If it isn't faster and
more convenient than what you do now, we'll tell you so ourselves."

## Business goals implied by the brochure

- Recurring revenue (monthly plans) with services attached to onboarding.
- The wedge is the **close-out** ("the screen that pays for the software") —
  cash control as the emotionally-charged, provable value.
- Word-of-mouth in a local trade: the demo-visit motion and the bilingual
  materials both assume in-person selling in a market like San Antonio.
- The existing shop doubles as the reference installation and the demo.

## Where the brochure and the code disagree

Audited claim-by-claim against the codebase. These are the honest gaps; they
also seed the [Feature Matrix](11-feature-matrix.md) and
[Commercialization](13-commercialization.md) documents.

| # | Brochure claim | Reality in code | Severity |
|---|---|---|---|
| G1 | **Multi-bay plan**: "Stock across locations", "Group reporting" | Does not exist. One database, one shop, no location concept anywhere in the schema | **High — a sold plan with no product behind it** |
| G2 | "Payroll weeks freeze. Once a week is paid it's locked" | Schema exists (`payroll_periods`, `payroll_lines`); locking is **designed but not enabled** (README says so plainly) | High — brochure states as shipped |
| G3 | Time clock "sold separately… switching it off changes nothing else" | No module flag exists. The time clock is always present; nothing can switch it off | Medium — packaging claim without a mechanism |
| G4 | "In English or Spanish" (report/reporting claim) | Floor screens and staff manual are bilingual; the **admin back office is English-only**; printed paperwork is deliberately English (two printables carry their own ES toggle) | Low–Medium |
| G5 | Brand personalization: "the whole system in your shop's colors" | No theming system. Palette, logo, and shop name are hardcoded (see [07 — Configuration](07-configuration.md)); delivering this today is custom code per customer | Medium |
| G6 | Full setup: inventory/customers/fleets "brought across" | Real, but as one-off engineer-run scripts (`scripts/import-*.mts`), not a repeatable onboarding tool | Medium |
| G7 | "Priority support", "Basic support", "quarterly reports free for the first year" | Operational/service promises with no product surface; fine, but nobody has defined what they cost to keep | Low |
| G8 | Demo visit motion | No demo mode or sample database a salesperson can reset between visits; seed scripts exist (`seed-example-day.mjs`, `seed-mock-fortnight.mjs`) but are developer tools | Medium |
| G9 | The product is named **Treadline** | The name appears only in the brochure. `package.json` is `casias-tire-shop-timeclock`; the README calls it "Shop System"; every screen wears the Casias badge | Medium — identity work, see [17 — Brand](17-brand.md) |
| G10 | "80mm thermal receipts" implied by "printed on thermal or letter paper" | Letter works; the thermal stylesheet is designed, awaiting hardware (README) | Low |

Everything else audited held up: blind per-tender covers, the order board and
its two-outcome cards, fleet statements, append-only books with signed changes,
the alarm log, photo-on-punch, the camera in the kiosk, staffing suggestions
from the shop's own numbers, the live public stock search, oversell surfacing,
FIFO costing, and the four-taps register flow are all real and in daily use.

## Positioning sentence

For the independent tire shop that runs on paper and memory, Treadline is the
one system that rings the counter, counts the racks, closes the drawer and
clocks the crew — built inside a working shop, priced like a phone bill, and
honest enough to sign your name on every night.
