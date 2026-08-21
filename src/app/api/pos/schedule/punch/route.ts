import { NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { managerPunch } from "@/lib/shift-desk";
import { logAudit } from "@/lib/audit";

/**
 * A manager punches for somebody from the board — the technician who drove
 * off at five with the clock still running, the one who never pressed break.
 * The lib enforces the same state machine the kiosk does and stamps the
 * entry with who really pressed the button.
 */
export async function POST(req: Request) {
  const auth = await requirePos("manageSchedule");
  if (!auth.ok) return auth.response;

  let body: { employeeId?: number; action?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  const employeeId = Number(body.employeeId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(employeeId) || employeeId <= 0) return jsonError("Which person?");
  if (!["check_in", "check_out", "break_start", "break_end"].includes(action))
    return jsonError("Which button?");

  const r = managerPunch({
    employeeId,
    action: action as "check_in" | "check_out" | "break_start" | "break_end",
    byId: auth.user.employeeId,
    byName: auth.user.name,
  });
  if (!r.ok) return jsonError(r.error, 409);

  logAudit({
    actorType: "employee",
    employeeId: auth.user.employeeId,
    employeeName: auth.user.name,
    employeeRole: auth.user.role,
    action: "schedule.manager_punch",
    details: { forEmployeeId: employeeId, punch: action },
  });
  return NextResponse.json({ ok: true });
}
