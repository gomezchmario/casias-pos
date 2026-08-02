import { NextRequest, NextResponse } from "next/server";
import { findAdminById, setAdminPassword, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newPassword = body.newPassword ?? "";
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const admin = findAdminById(session.adminId);
  if (!admin) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }
  if (
    !session.mustChangePassword &&
    !verifyPassword(body.currentPassword ?? "", admin.password_hash)
  ) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }

  setAdminPassword(admin.id, newPassword);
  session.mustChangePassword = false;
  await session.save();

  logAudit({
    adminId: admin.id,
    adminUsername: admin.username,
    action: "admin.password_change",
  });

  return NextResponse.json({ ok: true });
}
