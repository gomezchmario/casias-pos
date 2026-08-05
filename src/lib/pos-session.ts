import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { getSetting } from "./settings";
import { isValidPinFormat } from "./pin";
import { isPosRole, type PosRole } from "./roles";
import { localIsoToDate, nowLocalIso, toLocalIso } from "./time";

export const POS_COOKIE = "casias_pos";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;

export type PosUser = {
  employeeId: number;
  name: string;
  role: PosRole;
};

type EmployeeAuthRow = {
  id: number;
  name: string;
  pin_hash: string;
  pos_role: string;
  active: number;
  pos_locked_until: string | null;
  pos_failed_attempts: number;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function plusSeconds(seconds: number): string {
  const d = new Date();
  d.setSeconds(d.getSeconds() + seconds);
  return toLocalIso(d);
}

/**
 * How long the register may sit untouched before it locks.
 *
 * Exported because the browser needs the same number: the server can only
 * measure the gap between REQUESTS, and a request is not the same thing as a
 * person. Only the client can tell the difference between a register somebody
 * is working at and a tab left open on an empty counter.
 */
export function posIdleSeconds(): number {
  const n = Number(getSetting("pos_idle_lock_seconds"));
  return Number.isFinite(n) && n > 0 ? n : 900;
}

/** Employees available on the login screen. PIN hashes never leave the server. */
export function listPosLoginEmployees(): { id: number; name: string; role: PosRole }[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, pos_role FROM employees WHERE active = 1 ORDER BY name")
    .all() as { id: number; name: string; pos_role: string }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: isPosRole(r.pos_role) ? r.pos_role : "technician",
  }));
}

/**
 * Verify a PIN for one specific employee. The employee is picked by name first,
 * so this is a single bcrypt compare — the time clock's scan-every-employee
 * approach is far too slow to sit in front of a register.
 */
export function verifyPin(
  employeeId: number,
  pin: string,
): { ok: true; user: PosUser } | { ok: false; error: string } {
  if (!isValidPinFormat(pin)) return { ok: false, error: "PIN must be 4 digits" };

  const db = getDb();
  const emp = db
    .prepare(
      `SELECT id, name, pin_hash, pos_role, active, pos_locked_until, pos_failed_attempts
       FROM employees WHERE id = ?`,
    )
    .get(employeeId) as EmployeeAuthRow | undefined;

  if (!emp || !emp.active) return { ok: false, error: "Unknown employee" };

  if (emp.pos_locked_until && localIsoToDate(emp.pos_locked_until) > new Date()) {
    return { ok: false, error: "Too many wrong PINs. Try again in a few minutes." };
  }

  if (!bcrypt.compareSync(pin, emp.pin_hash)) {
    const attempts = emp.pos_failed_attempts + 1;
    const lockUntil =
      attempts >= MAX_FAILED_ATTEMPTS ? plusSeconds(LOCKOUT_MINUTES * 60) : null;
    db.prepare(
      "UPDATE employees SET pos_failed_attempts = ?, pos_locked_until = ? WHERE id = ?",
    ).run(lockUntil ? 0 : attempts, lockUntil, emp.id);
    return { ok: false, error: "Incorrect PIN" };
  }

  db.prepare(
    "UPDATE employees SET pos_failed_attempts = 0, pos_locked_until = NULL WHERE id = ?",
  ).run(emp.id);

  return {
    ok: true,
    user: {
      employeeId: emp.id,
      name: emp.name,
      role: isPosRole(emp.pos_role) ? emp.pos_role : "technician",
    },
  };
}

/**
 * Verify a PIN without being told who it belongs to, for the time-clock kiosk:
 * an employee punches in and, if their role allows it, gets a register button
 * without typing anything twice.
 *
 * This scans every active employee's hash, which is exactly what the kiosk
 * already does to identify a check-in — one extra compare on a button press is
 * fine. The register's own login is still employee-first for speed.
 */
export function verifyKioskPin(
  pin: string,
): { ok: true; user: PosUser } | { ok: false; error: string } {
  if (!isValidPinFormat(pin)) return { ok: false, error: "PIN must be 4 digits" };

  const rows = getDb()
    .prepare("SELECT id, name, pin_hash, pos_role FROM employees WHERE active = 1")
    .all() as { id: number; name: string; pin_hash: string; pos_role: string }[];

  for (const emp of rows) {
    if (!bcrypt.compareSync(pin, emp.pin_hash)) continue;
    return {
      ok: true,
      user: {
        employeeId: emp.id,
        name: emp.name,
        role: isPosRole(emp.pos_role) ? emp.pos_role : "technician",
      },
    };
  }
  return { ok: false, error: "PIN not recognized" };
}

export async function createPosSession(user: PosUser): Promise<void> {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("hex");
  const now = nowLocalIso();
  db.prepare(
    `INSERT INTO pos_sessions
       (token_hash, employee_id, role_snapshot, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(hashToken(token), user.employeeId, user.role, now, now, plusSeconds(posIdleSeconds()));

  const store = await cookies();
  store.set(POS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function destroyPosSession(): Promise<PosUser | null> {
  const store = await cookies();
  const token = store.get(POS_COOKIE)?.value;
  const user = await getPosUser();
  if (token) {
    getDb()
      .prepare("UPDATE pos_sessions SET revoked_at = ? WHERE token_hash = ?")
      .run(nowLocalIso(), hashToken(token));
  }
  store.delete(POS_COOKIE);
  return user;
}

/**
 * Resolve the current POS user, sliding the expiry forward.
 *
 * This is the BACKSTOP for an abandoned register, not the idle lock itself. It
 * cannot be, because it measures the gap between requests and the browser can
 * make requests on its own: the shell used to poll this endpoint on a timer,
 * every poll slid the expiry another quarter hour, and a tab left open on an
 * empty counter therefore stayed signed in indefinitely. Sessions were observed
 * alive 22 minutes untouched against a 15 minute setting.
 *
 * The lock proper now lives in `PosShell`, which watches for actual keys and
 * taps and revokes the session itself. This still expires a session whose
 * browser is gone — closed tab, killed process, pulled power — where nothing
 * client-side is left to do it.
 */
export async function getPosUser(): Promise<PosUser | null> {
  const store = await cookies();
  const token = store.get(POS_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const now = nowLocalIso();
  const row = db
    .prepare(
      `SELECT s.id, s.employee_id, e.name, e.pos_role, e.active
       FROM pos_sessions s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(hashToken(token), now) as
    | { id: number; employee_id: number; name: string; pos_role: string; active: number }
    | undefined;

  if (!row || !row.active) return null;

  db.prepare("UPDATE pos_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(
    now,
    plusSeconds(posIdleSeconds()),
    row.id,
  );

  return {
    employeeId: row.employee_id,
    name: row.name,
    // Role is read live, not from the snapshot: a demotion takes effect at once.
    role: isPosRole(row.pos_role) ? row.pos_role : "technician",
  };
}

export function purgeExpiredPosSessions(): void {
  // Compared as text, so the cutoff has to be in the same local-ISO shape the
  // rows are stored in — SQLite's datetime() uses a space where we use a 'T'.
  getDb()
    .prepare("DELETE FROM pos_sessions WHERE expires_at < ?")
    .run(plusSeconds(-30 * 24 * 60 * 60));
}
