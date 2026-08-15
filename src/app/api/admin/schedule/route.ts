import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireAdminApi } from "@/lib/api-helpers";
import { logAudit } from "@/lib/audit";
import { clearShift, copyWeek, scheduleFor, setShift } from "@/lib/schedule";
import { staffingNeed } from "@/lib/reports-bi";

/**
 * The roster for one week, and what the tickets say that week needs.
 *
 * BOTH IN ONE RESPONSE, deliberately. A roster screen that cannot say "you have
 * three people on a Saturday that needs five" is a spreadsheet with a login,
 * and the shop already has spreadsheets. The recommendation is the reason this
 * lives in the same database as the sales rather than on a whiteboard.
 *
 * The staffing figures come from the same `staffingNeed` the reports use, over
 * the four weeks ending today — not over the week being rostered, which has not
 * happened yet and has no tickets in it. That is worth stating because it is
 * the one thing about this screen that could be misread: the recommendation
 * describes the shop's recent past, and it is being used to plan its near
 * future on the assumption that next Saturday looks like the last four.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const from = req.nextUrl.searchParams.get("from");
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return jsonError("Which week?");

  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const to = (db.prepare("SELECT date(?, '+6 days') AS d").get(from) as { d: string }).d;
  const today = (db.prepare("SELECT date('now','localtime') AS d").get() as { d: string }).d;
  const histFrom = (db.prepare("SELECT date(?, '-27 days') AS d").get(today) as { d: string }).d;

  return NextResponse.json({
    from,
    to,
    people: scheduleFor(from, to),
    staffing: staffingNeed(histFrom, today),
  });
}

/** Put somebody on a day, take them off one, or copy a whole week forward. */
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let body: {
    action?: "set" | "clear" | "copy";
    employeeId?: number;
    workDate?: string;
    startMinute?: number;
    endMinute?: number;
    breakMinutes?: number;
    note?: string | null;
    fromMonday?: string;
    toMonday?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON");
  }

  if (body.action === "copy") {
    if (!body.fromMonday || !body.toMonday) return jsonError("Which weeks?");
    const res = copyWeek(body.fromMonday, body.toMonday);
    logAudit({
      adminId: auth.admin.adminId,
      adminUsername: auth.admin.username,
      action: "schedule.copy",
      targetType: "schedule",
      details: { from: body.fromMonday, to: body.toMonday, copied: res.copied },
    });
    return NextResponse.json(res);
  }

  if (!body.employeeId || !body.workDate) return jsonError("Who, and which day?");

  if (body.action === "clear") {
    clearShift(body.employeeId, body.workDate);
    logAudit({
      adminId: auth.admin.adminId,
      adminUsername: auth.admin.username,
      action: "schedule.clear",
      targetType: "employee",
      targetId: body.employeeId,
      details: { work_date: body.workDate },
    });
    return NextResponse.json({ ok: true });
  }

  const res = setShift({
    employeeId: body.employeeId,
    workDate: body.workDate,
    startMinute: body.startMinute ?? 8 * 60,
    endMinute: body.endMinute ?? 19 * 60,
    breakMinutes: body.breakMinutes ?? 60,
    note: body.note ?? null,
    adminId: auth.admin.adminId,
  });
  if (!res.ok) return jsonError(res.error);

  logAudit({
    adminId: auth.admin.adminId,
    adminUsername: auth.admin.username,
    action: "schedule.set",
    targetType: "employee",
    targetId: body.employeeId,
    details: {
      work_date: body.workDate,
      start: body.startMinute,
      end: body.endMinute,
      break: body.breakMinutes,
    },
  });
  return NextResponse.json({ ok: true });
}
