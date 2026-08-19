# 09 — Operations Runbook

> Day-to-day care of a running installation, and a triage of the `scripts/`
> directory — which of its 50 files are operational tools, and which are
> one-off history that should not be run again.

## Routine

| Cadence | Action |
|---|---|
| Nightly (shop staff) | The close-out itself: count, log, print, sign, file |
| Daily/Weekly (owner) | `node scripts/backup-db.mjs` to an off-machine destination |
| Weekly | Glance at `/pos/alarms` (exceptions are signed, not silenced) and the admin dashboard's flagged time entries |
| Monthly | `npm run purge-photos` (or confirm it is scheduled) — deletes punch photos past `photo_retention_days` |
| After any deploy | Hard-refresh open register tabs (stale-tab rule) |
| After a migration | `npm run setup` was run deliberately; verify with a smoke test |

## When something looks wrong

- **"The drawer is off"** — read the close-out sheet's arithmetic block, then
  `/pos/drawer`'s movements fold and register-log fold; the Daily Report's
  "Every count taken today" shows every count with who and when.
- **"A number changed after the fact"** — `/admin/audit`: every mutation has
  actor, role-at-the-time, before/after JSON.
- **"The print exploded / looks wrong"** — first question: when was the tab
  opened? Then the print pipeline (below) reproduces it headlessly.
- **"Somebody can't clock in"** — check the fence page (`/admin/fence`):
  is trusted-only on? Is the device trusted? Was a location refused? The
  refusal messages on the kiosk say which; `time_entries.fence_verdict`
  records how every allowed punch got in.
- **Integrity worry** — the on-demand integrity check reconciles headers vs
  lines vs payments and lots vs movements; mismatches report, never
  self-repair.

## Test accounts

- **Test Viewer** (PIN 0813) — the designated read-only account for demos and
  for the headless verification pipeline. Viewer role: rank of an owner,
  allowlist of nothing that writes; cannot punch the clock.
- **Test Manager** — inactive; historical.
- These live in production data (recorded as debt: [12](12-technical-debt.md)).

## The verification pipeline (used in anger)

`puppeteer-core` scripts (session scratch, pattern documented here because it
is part of operations): mint a viewer session via `POST /api/pos/auth/kiosk`,
render any page, `page.pdf()` with dialog-default margins, extract text per
page with `pdfjs-dist`, assert. This is how print regressions, role-leaks,
and layout breaks are caught without spending toner or trusting eyeballs.

## `scripts/` triage

### Operational tools (safe, reusable)

`setup.mjs` · `backup-db.mjs` · `purge-photos.mjs` · `run-hidden.vbs` ·
`i18n-audit.mts` · `build-web.mjs` · `build-brochure.mjs` · `build-manual.mts`
· `build-review.mts` · `build-shop-report.mts` · `informe-build/pdf.mjs` ·
`preview-*.mts` (report/help/trends previews) · `shoot-manual.mts`
(manual screenshots)

### Seeding / demo

`seed-test-accounts.mjs` · `seed-example-day.mjs` · `seed-mock-fortnight.mjs`
· `reset-for-production.mjs` — the raw material for a future demo mode; today
they are developer tools with no guardrails against running on live data.
**Never run a seed against the production DB.**

### One-off history (do not run again)

Imports: `import-excel-history.mts`, `import-tire-list.mts`,
`import-inventory.mts`, `import-counter-study.mts`,
`import-day-2026-08-05/06.mts`, `survey-workbooks.mts`, `lib-xlsx.mts`
(helper). Corrections, each tied to a dated incident:
`fix-card-tender-2026-08-08.mts`, `fix-1am-ticket.mts`,
`undo-order-moves-2026-08-10.mts`, `clear-day-2026-08-06.mts`,
`unvoid-060.mts`, `unvoid-sale.mts`, `split-javier.mts`,
`tidy-employee-names.mjs`, `fix-quick-button-categories.mts`,
`clean-setup-week-controls.mts`, `backfill-ordered-receipts.mts`,
`backfill-timeclock.mjs` (the 5-week clock simulation), `clear-tickets.mjs`.
Probes: `dir-probe.mts`, `discount-probe.mts`, `viewer-probe.mts`,
`check-closeout.mts`, `tidy-scratch.mts`.

The one-off pile is valuable as history (each script documents an incident)
but indistinguishable from tooling at a glance — flagged in
[12 — Technical Debt](12-technical-debt.md) for an `archive/` move during
cleanup, not deletion.

## Data corrections policy

When production data must be touched by hand (it happens — wrong tender,
duplicate account):

1. `backup-db.mjs` first, always.
2. Rehearse on a `VACUUM INTO` copy (`probe2` pattern).
3. The change is one figure — never "tidy the neighbours to match"
   (standing house rule).
4. Write an `audit_log` row with before/after, matching the app's own insert
   shape.
5. Prefer adding a correcting row over editing, wherever the schema offers it.
