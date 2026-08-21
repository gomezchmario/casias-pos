import { NextResponse } from "next/server";
import { verifyKioskPin } from "@/lib/pos-session";
import { setPhone, phoneWords } from "@/lib/shift-desk";
import { logAudit } from "@/lib/audit";

/**
 * A person sets their own number, proved by their own PIN. The one write the
 * kiosk allows on the employee record, because it is the one field that is
 * more theirs than the shop's — and the gate on the schedule endpoint is what
 * makes filling it in non-optional the first time.
 */
export async function POST(req: Request) {
  let body: { pin?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = verifyKioskPin(String(body.pin ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  if (result.user.role === "viewer")
    return NextResponse.json(
      { error: "This account looks at screens; it does not work shifts." },
      { status: 403 },
    );

  const set = setPhone(result.user.employeeId, String(body.phone ?? ""));
  if (!set.ok) return NextResponse.json({ error: set.error }, { status: 400 });

  logAudit({
    actorType: "employee",
    employeeId: result.user.employeeId,
    employeeName: result.user.name,
    employeeRole: result.user.role,
    action: "employee.phone_set",
    details: { via: "kiosk" },
  });
  return NextResponse.json({ ok: true, phone: phoneWords(set.phone) });
}
