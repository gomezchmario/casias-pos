import { NextResponse } from "next/server";
import { destroyPosSession } from "@/lib/pos-session";
import { logAudit } from "@/lib/audit";

export async function POST() {
  const user = await destroyPosSession();
  if (user) {
    logAudit({
      actorType: "employee",
      employeeId: user.employeeId,
      employeeName: user.name,
      employeeRole: user.role,
      action: "pos.logout",
    });
  }
  return NextResponse.json({ ok: true });
}
