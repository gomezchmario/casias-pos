import { NextRequest, NextResponse } from "next/server";
import { getEmployee, resetEmployeePin } from "@/lib/employees";
import { logAudit } from "@/lib/audit";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const empId = parseInt(id, 10);
  const existing = getEmployee(empId);
  if (!existing) return jsonError("Not found", 404);

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  const result = resetEmployeePin(empId, body.pin ?? "");
  if (!result.ok) return jsonError(result.error);

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "employee.pin_reset",
    targetType: "employee",
    targetId: empId,
    details: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
