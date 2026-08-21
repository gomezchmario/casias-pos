import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { createPosSession, verifyKioskPin } from "@/lib/pos-session";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/roles";
import { isTrustedDevice } from "@/lib/devices";
import { judgePunch, metresWords } from "@/lib/fence";

/**
 * Open the register straight from the time-clock kiosk. The employee has
 * already typed their PIN to punch in, so this trades that same PIN for a POS
 * session instead of making them sign in a second time on another screen.
 *
 * The role gate is here rather than in the UI: hiding the button from a
 * technician is a courtesy, refusing the session is the actual control.
 *
 * THE SAME FENCE AS THE CLOCK, and it was a hole until it was. The clock
 * refused a punch from a couch while this door, one endpoint over, traded the
 * same four digits for the whole register from anywhere the tunnel reaches.
 * One rule for both doors now, decided by the same judge: an enrolled device
 * walks in without being asked where it is, anything else has to be standing
 * at the shop. Same limits too — a browser's location is a claim, not a fact,
 * so this keeps the ordinary way in harder than driving in, and is not proof
 * of anything.
 */
export async function POST(req: Request) {
  let body: { pin?: string; lat?: number | null; lng?: number | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const pin = String(body.pin ?? "");
  const result = verifyKioskPin(pin);
  if (!result.ok) {
    logAudit({
      actorType: "system",
      action: "pos.login_failed",
      details: { reason: result.error, via: "kiosk" },
    });
    return jsonError(result.error, 401);
  }

  /*
    After the PIN, before the session. Judged after the PIN on purpose, so a
    mistyped PIN reads as a mistyped PIN and not as a lecture about location;
    judged before the session because that is the entire point.
  */
  const trusted = await isTrustedDevice();
  const fence = judgePunch({ trusted, lat: body.lat, lng: body.lng });
  if (!fence.ok) {
    logAudit({
      actorType: "employee",
      employeeId: result.user.employeeId,
      employeeName: result.user.name,
      employeeRole: result.user.role,
      action: "pos.login_failed",
      details: { reason: `fence: ${fence.reason}`, via: "kiosk", metres: fence.metres },
    });
    return NextResponse.json(
      {
        // The reason travels beside the message so the lock screen can tell
        // "needs a location" apart from "will never get in" and only chase
        // the browser for coordinates in the one case they would help.
        fence: fence.reason,
        error:
          fence.reason === "untrusted_device"
            ? "This device cannot open the register. Use a shop device, or ask to have this one trusted."
            : fence.reason === "no_location"
              ? "Turn on location for this page to open the register from your own device."
              : `You are ${metresWords(fence.metres ?? 0)} from the shop. The register only opens at the shop.`,
      },
      { status: 403 },
    );
  }

  /*
    A VIEWER GETS IN WITHOUT BEING ABLE TO RING.

    The gate asked whether the account can ring a sale, which is the right
    question for every role that existed when it was written and exactly the
    wrong one for this account: a viewer cannot ring anything by design, so it
    would have been refused at the door and the role would have been unusable
    without anybody noticing why. Getting in is not a permission to do
    anything — every screen it reaches still refuses it — it is only permission
    to look.
  */
  if (!can(result.user.role, "ringSale") && result.user.role !== "viewer") {
    logAudit({
      actorType: "employee",
      employeeId: result.user.employeeId,
      employeeName: result.user.name,
      employeeRole: result.user.role,
      action: "pos.login_failed",
      details: { reason: "role cannot ring sales", via: "kiosk" },
    });
    return jsonError("Your account can't open the register", 403);
  }

  await createPosSession(result.user);
  logAudit({
    actorType: "employee",
    employeeId: result.user.employeeId,
    employeeName: result.user.name,
    employeeRole: result.user.role,
    action: "pos.login",
    // How the door opened — trusted device, inside the fence, or no fence
    // set — so a session can be read back the way a punch can.
    details: { via: "kiosk", fence: fence.verdict },
  });

  return NextResponse.json({ ok: true, user: result.user });
}
