import { getSetting } from "./settings";

/**
 * The geofence around the shop, and the one place that decides a punch.
 *
 * WHAT THIS IS FOR. The time clock is reachable from anywhere the app is, so
 * without this a shift can be started from bed. The fence makes the ordinary
 * way of cheating harder than driving in. It is not proof of presence: a
 * browser's location can be faked from the developer tools in half a minute,
 * and an Android phone can lie about it wholesale. Nothing here should ever be
 * described to anybody as proof that a person was at the shop.
 *
 * WHAT DECIDES. Two ways past the fence, and only two:
 *   - the device is one the shop enrolled, in which case no location is asked
 *     for at all — see devices.ts;
 *   - the reading the browser gave is inside the radius.
 * A shop with no fence set lets everything through, which is the state every
 * install starts in.
 *
 * THE CHECK IS ON THE SERVER, and has to be. The coordinates arrive from a
 * browser and are therefore a claim, not a fact; a client that decided for
 * itself whether it was in range would be asking the suspect for the verdict.
 */

/** Metres between two points on the earth. Haversine, which is plenty here. */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type Fence = { lat: number; lng: number; radiusM: number } | null;

/** The fence as it is set today, or null when the shop has not set one. */
export function currentFence(): Fence {
  const lat = Number(getSetting("timeclock_fence_lat"));
  const lng = Number(getSetting("timeclock_fence_lng"));
  const radiusM = Number(getSetting("timeclock_fence_radius_m"));
  // A half-set fence is no fence. Coordinates that do not parse, or a zero
  // radius, would otherwise refuse every punch in the shop — the failure mode
  // that empties a payroll, so it fails open and loudly instead.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null;
  return { lat, lng, radiusM };
}

/** Is the clock closed to everything but enrolled devices? */
export function trustedOnly(): boolean {
  return getSetting("timeclock_trusted_only") === "1";
}

/** What happened when this punch met the fence. */
export type FenceVerdict =
  | { ok: true; verdict: "off" | "trusted" | "inside"; metres?: number }
  | {
      ok: false;
      reason: "no_location" | "too_far" | "untrusted_device";
      metres?: number;
      radiusM?: number;
    };

/**
 * Judge one punch.
 *
 * `trusted` wins before anything else is looked at, which is the owner's rule
 * stated plainly: an enrolled device does not need a location and is never
 * asked for one. The shop's own counter tablet keeps working when the roof
 * blocks GPS, and the register PC — which has no GPS at all and would guess
 * its position off wi-fi — never gets to guess.
 *
 * The accuracy figure is deliberately NOT used to reject anything. A phone
 * reporting fifty metres of uncertainty while standing in the bay is normal
 * indoors, and refusing it would lock out the honest case this exists to
 * serve. It is recorded so the fence can be judged later, not enforced on.
 */
export function judgePunch(args: {
  trusted: boolean;
  lat?: number | null;
  lng?: number | null;
}): FenceVerdict {
  if (args.trusted) return { ok: true, verdict: "trusted" };

  /*
    Trusted-only closes the door before the fence is consulted, because it is
    a stricter rule and not an additional one: where it is on, being in the lot
    buys nothing and saying so would be misleading. This is the one refusal
    here that no location can satisfy, which is why it is worth a message of
    its own rather than a distance the person cannot act on.
  */
  if (trustedOnly()) return { ok: false, reason: "untrusted_device" };

  const fence = currentFence();
  if (!fence) return { ok: true, verdict: "off" };

  const { lat, lng } = args;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  )
    return { ok: false, reason: "no_location", radiusM: fence.radiusM };

  const metres = metresBetween({ lat, lng }, fence);
  return metres <= fence.radiusM
    ? { ok: true, verdict: "inside", metres }
    : { ok: false, reason: "too_far", metres, radiusM: fence.radiusM };
}

/** "1.2 km" / "340 m", for a message somebody reads once and acts on. */
export function metresWords(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
