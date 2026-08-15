import { getDb } from "./db";
import { nowLocalIso } from "./time";

/**
 * The roster: who is expected in, and when.
 *
 * A thin layer over one table on purpose. The shop rosters five technicians by
 * writing names against days, and every clever thing this could grow — patterns,
 * rotations, availability windows — is a week of work to save a minute of
 * typing at a shop this size. What it does have to do well is arithmetic:
 * hours rostered against the hours the tickets say are needed, which is the
 * whole reason the roster is worth holding in the same database as the sales.
 */

export type Shift = {
  id: number;
  employeeId: number;
  workDate: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  note: string | null;
};

export type ScheduledPerson = {
  employeeId: number;
  name: string;
  role: string;
  /** Cents an hour, or null where nobody has set one. */
  hourlyRateCents: number | null;
  /** Their shifts in the window, keyed by date. */
  byDate: Record<string, Shift>;
};

/** Paid hours in a shift — the break is unpaid, which is what makes it a break. */
export const paidHours = (s: Shift): number =>
  Math.max(0, s.endMinute - s.startMinute - s.breakMinutes) / 60;

/** "8:00am" from minutes past midnight, for a label rather than a form. */
export function clockOf(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

/**
 * Everybody who could be rostered, with whatever they are rostered for.
 *
 * EVERY ACTIVE EMPLOYEE, not only the ones already on the roster — an empty
 * week has to be fillable, and a screen that only lists people who already have
 * shifts is a screen that can never gain a first one. Technicians first,
 * because they are who the staffing figures are about and who gets rostered
 * most; the rest follow so the counter and the office can still be written in.
 */
export function scheduleFor(from: string, to: string): ScheduledPerson[] {
  const db = getDb();

  const people = db
    .prepare(
      `SELECT id AS employeeId, name, pos_role AS role, hourly_rate_cents AS hourlyRateCents
         FROM employees
        WHERE active = 1
     ORDER BY CASE pos_role WHEN 'technician' THEN 0 ELSE 1 END, name`,
    )
    .all() as Omit<ScheduledPerson, "byDate">[];

  const shifts = db
    .prepare(
      `SELECT id, employee_id AS employeeId, work_date AS workDate,
              start_minute AS startMinute, end_minute AS endMinute,
              break_minutes AS breakMinutes, note
         FROM schedule_shifts
        WHERE work_date BETWEEN ? AND ?`,
    )
    .all(from, to) as Shift[];

  const byPerson = new Map<number, Record<string, Shift>>();
  for (const s of shifts) {
    const mine = byPerson.get(s.employeeId) ?? {};
    mine[s.workDate] = s;
    byPerson.set(s.employeeId, mine);
  }

  return people.map((p) => ({ ...p, byDate: byPerson.get(p.employeeId) ?? {} }));
}

/**
 * Put somebody on a day, or move the shift they already have.
 *
 * Upsert on the person-and-day pair rather than insert-or-error, because that
 * is what the screen does: clicking a cell that already has a shift in it is
 * editing that shift, and making the caller work out which verb to use would
 * put the same decision in two places.
 */
export function setShift(args: {
  employeeId: number;
  workDate: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  note?: string | null;
  adminId?: number | null;
}): { ok: true; id: number } | { ok: false; error: string } {
  const { employeeId, workDate, startMinute, endMinute, breakMinutes } = args;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, error: "That is not a date" };
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > 1440 ||
    endMinute <= startMinute
  )
    return { ok: false, error: "The shift has to end after it starts" };
  /*
    A break cannot be longer than the shift it is inside. Refused rather than
    clamped: a nine-hour break on an eight-hour shift is a typo, and silently
    turning it into zero paid hours would put somebody on the roster who,
    according to the arithmetic, is not there.
  */
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= endMinute - startMinute)
    return { ok: false, error: "The break has to be shorter than the shift" };

  const now = nowLocalIso();
  const info = getDb()
    .prepare(
      `INSERT INTO schedule_shifts
         (employee_id, work_date, start_minute, end_minute, break_minutes, note,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         start_minute  = excluded.start_minute,
         end_minute    = excluded.end_minute,
         break_minutes = excluded.break_minutes,
         note          = excluded.note,
         updated_at    = excluded.updated_at`,
    )
    .run(
      employeeId,
      workDate,
      startMinute,
      endMinute,
      breakMinutes,
      args.note?.trim() || null,
      args.adminId ?? null,
      now,
      now,
    );

  const id =
    Number(info.lastInsertRowid) ||
    ((
      getDb()
        .prepare("SELECT id FROM schedule_shifts WHERE employee_id = ? AND work_date = ?")
        .get(employeeId, workDate) as { id: number }
    ).id);
  return { ok: true, id };
}

/** Take somebody off a day. A roster entry deleted is simply not rostered. */
export function clearShift(employeeId: number, workDate: string): { ok: true } {
  getDb()
    .prepare("DELETE FROM schedule_shifts WHERE employee_id = ? AND work_date = ?")
    .run(employeeId, workDate);
  return { ok: true };
}

/**
 * Copy one week onto the next.
 *
 * The one convenience worth having, because a tire shop's roster is the same
 * week over and over with a name moved. Existing shifts in the target week are
 * left alone rather than overwritten — somebody who has already written next
 * Tuesday in by hand meant it, and a copy button that quietly undid that would
 * be used once.
 */
export function copyWeek(fromMonday: string, toMonday: string): { copied: number } {
  const db = getDb();
  const src = db
    .prepare(
      `SELECT employee_id, work_date, start_minute, end_minute, break_minutes, note
         FROM schedule_shifts
        WHERE work_date BETWEEN ? AND date(?, '+6 days')`,
    )
    .all(fromMonday, fromMonday) as {
    employee_id: number;
    work_date: string;
    start_minute: number;
    end_minute: number;
    break_minutes: number;
    note: string | null;
  }[];

  const now = nowLocalIso();
  const shift = db.prepare("SELECT date(?, '+' || ? || ' days') AS d");
  const offset = (
    db.prepare("SELECT CAST(julianday(?) - julianday(?) AS INTEGER) AS n").get(toMonday, fromMonday) as {
      n: number;
    }
  ).n;

  const insert = db.prepare(
    `INSERT INTO schedule_shifts
       (employee_id, work_date, start_minute, end_minute, break_minutes, note,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, work_date) DO NOTHING`,
  );

  let copied = 0;
  db.transaction(() => {
    for (const r of src) {
      const d = (shift.get(r.work_date, offset) as { d: string }).d;
      const res = insert.run(
        r.employee_id,
        d,
        r.start_minute,
        r.end_minute,
        r.break_minutes,
        r.note,
        now,
        now,
      );
      copied += res.changes;
    }
  })();

  return { copied };
}
