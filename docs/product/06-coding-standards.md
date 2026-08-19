# 06 — Coding Standards

> The house rules as practiced in this codebase. Most of them exist because a
> specific bug or a specific afternoon taught them; where that story matters
> it is told in a comment at the site itself. New code is expected to read
> like the surrounding code.

## The non-negotiables

1. **Money is integer cents.** `src/lib/money.ts` owns parse/format. No
   floats, no strings-with-dollar-signs anywhere between input and display.
2. **No SQL above `src/lib/`.** Routes parse, guard, call, serialize.
3. **Ledgers append; entities soft-delete; everything audits** — inside the
   same transaction (`inTx` from `tx.ts`; `logActorAudit`/`logAudit` from
   `audit.ts`). A change without its audit row is not a reachable state.
4. **One business date.** Anything bucketing money by day goes through
   `business-date.ts`. Never `DATE('now')`.
5. **Local time only.** `time.ts` (`nowLocalIso`) — no UTC, no `Date.toISOString`
   for storage. The server's OS timezone is part of the deployment contract.
6. **Server-side truth.** Role-sensitive figures are shaped in the route,
   never hidden in the client. A number sent down and hidden in markup is not
   hidden.
7. **Fail-open where refusal empties a payroll.** The clock-in fence lets a
   half-configured fence, a missing location on a trusted device, or a failed
   device lookup through — the failure mode of a clock that wrongly refuses
   is a queue at the counter (see `fence.ts`, `devices.ts`).
8. **Capabilities, not roles, in handlers.** `requirePos("capability")`;
   adding a role check to a route is a review flag.

## Comments

The codebase's signature habit: **long prose comments that name the bug they
prevent.** A rule's comment tells the story of the afternoon it was learned —
what shipped wrong, how it surfaced, why the code now reads this way. Two
hard rules:

- A comment must never contradict the code beside it. When behavior changes,
  the essay changes in the same edit (see `drawerAdjustmentCents` for a
  doctrine reversal recorded honestly, with a date).
- Explaining *what* the line does is noise; explaining *why it must be this
  way* is the job.

## TypeScript and style

- Strict TS; `npx tsc --noEmit` gates every build. No `any` in new code
  unless quarantined with a reason.
- Request bodies are typed inline in the route (`let body: {...}`) and
  validated by hand — refused, not clamped (a silently corrected coordinate
  is a fence nobody can reason about).
- Closed unions for domain vocabularies (`AuditAction`, `EntryType`,
  `PosRole`) so a new value is a compile error until it is named everywhere.
- Formatting follows the file you are in; no repo-wide reformat commits.

## Migrations

- Ordered SQL files with prose headers explaining the design, applied only by
  `npm run setup`, recorded by filename. Never edit an applied migration;
  additive `ALTER` in a new file. Data corrections that matter get their own
  migration with the reasoning (e.g. 045 folding legacy "Used USED" into the
  pool).

## Workflow rules (learned in production)

- **Deploy ritual**: `tsc --noEmit` → `npm run build` → stop node → launch
  via `scripts/run-hidden.vbs` → smoke-check → commit/push. Migrations are a
  deliberate separate step (`npm run setup`) with a `backup-db.mjs` first.
- **Stale tabs print stale bundles.** After a deploy, open register tabs run
  the old client until hard-refreshed. Any "impossible" UI bug report starts
  with "when was this tab opened?"
- **Probe before production.** Data investigations and risky logic run
  against a throwaway `VACUUM INTO` copy first (the `probe2` pattern);
  production data edits take a verified backup, a dry run on the copy, and an
  audit row when applied.
- **Automated edits use unique anchors.** Scripted source edits go through a
  helper that throws unless the anchor matches exactly once — and on Windows,
  heredocs eat backslashes: generated code with regexes gets written by the
  file-writing tool, not a shell heredoc (a `/\s+/g` shipped as `/s+/g` once;
  the toggle flipped its label over a page that never changed).
- **Commit messages are prose**: a title that states the change as a claim,
  then the why, the alternative rejected, and what was verified.

## Testing strategy

**Current state, honestly:** there are no unit tests and no CI. Verification
is systematic but manual:

- **Probe scripts** (tsx against a DB copy) exercise domain functions with
  real data — every fence path, ledger arithmetic, report folds — and their
  output is pasted into commit messages as evidence.
- **Authenticated headless verification**: a puppeteer pipeline signs in with
  the designated read-only test account (Test Viewer), renders real pages,
  prints real PDFs, extracts text per page, and diffs against expectations.
  Print regressions (masthead loss, fragmenter blowups) were caught this way.
- **The typechecker** is the only always-on gate.

**Target, in order of value** (tracked in [14 — Roadmap](14-roadmap.md)):

1. Unit tests over `src/lib` money paths: cents arithmetic, business-date
   bucketing, void/reversal symmetry, FIFO costing, fence judgment.
2. A seedable fixture database for those tests (the seed scripts are most of
   the way there).
3. Golden-file tests for the printable documents (text-layer extraction, the
   existing pipeline formalized).
4. CI running tsc + tests on push. Frontend E2E last; the manual pipeline
   already covers the highest-risk screens.
