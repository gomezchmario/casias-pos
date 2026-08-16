import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { nowLocalIso } from "./time";

/**
 * Devices the shop trusts to punch the clock without proving where they are.
 *
 * See `migrations/050_trusted_devices.sql` for the shape and the reasoning.
 * Modelled closely on `pos-session.ts`, deliberately: same hashed-token rule,
 * same cookie handling, so there is one pattern in this codebase for "a secret
 * a browser carries" rather than two that drift.
 *
 * The cookie is long-lived on purpose — two years. It marks a physical object
 * the shop has decided about, not a person's session, and a device that had to
 * be re-trusted every fortnight would be re-trusted by whoever was nearest,
 * which is how a control becomes a ritual.
 */

export const DEVICE_COOKIE = "casias_device";

/** Two years, in seconds. */
const DEVICE_MAX_AGE = 60 * 60 * 24 * 730;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type TrustedDevice = {
  id: number;
  label: string;
  user_agent: string | null;
  first_ip: string | null;
  enrolled_by_name: string | null;
  enrolled_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoked_by_name: string | null;
};

/**
 * Trust the browser making this request.
 *
 * Called from the admin panel, so the person pressing it has already proved
 * more than any PIN could. Re-enrolling a browser that already holds a live
 * cookie mints a fresh one and leaves the old row revoked, rather than
 * quietly reusing it — pressing the button twice should not leave two live
 * secrets for one device, and the second press is usually somebody making
 * sure.
 */
export async function enrollDevice(args: {
  label: string;
  byName: string;
  byId?: number | null;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<{ id: number }> {
  await revokeCurrentDevice(args.byName);

  const token = crypto.randomBytes(32).toString("hex");
  const now = nowLocalIso();
  const info = getDb()
    .prepare(
      `INSERT INTO trusted_devices
         (token_hash, label, user_agent, first_ip, enrolled_by, enrolled_by_name, enrolled_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hashToken(token),
      args.label.trim().slice(0, 60),
      args.userAgent?.slice(0, 300) ?? null,
      args.ip ?? null,
      args.byId ?? null,
      args.byName,
      now,
      now,
    );

  const store = await cookies();
  store.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  });

  return { id: Number(info.lastInsertRowid) };
}

/**
 * Is the browser making this request a trusted device?
 *
 * Touches `last_seen_at` as it goes, which is what makes the admin list worth
 * reading: a device nobody has used since March is a device to revoke.
 *
 * Never throws. This is called on the punch path, and a trusted-device lookup
 * that failed loudly would take the whole time clock down with it; a device
 * that cannot be confirmed is simply not trusted, and then the fence decides.
 */
export async function isTrustedDevice(): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(DEVICE_COOKIE)?.value;
    if (!token) return false;
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id FROM trusted_devices WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .get(hashToken(token)) as { id: number } | undefined;
    if (!row) return false;
    db.prepare(`UPDATE trusted_devices SET last_seen_at = ? WHERE id = ?`).run(
      nowLocalIso(),
      row.id,
    );
    return true;
  } catch {
    return false;
  }
}

/** Every device, live ones first, most recently seen at the top. */
export function listDevices(): TrustedDevice[] {
  return getDb()
    .prepare(
      `SELECT id, label, user_agent, first_ip, enrolled_by_name, enrolled_at,
              last_seen_at, revoked_at, revoked_by_name
         FROM trusted_devices
     ORDER BY revoked_at IS NOT NULL, COALESCE(last_seen_at, enrolled_at) DESC`,
    )
    .all() as TrustedDevice[];
}

/** The "left it in a taxi" button. */
export function revokeDevice(id: number, byName: string): boolean {
  const info = getDb()
    .prepare(
      `UPDATE trusted_devices SET revoked_at = ?, revoked_by_name = ?
        WHERE id = ? AND revoked_at IS NULL`,
    )
    .run(nowLocalIso(), byName, id);
  return info.changes > 0;
}

/** Retire whatever this browser is currently carrying, if anything. */
async function revokeCurrentDevice(byName: string): Promise<void> {
  const store = await cookies();
  const token = store.get(DEVICE_COOKIE)?.value;
  if (!token) return;
  getDb()
    .prepare(
      `UPDATE trusted_devices SET revoked_at = ?, revoked_by_name = ?
        WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(nowLocalIso(), byName, hashToken(token));
}

/** Is the device holding this browser's cookie still trusted, for the UI. */
export async function currentDeviceRow(): Promise<TrustedDevice | null> {
  const store = await cookies();
  const token = store.get(DEVICE_COOKIE)?.value;
  if (!token) return null;
  return (
    (getDb()
      .prepare(
        `SELECT id, label, user_agent, first_ip, enrolled_by_name, enrolled_at,
                last_seen_at, revoked_at, revoked_by_name
           FROM trusted_devices WHERE token_hash = ?`,
      )
      .get(hashToken(token)) as TrustedDevice | undefined) ?? null
  );
}
