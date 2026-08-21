import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { curfewConfig } from "@/lib/curfew";
import { getDb } from "@/lib/db";
import { listDevices } from "@/lib/devices";
import { getSetting, setSetting } from "@/lib/settings";
import { nowLocalIso } from "@/lib/time";

/**
 * The fence around the shop: read it, set it from where you are standing, or
 * take it down.
 *
 * SET FROM A READING, NOT FROM AN ADDRESS. The coordinates posted here come
 * from the browser's own GPS on a device physically at the shop, because a
 * geocoded street address lands on the road centreline or the wrong end of the
 * lot and a fence built on one is wrong before it is switched on. The page
 * that calls this says as much to whoever presses the button.
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return NextResponse.json({
    lat: getSetting("timeclock_fence_lat"),
    lng: getSetting("timeclock_fence_lng"),
    radiusM: getSetting("timeclock_fence_radius_m"),
    setBy: getSetting("timeclock_fence_set_by"),
    setAt: getSetting("timeclock_fence_set_at"),
    trustedOnly: getSetting("timeclock_trusted_only") === "1",
    // The register's night rule rides on the fence page — both are answers
    // to "who can open what, and under what condition" — so it rides on the
    // fence's own read too.
    curfew: curfewConfig(),
    // Everybody the allow list could name. Owners are absent on purpose:
    // the rule never applies to them, and a checkbox that does nothing is a
    // lie with a tick in it.
    curfewCandidates: getDb()
      .prepare(
        `SELECT id, name, COALESCE(pos_role,'') AS role
           FROM employees
          WHERE active = 1 AND COALESCE(pos_role,'') NOT IN ('owner')
          ORDER BY name`,
      )
      .all(),
  });
}

/**
 * Close the clock to everything but enrolled devices, or open it again.
 *
 * REFUSED WHILE NOTHING IS TRUSTED, and that guard is the only reason this is
 * a separate handler rather than a field on the one below. Switching it on
 * with an empty device list locks every person in the building out of the
 * clock, and the way back is a database edit by somebody who knows what a
 * settings table is — at seven in the morning, with technicians waiting.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: { trustedOnly?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const on = body.trustedOnly === true;
  if (on && listDevices().filter((d) => !d.revoked_at).length === 0)
    return NextResponse.json(
      {
        error:
          "Trust at least one device first — with none trusted, nobody would be able to clock in.",
      },
      { status: 400 },
    );

  setSetting("timeclock_trusted_only", on ? "1" : "0");
  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: on ? "fence.trusted_only_on" : "fence.trusted_only_off",
    targetType: "settings",
  });
  return NextResponse.json({ ok: true, trustedOnly: on });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: { lat?: number; lng?: number; radiusM?: number; clear?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.clear) {
    setSetting("timeclock_fence_lat", "");
    setSetting("timeclock_fence_lng", "");
    setSetting("timeclock_fence_set_by", "");
    setSetting("timeclock_fence_set_at", "");
    logAudit({
      adminId: auth.admin.adminId,
      adminUsername: auth.admin.username,
      action: "fence.cleared",
      targetType: "settings",
    });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusM = Math.round(Number(body.radiusM));
  // Refused rather than clamped. A fence is the difference between a shift
  // starting and somebody standing in the lot unable to clock in, and a
  // silently corrected coordinate is a fence nobody can reason about.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90)
    return NextResponse.json({ error: "That latitude is not a place" }, { status: 400 });
  if (!Number.isFinite(lng) || lng < -180 || lng > 180)
    return NextResponse.json({ error: "That longitude is not a place" }, { status: 400 });
  if (!Number.isFinite(radiusM) || radiusM < 25 || radiusM > 5000)
    return NextResponse.json(
      { error: "Pick a radius between 25 and 5000 metres" },
      { status: 400 },
    );

  const before = {
    lat: getSetting("timeclock_fence_lat"),
    lng: getSetting("timeclock_fence_lng"),
    radiusM: getSetting("timeclock_fence_radius_m"),
  };

  setSetting("timeclock_fence_lat", String(lat));
  setSetting("timeclock_fence_lng", String(lng));
  setSetting("timeclock_fence_radius_m", String(radiusM));
  setSetting("timeclock_fence_set_by", auth.admin.username);
  setSetting("timeclock_fence_set_at", nowLocalIso());

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "fence.set",
    targetType: "settings",
    before,
    after: { lat: String(lat), lng: String(lng), radiusM: String(radiusM) },
  });

  return NextResponse.json({ ok: true, lat, lng, radiusM });
}
