import { cookies } from "next/headers";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { nowLocalIso } from "./time";
import { currentBusinessDate } from "./business-date";
import { logActorAudit, type Actor } from "./audit";
import { fleetReport, type FleetReport } from "./fleets";
import { describeVehicle, phoneDigits, type Vehicle } from "./customers";
import { nextCustomerNo } from "./counters";
import { properName } from "./names";
import { inTx } from "./tx";
import type { PosUser } from "./pos-session";
import { can } from "./roles";

/**
 * The company directory — a fleet's own window on its own account.
 *
 * WHAT IS NEW HERE, AND WHY IT IS WORTH BEING CAREFUL ABOUT. Every other screen
 * in this program is reached by somebody who works at the shop, after typing a
 * PIN that identifies them. This one is not. A company gets a link and a
 * four-letter code and reads what it owes, which of its drivers ran it up, on
 * which tickets and which trucks. That is the first door in this building that
 * opens outward, so the rules for it are written down here rather than spread
 * across the routes that enforce them:
 *
 *   1. NO MONEY MOVES. There is no function in this file that writes to
 *      `payments`, `account_payments`, `sales`, `sale_items`, or any drawer
 *      table. The read side goes through `fleetReport`, which is the same
 *      function that prints the statement, so the portal and the paper cannot
 *      drift apart. A company that disagrees with a figure rings the shop —
 *      that is the correct outcome, and the whole design assumes it.
 *
 *   2. WHAT THEY MAY CHANGE IS THEIR OWN DRIVERS AND THEIR OWN TRUCKS, AND
 *      NOTHING ELSE. Every write in this file re-derives the owning company
 *      from the session and checks it against the row being touched, in the
 *      library, on the server. A driver id in a request body is a claim, never
 *      a permission — see `ownedDriver` and `ownedVehicle`, which exist so that
 *      no route has to remember to do this and none of them can forget.
 *
 *   3. EVERY WRITE IS ATTRIBUTED TO THE COMPANY. Not to an employee, not to the
 *      system — see the `customer` actor in audit.ts. When a VIN changes, the
 *      log says which company changed it.
 *
 * THE CODE IS FOUR LETTERS BECAUSE IT GETS READ DOWN A PHONE to somebody in an
 * office who will write it on a sticky note. That is 456,976 combinations,
 * which is poor protection standing alone — so it does not stand alone. The
 * login is throttled per device the same way the time clock's PIN is, the
 * address is only worth having with the code, and both good and bad attempts
 * are recorded in `dir_visits` where the shop can see somebody working through
 * words. Understand the trade honestly: this protects a list of trucks and an
 * amount owed from casual snooping. It is not, and is not built to be, the lock
 * on the register.
 */

/** Four letters. Case is not part of it — nobody reads case down a phone. */
export const DIR_PIN_LENGTH = 4;
const DIR_COOKIE = "casias_dir";
/** A company stays signed in for a fortnight, then reads the code again. */
const SESSION_DAYS = 14;

/** Reserved: the shop's own index lives at /dir/customers. */
const RESERVED_SLUGS = new Set(["customers", "api", "login", "logout", "static"]);

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// The address
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A company name, as it can appear in a URL.
 *
 * Derived from the name rather than random, because this gets typed off a
 * business card and read down a phone, and "wilsonhauling" survives both where
 * a random string survives neither. The cost is that the address is guessable —
 * a competitor knows the company's name — which is exactly why there is a code
 * behind it and why the throttle in `dirLogin` is not optional.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents: Pena and Peña type the same
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "company";
}

/**
 * This company's address, minting one the first time it is asked for.
 *
 * Collisions get a numeric suffix rather than an error. Two companies called
 * "Martinez Trucking" is an ordinary thing in San Antonio and must not be a
 * failure somebody has to resolve before they can hand out a link.
 */
