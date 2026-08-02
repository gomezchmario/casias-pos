import { NextRequest, NextResponse } from "next/server";
import {
  createEmployee,
  getEmployeeState,
  listEmployees,
} from "@/lib/employees";
import { logAudit } from "@/lib/audit";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "true";
  const employees = listEmployees(includeInactive);
  const withState = employees.map((e) => {
    const s = getEmployeeState(e.id);
    return { ...e, current_state: s.state, last_event_at: s.lastEventAt };
  });
  return NextResponse.json({ employees: withState });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: {
    name?: string;
    pin?: string;
    role?: string | null;
    posRole?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = createEmployee({
    name: body.name ?? "",
    pin: body.pin ?? "",
    role: body.role ?? null,
    posRole: body.posRole ?? null,
  });
  if (!result.ok) return jsonError(result.error);

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "employee.create",
    targetType: "employee",
    targetId: result.id,
    details: { name: body.name, role: body.role, posRole: body.posRole },
  });

  return NextResponse.json({ ok: true, id: result.id });
}
