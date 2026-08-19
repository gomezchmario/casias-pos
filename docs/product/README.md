# Treadline — Product Documentation

This directory is the documentation of record for **Treadline**, the commercial
tire-shop management platform. The software currently runs in production at one
shop (Casias Muffler and Tire Shop, San Antonio TX); these documents describe
what exists, what the brochure promises, and what stands between the two.

The top-level [`README.md`](../../README.md) is the engineering overview and is
maintained alongside this suite. These documents go deeper in every direction
it points.

## The suite

| Doc | What it answers |
|---|---|
| [01 — Product Vision](01-product-vision.md) | What Treadline is, who buys it, and where the brochure and the code disagree |
| [02 — Architecture](02-architecture.md) | How the system is built, layered, and served |
| [03 — Database](03-database.md) | Every table, and the invariants that make it a book of record |
| [04 — API Reference](04-api.md) | Every route: guards, request and response shapes |
| [05 — UI Standards](05-ui-standards.md) | Screen organization, design language, i18n, copy voice |
| [06 — Coding Standards](06-coding-standards.md) | The house rules, and the testing strategy |
| [07 — Configuration](07-configuration.md) | Every setting, and everything hardcoded that should become one |
| [08 — Deployment](08-deployment.md) | Installation, release process, backup and restore, the server path |
| [09 — Operations](09-operations.md) | The runbook, and the scripts directory triaged |
| [10 — Security](10-security.md) | Auth, capabilities, known gaps, hardening checklist |
| [11 — Feature Matrix](11-feature-matrix.md) | Every feature by status, against the brochure and the plans |
| [12 — Technical Debt](12-technical-debt.md) | The debt register and known issues, honestly stated |
| [13 — Commercialization](13-commercialization.md) | What converting one shop's system into a product requires |
| [14 — Roadmap](14-roadmap.md) | The phases, priorities, risks and effort |
| [15 — Owner Controls](15-owner-controls.md) | **OWNER-ONLY — do not distribute.** The cash-control mechanisms |
| [16 — PRD](16-prd.md) | Personas, workflows, requirements, future enhancements |
| [17 — Brand](17-brand.md) | The Treadline identity: name, mark, palette, voice |

## Distribution

Everything here **except `15-owner-controls.md`** is written to be safe to hand
to staff, partners, or prospects. Document 15 describes the owner's cash-control
instruments and is internal to the shop owner alone; the rest of the suite
refers to those mechanisms only as "owner-level controls."

## The maintenance rule

Documentation that drifts from the code is worse than no documentation, because
only one of the two failures is visible. The rule, stated once here and assumed
everywhere:

- **Every major change ships with its documentation update** — same commit or
  same day.
- Schema changes update 03. New or changed routes update 04. New settings
  update 07. Anything crossed off or newly discovered updates 11, 12, and 14.
- Facts in these documents are written from the code, the migrations, and the
  brochure — never from memory. When something is unknown or unverified it is
  marked as such rather than papered over.

## Reading order for a newcomer

1. [01 — Product Vision](01-product-vision.md), then the brochure itself at
   `/info` (source: `docs/treadline-brochure.html`).
2. The top-level [`README.md`](../../README.md).
3. [02 — Architecture](02-architecture.md) and [03 — Database](03-database.md).
4. Whatever your work touches, from the table above.