function ensureSlug(customerId: number, name: string): string {
  const db = getDb();
  const row = db
    .prepare(`SELECT dir_slug AS slug FROM customers WHERE id = ?`)
    .get(customerId) as { slug: string | null } | undefined;
  if (row?.slug) return row.slug;

  const base = slugify(name);
  let candidate = base;
  for (let n = 2; ; n++) {
    const taken =
      RESERVED_SLUGS.has(candidate) ||
      !!db
        .prepare(`SELECT 1 FROM customers WHERE dir_slug = ? AND id <> ?`)
        .get(candidate, customerId);
    if (!taken) break;
    candidate = `${base}-${n}`;
  }
  db.prepare(`UPDATE customers SET dir_slug = ? WHERE id = ?`).run(candidate, customerId);
  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// The shop's side: who has a portal, and what their code is
// ─────────────────────────────────────────────────────────────────────────────

export type DirectoryRow = {
  id: number;
  customerNo: string;
  name: string;
  slug: string;
  /** Whether a code is set. Never the code itself — see `setDirPin`. */
  hasPin: boolean;
  pinSetAt: string | null;
  pinSetBy: string | null;
  drivers: number;
  balanceCents: number;
  lastVisit: string | null;
  liveSessions: number;
};

/**
 * Every company that could have a portal, with or without one yet.
 *
 * Listing companies with no code set is the point: the screen is where somebody
 * goes to hand a company its link, and a list that only showed the ones already
 * done would be a list of the work already finished.
 */
export function listDirectory(user: PosUser): Result<{ rows: DirectoryRow[] }> {
  if (!can(user.role, "manageDirectory"))
    return { ok: false, error: "Only the owner or the accountant can open the directory" };

  const db = getDb();
  const companies = db
    .prepare(
      `SELECT id, customer_no AS customerNo, name,
              dir_slug AS slug, dir_pin_hash AS pinHash,
              dir_pin_set_at AS pinSetAt, dir_pin_set_by AS pinSetBy
         FROM customers
        WHERE is_fleet = 1 AND deleted = 0
     ORDER BY name`,
    )
    .all() as {
    id: number;
    customerNo: string;
    name: string;
    slug: string | null;
    pinHash: string | null;
    pinSetAt: string | null;
    pinSetBy: number | null;
  }[];

  const now = nowLocalIso();
  return {
    ok: true,
    rows: companies.map((c) => {
      const slug = c.slug ?? ensureSlug(c.id, c.name);

      const drivers = db
        .prepare(
          `SELECT COUNT(*) AS n FROM customers WHERE fleet_id = ? AND deleted = 0`,
        )
        .get(c.id) as { n: number };

      /*
        The balance, from the same signed ledger the statement uses — charges
        positive, payments negative. Written out here rather than borrowed from
        `fleetReport` because that builds a whole document per company, and this
        screen lists every company at once.
      */
      const bal = db
        .prepare(
          `SELECT COALESCE(SUM(amt), 0) AS cents FROM (
              SELECT p.amount_cents AS amt
                FROM payments p
                JOIN sales s ON s.id = p.sale_id
                JOIN payment_methods m ON m.id = p.method_id
                JOIN customers c ON c.id = s.customer_id
               WHERE m.code = 'credit_account' AND s.deleted = 0
                 AND COALESCE(c.fleet_id, c.id) = ?
               UNION ALL
              SELECT -a.amount_cents
                FROM account_payments a
                JOIN customers c ON c.id = a.customer_id
               WHERE COALESCE(c.fleet_id, c.id) = ?
           )`,
        )
        .get(c.id, c.id) as { cents: number };

      const visit = db
        .prepare(
          `SELECT at FROM dir_visits WHERE customer_id = ? AND ok = 1
            ORDER BY id DESC LIMIT 1`,
        )
        .get(c.id) as { at: string } | undefined;

      const live = db
        .prepare(
          `SELECT COUNT(*) AS n FROM dir_sessions
            WHERE customer_id = ? AND revoked_at IS NULL AND expires_at > ?`,
        )
        .get(c.id, now) as { n: number };

      const setBy = c.pinSetBy
        ? (db.prepare(`SELECT name FROM employees WHERE id = ?`).get(c.pinSetBy) as
            | { name: string }
            | undefined)
        : undefined;

      return {
        id: c.id,
        customerNo: c.customerNo,
        name: c.name,
        slug,
        hasPin: !!c.pinHash,
        pinSetAt: c.pinSetAt,
        pinSetBy: setBy?.name ?? null,
        drivers: drivers.n,
        balanceCents: bal.cents,
        lastVisit: visit?.at ?? null,
        liveSessions: live.n,
      };
    }),
  };
}

/** Four letters, in any case. Digits are out: they get confused with the PIN pad. */
export function isValidDirPin(pin: string): boolean {
  return new RegExp(`^[A-Za-z]{${DIR_PIN_LENGTH}}$`).test(pin.trim());
}

/**
 * Set a company's code.
 *
 * Stored as a bcrypt hash and never read back, exactly like an employee PIN.
 * That means nobody — including the owner — can look up a code that has been
 * forgotten, and the only repair is to set a new one. That is the correct
 * trade: a code that can be read off a screen is a code that gets read off a
 * screen by whoever is standing behind whoever opened it.
 */
export function setDirPin(user: PosUser, customerId: number, pin: string): Result<{ slug: string }> {
  if (!can(user.role, "manageDirectory"))
    return { ok: false, error: "Only the owner or the accountant can set a company's code" };
  if (!isValidDirPin(pin))
    return { ok: false, error: `The code is ${DIR_PIN_LENGTH} letters — no numbers, no spaces` };

  const db = getDb();
  const company = db
    .prepare(`SELECT id, name, is_fleet AS isFleet FROM customers WHERE id = ? AND deleted = 0`)
    .get(customerId) as { id: number; name: string; isFleet: number } | undefined;
  if (!company) return { ok: false, error: "Company not found" };
  if (!company.isFleet)
    return { ok: false, error: "Only a company can have a directory page" };

  const hash = bcrypt.hashSync(pin.trim().toLowerCase(), 10);
  const slug = ensureSlug(company.id, company.name);

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE customers
          SET dir_pin_hash = ?, dir_pin_set_at = ?, dir_pin_set_by = ?
        WHERE id = ?`,
    ).run(hash, nowLocalIso(), user.employeeId, customerId);

    /*
      Setting a new code ends every session opened with the old one. Otherwise
      changing the code — which is what somebody does the moment they think it
      has got out — would leave whoever it got out to still signed in, and the
      one deliberate act available would have done nothing.
    */
    db.prepare(
      `UPDATE dir_sessions SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL`,
    ).run(nowLocalIso(), customerId);

    logActorAudit(actorOf(user), {
      action: "dir.pin_set",
      targetType: "customer",
      targetId: customerId,
      details: { company: company.name, slug },
    });
  });
  write();

  return { ok: true, slug };
}

/** Take the portal away. The address survives; nothing behind it opens. */
export function clearDirPin(user: PosUser, customerId: number): Result {
  if (!can(user.role, "manageDirectory"))
    return { ok: false, error: "Only the owner or the accountant can close a company's page" };

  const db = getDb();
  const company = db
    .prepare(`SELECT name FROM customers WHERE id = ?`)
    .get(customerId) as { name: string } | undefined;
  if (!company) return { ok: false, error: "Company not found" };

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE customers SET dir_pin_hash = NULL, dir_pin_set_at = NULL, dir_pin_set_by = NULL
        WHERE id = ?`,
    ).run(customerId);
    db.prepare(
      `UPDATE dir_sessions SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL`,
    ).run(nowLocalIso(), customerId);
    logActorAudit(actorOf(user), {
      action: "dir.pin_clear",
      targetType: "customer",
      targetId: customerId,
      details: { company: company.name },
    });
  });
  write();
  return { ok: true };
}

