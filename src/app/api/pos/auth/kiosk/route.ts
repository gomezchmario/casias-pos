import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-helpers";
import { createPosSession, verifyKioskPin } from "@/lib/pos-session";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/roles";

/**
 * Open the register straight from the time-clock kiosk. The employee has
 * already typed their PIN to punch in, so this trades that same PIN for a POS
 * session instead of making them sign in a second time on another screen.
 *
 * The role gate is here rather than in the UI: hiding the button from a
 * technician is a courtesy, refusing the session is the actual control.
 */
export async function POST(req: Request) {
  let body: { pin?: string };
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
    details: { via: "kiosk" },
  });

  return NextResponse.json({ ok: true, user: result.user });
}
