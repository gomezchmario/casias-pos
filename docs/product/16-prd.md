# 16 — Product Requirements Document

> The commercial product's requirements, grounded in the working system. Where
> a requirement is already met, the matrix ([11](11-feature-matrix.md)) says
> so; this document states the requirement itself, so the next implementation
> decision has something to be measured against.

## Personas

- **The owner** — buys it, administers it, and is the person the cash
  controls serve. Reads the close-out nightly and the reports weekly; trusts
  paper he signed over screens he glanced at. May be the least technical
  person in the building and must never be made to feel it.
- **The manager** — runs the floor and the drawer when the owner is away;
  sees operational truth (counts, schedules, alarms) but not owner-level
  figures.
- **The cashier / service writer** — rings tickets fast, all day, bilingual
  counter. The writer is the same job outdoors, minus the day's books.
- **The technician** — appears on lines and leaderboards; punches the clock;
  touches the register only through the kiosk hand-off if at all.
- **The accountant** — the customer book and house accounts, nothing else
  gained on the way (the GRANTED/WITHHELD design exists for her).
- **The viewer** — a demo/audit account that can open everything and change
  nothing.
- **The fleet manager** (external) — a monthly statement that survives
  accounts-payable, and self-service driver/vehicle upkeep.
- **The customer** (external) — the public site: is the shop open, do they
  have my size, call.

## Core workflows (the product must keep these under friction)

1. **Ring → pay → done** in four taps for the modal under-$20 ticket;
   split/partial/account tenders without leaving the flow; credit lands on
   the person who did the work (and the seller, on tires).
2. **Receive → count → sell → reconcile**: stock arrives (sized or as an
   unsized used load), the rack sheet matches the racks, oversells surface,
   the ledger explains every unit.
3. **Order → call → fulfill**: a special order never falls through silently;
   every stage change names who and when; "nobody called me" is answerable
   with a date.
4. **Close the day**: count blind, log, print one page, sign it, retire the
   cash; the paper explains itself to someone reading it cold.
5. **Clock → schedule → payroll**: punches with evidence (photo, fence),
   schedules against measured need, corrections signed, paid weeks frozen
   (requirement — currently gap G2).
6. **Study → buy**: what walked out, what stands still, what the website was
   asked for — feeding the next order.

## Requirements

**P0 — the product is these (all shipped today):** the six invariants
(integer cents; append-only; soft-delete; audited; one business date; frozen
totals); capability-gated everything; server-side figure shaping; blind
counts; bilingual floor; print-first documents; single-machine self-hosted
with no external dependency in the request path; fail-open clock rails.

**P1 — commercial completeness (Phase 2):** first-run setup; branding/theme
per shop; installer + updates; licensing with plan flags (time clock
switchable); payroll locking enabled; PIN-surface throttling; import and
export tooling; demo mode; backups as a service with restore drills.

**P2 — growth (Phase 3):** multi-location as sold (or plan withdrawn);
generalized narrative reporting; admin ES; accounting export; multi-terminal.

**Non-goals (stated so they stay decided):** cloud-only operation; per-seat
pricing; telemetry by default; replacing the accountant; loyalty/marketing
suites; anything that slows the four-tap ticket.

## Acceptance criteria for "commercial-ready" (Phase 2 exit)

1. A second shop installs from the installer, completes first-run, and rings
   a real ticket **without the author present**.
2. Its branding (name, logo, palette) and jurisdiction (timezone, tax,
   overtime) come entirely from configuration.
3. Update applied via the channel: backup → migrate → restart, and the
   register tabs warn about staleness.
4. The three PIN endpoints refuse a scripted sweep (throttle evidence).
5. A paid payroll week refuses edits and books corrections forward.
6. The brochure contains no claim the matrix marks Missing.
7. The demo resets to sample data in one command, and cannot do so against a
   live database.

## Future enhancements (parked, with the reason)

- Multi-terminal open-ticket concurrency (design first; the DB layer already
  holds).
- Hosted offering on the VPS path (after B1/B2 make installs boring).
- SMS to customers from the order board (the board's data model already
  carries what/when/who).
- Barcode/SKU scanning at receive (schema ready: sku exists).
- Accountant portal (read-only statements pull instead of printed paper).
- Photo evidence on inventory adjustments (pattern exists on punches).
- The "writes the sentence" engine as a first-class report layer.
