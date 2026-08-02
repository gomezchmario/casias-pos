import { NextRequest, NextResponse } from "next/server";
import {
  deleteEntry,
  getEntry,
  updateEntry,
  type EntryType,
} from "@/lib/entries";
import { logAudit } from "@/lib/audit";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const entryId = parseInt(id, 10);
  const existing = getEntry(entryId);
  if (!existing) return jsonError("Not found", 404);

  let body: {
    timestamp?: string;
    type?: EntryType;
    notes?: string | null;
    flagged?: boolean;
    flagReason?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  updateEntry(entryId, { ...body, adminId: auth.admin.adminId });

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: body.flagged === false ? "entry.unflag" : "entry.update",
    targetType: "time_entry",
    targetId: entryId,
    details: { before: existing, after: body },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const entryId = parseInt(id, 10);
  const existing = getEntry(entryId);
  if (!existing) return jsonError("Not found", 404);
  deleteEntry(entryId);
  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "entry.delete",
    targetType: "time_entry",
    targetId: entryId,
    details: existing,
  });
  return NextResponse.json({ ok: true });
}
