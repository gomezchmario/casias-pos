import { NextRequest, NextResponse } from "next/server";
import { findAdminByUsername, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password required" },
      { status: 400 },
    );
  }

  const admin = findAdminByUsername(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }

  const session = await getSession();
  session.adminId = admin.id;
  session.username = admin.username;
  session.mustChangePassword = admin.must_change_password === 1;
  await session.save();

  logAudit({
    adminId: admin.id,
    adminUsername: admin.username,
    action: "admin.login",
  });

  return NextResponse.json({
    ok: true,
    username: admin.username,
    mustChangePassword: admin.must_change_password === 1,
  });
}
