import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";

/**
 * Set the register's night rule — the whole of it in one write, because the
 * pieces only mean anything together: a window with no allow list and an
 * allow list with no window are different rules, and saving them separately
 * would let the page leave the shop in a state nobody chose.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: {
    enabled?: boolean;
    startMinute?: number;
    endMinute?: number;
    allow?: number[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const start = Number(body.startMinute);
  const end = Number(body.endMinute);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 1439 ||
    end < 0 ||
    end > 1439
  )
    return NextResponse.json({ error: "Those are not times of day" }, { status: 400 });
  if (start === end && body.enabled)
    return NextResponse.json(
      { error: "The window starts and ends at the same minute — that is no window at all" },
      { status: 400 },
    );

  const allow = Array.isArray(body.allow)
    ? body.allow.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  setSetting("register_curfew_enabled", body.enabled ? "1" : "0");
  setSetting("register_curfew_start_minute", String(start));
  setSetting("register_curfew_end_minute", String(end));
  setSetting("register_curfew_allow", allow.join(","));

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "curfew.set",
    targetType: "settings",
    details: { enabled: Boolean(body.enabled), startMinute: start, endMinute: end, allow },
  });
  return NextResponse.json({ ok: true });
}