/** Sign a company out everywhere, without changing the code. */
export function revokeDirSessions(user: PosUser, customerId: number): Result<{ ended: number }> {
  if (!can(user.role, "manageDirectory"))
    return { ok: false, error: "Only the owner or the accountant can do that" };
  const db = getDb();
  const info = db
    .prepare(`UPDATE dir_sessions SET revoked_at = ? WHERE customer_id = ? AND revoked_at IS NULL`)
    .run(nowLocalIso(), customerId);
  logActorAudit(actorOf(user), {
    action: "dir.session_revoke",
    targetType: "customer",
    targetId: customerId,
    details: { ended: info.changes },
  });
  return { ok: true, ended: info.changes };
}

function actorOf(user: PosUser): Actor {
  return { type: "employee", employeeId: user.employeeId, name: user.name, role: user.role };
}

// ─────────────────────────────────────────────────────────────────────────────
// The company's side: getting in
// ─────────────────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Wrong codes, counted per device, five in a row then five minutes off.
 *
 * The same shape and the same numbers as the time clock's `pin-throttle` —
 * deliberately, because two different lockout rules in one shop is one rule
 * nobody can remember. It is kept separate rather than shared because the two
 * count different things and must not lock each other out: a delivery driver
 * fumbling the company code at the roadside has nothing to do with the kiosk on
 * the wall, and a shared counter would make each of them the other's problem.
 *
 * In memory, like the kiosk's. A restart hands back the attempts, which costs
 * nothing next to a write on every mistyped code.
 */
