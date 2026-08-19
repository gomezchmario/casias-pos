# 05 — UI Standards

> How the screens are organized, what the colors mean, how language works,
> and how the words are written. The product's UI voice is a feature: the
> target user has a middle-school reading level and no patience for software
> vocabulary, and every screen is written accordingly.

## Screen organization

Four surfaces, four shells (see [02 — Architecture](02-architecture.md)):

- **Kiosk** (`/`) — one screen: clock, keypad, camera circle, greeting. Shows
  nothing a customer in the waiting room shouldn't read; the roster and hours
  live behind sign-ins.
- **POS shell** (`/pos/*`) — top nav (Main · New sale · Logs · Inventory ·
  Reports · Daily Report · Drawer), user chip with role, EN/ES toggle, Time
  Clock button, idle lock. Every page inside fetches one purpose-built
  endpoint.
- **Admin** (`/admin/*`) — sidebar nav (Dashboard, Employees, Permissions,
  Time Entries, Schedule, Clock-in Area, Reports, Audit Log, Settings).
  English-only today.
- **Public** (`/inventory`, `/leaderboard`, `/web`, `/info`, `/dir`, `/help`)
  — no chrome shared with the apps; the website carries the shop's own brand.

## Design language

### Color semantics (POS)

Color is meaning, and the meanings are rationed:

| Color | Means | Examples |
|---|---|---|
| **Navy** (`#0a2540` family) | The shop's ink; primary actions, chosen states | Price grid, selected mechanic |
| **Amber/gold** | *Something needs a person* | Unpicked-mechanic ring, pool-size prompt, attention cards |
| **Red** | Money or state that does not balance; on-break | Short verdicts, off-schedule, break ring |
| **Green** | Verified-good; checked-in | Balanced verdict, clock-in ring |
| **Grey** | "The other thing on this screen" — deliberately not a semantic color | The drawer's details button above Pay |

Rules that follow: red is never decoration; amber is spent on one thing per
screen; a control's fill marks selection while a ring marks status, and the
two never compete (selection wins).

### Recurring patterns

- **One-round-trip pages**: each screen has one endpoint returning everything
  it renders; no client-side joins of multiple fetches.
- **Folds (`<details>`)**: secondary material folds away closed by default
  (movements list, register log, rack insights, walked-out spoiler). A fold's
  summary line carries the count and the total so the closed state still
  informs.
- **Blind covers**: anywhere somebody counts money, the expected figure stays
  covered until their number is typed. This is a load-bearing control, not a
  style; see the security and owner documents.
- **Confirm-and-undo over are-you-sure**: destructive moves name their target
  in the confirmation and prefer a reversing action to a warning dialog.
  True hard-deletes are rare, confirmed, and tombstoned.
- **Inline row editing**: lists edit in place (movements rename, register-log
  correction) with Save/Cancel and Escape-to-close, rather than modals, when
  the edit is one field.
- **Status chips/rings over columns**: clock state is a ring on the person's
  button; ticket states are colored cards; "not counted" is a badge only
  where a count could exist (cash/card), never on tenders that can't be
  counted.

### Print

Paper is a first-class output (receipt, close-out sheet, Daily Report,
staffing report, rack sheet, statements, to-order). Standards:

- Letter size, explicit `@page` margins; each document owns a print
  stylesheet (`drawer.css`, `report.css`, `reports.css` print blocks).
- The app shell never prints: `nav, .pos-nav, header:not(.dr-masthead)` are
  hidden in print; documents carry their own masthead.
- `break-inside: avoid` is used surgically (head rows glued to first data
  row) — **never on large tbody groups**, which detonates Chrome's
  fragmenter into blank-page runs (learned the hard way; see `report.css`
  comments).
- Numbers use `tabular-nums`; verdict banners and signature blocks land in
  fixed positions so the eye learns the sheet.
- Screen-only controls carry `no-print`/`rp-no-print`/`tdr-hide-on-print`.

## Internationalization

- **Mechanism**: one dictionary — `const ES` in `src/lib/i18n.ts`
  (~1,150 keys, English string → Spanish string) — with `tr()/t()` via the
  `useLang` hook and a per-user EN/ES toggle in the POS shell. No i18n
  library, no key indirection: the English sentence *is* the key, so a stale
  translation dies visibly when copy changes.
- **Coverage rule**: floor-facing POS screens and the kiosk are fully
  bilingual; the staff manual (`/help`) is bilingual; the public website is
  bilingual with its own toggle; the brochure has its own toggle.
- **Paperwork is English by design** — filed documents read the same every
  night. Exceptions carry their own per-document toggle (staffing report,
  brochure) rather than following the app language.
- **Admin is English-only today** (gap G4).
- **Fragments**: sentences interrupted by JSX values are translated as halves
  around the value; the dictionary carries both halves.
- **Audit**: `scripts/i18n-audit.mts` walks `src/app/pos` and
  `src/components/pos` for untranslated literals. Run it after any POS copy
  change.

## Writing the words

The voice rules, extracted from practice:

- Plain sentences, active voice, no software vocabulary. "Say why it is being
  removed", not "Deletion reason required".
- **State the consequence, not the category.** Errors say what happened and
  what to do: "You are 4.2 km from the shop. Clock in when you get here."
- Numbers carry their meaning inline ("counted $370.00 less the $100.00
  float that stays…").
- Spanish is idiomatic shop Spanish (ponchadura, rin, checar), not textbook
  translation.
- Buttons say what happens ("Record the opening count", "Stop trusting"),
  never "OK"/"Submit".
- Explanatory one-liners under controls are normal and encouraged; they are
  how the product teaches itself.

## Components

Shared pieces live in `src/components/{kiosk,admin,pos,ui}` — 32 files.
The bar for extracting a component is reuse or genuine isolation (CashCounter,
PaymentPanel, TicketDrawer, ProductSearch, CameraPreview); pages otherwise
keep their markup inline with the reasoning comments beside it. There is no
design-system package; Tailwind utility classes plus a small set of house
classes (`btn`, `btn-primary/outline/ghost`, `input`, `card`, `alert`,
`rp-*` report primitives, `cv3-*` close-out primitives).

## Accessibility — current state, honestly

Present: semantic buttons/labels, `aria-pressed` on toggles, `aria-label` on
icon controls, `role="status"`/`aria-live` on async results (website search),
visible focus states on the public site, Escape-to-cancel on inline edits.
Not systematic: no audit has been run, contrast has not been measured
everywhere (the amber-on-white range is suspect), and keyboard-only flows
through the register have not been tested. Recorded as debt (see
[12 — Technical Debt](12-technical-debt.md)) rather than claimed.
