import { NextRequest, NextResponse } from "next/server";
import { requirePos } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { currentBusinessDate } from "@/lib/business-date";
import { scheduleFor } from "@/lib/schedule";
import { listRequests, todayBoard } from "@/lib/shift-desk";

/**
 * The shift desk's one read: the grid, the inbox and the board in a single
 * payload, computed at a single moment — the same rule the reports suite
 * follows, for the same reason. A manager flicking between the tabs is
 * looking at one desk, not three screens that answer at three times.
 *
 * People are grouped the way the owner thinks about the floor — technicians,
 * mechanics, the office — and the grouping is done HERE, off the live role,
 * so the grid, the filter pills and the coverage line can never disagree
 * about who counts as what.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePos("manageSchedule");
  if (!auth.ok) return auth.response;

  const today = currentBusinessDate();
  const sp = req.nextUrl.searchParams;
  // Monday-anchored, because copy-week is: a grid that showed some other
  // seven days would copy a week nobody was looking at.
  const weekStart =
    sp.get("weekStart") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("weekStart")!)
      ? sp.get("weekStart")!
      : mondayOf(today);
  const weekEnd = addDays(weekStart, 6);

  const extras = new Map(
    (
      getDb()
        .prepare(
          `SELECT id, phone, COALESCE(can_mufflers,0) AS canMufflers,
                  COALESCE(can_big_rigs,0) AS canBigRigs, COALESCE(pos_role,'') AS role,
                  desk_group AS deskGroup
             FROM employees WHERE active = 1`,
        )
        .all() as {
        id: number;
        phone: string | null;
        canMufflers: number;
        canBigRigs: number;
        role: string;
        deskGroup: string | null;
      }[]
    ).map((r) => [r.id, r]),
  );

  /*
    The override first, the role second. A pos_role answers "what may you
    touch on the register"; where somebody stands on the floor is sometimes
    a different fact — Americo rings tickets as a writer and turns wrenches
    as a mechanic, and the desk sorts him by the wrenches (056).
  */
  const groupOf = (role: string, over: string | null): "technicians" | "mechanics" | "office" | "hidden" => {
    if (over === "technicians" || over === "mechanics" || over === "office") return over;
    if (role === "technician") return "technicians";
    if (role === "mechanic") return "mechanics";
    if (role === "viewer") return "hidden";
    return "office";
  };

  const people = scheduleFor(weekStart, weekEnd)
    .map((p) => {
      const x = extras.get(p.employeeId);
      return {
        ...p,
        phone: x?.phone ?? null,
        canMufflers: x?.canMufflers ?? 0,
        canBigRigs: x?.canBigRigs ?? 0,
        group: groupOf(x?.role ?? p.role ?? "", x?.deskGroup ?? null),
      };
    })
    // A viewer account watches screens; putting it on the roster would be
    // rostering furniture.
    .filter((p) => p.group !== "hidden");

  return NextResponse.json({
    today,
    weekStart,
    weekEnd,
    people,
    requests: listRequests(),
    board: todayBoard(),
  });
}

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return addDays(date, -((d.getDay() + 6) % 7));
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
