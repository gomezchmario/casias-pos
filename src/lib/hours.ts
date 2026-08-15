import { getDb } from "./db";
import { inTx } from "./tx";
import { nowLocalIso } from "./time";
import { logActorAudit, type Actor } from "./audit";
import { can } from "./roles";
import type { PosUser } from "./pos-session";

/**
 * Hours actually worked, and how much of that is really known.
 *
 * THE CLOCK WAS ALWAYS THERE; WHAT WAS MISSING WAS THE SECOND HALF. People
 * check IN — the kiosk is by the door and it is the first thing they do — and
 * essentially nobody checks OUT, because checking out means walking back to a
 * kiosk after you have already finished. So a nightly job auto-closes the open
 * entries at nine, and every stored day reads as ending at 21:00 whether the
 * technician left at four or at nine.
 *
 * That is why this module exists rather than a SUM over `time_entries`: those
 * auto-closed intervals are not measurements, they are placeholders, and a
 * revenue-per-hour figure built on them would divide real money by invented
 * time and put a confident number on the screen. Every interval here carries
 * whether its ending was recorded or assumed, and every total comes in two
 * parts — hours that are known, and hours that are guessed — so a caller has to
 * decide what to do about it rather than being handed a single number that
 * hides the question.
 *
 * BREAKS COME OUT. A `break_start`/`break_end` pair inside a shift is unpaid
 * time and the shop's own clock records it; leaving it in would inflate every
 * hour figure by exactly the lunches people are honest enough to log.
 */

export type WorkedInterval = {
  inAt: string;
  outAt: string | null;
  minutes: number;
  /** The clock-out was written by the auto-close, not by a person. */
  assumed: boolean;
  /** Still on the clock right now — no ending at all yet. */
  open: boolean;
};

export type EmployeeHours = {
  employeeId: number;
  name: string;
  role: string;
  /**
   * Cents an hour, or null where nobody has set one.
   *
   * Carried on the hours rather than looked up beside them, so that anything
   * costing a shift is costing it at the rate belonging to THAT person and
   * cannot drift onto a default. Null stays null all the way to the screen —
   * "not set" is a different answer from "free" and the reports have to be able
   * to print the difference.
   */
  hourlyRateCents: number | null;
  /** Minutes whose start AND end were both recorded by somebody. */
  knownMinutes: number;
  /** Minutes whose end was assumed by the auto-close, or is still running. */
  assumedMinutes: number;
  intervals: WorkedInterval[];
  onTheClock: boolean;
  /** When they clocked in, if they are still on. */
  since: string | null;
};

export type DayHours = {
  businessDate: string;
  people: EmployeeHours[];
  knownMinutes: number;
  assumedMinutes: number;
  /** 0–100. How much of the day's recorded time was actually clocked out. */
  confidencePct: number;
};

const MINUTES = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(b.replace(" ", "T")) - Date.parse(a.replace(" ", "T"))) / 60000));

/** The auto-close leaves its signature in `flag_reason`; that is how a
 *  placeholder is told from a person pressing a button. */
const isAutoClose = (reason: string | null) => !!reason && /auto-closed/i.test(reason);

