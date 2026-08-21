import { NextResponse } from "next/server";
import { requirePos, jsonError } from "@/lib/api-helpers";
import { resolveRequest } from "@/lib/shift-desk";
import { logAudit } from "@/lib/audit";

/**
 * Answer one request. Approving is the write that matters — the lib applies
 * an approved call-off or change to the roster in the same transaction that
 * records the answer, so the grid and the inbox cannot tell two stories.
 */
export async function POST(req: Request) {
  const auth = await requirePos("manageSchedule");
  if (!auth.ok) return auth.response;

  let body: { id?: number; approve?: boolean; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return jsonError("Which request?");

  const r = resolveRequest({
    id,
    approve: Boolean(body.approve),
    byId: auth.user.employeeId,
    note: body.note ?? null,
  });
  if (!r.ok) return jsonError(r.error, 409);

  logAudit({
    actorType: "employee",
    employeeId: auth.user.employeeId,
    employeeName: auth.user.name,
    employeeRole: auth.user.role,
    action: body.approve ? "schedule.request_approved" : "schedule.request_declined",
    details: { requestId: id, note: body.note ?? null },
  });
  return NextResponse.json({ ok: true });
}
