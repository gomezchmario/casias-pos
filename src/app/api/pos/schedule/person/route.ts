import { NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { setPhone } from "@/lib/shift-desk";
import { nowLocalIso } from "@/lib/time";
import { logAudit } from "@/lib/audit";

/**
 * The desk's two facts about a person: the number to call, and what their
 * hands can do. Both editable from the grid because both are consulted from
 * it — a no-show needs the number NOW, and "is there a muffler man Thursday"
 * is only answerable if somebody could tick the box when they learned Jerry
 * does mufflers.
 */
export async function POST(req: Request) {
  const auth = await requirePos("manageSchedule");
  if (!auth.ok) return auth.response;

  let body: {
    employeeId?: number;
    phone?: string | null;
    canMufflers?: boolean;
    canBigRigs?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  const employeeId = Number(body.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return jsonError("Which person?");

  const changed: Record<string, unknown> = {};

  if (typeof body.phone === "string" && body.phone.trim() !== "") {
    const set = setPhone(employeeId, body.phone);
    if (!set.ok) return jsonError(set.error);
    changed.phone = set.phone;
  }

  if (typeof body.canMufflers === "boolean" || typeof body.canBigRigs === "boolean") {
    const db = getDb();
    if (typeof body.canMufflers === "boolean") {
      db.prepare("UPDATE employees SET can_mufflers = ?, updated_at = ? WHERE id = ?").run(
        body.canMufflers ? 1 : 0,
        nowLocalIso(),
        employeeId,
      );
      changed.canMufflers = body.canMufflers;
    }
    if (typeof body.canBigRigs === "boolean") {
      db.prepare("UPDATE employees SET can_big_rigs = ?, updated_at = ? WHERE id = ?").run(
        body.canBigRigs ? 1 : 0,
        nowLocalIso(),
        employeeId,
      );
      changed.canBigRigs = body.canBigRigs;
    }
  }

  if (Object.keys(changed).length === 0) return jsonError("Nothing to change");

  logAudit({
    actorType: "employee",
    employeeId: auth.user.employeeId,
    employeeName: auth.user.name,
    employeeRole: auth.user.role,
    action: "schedule.person_edit",
    details: { forEmployeeId: employeeId, ...changed },
  });
  return NextResponse.json({ ok: true });
}
