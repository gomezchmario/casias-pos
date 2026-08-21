import { getDb } from "./db";
import { currentBusinessDate } from "./business-date";
import { nowLocalIso } from "./time";
import { getEmployeeState } from "./employees";
import { createEntry, type EntryType } from "./entries";
import { clockOf, clearShift, setShift } from "./schedule";

/**
 * The shift desk: the two-way half of the roster.
 *
 * `schedule.ts` writes down what is meant to happen; this module carries what
 * people SAY about it — an employee asking off, offering to cover, proposing
 * different hours — and what a manager answered, plus the live board that
 * compares the roster against the clock and lets a manager punch for somebody
 * who forgot.
 *
 * THE PHONE RULE, stated once here because three routes enforce it: nobody
 * files a request until the shop has a number to reach them on. A call-off
 * with no callback number is half a conversation, and the first visit to the
 * schedule is the one moment the shop has leverage to ask.
 *
 * ATTRIBUTION IS NEVER OPTIONAL. Requests are created by the PIN that proved
 * who was asking; resolutions carry the manager's id; a manager's punch for
 * somebody else writes `recorded_by` on the entry. Nothing in this file
 * deletes anything — a request is resolved or withdrawn, never erased.
 */

// ── Phones ─────────────────────────────────────────────────────────────────

export function phoneOf(employeeId: number): string | null {
  const r = getDb()
    .prepare("SELECT phone FROM employees WHERE id = ?")
    .get(employeeId) as { phone: string | null } | undefined;
  return r?.phone?.trim() || null;
}

/**
 * Ten digits, kept as typed apart from the junk. Dashes, spaces and dots are
 * how people write numbers; the digits are what gets dialled — so the digits
 * are what is judged, and the stored form is the plain ten so every screen
 * prints it the same way.
 */
export function setPhone(
  employeeId: number,
  phone: string,
): { ok: true; phone: string } | { ok: false; error: string } {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10)
    return { ok: false, error: "A phone number needs 10 digits" };
  getDb()
    .prepare("UPDATE employees SET phone = ?, updated_at = ? WHERE id = ?")
    .run(digits, nowLocalIso(), employeeId);
  return { ok: true, phone: digits };
}

/** "2105551234" as "210 555 1234", for reading aloud while dialling. */
export function phoneWords(p: string | null): string | null {
  if (!p) return null;
  return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
}

// ── The employee's own view ────────────────────────────────────────────────

export type MyDay = {
  date: string;
  /** 0=Sunday, matching every weekday in this codebase. */
  weekday: number;
  shift: { start: string; end: string; breakMinutes: number; note: string | null } | null;
  /** Who else is rostered that day — first names on a wall, not a secret. */
  coworkers: string[];
};

export type RequestKind = "call_off" | "change" | "cover_offer" | "more_hours";

export type MyRequest = {
  id: number;
  kind: RequestKind;
  /** Null where the ask is not about a day — more hours has no date. */
  workDate: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  hoursWanted: number | null;
  note: string | null;
  status: "open" | "approved" | "declined" | "withdrawn";
  createdAt: string;
  resolutionNote: string | null;
  resolvedByName: string | null;
};

