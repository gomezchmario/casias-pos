import { getDb } from "./db";
import { nowLocalIso } from "./time";

export type EntryType =
  | "check_in"
  | "check_out"
  | "break_start"
  | "break_end";

export type TimeEntry = {
  id: number;
  employee_id: number;
  type: EntryType;
  timestamp: string;
  photo_path: string | null;
  flagged: number;
  flag_reason: string | null;
  notes: string | null;
  edited_by_admin_id: number | null;
  edited_at: string | null;
  created_at: string;
};

export type TimeEntryWithEmployee = TimeEntry & {
  employee_name: string;
};

export function createEntry(args: {
  employeeId: number;
  type: EntryType;
  photoPath?: string | null;
  flagged?: boolean;
  flagReason?: string | null;
  timestamp?: string;
}): number {
  const db = getDb();
  const now = nowLocalIso();
  const ts = args.timestamp ?? now;
  const result = db
    .prepare(
      `INSERT INTO time_entries
        (employee_id, type, timestamp, photo_path, flagged, flag_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.employeeId,
      args.type,
      ts,
      args.photoPath ?? null,
      args.flagged ? 1 : 0,
      args.flagReason ?? null,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function getEntry(id: number): TimeEntry | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM time_entries WHERE id = ?").get(id) as
      | TimeEntry
      | undefined) ?? null
  );
}

export type ListEntriesArgs = {
  employeeId?: number;
  type?: EntryType;
  startDate?: string; // YYYY-MM-DD inclusive
  endDate?: string; // YYYY-MM-DD inclusive
  flaggedOnly?: boolean;
  limit?: number;
  offset?: number;
};

export function listEntries(
  args: ListEntriesArgs = {},
): TimeEntryWithEmployee[] {
  const db = getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (args.employeeId) {
    where.push("e.employee_id = ?");
    params.push(args.employeeId);
  }
  if (args.type) {
    where.push("e.type = ?");
    params.push(args.type);
  }
  if (args.startDate) {
    where.push("e.timestamp >= ?");
    params.push(`${args.startDate}T00:00:00`);
  }
  if (args.endDate) {
    where.push("e.timestamp <= ?");
    params.push(`${args.endDate}T23:59:59`);
  }
  if (args.flaggedOnly) {
    where.push("e.flagged = 1");
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = args.limit ?? 500;
  const offset = args.offset ?? 0;
  const sql = `
    SELECT e.*, emp.name AS employee_name
    FROM time_entries e
    JOIN employees emp ON emp.id = e.employee_id
    ${whereClause}
    ORDER BY e.timestamp DESC, e.id DESC
    LIMIT ? OFFSET ?`;
  return db
    .prepare(sql)
    .all(...params, limit, offset) as TimeEntryWithEmployee[];
}

export function updateEntry(
  id: number,
  args: {
    timestamp?: string;
    type?: EntryType;
    notes?: string | null;
    flagged?: boolean;
    flagReason?: string | null;
    adminId: number;
  },
): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (args.timestamp !== undefined) {
    fields.push("timestamp = ?");
    values.push(args.timestamp);
  }
  if (args.type !== undefined) {
    fields.push("type = ?");
    values.push(args.type);
  }
  if (args.notes !== undefined) {
    fields.push("notes = ?");
    values.push(args.notes);
  }
  if (args.flagged !== undefined) {
    fields.push("flagged = ?");
    values.push(args.flagged ? 1 : 0);
  }
  if (args.flagReason !== undefined) {
    fields.push("flag_reason = ?");
    values.push(args.flagReason);
  }
  if (fields.length === 0) return;
  fields.push("edited_by_admin_id = ?");
  values.push(args.adminId);
  fields.push("edited_at = ?");
  values.push(nowLocalIso());
  values.push(id);
  const db = getDb();
  db.prepare(`UPDATE time_entries SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

export function deleteEntry(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM time_entries WHERE id = ?").run(id);
}
