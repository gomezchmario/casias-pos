import { getDb } from "./db";
import {
  diffMinutes,
  endOfWeek,
  formatHHMM,
  startOfWeek,
  toLocalIso,
} from "./time";

export type DailyBreakdown = {
  date: string; // YYYY-MM-DD
  workedMinutes: number;
  breakMinutes: number;
  shifts: number;
  hasOpenShift: boolean;
  hasFlagged: boolean;
};

export type EmployeeWeekly = {
  employee_id: number;
  employee_name: string;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  netWorkedMinutes: number; // worked minus paid breaks (for now equal to worked, since we deduct nothing)
  workedHHMM: string;
  breakHHMM: string;
  netHHMM: string;
  workedDecimal: string;
  daily: DailyBreakdown[];
  hasFlagged: boolean;
};

export type WeeklyReport = {
  startDate: string;
  endDate: string;
  weekStartDay: number;
  rows: EmployeeWeekly[];
};

/**
 * Build a weekly report between two local-date strings (YYYY-MM-DD), inclusive.
 * Pairs check_in/check_out and break_start/break_end events per employee per day.
 */
export function buildWeeklyReport(args: {
  startDate: string;
  endDate: string;
  weekStartDay: number;
  employeeId?: number;
}): WeeklyReport {
  const db = getDb();
  /*
    Deactivated employees are off this report, with one exception that is the
    whole reason this is not just "WHERE active = 1".

    SOMEBODY WHO WORKED IN THE WEEK IS ON IT WHETHER OR NOT THEY STILL WORK
    HERE. A person who quits on Wednesday is deactivated on Wednesday and paid
    on Friday, and a payroll sheet that silently dropped their Monday to
    Wednesday would be short by exactly the hours nobody is left to complain
    about. So the flag decides whether an EMPTY row is worth printing, and the
    entries decide whether the person is on the sheet at all.

    Asking for one employee by id still returns them regardless. That is a
    deliberate lookup of a named person — usually precisely because they have
    left and somebody is settling up.
  */
  const empSql = args.employeeId
    ? "SELECT id, name, active FROM employees WHERE id = ? ORDER BY name"
    : "SELECT id, name, active FROM employees ORDER BY active DESC, name";
  const employees = (
    args.employeeId
      ? db.prepare(empSql).all(args.employeeId)
      : db.prepare(empSql).all()
  ) as { id: number; name: string; active: number }[];

  const rangeStart = `${args.startDate}T00:00:00`;
  const rangeEnd = `${args.endDate}T23:59:59`;

  const rows: EmployeeWeekly[] = [];
  for (const emp of employees) {
    const entries = db
      .prepare(
        `SELECT type, timestamp, flagged FROM time_entries
         WHERE employee_id = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(emp.id, rangeStart, rangeEnd) as {
      type: string;
      timestamp: string;
      flagged: number;
    }[];

    if (entries.length === 0) {
      // Nothing worked, and no longer here: not a row, just a name taking up a
      // line on a sheet somebody is reading to pay people.
      if (!emp.active && !args.employeeId) continue;
      rows.push(emptyRow(emp.id, emp.name, args.startDate, args.endDate));
      continue;
    }

    // Group by date. Entries that span midnight will pair within the same date
    // (we close shifts at 9pm, so this is rare).
    const byDate = new Map<string, typeof entries>();
    for (const e of entries) {
      const d = e.timestamp.slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(e);
    }

    const dailies: DailyBreakdown[] = [];
    let totalWorked = 0;
    let totalBreak = 0;
    let anyFlagged = entries.some((e) => e.flagged === 1);

    for (const date of dateRange(args.startDate, args.endDate)) {
      const list = byDate.get(date) ?? [];
      const stats = computeDayStats(list);
      dailies.push({ date, ...stats });
      totalWorked += stats.workedMinutes;
      totalBreak += stats.breakMinutes;
    }

    rows.push({
      employee_id: emp.id,
      employee_name: emp.name,
      totalWorkedMinutes: totalWorked,
      totalBreakMinutes: totalBreak,
      netWorkedMinutes: totalWorked, // breaks are unpaid time off-clock; worked already excludes them
      workedHHMM: formatHHMM(totalWorked),
      breakHHMM: formatHHMM(totalBreak),
      netHHMM: formatHHMM(totalWorked),
      workedDecimal: (totalWorked / 60).toFixed(2),
      daily: dailies,
      hasFlagged: anyFlagged,
    });
  }

  return {
    startDate: args.startDate,
    endDate: args.endDate,
    weekStartDay: args.weekStartDay,
    rows,
  };
}

function emptyRow(
  id: number,
  name: string,
  startDate: string,
  endDate: string,
): EmployeeWeekly {
  return {
    employee_id: id,
    employee_name: name,
    totalWorkedMinutes: 0,
    totalBreakMinutes: 0,
    netWorkedMinutes: 0,
    workedHHMM: "0h 00m",
    breakHHMM: "0h 00m",
    netHHMM: "0h 00m",
    workedDecimal: "0.00",
    daily: dateRange(startDate, endDate).map((date) => ({
      date,
      workedMinutes: 0,
      breakMinutes: 0,
      shifts: 0,
      hasOpenShift: false,
      hasFlagged: false,
    })),
    hasFlagged: false,
  };
}

function computeDayStats(
  entries: { type: string; timestamp: string; flagged: number }[],
): Omit<DailyBreakdown, "date"> {
  let worked = 0;
  let breaks = 0;
  let shifts = 0;
  let openShift = false;
  let hasFlagged = false;

  let shiftStart: string | null = null;
  let breakStart: string | null = null;

  for (const e of entries) {
    if (e.flagged) hasFlagged = true;
    if (e.type === "check_in") {
      shiftStart = e.timestamp;
    } else if (e.type === "check_out" && shiftStart) {
      worked += diffMinutes(shiftStart, e.timestamp);
      shifts++;
      shiftStart = null;
    } else if (e.type === "break_start" && shiftStart) {
      breakStart = e.timestamp;
    } else if (e.type === "break_end" && breakStart && shiftStart) {
      const b = diffMinutes(breakStart, e.timestamp);
      breaks += b;
      // Subtract break from worked (we've been counting working time, but
      // break time inside a shift shouldn't count as worked).
      worked -= b;
      breakStart = null;
    }
  }
  if (shiftStart) openShift = true;
  if (worked < 0) worked = 0;

  return {
    workedMinutes: worked,
    breakMinutes: breaks,
    shifts,
    hasOpenShift: openShift,
    hasFlagged,
  };
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

export function currentWeekRange(weekStartDay: number): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const start = startOfWeek(now, weekStartDay);
  const end = endOfWeek(now, weekStartDay);
  end.setDate(end.getDate() - 1); // inclusive endpoint
  return {
    startDate: toLocalIso(start).slice(0, 10),
    endDate: toLocalIso(end).slice(0, 10),
  };
}
