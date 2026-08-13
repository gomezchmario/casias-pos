import { NextRequest, NextResponse } from "next/server";
import { findEmployeeByPin, isValidPinFormat } from "@/lib/pin";
import { getEmployeeState } from "@/lib/employees";
import { createEntry, type EntryType } from "@/lib/entries";
import { saveBase64Photo } from "@/lib/photos";
import { nowLocalIso } from "@/lib/time";
import { maybeAutoClose } from "@/lib/api-helpers";

const ALLOWED_NEXT: Record<string, EntryType[]> = {
  checked_out: ["check_in"],
  checked_in: ["check_out", "break_start"],
  on_break: ["break_end"],
};

export async function POST(req: NextRequest) {
  maybeAutoClose();

  let body: { pin?: string; action?: string; photoData?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const pin = body.pin ?? "";
  const action = body.action as EntryType | undefined;

  if (!isValidPinFormat(pin)) {
    return NextResponse.json(
      { ok: false, error: "PIN must be 4 digits" },
      { status: 400 },
    );
  }
  if (!action || !["check_in", "check_out", "break_start", "break_end"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "Invalid action" },
      { status: 400 },
    );
  }

  const employee = findEmployeeByPin(pin);
  if (!employee) {
    // Don't save photo for invalid PINs.
    return NextResponse.json(
      { ok: false, error: "PIN not recognized" },
      { status: 404 },
    );
  }

  /*
    A viewer does not work shifts.

    This route never passes through `requirePos` — it is the time clock, and it
    takes a PIN rather than a session — so the read-only rule has to be stated
    here as well. Punching a clock writes a row like anything else, and an
    account whose whole promise is that nothing it does is saved must not be
    able to put itself on the payroll's hours.
  */
  if (employee.pos_role === "viewer") {
    return NextResponse.json(
      {
        ok: false,
        error: "This account can look at everything and change nothing — including the clock.",
      },
      { status: 403 },
    );
  }

  const stateInfo = getEmployeeState(employee.id);
  const allowed = ALLOWED_NEXT[stateInfo.state] ?? [];
  if (!allowed.includes(action)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot ${action.replace("_", " ")} — currently ${stateInfo.state.replace("_", " ")}`,
      },
      { status: 409 },
    );
  }

  // Save photo if provided. Flag the entry if no photo was provided.
  let photoPath: string | null = null;
  let flagged = false;
  let flagReason: string | null = null;
  if (body.photoData) {
    photoPath = saveBase64Photo(employee.id, body.photoData);
    if (!photoPath) {
      flagged = true;
      flagReason = "Photo upload failed";
    }
  } else {
    flagged = true;
    flagReason = "No photo captured (camera unavailable or denied)";
  }

  const timestamp = nowLocalIso();
  createEntry({
    employeeId: employee.id,
    type: action,
    photoPath,
    flagged,
    flagReason,
    timestamp,
  });

  return NextResponse.json({
    ok: true,
    employee: { id: employee.id, name: employee.name },
    action,
    timestamp,
    flagged,
  });
}