const MAX_DIR_FAILS = 5;
const DIR_LOCKOUT_MINUTES = 5;
const dirStrikes = new Map<string, { fails: number; until: number }>();

export type DirGate = { blocked: false } | { blocked: true; secondsLeft: number };

async function dirDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get("casias_dir_dev")?.value;
  if (existing) return existing;
  const id = crypto.randomBytes(16).toString("hex");
  jar.set("casias_dir_dev", id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return id;
}

function gateFor(deviceId: string): DirGate {
  const s = dirStrikes.get(deviceId);
  const now = Date.now();
  if (!s || s.until <= now) return { blocked: false };
  return { blocked: true, secondsLeft: Math.ceil((s.until - now) / 1000) };
}

/**
 * Try a code against a company.
 *
 * Returns the same refusal whether the address is unknown, the company has no
 * portal, or the code is wrong. Distinguishing them would turn the page into a
 * tool for finding out which companies the shop carries on account, which is
 * commercially interesting to exactly the people who should not have it.
 */
export async function dirLogin(slug: string, pin: string): Promise<Result<{ name: string }>> {
  const deviceId = await dirDeviceId();
  const gate = gateFor(deviceId);
  if (gate.blocked)
    return { ok: false, error: `Too many tries. Wait ${Math.ceil(gate.secondsLeft / 60)} minutes.` };

  const db = getDb();
  const company = db
    .prepare(
      `SELECT id, name, dir_pin_hash AS pinHash
         FROM customers
        WHERE dir_slug = ? AND is_fleet = 1 AND deleted = 0`,
    )
    .get(slug) as { id: number; name: string; pinHash: string | null } | undefined;

  const good =
    !!company?.pinHash && bcrypt.compareSync(pin.trim().toLowerCase(), company.pinHash);

  if (!good) {
    const s = dirStrikes.get(deviceId) ?? { fails: 0, until: 0 };
    s.fails += 1;
    if (s.fails >= MAX_DIR_FAILS) {
      s.until = Date.now() + DIR_LOCKOUT_MINUTES * 60_000;
      s.fails = 0;
    }
    dirStrikes.set(deviceId, s);

    if (company)
      db.prepare(`INSERT INTO dir_visits (customer_id, at, ok, note) VALUES (?, ?, 0, ?)`).run(
        company.id,
        nowLocalIso(),
        "wrong code",
      );
    return { ok: false, error: "That code does not open this page." };
  }

  dirStrikes.delete(deviceId);

  const token = crypto.randomBytes(32).toString("hex");
  const now = nowLocalIso();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const expiresIso = `${expires.getFullYear()}-${String(expires.getMonth() + 1).padStart(2, "0")}-${String(expires.getDate()).padStart(2, "0")} ${String(expires.getHours()).padStart(2, "0")}:${String(expires.getMinutes()).padStart(2, "0")}:${String(expires.getSeconds()).padStart(2, "0")}`;

  db.prepare(
    `INSERT INTO dir_sessions (token_hash, customer_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hashToken(token), company!.id, now, now, expiresIso);

  db.prepare(`INSERT INTO dir_visits (customer_id, at, ok) VALUES (?, ?, 1)`).run(
    company!.id,
    now,
  );

  logActorAudit(
    { type: "customer", customerId: company!.id, name: company!.name },
    { action: "dir.login", targetType: "customer", targetId: company!.id },
  );

  const jar = await cookies();
  jar.set(DIR_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86_400,
    /*
      Path "/" rather than "/dir", which is the narrower-looking choice and
      would have been wrong: the portal's own API lives at /api/dir/..., so a
      cookie scoped to /dir would be sent to the pages and withheld from every
      request they make — a session that reads as signed-in and cannot fetch
      anything. Scope is not what keeps this cookie safe; httpOnly is, plus the
      fact that nothing outside this file ever looks at it.
    */
    path: "/",
  });

  return { ok: true, name: company!.name };
}

export type DirSession = { customerId: number; name: string; slug: string };

/**
 * Who is reading, if anybody.
 *
 * The session names the company. NOTHING in a request body is allowed to,
 * which is the single rule that keeps one company out of another's page — see
 * the note at the top of this file.
 */
export async function dirSession(): Promise<DirSession | null> {
  const jar = await cookies();
  const token = jar.get(DIR_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, c.id AS customerId, c.name, c.dir_slug AS slug
         FROM dir_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
          AND c.deleted = 0 AND c.dir_pin_hash IS NOT NULL`,
    )
    .get(hashToken(token), nowLocalIso()) as
    | { id: number; customerId: number; name: string; slug: string }
    | undefined;
  if (!row) return null;

  db.prepare(`UPDATE dir_sessions SET last_seen_at = ? WHERE id = ?`).run(nowLocalIso(), row.id);
  return { customerId: row.customerId, name: row.name, slug: row.slug };
}

