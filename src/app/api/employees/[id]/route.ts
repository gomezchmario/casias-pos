import { NextRequest, NextResponse } from "next/server";
import {
  deleteEmployee,
  getEmployee,
  updateEmployee,
} from "@/lib/employees";
import { logAudit } from "@/lib/audit";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const emp = getEmployee(parseInt(id, 10));
  if (!emp) return jsonError("Not found", 404);
  return NextResponse.json({ employee: emp });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const empId = parseInt(id, 10);
  const existing = getEmployee(empId);
  if (!existing) return jsonError("Not found", 404);

  let body: {
    name?: string;
    role?: string | null;
    posRole?: string;
    active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  const result = updateEmployee(empId, body);
  if (!result.ok) return jsonError(result.error);

  let action: "employee.update" | "employee.activate" | "employee.deactivate" =
    "employee.update";
  if (body.active === false && existing.active === 1) action = "employee.deactivate";
  if (body.active === true && existing.active === 0) action = "employee.activate";

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action,
    targetType: "employee",
    targetId: empId,
    details: body,
  });

  // A permission change is worth its own log line — it's the record of who
  // granted whom the ability to touch money.
  if (body.posRole !== undefined && body.posRole !== existing.pos_role) {
    logAudit({
      adminId: auth.admin.adminId,
      adminUsername: auth.admin.username,
      action: "employee.pos_role_change",
      targetType: "employee",
      targetId: empId,
      before: { pos_role: existing.pos_role },
      after: { pos_role: body.posRole },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const empId = parseInt(id, 10);
  const existing = getEmployee(empId);
  if (!existing) return jsonError("Not found", 404);
  const result = deleteEmployee(empId);
  if (!result.ok) return jsonError(result.error, 409);
  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "employee.delete",
    targetType: "employee",
    targetId: empId,
    details: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