export function mySchedule(employeeId: number, days = 14): {
  days: MyDay[];
  requests: MyRequest[];
} {
  const db = getDb();
  const today = currentBusinessDate();
  const end = shiftDate(today, days - 1);

  const rows = db
    .prepare(
      `SELECT s.employee_id AS employeeId, e.name, s.work_date AS workDate,
              s.start_minute AS startMinute, s.end_minute AS endMinute,
              s.break_minutes AS breakMinutes, s.note
         FROM schedule_shifts s
         JOIN employees e ON e.id = s.employee_id
        WHERE s.work_date BETWEEN ? AND ?
        ORDER BY s.work_date, s.start_minute`,
    )
    .all(today, end) as {
    employeeId: number;
    name: string;
    workDate: string;
    startMinute: number;
    endMinute: number;
    breakMinutes: number;
    note: string | null;
  }[];

  const out: MyDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDate(today, i);
    const dayRows = rows.filter((r) => r.workDate === date);
    const mine = dayRows.find((r) => r.employeeId === employeeId);
    out.push({
      date,
      weekday: new Date(`${date}T00:00:00`).getDay(),
      shift: mine
        ? {
            start: clockOf(mine.startMinute),
            end: clockOf(mine.endMinute),
            breakMinutes: mine.breakMinutes,
            note: mine.note,
          }
        : null,
      coworkers: dayRows.filter((r) => r.employeeId !== employeeId).map((r) => r.name),
    });
  }

  const requests = db
    .prepare(
      `SELECT r.id, r.kind, r.work_date AS workDate,
              r.proposed_start_minute AS ps, r.proposed_end_minute AS pe,
              r.hours_wanted AS hoursWanted,
              r.note, r.status, r.created_at AS createdAt,
              r.resolution_note AS resolutionNote,
              m.name AS resolvedByName
         FROM schedule_requests r
    LEFT JOIN employees m ON m.id = r.resolved_by
        WHERE r.employee_id = ?
        ORDER BY r.created_at DESC
        LIMIT 30`,
    )
    .all(employeeId)
    .map((raw) => {
      const r = raw as MyRequest & { ps: number | null; pe: number | null };
      return {
        id: r.id,
        kind: r.kind,
        workDate: r.workDate,
        proposedStart: r.ps === null ? null : clockOf(r.ps),
        proposedEnd: r.pe === null ? null : clockOf(r.pe),
        hoursWanted: r.hoursWanted,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt,
        resolutionNote: r.resolutionNote,
        resolvedByName: r.resolvedByName,
      };
    });

  return { days: out, requests };
}

// ── Requests ───────────────────────────────────────────────────────────────

