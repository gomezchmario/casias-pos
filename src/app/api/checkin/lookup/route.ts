import { NextRequest, NextResponse } from "next/server";
import { findEmployeeByPin, isValidPinFormat } from "@/lib/pin";
import { getEmployeeState } from "@/lib/employees";
import { maybeAutoClose } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { can, isPosRole } from "@/lib/roles";
import {
  clearPinFailures,
  kioskDeviceId,
  notePinFailure,
  pinGate,
  PIN_LOCKOUT_MINUTES,
} from "@/lib/pin-throttle";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  maybeAutoClose();

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  /*
    Five wrong in a row buys five minutes off — see `pin-throttle`.

    Checked before the PIN is even looked at, so a locked-out device gets the
    same answer however fast it asks, and the bcrypt comparison against every
    employee is not run on its behalf either.
  */
  const device = await kioskDeviceId();
  const gate = pinGate(device);
  if (gate.blocked) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many wrong PINs. Try again in ${Math.ceil(gate.secondsLeft / 60)} minute${gate.secondsLeft > 60 ? "s" : ""}.`,
        lockedForSeconds: gate.secondsLeft,
      },
      { status: 429 },
    );
  }

  const pin = body.pin ?? "";
  if (!isValidPinFormat(pin)) {
    return NextResponse.json(
      { ok: false, error: "PIN must be 4 digits" },
      { status: 400 },
    );
  }

  const employee = findEmployeeByPin(pin);
  if (!employee) {
    const after = notePinFailure(device);
    if (after.blocked) {
      // Worth a row in the log: five wrong in a row on one device is either a
      // PIN somebody has genuinely forgotten or somebody working through the
      // numbers, and both are things an owner would want to be able to look up
      // afterwards rather than hear about.
      logAudit({
        actorType: "system",
        action: "pos.login_failed",
        details: {
          via: "kiosk",
          reason: "locked out after five wrong PINs",
          minutes: PIN_LOCKOUT_MINUTES,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: `Too many wrong PINs. Try again in ${PIN_LOCKOUT_MINUTES} minutes.`,
          lockedForSeconds: after.secondsLeft,
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "PIN not recognized" },
      { status: 404 },
    );
  }

  // A right answer breaks the run. The count is about consecutive misses, so
  // one correct PIN puts the device back to a clean five.
  clearPinFailures(device);

  const stateInfo = getEmployeeState(employee.id);

  let actions: ("check_in" | "check_out" | "break_start" | "break_end")[];
  switch (stateInfo.state) {
    case "checked_out":
      actions = ["check_in"];
      break;
    case "checked_in":
      actions = ["check_out", "break_start"];
      break;
    case "on_break":
      actions = ["break_end"];
      break;
  }

  // Whether to offer the register alongside the clock-in buttons. A mechanic
  // sees nothing but check in / check out; the session endpoint re-checks this
  // regardless, so hiding the button is presentation, not the control.
  const posRoleRaw = (
    getDb().prepare("SELECT pos_role FROM employees WHERE id = ?").get(employee.id) as
      | { pos_role: string }
      | undefined
  )?.pos_role;
  const posRole = isPosRole(posRoleRaw) ? posRoleRaw : "technician";

  return NextResponse.json({
    ok: true,
    employee: {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      posRole,
      canRegister: can(posRole, "ringSale"),
    },
    state: stateInfo.state,
    lastEventAt: stateInfo.lastEventAt,
    lastEventType: stateInfo.lastEventType,
    actions,
  });
}
