import { NextRequest, NextResponse } from "next/server";
import { createEntry, listEntries, type EntryType } from "@/lib/entries";
import { logAudit } from "@/lib/audit";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const employeeId = sp.get("employeeId");
  const type = sp.get("type");
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const flaggedOnly = sp.get("flaggedOnly") === "true";
  const limit = sp.get("limit") ? Math.min(parseInt(sp.get("limit")!, 10), 1000) : 200;
  const offset = sp.get("offset") ? parseInt(sp.get("offset")!, 10) : 0;

  const entries = listEntries({
    employeeId: employeeId ? parseInt(employeeId, 10) : undefined,
    type: (type as EntryType) || undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    flaggedOnly,
    limit,
    offset,
  });
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: {
    employeeId?: number;
    type?: EntryType;
    timestamp?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }
  if (!body.employeeId || !body.type)
    return jsonError("employeeId and type required");

  const id = createEntry({
    employeeId: body.employeeId,
    type: body.type,
    timestamp: body.timestamp,
    flagged: true,
    flagReason: `Manually added by admin ${auth.admin.username}`,
  });
  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "entry.create",
    targetType: "time_entry",
    targetId: id,
    details: body,
  });
  return NextResponse.json({ ok: true, id });
}