export async function dirLogout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(DIR_COOKIE)?.value;
  if (token)
    getDb()
      .prepare(`UPDATE dir_sessions SET revoked_at = ? WHERE token_hash = ?`)
      .run(nowLocalIso(), hashToken(token));
  jar.delete(DIR_COOKIE);
}

/** The company's name for an address, for the sign-in screen. Nothing else. */
export function companyNameForSlug(slug: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT name FROM customers
        WHERE dir_slug = ? AND is_fleet = 1 AND deleted = 0 AND dir_pin_hash IS NOT NULL`,
    )
    .get(slug) as { name: string } | undefined;
  return row?.name ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// What a company sees
// ─────────────────────────────────────────────────────────────────────────────

export type DirDriver = {
  id: number;
  name: string;
  phone: string | null;
  chargedCents: number;
  lastVisit: string | null;
  vehicles: (Vehicle & { label: string })[];
};

export type DirProfile = {
  company: { id: number; name: string; slug: string; phone: string | null; address: string | null };
  balanceCents: number;
  drivers: DirDriver[];
  /** The company's own trucks — rung on the company rather than on a driver. */
  ownVehicles: (Vehicle & { label: string })[];
  charges: FleetReport["charges"];
  payments: FleetReport["payments"];
};

/**
 * Everything the portal shows, built on `fleetReport`.
 *
 * Deliberately the same function that prints the statement. A second query
 * shaped slightly differently is a second answer to "what do we owe", and the
 * first afternoon those two disagree costs more than this whole feature saves.
 *
 * The window is all time, because a company reading its own page is asking
 * "what do we owe" and not "what did we owe in March" — the balance has to be
 * the whole balance or it is a number that invites an argument.
 */
export function dirProfile(customerId: number): DirProfile | null {
  const report = fleetReport(customerId, "2000-01-01", currentBusinessDate());
  if (!report) return null;

  const db = getDb();
  const carsFor = (ownerId: number) =>
    (
      db
        .prepare(
          `SELECT * FROM vehicles WHERE customer_id = ? AND deleted = 0 ORDER BY id DESC`,
        )
        .all(ownerId) as Vehicle[]
    ).map((v) => ({ ...v, label: describeVehicle(v) }));

  return {
    company: {
      id: report.fleet.id,
      name: report.fleet.name,
      slug:
        (db.prepare(`SELECT dir_slug AS s FROM customers WHERE id = ?`).get(customerId) as {
          s: string;
        }).s,
      phone: report.fleet.phone,
      address: report.fleet.address,
    },
    balanceCents: report.totals.closingCents,
    drivers: report.members.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      chargedCents: m.chargedCents,
      lastVisit: m.lastVisit,
      vehicles: carsFor(m.id),
    })),
    ownVehicles: carsFor(customerId),
    charges: report.charges,
    payments: report.payments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// What a company may change: its own drivers, its own trucks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this driver actually on this company?
 *
 * The reason every write in this file starts here. A driver id arriving in a
 * request body is a claim about the world, and the only thing standing between
 * "edit my driver" and "edit anybody's driver" is re-deriving the owner from
 * the row and comparing it to the SESSION — never to anything the caller sent.
 * The company itself counts as its own: a fleet can hold trucks directly.
 */
function ownedDriver(companyId: number, driverId: number): { id: number; name: string } | null {
  const row = getDb()
    .prepare(
      `SELECT id, name FROM customers
        WHERE id = ? AND deleted = 0 AND (fleet_id = ? OR id = ?)`,
    )
    .get(driverId, companyId, companyId) as { id: number; name: string } | undefined;
  return row ?? null;
}

/** Same rule for a car: its owner must be the company or one of its drivers. */
function ownedVehicle(companyId: number, vehicleId: number): Vehicle | null {
  const row = getDb()
    .prepare(
      `SELECT v.* FROM vehicles v
         JOIN customers c ON c.id = v.customer_id
        WHERE v.id = ? AND v.deleted = 0 AND c.deleted = 0
          AND COALESCE(c.fleet_id, c.id) = ?`,
    )
    .get(vehicleId, companyId) as Vehicle | undefined;
  return row ?? null;
}

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** VINs are upper case and have no I, O or Q. Same rule as the counter's. */
const cleanVin = (v: string | null | undefined) => {
  const t = (v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t === "" ? null : t;
};

export function dirAddDriver(
  session: DirSession,
  args: { name?: string; phone?: string },
): Result<{ id: number }> {
  const name = clean(args.name);
  if (!name) return { ok: false, error: "A driver needs a name" };

  const phone = clean(args.phone);

  /*
    The same duplicate check the counter runs. A company adding a driver who is
    already in the book under a slightly different spelling is the single most
    likely way this screen makes work rather than saving it, and the number is
    what catches it.
  */
  const digits = phoneDigits(phone);
  if (digits.length >= 7) {
    const existing = getDb()
      .prepare(
        `SELECT name FROM customers
          WHERE deleted = 0
            AND replace(replace(replace(replace(phone,'(',''),')',''),'-',''),' ','') LIKE ?
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(`%${digits}`) as { name: string } | undefined;
    if (existing)
      return { ok: false, error: `That number is already here under "${existing.name}"` };
  }

  const id = inTx(() => {
    // Number, name-casing and columns all come from the counter's own path —
    // see createCustomer. A driver added from the directory is an ordinary
    // customer in every respect except who typed it, and a row built to a
    // different shape here would be a second class of customer that every
    // report downstream would then have to know about.
    const customerNo = nextCustomerNo();
    const now = nowLocalIso();
    const info = getDb()
      .prepare(
        `INSERT INTO customers (customer_no, name, phone, fleet_id, is_fleet, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(customerNo, properName(name), phone, session.customerId, now, now);

    logActorAudit(
      { type: "customer", customerId: session.customerId, name: session.name },
      {
        action: "customer.create",
        targetType: "customer",
        targetId: Number(info.lastInsertRowid),
        details: { via: "directory", company: session.name, customer_no: customerNo },
        after: { name: properName(name), phone, fleet_id: session.customerId },
      },
    );
    return Number(info.lastInsertRowid);
  });

  return { ok: true, id };
}

export function dirUpdateDriver(
  session: DirSession,
  driverId: number,
  args: { name?: string; phone?: string },
): Result {
  const driver = ownedDriver(session.customerId, driverId);
  if (!driver) return { ok: false, error: "That driver is not on this account" };
  /*
    A company may correct its drivers but not rename ITSELF. The name on the
    company is the name on the statement and on every ticket already rung
    against it, and letting the account rename itself from outside is how a
    month of history stops matching the paperwork it was printed on.
  */
  if (driverId === session.customerId)
    return { ok: false, error: "Ring the shop to change the company's own name" };

  const name = clean(args.name);
  if (args.name !== undefined && !name) return { ok: false, error: "A driver needs a name" };

  const db = getDb();
  const before = db
    .prepare(`SELECT name, phone FROM customers WHERE id = ?`)
    .get(driverId) as { name: string; phone: string | null };

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE customers SET name = COALESCE(?, name), phone = ?, updated_at = ? WHERE id = ?`,
    ).run(
      name ? properName(name) : null,
      args.phone !== undefined ? clean(args.phone) : before.phone,
      nowLocalIso(),
      driverId,
    );
    logActorAudit(
      { type: "customer", customerId: session.customerId, name: session.name },
      {
        action: "customer.update",
        targetType: "customer",
        targetId: driverId,
        details: { via: "directory", company: session.name },
        before,
        after: {
          name: name ?? before.name,
          phone: args.phone !== undefined ? clean(args.phone) : before.phone,
        },
      },
    );
  });
  write();
  return { ok: true };
}

