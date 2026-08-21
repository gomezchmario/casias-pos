import { NextResponse } from "next/server";
import { verifyKioskPin } from "@/lib/pos-session";
import { createRequest, phoneOf, withdrawRequest } from "@/lib/shift-desk";
import { logAudit } from "@/lib/audit";

/**
 * An employee asks something of the roster, or takes an ask back.
 *
 * The phone gate is enforced here as well as on the panel, because a request
 * is precisely the moment the number gets dialled: approving a call-off and
 * then discovering there is no way to call the person about Friday is the
 * exact failure the gate exists to prevent.
 */
export async function POST(req: Request) {
  let body: {
    pin?: string;
    action?: "create" | "withdraw";
    id?: number;
    kind?: "call_off" | "change" | "cover_offer";
    workDate?: string;
    proposedStartMinute?: number | null;
    proposedEndMinute?: number | null;
    note?: string | null;
  };
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
  const me = result.user.employeeId;

  if (body.action === "withdraw") {
    const w = withdrawRequest(Number(body.id), me);
    if (!w.ok) return NextResponse.json({ error: w.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (!phoneOf(me))
    return NextResponse.json(
      { error: "Put your phone number in first", needsPhone: true },
      { status: 428 },
    );

  if (body.kind !== "call_off" && body.kind !== "change" && body.kind !== "cover_offer")
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const made = createRequest({
    employeeId: me,
    kind: body.kind,
    workDate: String(body.workDate ?? ""),
    proposedStartMinute: body.proposedStartMinute ?? null,
    proposedEndMinute: body.proposedEndMinute ?? null,
    note: body.note ?? null,
  });
  if (!made.ok) return NextResponse.json({ error: made.error }, { status: 400 });

  logAudit({
    actorType: "employee",
    employeeId: me,
    employeeName: result.user.name,
    employeeRole: result.user.role,
    action: "schedule.request",
    details: { kind: body.kind, workDate: body.workDate, requestId: made.id },
  });
  return NextResponse.json({ ok: true, id: made.id });
}
