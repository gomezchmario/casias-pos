import { cookies } from "next/headers";
import crypto from "node:crypto";

/**
 * Five wrong PINs in a row, then five minutes off.
 *
 * The time clock takes a bare four-digit PIN and looks it up against every
 * employee — which means, unthrottled, ten thousand guesses is the whole
 * building. That was survivable while the only way to reach it was to stand in
 * the shop; it stops being survivable the moment the address is reachable from
 * anywhere, and it was worth closing before then either way.
 *
 * IN A ROW is the important half. The counter resets on any correct PIN, so a
 * normal day never comes near it: five consecutive misses on one device is not
 * somebody fumbling, it is somebody trying combinations. The numbers are the
 * same five-and-five the POS login already uses per employee — see
 * `MAX_FAILED_ATTEMPTS` in pos-session.ts — because two different lockout
 * rules in one shop is one rule nobody can remember.
 *
 * COUNTED PER DEVICE, not per employee, because a wrong PIN names nobody: there
 * is no account to lock. The device is identified by a cookie set on first
 * contact, which is exactly as strong as it needs to be — this exists to stop
 * somebody standing at the kiosk working through the numbers, and somebody with
 * the developer tools open is a different problem with a different answer.
 *
 * Held in memory rather than a table. The register is one process on one
 * machine, a lockout is five minutes long, and the failure mode of a restart is
 * that a would-be guesser gets their five attempts back — which costs nothing
 * against the cost of a write on every mistyped PIN.
 */

export const MAX_PIN_FAILS = 5;
export const PIN_LOCKOUT_MINUTES = 5;

const KIOSK_COOKIE = "casias_kiosk";

type Strike = { fails: number; until: number };
const strikes = new Map<string, Strike>();

/** Forget devices nobody has touched in an hour, so the map cannot grow. */
function sweep(now: number) {
  if (strikes.size < 500) return;
  for (const [k, v] of strikes) if (v.until < now - 3_600_000) strikes.delete(k);
}

/**
 * Who is typing, as far as this can tell.
 *
 * Sets the cookie when it is missing, so the first wrong PIN from a device is
 * already being counted rather than the first one after it.
 */
export async function kioskDeviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(KIOSK_COOKIE)?.value;
  if (existing) return existing;

  const id = crypto.randomBytes(16).toString("hex");
  jar.set(KIOSK_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Long-lived: this is a shop tablet that stays on the wall, and a cookie
    // that expired weekly would hand back the attempts every Monday.
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return id;
}

export type PinGate = { blocked: false } | { blocked: true; secondsLeft: number };

/** Is this device serving a lockout right now? */
export function pinGate(deviceId: string): PinGate {
  const now = Date.now();
  const s = strikes.get(deviceId);
  if (!s || s.until <= now) return { blocked: false };
  return { blocked: true, secondsLeft: Math.ceil((s.until - now) / 1000) };
}

/**
 * A wrong PIN. Returns the gate as it stands AFTER counting this one, so the
 * fifth failure locks immediately rather than on the sixth attempt.
 */
export function notePinFailure(deviceId: string): PinGate {
  const now = Date.now();
  sweep(now);
  const s = strikes.get(deviceId) ?? { fails: 0, until: 0 };
  s.fails += 1;
  if (s.fails >= MAX_PIN_FAILS) {
    s.until = now + PIN_LOCKOUT_MINUTES * 60_000;
    s.fails = 0; // The lockout replaces the count; serving it starts fresh.
  }
  strikes.set(deviceId, s);
  return pinGate(deviceId);
}

/** A correct PIN. The run is broken, so the count goes back to nothing. */
export function clearPinFailures(deviceId: string): void {
  strikes.delete(deviceId);
}
