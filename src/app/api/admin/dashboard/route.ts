import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-helpers";
import { getDb } from "@/lib/db";
import { getEmployeeState, listEmployees } from "@/lib/employees";
import { hoursForDay } from "@/lib/hours";

/**
 * Everything the admin dashboard shows, in one response.
 *
 * The old dashboard made three requests and could still not answer the two
 * questions a manager actually walks in with: HOW LONG has each person been in,
 * and WHO IS MISSING. The second one it could not answer even in principle —
 * lateness is the gap between the roster and the clock, and until the schedule
 * existed there was no roster to read the clock against. Now there is, so the
 * comparison lives here, on the server, where both tables are.
 *
 * One response rather than three because the pieces qualify each other: "7 in"
 * is a different fact when 9 were expected, and drawing the two from separate
 * requests invites the frame where one has loaded and the other has not.
 */
export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const db = getDb();
  const today = (db.prepare("SELECT date('now','localtime') AS d").get() as { d: string }).d;
  const nowMinute = (
    db
      .prepare(
        "SELECT CAST(strftime('%H','now','localtime') AS INTEGER) * 60 + CAST(strftime('%M','now','localtime') AS INTEGER) AS m",
      )
      .get() as { m: number }
  ).m;

  // The same state join the employees route does — see that file.
  const employees = listEmployees().map((e) => {
    const s = getEmployeeState(e.id);
    return { ...e, current_state: s.state, last_event_at: s.lastEventAt };
  });
  const hours = hoursForDay(today);

  /** Who the roster says should be in right now, or later today. */
  const scheduled = db
    .prepare(
      `SELECT s.employee_id AS employeeId, e.name,
              s.start_minute AS startMinute, s.end_minute AS endMinute
         FROM schedule_shifts s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.work_date = ? AND e.active = 1
     ORDER BY s.start_minute, e.name`,
    )
    .all(today) as { employeeId: number; name: string; startMinute: number; endMinute: number }[];

  /*
    Late is measured with a grace period, and the size of it is a judgement:
    fifteen minutes. Five flags somebody parking; thirty hides a real problem.
    It is a constant here rather than a setting because the first question is
    whether the shop uses this at all — a knob for it can come when somebody
    asks for the knob.
  */
  const GRACE_MINUTES = 15;
  const states = new Map(employees.map((e) => [e.id, e.current_state]));
  const late = scheduled.filter(
    (s) =>
      states.get(s.employeeId) === "checked_out" &&
      nowMinute > s.startMinute + GRACE_MINUTES &&
      nowMinute < s.endMinute,
  );

  /*
    The last seven days of worked minutes, for the little chart. Paired the same
    way hoursForDay pairs a single day — check_in to the next entry, capped at
    nine at night — but in one grouped pass, because seven calls to hoursForDay
    is seven walks over the same table.
  */
  const week = db
    .prepare(
      `SELECT substr(t.timestamp, 1, 10) AS day,
              CAST(SUM(
                MIN(
                  (julianday(COALESCE(
                     (SELECT MIN(t2.timestamp) FROM time_entries t2
                       WHERE t2.employee_id = t.employee_id
                         AND t2.timestamp > t.timestamp
                         AND substr(t2.timestamp,1,10) = substr(t.timestamp,1,10)),
                     -- An unclosed stretch ends at 9pm on a past day (the
                     -- auto-close rule) but only at NOW on today: somebody two
                     -- hours into a shift has worked two hours, and counting
                     -- them to 9pm made today's bar taller all afternoon than
                     -- the day had actually been. The MIN of the two strings
                     -- works because both carry the T separator — the entries
                     -- are stored that way, and strftime is told to match.
                     MIN(substr(t.timestamp,1,10) || 'T21:00:00',
                         strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))))
                   - julianday(t.timestamp)) * 1440,
                  720)
              ) AS INTEGER) AS minutes
         FROM time_entries t
        WHERE t.type IN ('check_in', 'break_end')
          AND substr(t.timestamp, 1, 10) BETWEEN date(?, '-6 days') AND ?
     GROUP BY day`,
    )
    .all(today, today) as { day: string; minutes: number }[];

  /* The two lists the page shows under the numbers, so it really is one
     request: today's last few punches, and whatever is flagged. */
  const recent = db
    .prepare(
      `SELECT t.id, t.type, t.timestamp, t.flagged, e.name AS employee_name
         FROM time_entries t JOIN employees e ON e.id = t.employee_id
        WHERE substr(t.timestamp, 1, 10) = ?
     ORDER BY t.timestamp DESC LIMIT 10`,
    )
    .all(today) as { id: number; type: string; timestamp: string; flagged: number; employee_name: string }[];

  const flaggedEntries = db
    .prepare(
      `SELECT t.id, t.type, t.timestamp, t.flag_reason, e.name AS employee_name
         FROM time_entries t JOIN employees e ON e.id = t.employee_id
        WHERE t.flagged = 1
     ORDER BY t.timestamp DESC LIMIT 5`,
    )
    .all() as { id: number; type: string; timestamp: string; flag_reason: string | null; employee_name: string }[];

  /*
    The chart and the card must not disagree about today. The SQL above and
    hoursForDay are two estimators of the same thing, and mid-shift they can
    drift an hour apart on the day that is still moving — so the bar for today
    is overwritten with the SAME figure the Hours-so-far card shows. Past days
    are settled and the SQL stands for them.
  */
  const todayMinutes = hours.people.reduce((n, x) => n + x.knownMinutes + x.assumedMinutes, 0);
  const todayRow = week.find((w) => w.day === today);
  if (todayRow) todayRow.minutes = todayMinutes;
  else if (todayMinutes > 0) week.push({ day: today, minutes: todayMinutes });

  const flagged = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM time_entries WHERE flagged = 1",
      )
      .get() as { n: number }
  ).n;

  return NextResponse.json({
    today,
    employees,
    /** Per person today: minutes so far, whether still on, since when. */
    hours: hours.people.map((p) => ({
      employeeId: p.employeeId,
      minutes: p.knownMinutes + p.assumedMinutes,
      onTheClock: p.onTheClock,
      since: p.since,
    })),
    scheduled,
    late,
    week,
    flagged,
    recent,
    flaggedEntries,
  });
}