export function createRequest(args: {
  employeeId: number;
  kind: RequestKind;
  /** Required for everything except more_hours, which is not about a day. */
  workDate?: string | null;
  proposedStartMinute?: number | null;
  proposedEndMinute?: number | null;
  hoursWanted?: number | null;
  note?: string | null;
}): { ok: true; id: number } | { ok: false; error: string } {
  const db = getDb();
  const { employeeId, kind } = args;
  const note = args.note?.trim() || null;
  const today = currentBusinessDate();

  if (kind === "more_hours") {
    const hours = args.hoursWanted ?? null;
    if (!Number.isInteger(hours) || (hours as number) <= 0 || (hours as number) > 80)
      return { ok: false, error: "How many hours a week? Between 1 and 80." };
    const dup = db
      .prepare(
        `SELECT 1 FROM schedule_requests
          WHERE employee_id = ? AND kind = 'more_hours' AND status = 'open'`,
      )
      .get(employeeId);
    if (dup)
      return { ok: false, error: "You already asked for more hours — it is waiting for a manager" };
    const info = db
      .prepare(
        `INSERT INTO schedule_requests
           (employee_id, kind, work_date, hours_wanted, note, status, created_at)
         VALUES (?, 'more_hours', NULL, ?, ?, 'open', ?)`,
      )
      .run(employeeId, hours, note, nowLocalIso());
    return { ok: true, id: Number(info.lastInsertRowid) };
  }

  const workDate = String(args.workDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, error: "That is not a date" };
  // Yesterday cannot be called off. Today can — "I am not coming in" at 6 AM
  // is the single most common message this exists to carry.
  if (workDate < today) return { ok: false, error: "That day has already happened" };

  if (kind === "call_off") {
    /*
      Rostered or not — both are real asks. On a rostered day this is "I am
      not coming Thursday"; on a day nothing is written yet it is "keep June
      3rd clear", filed months out for a wedding the roster cannot see that
      far ahead to. The desk reads the difference off the rostered column.
    */
    // A reason, always. "Can't come" with nothing behind it leaves the
    // manager phoning to ask why before they can do anything about who.
    if (!note) return { ok: false, error: "Say why, in a few words" };
  }

  if (kind === "change") {
    const ps = args.proposedStartMinute ?? null;
    const pe = args.proposedEndMinute ?? null;
    const proposesHours = ps !== null || pe !== null;
    if (proposesHours) {
      if (
        ps === null ||
        pe === null ||
        !Number.isInteger(ps) ||
        !Number.isInteger(pe) ||
        ps < 0 ||
        pe > 1440 ||
        pe <= ps
      )
        return { ok: false, error: "The hours have to end after they start" };
    } else if (!note) {
      return { ok: false, error: "Say what you are asking for" };
    }
  }

  // One open ask of a kind per day per person. A second "can't come Thursday"
  // on top of an unanswered first is the same conversation twice.
  const dup = db
    .prepare(
      `SELECT 1 FROM schedule_requests
        WHERE employee_id = ? AND kind = ? AND work_date = ? AND status = 'open'`,
    )
    .get(employeeId, kind, workDate);
  if (dup) return { ok: false, error: "You already asked about that day — it is waiting for a manager" };

  const info = db
    .prepare(
      `INSERT INTO schedule_requests
         (employee_id, kind, work_date, proposed_start_minute, proposed_end_minute,
          note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      employeeId,
      kind,
      workDate,
      kind === "change" ? (args.proposedStartMinute ?? null) : null,
      kind === "change" ? (args.proposedEndMinute ?? null) : null,
      note,
      nowLocalIso(),
    );
  return { ok: true, id: Number(info.lastInsertRowid) };
}

/**
 * Answers this person has not been shown yet, delivered and stamped in one
 * transaction — the punch that reads them is the delivery, and the stamp is
 * what keeps tomorrow's punch from delivering them again.
 */
export function unseenAnswers(employeeId: number): {
  kind: RequestKind;
  workDate: string | null;
  status: "approved" | "declined";
  resolutionNote: string | null;
}[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, kind, work_date AS workDate, status,
              resolution_note AS resolutionNote
         FROM schedule_requests
        WHERE employee_id = ? AND status IN ('approved','declined')
          AND notified_at IS NULL
        ORDER BY resolved_at`,
    )
    .all(employeeId) as {
    id: number;
    kind: RequestKind;
    workDate: string | null;
    status: "approved" | "declined";
    resolutionNote: string | null;
  }[];
  if (rows.length > 0) {
    const stamp = db.prepare("UPDATE schedule_requests SET notified_at = ? WHERE id = ?");
    const now = nowLocalIso();
    const tx = db.transaction(() => {
      for (const r of rows) stamp.run(now, r.id);
    });
    tx();
  }
  return rows.map(({ id: _id, ...r }) => r);
}

/** Only your own, and only while nobody has answered it. */
export function withdrawRequest(
  id: number,
  employeeId: number,
): { ok: true } | { ok: false; error: string } {
  const r = getDb()
    .prepare(
      `UPDATE schedule_requests SET status = 'withdrawn', resolved_at = ?
        WHERE id = ? AND employee_id = ? AND status = 'open'`,
    )
    .run(nowLocalIso(), id, employeeId);
  return r.changes === 1 ? { ok: true } : { ok: false, error: "That request is already settled" };
}

export type DeskRequest = {
  id: number;
  employeeId: number;
  name: string;
  phone: string | null;
  kind: RequestKind;
  workDate: string | null;
  proposedStartMinute: number | null;
  proposedEndMinute: number | null;
  hoursWanted: number | null;
  /** The rostered hours that day, so the ask is read against what stands. */
  rostered: { start: string; end: string } | null;
  note: string | null;
  status: string;
  createdAt: string;
  resolvedByName: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
};