export type VehicleFields = {
  year?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  plate?: string | null;
  vin?: string | null;
  tireSize?: string | null;
  notes?: string | null;
};

export function dirAddVehicle(
  session: DirSession,
  ownerId: number,
  args: VehicleFields,
): Result<{ id: number }> {
  const owner = ownedDriver(session.customerId, ownerId);
  if (!owner) return { ok: false, error: "That driver is not on this account" };

  const vin = cleanVin(args.vin);
  if (vin) {
    const clash = getDb()
      .prepare(`SELECT id FROM vehicles WHERE vin = ? AND deleted = 0`)
      .get(vin) as { id: number } | undefined;
    if (clash) return { ok: false, error: "That VIN is already on a vehicle here" };
  }

  const db = getDb();
  const write = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO vehicles (customer_id, year, make, model, color, plate, vin, tire_size, notes,
                               created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ownerId,
        clean(args.year),
        clean(args.make),
        clean(args.model),
        clean(args.color),
        clean(args.plate),
        vin,
        clean(args.tireSize),
        clean(args.notes),
        nowLocalIso(),
        nowLocalIso(),
      );
    logActorAudit(
      { type: "customer", customerId: session.customerId, name: session.name },
      {
        action: "vehicle.create",
        targetType: "vehicle",
        targetId: Number(info.lastInsertRowid),
        details: { via: "directory", company: session.name, owner: owner.name },
        after: { make: clean(args.make), model: clean(args.model), vin },
      },
    );
    return Number(info.lastInsertRowid);
  });

  return { ok: true, id: write() };
}

