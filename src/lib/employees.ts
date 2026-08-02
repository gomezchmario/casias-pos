import { getDb } from "./db";
import { hashPin, isValidPinFormat, pinIsTakenByOther } from "./pin";
import { nowLocalIso } from "./time";
import { isPosRole, type PosRole } from "./roles";

export type Employee = {
  id: number;
  name: string;
  role: string | null;
  pos_role: PosRole;
  active: number;
  created_at: string;
  updated_at: string;
};

const EMPLOYEE_COLUMNS =
  "id, name, role, pos_role, active, created_at, updated_at";

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
  const name = args.name.trim();
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
  args: { name?: string; role?: string | null; posRole?: string; active?: boolean },
): { ok: true } | { ok: false; error: string } {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (args.name !== undefined) {
    const name = args.name.trim();
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
 * Deleting an employee who appears anywhere in the POS books would either
 * orphan or erase money records, so it is refused — deactivate them instead.
 */
export function deleteEmployee(
  id: number,
): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  const referenced = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE cashier_id = ?1) +
         (SELECT COUNT(*) FROM sale_items WHERE mechanic_id = ?1) +
         (SELECT COUNT(*) FROM payments WHERE taken_by = ?1) +
         (SELECT COUNT(*) FROM inventory_movements WHERE created_by = ?1) AS n`,
    )
    .get(id) as { n: number };

  if (referenced.n > 0) {
    return {
      ok: false,
      error: `This employee appears on ${referenced.n} sales or inventory records and can't be deleted. Deactivate them instead.`,
    };
  }

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
