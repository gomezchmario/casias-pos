# 15 — Owner Controls

> **OWNER-ONLY. Do not print, forward, or show this document to staff,
> partners, or prospects.** Everything else in `docs/product/` is written to
> be shareable; this file is the one exception, and the others refer to its
> contents only as "owner-level controls." It exists because an unwritten
> control system dies with the person who built it.
>
> The design principle behind everything here, in the owner's own words:
> **locks keep honest men honest.** None of these instruments is proof
> against a determined thief; each removes the *easy* path — and the
> knowledge — that ordinary skimming runs on.

## 1. The information doctrine

The floor's honest job — ring everything, count what's there — requires
**zero knowledge of what the totals should be**. Every instrument below
enforces that one idea:

- A cashier who knows the drawer is $40 over can pocket $40 and still
  balance. So nobody is shown "over."
- A cashier who knows it's short can under-ring until it isn't. So nobody is
  shown running expectations.
- A count you can see the answer to is a copy, not a count. So the answer is
  covered until theirs is typed.

## 2. Blind counts (`skipBlindCount`)

Every count surface covers the expected figure per tender until that tender's
count is typed. Only the owner capability `skipBlindCount` lifts the cover.
Midday checks freeze expectations at count time so later bookings can't
rewrite whether a count balanced.

## 3. Quiet cash movements (`hideDrawerMovement`)

`drawer_movements.hidden = 1` — owner-only to create (the checkbox "Keep off
the sheet" on the drawer screen).

**Doctrine (revised 2026-08-16, recorded in `drawer.ts`):** *hidden means off
the paper, never out of the arithmetic.* The expected figure includes hidden
movements — both twin queries (`drawerAdjustmentCents` in `drawer.ts`,
`drawerAdjustFor` in `shifts.ts`) — so an honest count **balances** after a
quiet cash-out. The original 026 design (expectation deliberately left short
so only the owner knew why) was retired the first day it fired in real use:
the manager's screen shouted SHORT BY $340, making the quiet withdrawal the
loudest thing in the shop.

Where the money hides, per surface:

| Surface | Non-owner sees | Owner sees |
|---|---|---|
| The count | BALANCED (expected moved with the money) | Same |
| Movements lists | No hidden rows; net summed off shown rows | Rows, with reasons |
| Close-out sheet (screen **and paper — whoever prints it**) | Quiet amount folded into **"Cash from customers"**; moved-line shows visible net; every line sums | Screen literal; the *printed* sheet folds the same way, because paper goes to the office |
| Daily Report ("Full Report") | No hidden rows; **Collected** and the cash takings line folded (`maskCashVariance(raw, quietCents)`); variance pinned balanced on audited days so surplus is never advertised either | Rows printed openly, marked **"taken off the sheet, owner only"** — this report is the owner's readable record |

Residual seams, known and accepted: a manager who re-adds individual cash
tickets can find the fold (arithmetic can't hide from that work — and someone
doing that work is itself worth noticing); the register's Section-2 tender
sum vs. the top sales stat differs by the quiet amount on audited days.
Hidden **deposits** work identically in reverse. The overdraw guard applies
to hidden withdrawals too.

Everything is fully recorded regardless: the movement row, the audit entry,
`hiddenDrawerCents` — the *books* are complete; only the floor's *view* is
shaped. This is a display doctrine, not a second set of books.

## 4. Masked check history

`maskCashChecks` forces the cash line of historical counts to read balanced
for non-owners — the two-in-the-afternoon "drawer is over" discovery is the
exact moment skimming starts, so surplus never appears on screen.

## 5. The register log (owner fold on the Drawer page)

Owner-only list of the day's counts with **Edit** (strike + corrected copy
carrying the original clock and counter, so fixing a noon typo can't become
tonight's verdict) and **Remove** (strike with reason). Both audited with
before/after; struck history stays readable on the owner's report.

## 6. Tips interplay

The verdict reads the cash variance tips-out: short by no more than the tips
paid from the drawer explains itself ("$63 light and $63 of tips paid out —
nothing is missing"), and short by *more* stays red on purpose. The
retire-to-safe figure reads the same signal, so sheet and arithmetic can't
disagree.

## 7. Role-scoped exceptions and figures

Owner-only alarm rows are stripped from payloads at the route ("the page is
not where the secret is kept"); technician earnings blank below rank;
`hiddenDrawerCents` is zero in every non-owner payload.

## 8. Attribution instruments

Every count, movement, void, discount, correction and alarm dismissal carries
who, when, role-at-the-time, and reason — the audit log is the instrument the
others stand on. The blind covers keep people honest *before* the fact; the
audit trail catches the rest *after*.

## Operating notes for the owner

- Record quiet movements from the **owner** account only; the manager account
  sees the floor's view (this is why the duplicate-account cleanup, D10,
  matters).
- The Daily Report is *your* document — it names your quiet movements in the
  open. Don't hand it across the counter; the close-out sheet is the paper
  that circulates.
- If a manager's numbers ever *should* differ from what these instruments
  show them, say so in this file first — the doctrine only works while this
  document matches the code. Current as of the commit that adds it.
