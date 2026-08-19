# 08 — Deployment, Installation, Releases

> Three lives of the same build: the shop's Windows PC (production today),
> the public URL (a tunnel to that same PC), and the future rented server
> (planned, absorbed here from the earlier VPS plan). Plus the release
> ritual and the backup/restore contract.

## Requirements

- Node.js 22+. `better-sqlite3` is a native module — on Linux that means
  `build-essential` + `python3` before `npm install`, or the failure reads as
  a Node problem.
- Any OS; production today is Windows 11.
- A camera-bearing device for the kiosk and HTTPS everywhere: camera and
  geolocation both require a secure context.

## Installation (a new machine)

```bash
npm install
npm run setup        # .env (SESSION_SECRET), database, migrations, seed admin
npm run build
npm start            # server.mjs — HTTPS on :3000, HTTP redirected
```

`npm run setup` is **the only thing that migrates**. It is idempotent —
applied migrations are recorded by filename and skipped — and it is never run
implicitly, so restarting the app can never reshape the database.

Self-signed certs live in `certs/` (gitignored). First visit requires
accepting the certificate; enrolled shop devices do this once.

## Production today (the shop PC)

- Launcher: `wscript scripts\run-hidden.vbs` — starts the server with no
  visible window (nothing on the taskbar to close at shift's end), logs to
  file, safe to double-launch.
- The same build is publicly served at `app.casiastire.shop` through a tunnel
  terminating on this machine. **The public URL is the shop PC** — sizing,
  uptime and security all follow from that fact.
- The OS timezone (America/Chicago) is part of the contract: every timestamp
  in the system is local time (`src/lib/time.ts`), and `business_date`
  derives from it.

## The release ritual

Practiced, not aspirational — this is how every change ships:

1. `npx tsc --noEmit` — the gate.
2. `npm run build`.
3. If a migration shipped: `node scripts/backup-db.mjs`, stop the server,
   `npm run setup`.
4. Stop node (`taskkill`/`Stop-Process`), relaunch via `run-hidden.vbs`.
5. Smoke: `curl -sk https://localhost:3000/pos` expects 200; exercise the
   changed surface (the authenticated headless pipeline for anything
   printable).
6. Commit with a prose message carrying the verification evidence; push.

**The stale-tab rule:** browser tabs opened before the deploy keep running
the previous client bundle until hard-refreshed. Every "the change isn't
there" and one 219-page print incident trace to this. After deploying,
refresh the register tabs.

**Rollback** is git revert + redeploy, plus restoring the pre-migration
backup if a migration must come back out (none ever has; migrations are
additive by rule).

## Backups

- `node scripts/backup-db.mjs [dest]` — `VACUUM INTO` (a file copy can
  silently miss hours of WAL), then integrity check and row-count comparison
  against the source. Backups land in `data/backups/` timestamped.
- Taken before every migration and every production data correction, and on
  a routine cadence besides.
- **A backup is a rumour until restored.** The restore drill: copy the
  snapshot to a scratch directory, open it, verify the last sale number
  against production. Do this before trusting any new backup destination.
- Excluded from git by design: the database, TLS keys, photos, `.env`.

## The rented-server path (planned, not yet built)

Decisions and hazards recorded when this was designed; they hold:

- **Moving the server moves the register.** Once the DB lives in a
  datacenter, the counter rings over the internet; mitigation is a documented
  cold-standby PC or 4G failover — an operational decision to make
  deliberately.
- **Ubuntu LTS + Caddy** terminating TLS (Let's Encrypt), proxying
  `127.0.0.1:3000`; behind a proxy run `next start` (`npm run start:http`) —
  `server.mjs`'s TLS sniffing solves a localhost problem that no longer
  applies there. `ufw` allows 80/443 only.
- **systemd** unit with `Restart=always`, `Environment=NODE_ENV=production`
  and `Environment=TZ=America/Chicago` — **and** the OS timezone set. A UTC
  box silently files every evening sale on the next business day.
- Nightly `backup-db.mjs` on a timer writing **off** the box; restore drill
  before cutover.
- Cutover: close the day on the old machine, back up, copy DB + `uploads/`,
  `npm run setup`, ring a 9:30 p.m. test sale and verify its
  `business_date`, enroll the shop's devices, switch DNS, keep the old PC
  untouched for a fortnight.
- Precondition: the device-trust work now shipped (fence, trusted devices)
  plus the hardening list in [10 — Security](10-security.md) — notably the
  unauthenticated-PIN throttle.

## Multi-customer packaging (recorded for the roadmap)

Nothing here exists yet: no installer, no update channel, no per-customer
config bundle, no license mechanism. The current model — git pull + build on
the one machine — does not survive a second customer; see
[13 — Commercialization](13-commercialization.md) for the requirements and
[14 — Roadmap](14-roadmap.md) for sequencing.
