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

  /*
    A viewer is offered no clock buttons at all.

    The submit endpoint has always refused this account — punching a clock
    writes a row, and an account whose whole promise is that nothing it does is
    saved must not put itself on the payroll's hours. But the kiosk was still
    drawing a Check In button above that refusal, so the promise was kept by a
    403 that arrived only after somebody had pressed it. A button that cannot
    work is worse than no button: it is the screen telling you something the
    server is about to deny.
  */
  const clocks = posRole !== "viewer";

  return NextResponse.json({
    ok: true,
    employee: {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      posRole,
      // browseRegister, not ringSale. The question this button asks is "is
      // there anything for you through here", and for the read-only account
      // the answer is yes — it may open every screen and write to none of
      // them. Asking ringSale hid the register from the one account whose
      // entire purpose is looking at it.
      canRegister: can(posRole, "browseRegister"),
    },
    state: stateInfo.state,
    lastEventAt: stateInfo.lastEventAt,
    lastEventType: stateInfo.lastEventType,
    actions: clocks ? actions : [],
    /*
      Said out loud rather than leaving an empty space where the buttons were.
      Somebody who types a PIN and gets a card with nothing on it assumes the
      screen is broken; this is a real account behaving exactly as intended,
      and one line is the difference between those two readings.
    */
    noClockReason: clocks
      ? null
      : "This account is for looking at the shop, so it does not clock in or out.",
  });
}
