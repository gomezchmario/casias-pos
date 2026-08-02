import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  const adminId = session.adminId ?? null;
  const username = session.username ?? null;
  session.destroy();
  if (adminId && username) {
    logAudit({ adminId, adminUsername: username, action: "admin.logout" });
  }
  return NextResponse.json({ ok: true });
}
