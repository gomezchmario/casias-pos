import { getDb } from "./db";
import { logAudit } from "./audit";
import { getSetting } from "./settings";
import { localIsoToDate, nowLocalIso, todayLocalDate } from "./time";

/**
 * Find any open shifts (employees who are checked in or on break) where the
 * latest event is from BEFORE the auto-close threshold today, or from a prior
 * day. Auto-create a check_out at the configured hour and flag both entries
 * so admins notice.
 *
 * Idempotent — safe to call frequently (e.g. on every kiosk request).
 */
export function autoCloseStaleShifts(): { closed: number } {
  const db = getDb();
  const autoCloseHour = parseInt(getSetting("auto_close_hour"), 10) || 21;

  const now = new Date();
  const today = todayLocalDate();
  const todayThreshold = `${today}T${String(autoCloseHour).padStart(2, "0")}:00:00`;

  // We only auto-close shifts whose latest event is at or before the threshold.
  // The cutoff for an entry to be eligible is "now if it's after threshold today, else yesterday's threshold".
  let cutoff: string;
  if (now.getHours() >= autoCloseHour) {
    cutoff = todayThreshold;
  } else {
    // Yesterday's threshold
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yISO = y.toISOString().slice(0, 10);
    cutoff = `${yISO}T${String(autoCloseHour).padStart(2, "0")}:00:00`;
  }

  // Find employees whose most-recent entry is check_in or break_start AND
  // that entry's timestamp is at or before the cutoff.
  const candidates = db
    .prepare(
      `SELECT e.id AS employee_id, e.name, latest.type AS last_type, latest.timestamp AS last_ts
       FROM employees e
       JOIN (
         SELECT employee_id, type, timestamp,
                ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY timestamp DESC, id DESC) AS rn
         FROM time_entries
       ) latest ON latest.employee_id = e.id AND latest.rn = 1
       WHERE e.active = 1
         AND latest.type IN ('check_in', 'break_start')
         AND latest.timestamp <= ?`,
    )
    .all(cutoff) as {
    employee_id: number;
    name: string;
    last_type: string;
    last_ts: string;
  }[];

  if (candidates.length === 0) return { closed: 0 };

  const insert = db.prepare(
    `INSERT INTO time_entries
       (employee_id, type, timestamp, photo_path, flagged, flag_reason, created_at)
     VALUES (?, ?, ?, NULL, 1, ?, ?)`,
  );
  const flagOriginal = db.prepare(
    `UPDATE time_entries SET flagged = 1,
       flag_reason = COALESCE(flag_reason, '') || ?
     WHERE id = (
       SELECT id FROM time_entries
       WHERE employee_id = ? AND type = ? AND timestamp = ?
       ORDER BY id DESC LIMIT 1
     )`,
  );

  const tx = db.transaction(() => {
    let closed = 0;
    for (const c of candidates) {
      // Compute the close timestamp: same date as the open event, at autoCloseHour.
      const openDate = c.last_ts.slice(0, 10);
      const closeIso = `${openDate}T${String(autoCloseHour).padStart(2, "0")}:00:00`;

      // If the open event somehow occurred after the close hour on its day,
      // close at the open event's time + 0 (already past hour) to avoid out-of-order.
      const openDateObj = localIsoToDate(c.last_ts);
      const closeDateObj = localIsoToDate(closeIso);
      const finalCloseIso =
        closeDateObj.getTime() < openDateObj.getTime() ? c.last_ts : closeIso;

      // If the employee was on break, end the break first, then check out.
      if (c.last_type === "break_start") {
        insert.run(
          c.employee_id,
          "break_end",
          finalCloseIso,
          `Auto-ended break at ${finalCloseIso} (auto-close)`,
          nowLocalIso(),
        );
      }
      insert.run(
        c.employee_id,
        "check_out",
        finalCloseIso,
        `Auto-closed at ${finalCloseIso} — employee did not check out`,
        nowLocalIso(),
      );
      flagOriginal.run(
        " | Auto-closed by system",
        c.employee_id,
        c.last_type,
        c.last_ts,
      );
      logAudit({
        adminId: null,
        adminUsername: "system",
        action: "system.auto_close",
        targetType: "employee",
        targetId: c.employee_id,
        details: {
          employee_name: c.name,
          last_event_type: c.last_type,
          last_event_at: c.last_ts,
          auto_close_at: finalCloseIso,
        },
      });
      closed++;
    }
    return closed;
  });
  return { closed: tx() };
}
