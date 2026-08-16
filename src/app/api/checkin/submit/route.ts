import { NextRequest, NextResponse } from "next/server";
import { findEmployeeByPin, isValidPinFormat } from "@/lib/pin";
import { getEmployeeState } from "@/lib/employees";
import { createEntry, type EntryType } from "@/lib/entries";
import { saveBase64Photo } from "@/lib/photos";
import { nowLocalIso } from "@/lib/time";
import { maybeAutoClose } from "@/lib/api-helpers";
import { isTrustedDevice } from "@/lib/devices";
import { judgePunch, metresWords } from "@/lib/fence";

const ALLOWED_NEXT: Record<string, EntryType[]> = {
  checked_out: ["check_in"],
  checked_in: ["check_out", "break_start"],
  on_break: ["break_end"],
};

export async function POST(req: NextRequest) {
  maybeAutoClose();

  let body: {
    pin?: string;
    action?: string;
    photoData?: string | null;
    // The browser's own reading. A claim, not a fact — judged on the server,
    // by `judgePunch`, because asking the client whether it is allowed in is
    // asking the suspect for the verdict.
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
  };
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

  /*
    THE FENCE, JUDGED BEFORE ANYTHING IS WRITTEN.

    Ordered deliberately after the PIN and the state check but before the photo
    is saved: a refused punch should not leave a photograph on disk, and it
    should not leave a row anywhere. The employee is told plainly what happened
    — being vague here does not protect anything, since anyone standing in the
    shop can see whether they are in the shop — and told what to do about it.

    A trusted device never reaches the distance test at all. That is the
    owner's rule: enrolled devices bypass the fence entirely; everybody else
    has to be standing here.
  */
  const trusted = await isTrustedDevice();
  const fence = judgePunch({ trusted, lat: body.lat, lng: body.lng });
  if (!fence.ok) {
    return NextResponse.json(
      {
        ok: false,
        fence: fence.reason,
        error:
          fence.reason === "untrusted_device"
            ? "This device cannot punch the clock. Use the shop's tablet, or ask a manager to set this one up."
            : fence.reason === "no_location"
              ? "Turn on location for this page to clock in, or ask a manager to trust this device."
              : `You are ${metresWords(fence.metres ?? 0)} from the shop. Clock in when you get here.`,
      },
      { status: 403 },
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
    // Kept on the allowed punch too, not only the refused ones — a record that
    // remembers nothing but failures cannot answer "was Jose really here on
    // the 3rd", and cannot be used to tell whether the fence is the right
    // size. See migration 049.
    lat: fence.verdict === "trusted" ? null : body.lat,
    lng: fence.verdict === "trusted" ? null : body.lng,
    accuracyM: fence.verdict === "trusted" ? null : body.accuracy,
    fenceVerdict: fence.verdict,
  });

  return NextResponse.json({
    ok: true,
    employee: { id: employee.id, name: employee.name },
    action,
    timestamp,
    flagged,
  });
}
