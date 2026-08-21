import { getDb } from "./db";
import { hashPin, isValidPinFormat, pinIsTakenByOther } from "./pin";
import { nowLocalIso } from "./time";
import { isPosRole, type PosRole } from "./roles";
import { properName } from "./names";

export type Employee = {
  id: number;
  name: string;
  role: string | null;
  pos_role: PosRole;
  active: number;
  /** Cents an hour. Null means nobody has said — not that they are unpaid. */
  hourly_rate_cents: number | null;
  created_at: string;
  updated_at: string;
};

const EMPLOYEE_COLUMNS =
  "id, name, role, pos_role, active, hourly_rate_cents, created_at, updated_at";

export type EmployeeWithState = Employee & {
  current_state: "checked_out" | "checked_in" | "on_break";
  last_event_at: string | null;
};

export function listEmployees(includeInactive = false): Employee[] {
  const db = getDb();
  const sql = includeInactive
    ? `SELECT ${EMPLOYEE_COLUMNS} FROM employees ORDER BY active DESC, name`
    : `SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE active = 1 ORDER BY name`;
  return db.prepare(sql).all() as Employee[];
}

/**
 * Who can be credited with a line of work.
 *
 * The floor, not the payroll. `role` here is the job on the time clock, not the
 * POS permission — an owner may well have a manager's POS role and never touch
 * a tire, and putting the office staff in the register's mechanic list only
 * makes the right name harder to hit on a busy Saturday.
 *
 * Matched on a prefix because the existing rows disagree with themselves:
 * "TIRE" and "TIRES" both exist, typed by hand years apart. Anyone whose job
 * title starts with TIRE is on the floor.
 */
export function listMechanics(): Employee[] {
  return getDb()
    .prepare(
      /*
        The mechanic role is excluded by name, on top of the job-label test.

        Without it, keeping a mechanic out of the register would depend on
        nobody ever typing TIRE into their job label — a convention held in a
        different column by a different screen, which is the kind of rule that
        holds until the day somebody is hired and typed in a hurry.
      */
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees
        WHERE active = 1 AND UPPER(COALESCE(role, '')) LIKE 'TIRE%'
          AND LOWER(COALESCE(pos_role, '')) <> 'mechanic'
        ORDER BY name`,
    )
    .all() as Employee[];
}

/**
 * The counter — everybody who sells, as opposed to everybody who fits.
 *
 * A separate list from `listMechanics` rather than a widening of it, because
 * the two answer different questions and only one of them is about work done
 * in a bay. Somebody at the counter sells a tire; a technician fits it. Both
 * are credited on the line that pays them, and the register decides which
 * list it is asking for — see the mechanic picker there.
 *
 * WRITERS WERE THE WHOLE LIST FIRST, and the shop found the hole within the
 * week: a manager who sells a set of tires had no name to put on the line
 * either. So the rule is now every counter role that can ring a sale, which
 * is a rule rather than a list of the people who happened to complain —
 * cashier is in it too, against the day the shop hires one.
 *
 * THREE ROLES ARE OUTSIDE IT, each for its own reason. The accountant keeps
 * the customer book and does not work the forecourt. The viewer cannot write
 * anything at all, and a read-only account holding credit for a sale is a
 * contradiction rather than an omission. And the OWNER is out at his own
 * word: he can already reach every screen in the building, so his name in
 * this grid buys nothing and is one more thing to press by accident on a
 * busy Saturday. If he ever wants a tire against his own name, Other takes
 * it — see the picker.
 *
 * Keyed on `pos_role` rather than `role`, which is where this distinction
 * actually lives: the shop's writers and managers all carry role OFFICE
 * alongside the bookkeeper, and OFFICE is not the question being asked.
 */
export function listCounterStaff(): Employee[] {
  return getDb()
    .prepare(
      `SELECT ${EMPLOYEE_COLUMNS} FROM employees
        WHERE active = 1
          AND LOWER(COALESCE(pos_role, '')) IN ('writer', 'cashier', 'manager')
        ORDER BY name`,
    )
    .all() as Employee[];
}

export function getEmployee(id: number): Employee | null {
  const db = getDb();
  return (
    (db
      .prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = ?`)
      .get(id) as Employee | undefined) ?? null
  );
}

