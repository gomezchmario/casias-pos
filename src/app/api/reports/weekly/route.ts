import { NextRequest, NextResponse } from "next/server";
import { buildWeeklyReport, currentWeekRange } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { requireAdminApi } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const weekStartDay = parseInt(getSetting("week_start_day"), 10) || 0;
  let startDate = sp.get("startDate");
  let endDate = sp.get("endDate");
  if (!startDate || !endDate) {
    const range = currentWeekRange(weekStartDay);
    startDate = startDate || range.startDate;
    endDate = endDate || range.endDate;
  }
  const employeeId = sp.get("employeeId")
    ? parseInt(sp.get("employeeId")!, 10)
    : undefined;

  const report = buildWeeklyReport({
    startDate,
    endDate,
    weekStartDay,
    employeeId,
  });
  return NextResponse.json(report);
}
