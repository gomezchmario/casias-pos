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
    kind?: "call_off" | "change" | "cover_offer" | "more_hours";
    workDate?: string;
    /** Cover offers may span a range — one request per day comes out of it. */
    endDate?: string;
    proposedStartMinute?: number | null;
    proposedEndMinute?: number | null;
    hoursWanted?: number | null;
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

  const kinds = ["call_off", "change", "cover_offer", "more_hours"];
  if (!body.kind || !kinds.includes(body.kind))
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  /*
    A cover offer over a range files ONE REQUEST PER DAY, not one request
    with two dates. A manager answers days, not spans — "Tuesday yes,
    Wednesday no need" — and per-day rows are what makes each day its own
    answer. Days already offered are skipped rather than refused, so
    stretching an offer by a week does not trip over the first day of it.
  */
  if (body.kind === "cover_offer" && body.endDate && body.endDate !== body.workDate) {
    const from = String(body.workDate ?? "");
    const to = String(body.endDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
      return NextResponse.json({ error: "That range ends before it starts" }, { status: 400 });
    const span =
      Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (span > 14)
      return NextResponse.json({ error: "Fourteen days at a time is plenty" }, { status: 400 });

    let filed = 0;
    for (let i = 0; i < span; i++) {
      const d = new Date(`${from}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const made = createRequest({
        employeeId: me,
        kind: "cover_offer",
        workDate: d.toISOString().slice(0, 10),
        note: body.note ?? null,
      });
      if (made.ok) filed++;
    }
    if (filed === 0)
      return NextResponse.json(
        { error: "You already offered every day in that range" },
        { status: 400 },
      );
    logAudit({
      actorType: "employee",
      employeeId: me,
      employeeName: result.user.name,
      employeeRole: result.user.role,
      action: "schedule.request",
      details: { kind: "cover_offer", from, to, filed },
    });
    return NextResponse.json({ ok: true, filed });
  }

  const made = createRequest({
    employeeId: me,
    kind: body.kind,
    workDate: body.workDate ?? null,
    proposedStartMinute: body.proposedStartMinute ?? null,
    proposedEndMinute: body.proposedEndMinute ?? null,
    hoursWanted: body.hoursWanted ?? null,
    note: body.note ?? null,
  });
  if (!made.ok) return NextResponse.json({ error: made.error }, { status: 400 });

  logAudit({
    actorType: "employee",
    employeeId: me,
    employeeName: result.user.name,
    employeeRole: result.user.role,
    action: "schedule.request",
    details: { kind: body.kind, workDate: body.workDate ?? null, requestId: made.id },
  });
  return NextResponse.json({ ok: true, id: made.id });
}