export function createEmployee(args: {
  name: string;
  pin: string;
  role?: string | null;
  posRole?: string | null;
}): { ok: true; id: number } | { ok: false; error: string } {
  // Tidied on the way in rather than on the way out to every screen. See the
  // note on `properName` for what it does and does not touch — a name typed with
  // deliberate mixed case survives it untouched.
  const name = properName(args.name);
  if (!name) return { ok: false, error: "Name is required" };
  if (!isValidPinFormat(args.pin))
    return { ok: false, error: "PIN must be exactly 4 digits" };
  if (pinIsTakenByOther(args.pin))
    return { ok: false, error: "That PIN is already in use" };
  const posRole = args.posRole ?? "technician";
  if (!isPosRole(posRole)) return { ok: false, error: "Invalid POS role" };
  const db = getDb();
  const now = nowLocalIso();
  const result = db
    .prepare(
      "INSERT INTO employees (name, pin_hash, role, pos_role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    )
    .run(name, hashPin(args.pin), args.role?.trim() || null, posRole, now, now);
  return { ok: true, id: Number(result.lastInsertRowid) };
}

export function updateEmployee(
  id: number,
  args: {
    name?: string;
    role?: string | null;
    posRole?: string;
    active?: boolean;
    /** Cents an hour, or null for "nobody has said" — see 046_employee_wage. */
    hourlyRateCents?: number | null;
  },
): { ok: true } | { ok: false; error: string } {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (args.name !== undefined) {
    const name = properName(args.name);
    if (!name) return { ok: false, error: "Name cannot be empty" };
    fields.push("name = ?");
    values.push(name);
  }
  if (args.role !== undefined) {
    fields.push("role = ?");
    values.push(args.role?.trim() || null);
  }
  if (args.posRole !== undefined) {
    if (!isPosRole(args.posRole)) return { ok: false, error: "Invalid POS role" };
    fields.push("pos_role = ?");
    values.push(args.posRole);
  }
  if (args.active !== undefined) {
    fields.push("active = ?");
    values.push(args.active ? 1 : 0);
  }
  if (args.hourlyRateCents !== undefined) {
    /*
      Null clears it back to "not known", which is a real state and not the same
      as zero — see the migration. A negative rate is refused rather than
      clamped: it can only be a typo, and a wage bill quietly computed from
      minus four dollars an hour is worse than a rejected form.
    */
    if (args.hourlyRateCents !== null && (!Number.isInteger(args.hourlyRateCents) || args.hourlyRateCents < 0))
      return { ok: false, error: "That is not an hourly rate" };
    fields.push("hourly_rate_cents = ?");
    values.push(args.hourlyRateCents);
  }
  if (fields.length === 0) return { ok: true };
  fields.push("updated_at = ?");
  values.push(nowLocalIso());
  values.push(id);
  const db = getDb();
  db.prepare(`UPDATE employees SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return { ok: true };
}

export function resetEmployeePin(
  id: number,
  newPin: string,
): { ok: true } | { ok: false; error: string } {
  if (!isValidPinFormat(newPin))
    return { ok: false, error: "PIN must be exactly 4 digits" };
  if (pinIsTakenByOther(newPin, id))
    return { ok: false, error: "That PIN is already in use" };
  const db = getDb();
  db.prepare(
    "UPDATE employees SET pin_hash = ?, updated_at = ? WHERE id = ?",
  ).run(hashPin(newPin), nowLocalIso(), id);
  return { ok: true };
}

/**
 * Deleting an employee who appears anywhere in the books would either orphan or
 * erase money records, so it is refused — deactivate them instead.
 *
 * WHY THIS READS THE SCHEMA INSTEAD OF LISTING THE TABLES
 *
 * It used to name four columns by hand: sales, sale_items, payments,
 * inventory_movements. There are twenty-five columns pointing at `employees`.
 * The other twenty-one — who opened the shift, who received the lot, who locked
 * payroll, who counted the register — got no check at all, so deleting one of
 * those people did not produce the friendly refusal above, it produced a raw
 * SQLITE_CONSTRAINT_FOREIGNKEY out of the depths of the driver, on a screen
 * with no handler for it. A hand-written list is also wrong the day somebody
 * adds a table, and wrong silently, which is the worst way to be wrong here.
 *
 * `foreign_key_list` is the same thing SQLite itself is about to consult. If it
 * says nobody points at this row, the DELETE below cannot fail.
 *
 * TWO DELIBERATE EXCEPTIONS
 *
 * `pos_sessions` is a live credential, not history — the right thing to do with
 * a departing employee's session is end it, so those rows are deleted here
 * rather than counted as a reason to refuse.
 *
 * `audit_log` is the opposite, and it is the reason this function refuses more
 * often than it looks like it should. One line in there — even just a login —
 * makes an employee permanently undeletable, and that is correct: the log is
 * the record of who did what, and an employee row it points at is how the log
 * stays readable. Erasing the person to tidy up the list is exactly the edit
 * the whole append-only design exists to prevent.
 */
export function deleteEmployee(
  id: number,
): { ok: true } | { ok: false; error: string } {
  const db = getDb();

  const refs = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];

  let total = 0;
  const where: string[] = [];
  for (const { name } of refs) {
    if (name === "pos_sessions") continue;
    const cols = (db.pragma(`foreign_key_list("${name}")`) as { table: string; from: string }[])
      .filter((f) => f.table === "employees")
      .map((f) => f.from);
    if (cols.length === 0) continue;
    const clause = cols.map((c) => `"${c}" = ?`).join(" OR ");
    const n = (
      db.prepare(`SELECT COUNT(*) n FROM "${name}" WHERE ${clause}`).get(...cols.map(() => id)) as {
        n: number;
      }
    ).n;
    if (n > 0) {
      total += n;
      where.push(name);
    }
  }

  if (total > 0) {
    return {
      ok: false,
      error: `This employee appears on ${total} record${total === 1 ? "" : "s"} (${where.join(", ")}) and can't be deleted. Deactivate them instead.`,
    };
  }

  db.prepare("DELETE FROM pos_sessions WHERE employee_id = ?").run(id);
  db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  return { ok: true };
}

/**
 * Determine an employee's current state from the latest time entry.
 * checked_out: no entries today, or last entry was check_out
 * checked_in:  last entry was check_in or break_end
 * on_break:    last entry was break_start
 */
export function getEmployeeState(employeeId: number): {
  state: "checked_out" | "checked_in" | "on_break";
  lastEventAt: string | null;
  lastEventType: string | null;
} {
  const db = getDb();
  const last = db
    .prepare(
      "SELECT type, timestamp FROM time_entries WHERE employee_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1",
    )
    .get(employeeId) as { type: string; timestamp: string } | undefined;
  if (!last)
    return { state: "checked_out", lastEventAt: null, lastEventType: null };

  let state: "checked_out" | "checked_in" | "on_break" = "checked_out";
  if (last.type === "check_in" || last.type === "break_end") state = "checked_in";
  else if (last.type === "break_start") state = "on_break";
  else if (last.type === "check_out") state = "checked_out";

  return { state, lastEventAt: last.timestamp, lastEventType: last.type };
}