export function dirUpdateVehicle(
  session: DirSession,
  vehicleId: number,
  args: VehicleFields,
): Result {
  const before = ownedVehicle(session.customerId, vehicleId);
  if (!before) return { ok: false, error: "That vehicle is not on this account" };

  const vin = args.vin !== undefined ? cleanVin(args.vin) : before.vin;
  if (vin && vin !== before.vin) {
    const clash = getDb()
      .prepare(`SELECT id FROM vehicles WHERE vin = ? AND deleted = 0 AND id <> ?`)
      .get(vin, vehicleId) as { id: number } | undefined;
    if (clash) return { ok: false, error: "That VIN is already on a vehicle here" };
  }

  const pick = <K extends keyof VehicleFields>(k: K, current: string | null) =>
    args[k] !== undefined ? clean(args[k] as string | null) : current;

  const after = {
    year: pick("year", before.year),
    make: pick("make", before.make),
    model: pick("model", before.model),
    color: pick("color", before.color),
    plate: pick("plate", before.plate),
    vin,
    tire_size: pick("tireSize", before.tire_size),
    notes: pick("notes", before.notes),
  };

  const db = getDb();
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE vehicles
          SET year = ?, make = ?, model = ?, color = ?, plate = ?, vin = ?, tire_size = ?,
              notes = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      after.year, after.make, after.model, after.color,
      after.plate, after.vin, after.tire_size, after.notes,
      nowLocalIso(),
      vehicleId,
    );
    logActorAudit(
      { type: "customer", customerId: session.customerId, name: session.name },
      {
        action: "vehicle.update",
        targetType: "vehicle",
        targetId: vehicleId,
        details: { via: "directory", company: session.name },
        before: {
          year: before.year, make: before.make, model: before.model, color: before.color,
          plate: before.plate, vin: before.vin, tire_size: before.tire_size, notes: before.notes,
        },
        after,
      },
    );
  });
  write();
  return { ok: true };
}
