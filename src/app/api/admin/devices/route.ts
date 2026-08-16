import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import {
  currentDeviceRow,
  enrollDevice,
  listDevices,
  revokeDevice,
} from "@/lib/devices";

/**
 * Trusted devices — the fence's bypass list.
 *
 * Admin only, and that is the point rather than an inconvenience: trusting a
 * device means it can punch the clock from anywhere forever, so the act should
 * require the strongest credential the shop has, not the 4-digit PIN this is
 * protecting. Pressing the button on the device being trusted is what enrolls
 * it — there is deliberately no way to trust some OTHER device remotely, since
 * a mistyped one would hand the bypass to a phone nobody can find.
 */
export async function GET() {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;
  return NextResponse.json({
    devices: listDevices(),
    // So the page can say "this device is trusted" rather than making somebody
    // work it out from a list of user-agent strings.
    thisDevice: await currentDeviceRow(),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  let body: { label?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const label = (body.label ?? "").trim() || "Unnamed device";
  const { id } = await enrollDevice({
    label,
    byName: admin.admin.username,
    byId: admin.admin.adminId,
    userAgent: req.headers.get("user-agent"),
    // Behind the tunnel the direct address is the proxy's, so the forwarded
    // header is read first. Recorded for identification only — nothing is ever
    // decided on it, because a header a client can set decides nothing.
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null,
  });

  logAudit({
    adminId: admin.admin.adminId,
    adminUsername: admin.admin.username,
    action: "device.enroll",
    targetType: "trusted_device",
    targetId: id,
    details: { label },
  });

  return NextResponse.json({ ok: true, id, devices: listDevices() });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (!Number.isInteger(body.id))
    return NextResponse.json({ error: "Which device?" }, { status: 400 });

  const done = revokeDevice(body.id!, admin.admin.username);
  if (!done)
    return NextResponse.json(
      { error: "That device is already revoked" },
      { status: 400 },
    );

  logAudit({
    adminId: admin.admin.adminId,
    adminUsername: admin.admin.username,
    action: "device.revoke",
    targetType: "trusted_device",
    targetId: body.id!,
  });

  return NextResponse.json({ ok: true, devices: listDevices() });
}