export function hoursForDay(businessDate: string): DayHours {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.employee_id AS employeeId, t.type, t.timestamp, t.flag_reason AS flagReason,
              e.name, e.pos_role AS role, e.hourly_rate_cents AS hourlyRateCents
         FROM time_entries t
         JOIN employees e ON e.id = t.employee_id
        WHERE substr(t.timestamp, 1, 10) = ?
     ORDER BY t.employee_id, t.timestamp, t.id`,
    )
    .all(businessDate) as {
    id: number;
    employeeId: number;
    type: string;
    timestamp: string;
    flagReason: string | null;
    name: string;
    role: string;
    hourlyRateCents: number | null;
  }[];

  const byPerson = new Map<number, EmployeeHours>();
  const open = new Map<number, { at: string }>();
  const breakAt = new Map<number, string>();

  for (const r of rows) {
    const person =
      byPerson.get(r.employeeId) ??
      ({
        employeeId: r.employeeId,
        name: r.name,
        role: r.role,
        hourlyRateCents: r.hourlyRateCents,
        knownMinutes: 0,
        assumedMinutes: 0,
        intervals: [],
        onTheClock: false,
        since: null,
      } satisfies EmployeeHours);
    byPerson.set(r.employeeId, person);

    if (r.type === "check_in") {
      // A second check-in with no check-out between them means the first was
      // never closed; the shift is taken to start at the LATER one rather than
      // silently adding a day-long interval.
      open.set(r.employeeId, { at: r.timestamp });
      breakAt.delete(r.employeeId);
    } else if (r.type === "break_start") {
      breakAt.set(r.employeeId, r.timestamp);
    } else if (r.type === "break_end") {
      const started = breakAt.get(r.employeeId);
      if (started) {
        // Unpaid time comes straight off the running interval.
        const mins = MINUTES(started, r.timestamp);
        person.knownMinutes -= Math.min(person.knownMinutes, mins);
        breakAt.delete(r.employeeId);
      }
    } else if (r.type === "check_out") {
      const started = open.get(r.employeeId);
      if (!started) continue;
      const assumed = isAutoClose(r.flagReason);
      const mins = MINUTES(started.at, r.timestamp);
      person.intervals.push({
        inAt: started.at,
        outAt: r.timestamp,
        minutes: mins,
        assumed,
        open: false,
      });
      if (assumed) person.assumedMinutes += mins;
      else person.knownMinutes += mins;
      open.delete(r.employeeId);
    }
  }

  // Anybody still on the clock at the time of asking.
  const now = nowLocalIso();
  for (const [employeeId, started] of open) {
    const person = byPerson.get(employeeId)!;
    const mins = MINUTES(started.at, now);
    person.intervals.push({ inAt: started.at, outAt: null, minutes: mins, assumed: true, open: true });
    person.assumedMinutes += mins;
    person.onTheClock = true;
    person.since = started.at;
  }

  const people = [...byPerson.values()].sort(
    (a, b) => b.knownMinutes + b.assumedMinutes - (a.knownMinutes + a.assumedMinutes),
  );
  const knownMinutes = people.reduce((n, p) => n + p.knownMinutes, 0);
  const assumedMinutes = people.reduce((n, p) => n + p.assumedMinutes, 0);
  const total = knownMinutes + assumedMinutes;

  return {
    businessDate,
    people,
    knownMinutes,
    assumedMinutes,
    confidencePct: total > 0 ? Math.round((knownMinutes / total) * 100) : 0,
  };
}

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: string };

/**
 * Clock somebody out from the close-out, at a time somebody actually states.
 *
 * THE FIX FOR THE MISSING HALF, and it is a workflow fix rather than a data
 * one. Nobody was going to walk back to a kiosk at the end of a shift, so the
 * hours were never going to be real no matter how the sums were written. The
 * person closing the day IS standing at a screen, does know who has gone home,
 * and roughly when — so the close-out asks them, once, and the day's hours stop
 * being fiction.
 *
 * It is NOT self-service and does not pretend to be: the entry records who
 * pressed the button, and an entry closed by somebody else is flagged. That is
 * the honest shape — a manager attesting when a technician left is a different
 * kind of evidence from the technician pressing a button, and payroll should be
 * able to tell them apart.
 */
export function clockOut(
  user: PosUser,
  employeeId: number,
  atIso: string,
): Result<{ entryId: number }> {
  if (!can(user.role, "closeShift"))
    return { ok: false, error: "Your account doesn't close the day" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(atIso))
    return { ok: false, error: "That is not a time" };

  const db = getDb();
  const last = db
    .prepare(
      `SELECT type, timestamp FROM time_entries
        WHERE employee_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1`,
    )
    .get(employeeId) as { type: string; timestamp: string } | undefined;
  if (!last || last.type === "check_out")
    return { ok: false, error: "They are not on the clock" };
  if (atIso < last.timestamp)
    return { ok: false, error: "That is before they clocked in" };

  return inTx(() => {
    const self = user.employeeId === employeeId;
    const info = db
      .prepare(
        `INSERT INTO time_entries
           (employee_id, type, timestamp, photo_path, flagged, flag_reason, created_at)
         VALUES (?, 'check_out', ?, NULL, ?, ?, ?)`,
      )
      .run(
        employeeId,
        atIso,
        self ? 0 : 1,
        self ? null : `Clocked out from the close-out by ${user.name}`,
        nowLocalIso(),
      );

    logActorAudit(
      {
        type: "employee",
        employeeId: user.employeeId,
        name: user.name,
        role: user.role,
      } satisfies Actor,
      {
        // The clock's own action, the same one the kiosk writes.
        action: "entry.create",
        targetType: "time_entry",
        targetId: Number(info.lastInsertRowid),
        details: { employee_id: employeeId, at: atIso, by_close_out: true, self },
      },
    );
    return { ok: true as const, entryId: Number(info.lastInsertRowid) };
  });
}
