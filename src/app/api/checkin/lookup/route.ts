import { NextRequest, NextResponse } from "next/server";
import { findEmployeeByPin, isValidPinFormat } from "@/lib/pin";
import { getEmployeeState } from "@/lib/employees";
import { maybeAutoClose } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { can, isPosRole } from "@/lib/roles";

export async function POST(req: NextRequest) {
  maybeAutoClose();

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
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
    return NextResponse.json(
      { ok: false, error: "PIN not recognized" },
      { status: 404 },
    );
  }

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
