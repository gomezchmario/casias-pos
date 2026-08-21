import { NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { clearShift, setShift } from "@/lib/schedule";
import { logAudit } from "@/lib/audit";

/**
 * Write one cell of the grid: put somebody on a day, move them, take them off.
 *
 * The lib validates the arithmetic; this route's job is attribution. Roster
 * edits from the desk are made by a manager signed into the register, so the
 * audit row carries their name the way every money edit does — `created_by`
 * on the shift itself stays null because that column means an admin-password
 * edit, and pretending a POS session was one would cross the two ladders.
 */
export async function POST(req: Request) {
  const auth = await requirePos("manageSchedule");
  if (!auth.ok) return auth.response;

  let body: {
    employeeId?: number;
    workDate?: string;
    clear?: boolean;
    startMinute?: number;
    endMinute?: number;
    breakMinutes?: number;
    note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const employeeId = Number(body.employeeId);
  const workDate = String(body.workDate ?? "");
  if (!Number.isInteger(employeeId) || employeeId <= 0) return jsonError("Which person?");

  if (body.clear) {
    clearShift(employeeId, workDate);
    logAudit({
      actorType: "employee",
      employeeId: auth.user.employeeId,
      employeeName: auth.user.name,
      employeeRole: auth.user.role,
      action: "schedule.clear",
      details: { forEmployeeId: employeeId, workDate },
    });
    return NextResponse.json({ ok: true });
  }

  const set = setShift({
    employeeId,
    workDate,
    startMinute: Number(body.startMinute),
    endMinute: Number(body.endMinute),
    breakMinutes: Number(body.breakMinutes ?? 60),
    note: body.note ?? null,
  });
  if (!set.ok) return jsonError(set.error);

  logAudit({
    actorType: "employee",
    employeeId: auth.user.employeeId,
    employeeName: auth.user.name,
    employeeRole: auth.user.role,
    action: "schedule.set",
    details: {
      forEmployeeId: employeeId,
      workDate,
      startMinute: body.startMinute,
      endMinute: body.endMinute,
      breakMinutes: body.breakMinutes ?? 60,
    },
  });
  return NextResponse.json({ ok: true, id: set.id });
}
