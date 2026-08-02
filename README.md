# Casias Tire Shop — Time Clock

A simple PIN-based employee time clock with photo verification and an admin dashboard for payroll-style reporting. Designed for one local Windows machine acting as both the kiosk and the admin terminal.

## Features

**Kiosk (public)**
- 4-digit PIN entry with on-screen keypad and physical-keyboard support
- Live circular camera preview; photo captured on each clock event
- State-aware action buttons:
  - Checked out → **Check In**
  - Working → **Check Out** or **Take a Break**
  - On break → **End Break**
- Confirmation toast with employee name + timestamp, then auto-resets
- Camera-denied check-ins still go through but get **flagged** for admin review
- Live clock + date

**Admin (`/admin`)**
- Dashboard: who's working / on break / flagged-entry alerts
- Employees: add / edit / deactivate / delete / reset PIN
- Time Entries: filter by employee, type, date range, flagged-only; view captured photo; manually edit/delete (audit-logged)
- Weekly Hours Report: per-employee summary + daily breakdown, CSV/XLSX export, print-friendly view
- Audit Log: every admin change + auto-close events, with diff details
- Settings: company name, week-start day, auto-close hour, photo retention, admin password
- Auto-close: any shift still open at the configured hour (default 9pm) is auto-closed and flagged so an admin sees it

## Quick Start

**Requirements:** Node.js 22+ (24 recommended).

### Easiest: double-click

Double-click **`start.bat`**. On first run it installs dependencies, initializes the database, and builds the production bundle — then starts the server and opens the kiosk in your browser. Subsequent runs skip the install/setup steps.

### Manual

```bash
npm install        # install dependencies
npm run setup      # generate .env.local, create database, seed admin + 3 sample employees
npm run dev        # start dev server (hot reload)
# OR
npm run build && npm start   # production
```

The server listens on **http://localhost:3000**.

- Kiosk:  <http://localhost:3000>
- Admin:  <http://localhost:3000/admin>

## Default credentials

- **Admin:** username `admin`, password `changeme` — you'll be required to change the password on first login.
- **Sample employee PINs (delete or change in admin):**
  - Alex Rivera — `1234`
  - Sam Patel — `2345`
  - Jordan Kim — `3456`

## Project layout

```
.
├── data/               # SQLite database (timeclock.db) — created at setup
├── uploads/            # Captured photos — created at setup
├── migrations/         # SQL schema migrations
├── scripts/
│   ├── setup.mjs       # First-run init: env, db, migrations, admin, samples
│   └── purge-photos.mjs # Manual purge of photos older than retention window
├── src/
│   ├── app/
│   │   ├── page.tsx            # Kiosk (public)
│   │   ├── api/                # Backend route handlers
│   │   └── admin/
│   │       ├── login/          # Login page (no shell)
│   │       └── (authed)/       # Sidebar-shell pages: dashboard, employees, entries, reports, audit, settings, change-password
│   ├── components/
│   │   ├── kiosk/              # Camera, keypad, PIN dots, clock, action buttons
│   │   ├── admin/              # AdminShell (sidebar + auth gate)
│   │   └── ui/                 # Brand logo, tire SVG, modal, badges
│   └── lib/                    # db, auth, session, pin, photos, audit, employees, entries, settings, reports, auto-close, time
├── start.bat           # Windows one-click launcher (production)
├── start-dev.bat       # Windows dev-mode launcher
└── package.json
```

## Configuration

`.env.local` is generated automatically by `npm run setup`:

```
SESSION_SECRET=<48 random bytes, used to encrypt admin cookies>
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=changeme
```

Feel free to delete `DEFAULT_ADMIN_*` after you've changed the password — they only matter on the very first run.

Most knobs (week-start day, auto-close hour, photo retention) are in **Settings → General** in the admin dashboard, not in `.env.local`.

## Photo retention

Photos accumulate in `./uploads/`. To purge files older than the configured retention window (default 90 days — change in **Settings**):

```bash
npm run purge-photos
```

Run it manually whenever you want, or schedule it with Windows Task Scheduler if you'd like it to happen automatically.

## Architectural notes

- **Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 + better-sqlite3. Single repo, single process, no external services.
- **Local-time everywhere.** All timestamps are stored in local time (`YYYY-MM-DDTHH:MM:SS`, no `Z`). No timezone conversions. If you move the kiosk machine across timezones, historical timestamps stay as they were recorded.
- **Auto-close is opportunistic, not cron.** On every kiosk API request (throttled to once per minute) the server checks for shifts still open past the configured hour and closes them with a flag. This means no separate cron job to run, and as soon as someone uses the kiosk after 9pm the cleanup happens.
- **Photos are protected.** Served via `/api/photos/[filename]` which requires admin auth. They never appear under a public path.
- **PINs are bcrypt-hashed.** Lookups iterate through active employees comparing hashes — fine for small workforces. If your shop ever has hundreds of employees, swap to a plaintext-PIN-with-salt scheme or a separate lookup table; for now this keeps the threat model honest.
- **better-sqlite3 is synchronous.** Fine for an embedded single-process app and dramatically simpler than async SQLite drivers.
- **No mobile-responsive styles.** This app is designed for a desktop monitor or a tablet in landscape.
- **Audit log includes `system` events** for auto-closures (admin ID is null). They show up in the audit log with the source labeled "system."

## Common tasks

**Reset everything:** delete `data/timeclock.db` and `.env.local`, then `npm run setup`.

**Backup:** copy `data/timeclock.db` while the server is stopped. (Or with WAL mode on, you can copy it live — but the cleanest backup is with the server stopped.)

**Change the admin password without logging in:** delete the admin row in `data/timeclock.db` (e.g. with the [DB Browser for SQLite](https://sqlitebrowser.org/)), then re-run `npm run setup` to recreate with the default password.

**Add an employee:** Admin → Employees → "+ Add employee."

## Troubleshooting

**Camera shows "Camera blocked."** Browsers only grant camera permission on `localhost` or HTTPS. If you're hitting a LAN IP, use `localhost` on the kiosk machine itself, or set up HTTPS (e.g. with [mkcert](https://github.com/FiloSottile/mkcert)).

**`npm install` fails on better-sqlite3.** Make sure Node.js LTS (or v22+) is installed. better-sqlite3 ships prebuilt binaries for stable Node versions; if you're on a bleeding-edge or unusual Node, you may need Visual Studio Build Tools to compile from source.

**PowerShell says "running scripts is disabled."** Either run `npm.cmd` (with the extension) instead of `npm`, or set the per-user execution policy: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**Server is up but `/admin` keeps reloading.** Clear cookies for `localhost:3000` — your `casias_admin` cookie may be stale after a `SESSION_SECRET` rotation.
