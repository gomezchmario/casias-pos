import { NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { copyWeek } from "@/lib/schedule";
import { logAudit } from "@/lib/audit";

/** Repeat a week — the lib leaves hand-written target days alone. */
export async function POST(req: Request) {
  const auth = await requirePos("manageSchedule");
  if (!auth.ok) return auth.response;

  let body: { fromMonday?: string; toMonday?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  const fromMonday = String(body.fromMonday ?? "");
  const toMonday = String(body.toMonday ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromMonday) || !/^\d{4}-\d{2}-\d{2}$/.test(toMonday))
    return jsonError("Which weeks?");

  const r = copyWeek(fromMonday, toMonday);
  logAudit({
    actorType: "employee",
    employeeId: auth.user.employeeId,
    employeeName: auth.user.name,
    employeeRole: auth.user.role,
    action: "schedule.copy_week",
    details: { fromMonday, toMonday, copied: r.copied },
  });
  return NextResponse.json({ ok: true, copied: r.copied });
}