export function listRequests(): { open: DeskRequest[]; recent: DeskRequest[] } {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.employee_id AS employeeId, e.name, e.phone,
              r.kind, r.work_date AS workDate,
              r.proposed_start_minute AS proposedStartMinute,
              r.proposed_end_minute AS proposedEndMinute,
              r.hours_wanted AS hoursWanted,
              r.note, r.status, r.created_at AS createdAt,
              r.resolution_note AS resolutionNote, r.resolved_at AS resolvedAt,
              m.name AS resolvedByName,
              s.start_minute AS rs, s.end_minute AS re
         FROM schedule_requests r
         JOIN employees e ON e.id = r.employee_id
    LEFT JOIN employees m ON m.id = r.resolved_by
    LEFT JOIN schedule_shifts s
           ON s.employee_id = r.employee_id AND s.work_date = r.work_date
        ORDER BY r.created_at DESC
        LIMIT 80`,
    )
    .all()
    .map((raw) => {
      const r = raw as DeskRequest & { rs: number | null; re: number | null };
      return {
        ...r,
        rostered: r.rs !== null && r.re !== null ? { start: clockOf(r.rs), end: clockOf(r.re) } : null,
      };
    });
  const today = currentBusinessDate();
  return {
    /*
      A cover offer for a day that has passed expires by not surfacing, not
      by changing status: the row stays open in the table — an honest record
      that the hand was up and nobody took it — and simply stops being
      anybody's business to answer. A status write would need a sweeper; a
      filter needs nothing and cannot be forgotten.
    */
    open: rows.filter(
      (r) => r.status === "open" && !(r.kind === "cover_offer" && (r.workDate ?? "") < today),
    ),
    recent: rows.filter((r) => r.status !== "open").slice(0, 20),
  };
}

/**
 * Answer one request, and where the answer is yes, make it true.
 *
 * One transaction: an approved call-off whose shift survived, or a cleared
 * shift whose request still said "open", would each be a board disagreeing
 * with the ledger that explains it.
 */
export function resolveRequest(args: {
  id: number;
  approve: boolean;
  byId: number;
  note?: string | null;
}): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT id, employee_id AS employeeId, kind, work_date AS workDate,
              proposed_start_minute AS ps, proposed_end_minute AS pe
         FROM schedule_requests WHERE id = ? AND status = 'open'`,
    )
    .get(args.id) as
    | { id: number; employeeId: number; kind: string; workDate: string; ps: number | null; pe: number | null }
    | undefined;
  if (!r) return { ok: false, error: "That request is already settled" };

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE schedule_requests
          SET status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ?
        WHERE id = ?`,
    ).run(
      args.approve ? "approved" : "declined",
      args.byId,
      nowLocalIso(),
      args.note?.trim() || null,
      args.id,
    );

    if (!args.approve) return;
    if (r.kind === "call_off") {
      clearShift(r.employeeId, r.workDate);
    } else if (r.kind === "change" && r.ps !== null && r.pe !== null) {
      const existing = db
        .prepare(
          "SELECT break_minutes AS b FROM schedule_shifts WHERE employee_id = ? AND work_date = ?",
        )
        .get(r.employeeId, r.workDate) as { b: number } | undefined;
      const set = setShift({
        employeeId: r.employeeId,
        workDate: r.workDate,
        startMinute: r.ps,
        endMinute: r.pe,
        breakMinutes: existing?.b ?? 60,
        note: null,
      });
      if (!set.ok) throw new Error(set.error);
    }
    // An approved cover offer changes nothing by itself — it is a phone call
    // a manager already made, and the shift they arranged is typed on the
    // grid like any other.
  });

  try {
    tx();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not apply that" };
  }
  return { ok: true };
}

// ── The day's board ────────────────────────────────────────────────────────

export type BoardRow = {
  employeeId: number;
  name: string;
  role: string;
  phone: string | null;
  shift: { start: string; end: string; startMinute: number } | null;
  state: "checked_out" | "checked_in" | "on_break";
  lastEventAt: string | null;
  /** Rostered, the start has passed, and they have not punched in today. */
  awol: boolean;
};

export function todayBoard(): {
  date: string;
  rows: BoardRow[];
  covers: DeskRequest[];
} {
  const db = getDb();
  const date = currentBusinessDate();
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  const rostered = db
    .prepare(
      `SELECT s.employee_id AS employeeId, e.name, COALESCE(e.pos_role,'') AS role,
              e.phone, s.start_minute AS startMinute, s.end_minute AS endMinute
         FROM schedule_shifts s
         JOIN employees e ON e.id = s.employee_id AND e.active = 1
        WHERE s.work_date = ?
        ORDER BY s.start_minute, e.name`,
    )
    .all(date) as {
    employeeId: number;
    name: string;
    role: string;
    phone: string | null;
    startMinute: number;
    endMinute: number;
  }[];

  const rows: BoardRow[] = rostered.map((r) => {
    const st = getEmployeeState(r.employeeId);
    return {
      employeeId: r.employeeId,
      name: r.name,
      role: r.role,
      phone: r.phone,
      shift: { start: clockOf(r.startMinute), end: clockOf(r.endMinute), startMinute: r.startMinute },
      state: st.state,
      lastEventAt: st.lastEventAt,
      // Twenty minutes of grace before a name goes amber. Ten flags the
      // habitually five-late; thirty hides a real no-show until the morning
      // is already broken.
      awol: st.state === "checked_out" && nowMinute > r.startMinute + 20,
    };
  });

  /*
    Everyone ON the clock who is not on the roster, because both halves of
    the mismatch matter: the rostered ghost above, and the walk-in below —
    somebody working a day nobody wrote down, which is either a favour being
    done or a wage nobody planned, and both are worth a manager's glance.
  */
  const seen = new Set(rows.map((r) => r.employeeId));
  // Owners excluded here to match the grid: the desk is the owner's rule on
  // everybody else's day, and the owner clocking in is not a walk-in worker
  // anybody needs to manage.
  const active = db
    .prepare(
      `SELECT id, name, COALESCE(pos_role,'') AS role, phone
         FROM employees WHERE active = 1 AND COALESCE(pos_role,'') != 'owner'`,
    )
    .all() as { id: number; name: string; role: string; phone: string | null }[];
  for (const e of active) {
    if (seen.has(e.id)) continue;
    const st = getEmployeeState(e.id);
    if (st.state === "checked_out") continue;
    rows.push({
      employeeId: e.id,
      name: e.name,
      role: e.role,
      phone: e.phone,
      shift: null,
      state: st.state,
      lastEventAt: st.lastEventAt,
      awol: false,
    });
  }

  const covers = listRequests().open.filter(
    (r) => r.kind === "cover_offer" && r.workDate === date,
  );

  return { date, rows, covers };
}

/**
 * A manager punches for somebody who cannot or did not.
 *
 * The same state machine as the kiosk — a manager cannot clock out somebody
 * who is not in, because the entry that "fixed" a state that was not there
 * would be the wrong row in the one table that must never carry one. No
 * photo, no fence: the fence exists to prove the PUNCHER is at the shop, and
 * the puncher here is a manager standing at the register.
 */
export function managerPunch(args: {
  employeeId: number;
  action: Extract<EntryType, "check_in" | "check_out" | "break_start" | "break_end">;
  byId: number;
  byName: string;
}): { ok: true } | { ok: false; error: string } {
  const allowed: Record<string, EntryType[]> = {
    checked_out: ["check_in"],
    checked_in: ["check_out", "break_start"],
    on_break: ["break_end", "check_out"],
  };
  const st = getEmployeeState(args.employeeId);
  if (!allowed[st.state]?.includes(args.action))
    return { ok: false, error: `They are ${st.state.replace("_", " ")} — that button does not apply` };

  createEntry({
    employeeId: args.employeeId,
    type: args.action,
    recordedBy: args.byId,
    notes: `Recorded by ${args.byName} from the shift desk`,
    fenceVerdict: "manager",
  });
  return { ok: true };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
