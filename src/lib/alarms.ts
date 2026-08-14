import { getDb } from "./db";
import type { PosRole } from "./roles";
import { inTx } from "./tx";
import { Actor, logActorAudit } from "./audit";
import { PosUser } from "./pos-session";
import { can } from "./roles";
import { nowLocalIso } from "./time";
import { closeoutV2, Exception, exceptionsFor } from "./day-report";

/**
 * The alarm book.
 *
 * The Daily Report raises its alarms fresh off the day's own figures every time
 * somebody opens it, which is right — an alarm about an unpaid ticket must stop
 * firing the moment the ticket is paid, and one that had been written down at
 * close would go on shouting about a thing that was fixed on Tuesday. Nothing
 * about them is stored.
 *
 * What that costs is memory. An owner opening yesterday cannot see what fired
 * last week, whether anybody looked at it, or whether the same alarm has now
 * fired eleven days running — which is the single most useful thing an alarm
 * can tell you and the one thing a page showing one day at a time can never
 * say. This module is that missing view: the same judgements, replayed across a
 * range of days, with the human answer attached.
 *
 * The answers ARE stored, in `alarm_actions` — see 036_alarms.sql for why they
 * are append-only and why an alarm is identified by nothing more than its day
 * and its code.
 */

const actorOf = (user: PosUser): Actor => ({
  type: "employee",
  employeeId: user.employeeId,
  name: user.name,
  role: user.role,
});

export type AlarmAction = {
  id: number;
  kind: "dismiss" | "reopen";
  note: string;
  byName: string;
  byRole: string;
  at: string;
};

export type AlarmRow = {
  businessDate: string;
  code: string;
  severity: "serious" | "watch";
  /** See `Exception.scope` — "standing" alarms are about now, not that day. */
  scope: "day" | "standing";
  text: string;
  /** True when the newest action on this alarm is a dismissal. */
  dismissed: boolean;
  /**
   * That newest action, whichever it is — dismissal or reopening. Carried
   * separately from the history so the row can say "waved away by Ana at 6:12,
   * 'ordered tire, customer collects Friday'" without the page walking a list.
   */
  latest: AlarmAction | null;
  /** Every action ever taken on this alarm, oldest first. */
  history: AlarmAction[];
};

export type AlarmBook = {
  from: string;
  to: string;
  /** Newest day first — the shape a person scanning for "what's new" wants. */
  days: { businessDate: string; alarms: AlarmRow[] }[];
  /** The same alarms counted by code rather than by day — see `alarmBook`. */
  recurring: {
    code: string;
    severity: "serious" | "watch";
    /** The most recent wording — the text is per-day and carries figures. */
    text: string;
    days: number;
    open: number;
    lastFired: string;
  }[];
  totals: { fired: number; open: number; serious: number };
};

/**
 * Every action taken in a range, keyed `businessDate|code`.
 *
 * Read in one query rather than per alarm. A range of ninety days raises a few
 * hundred alarms, and a query each would turn a slow page into an unusable one.
 */
function actionsFor(from: string, to: string): Map<string, AlarmAction[]> {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.business_date, a.code, a.kind, a.note, a.employee_role, a.created_at,
              e.name AS by_name
         FROM alarm_actions a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.business_date BETWEEN ? AND ?
        ORDER BY a.id`,
    )
    .all(from, to) as {
    id: number;
    business_date: string;
    code: string;
    kind: "dismiss" | "reopen";
    note: string;
    employee_role: string;
    created_at: string;
    by_name: string;
  }[];

  const out = new Map<string, AlarmAction[]>();
  for (const r of rows) {
    const key = `${r.business_date}|${r.code}`;
    const list = out.get(key) ?? [];
    list.push({
      id: r.id,
      kind: r.kind,
      note: r.note,
      byName: r.by_name,
      byRole: r.employee_role,
      at: r.created_at,
    });
    out.set(key, list);
  }
  return out;
}

/** The days in a range, inclusive, oldest first. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  // Parsed as UTC noon and stepped by whole days, which is the one arithmetic
  // that does not lose a day to a daylight-saving change in March.
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end && out.length < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * The book, for a range of days.
 *
 * Every day in the range is re-judged from scratch, because that is the only
 * way the alarms stay honest about the state of the shop today rather than the
 * state it was in at close.
 *
 * It is genuinely expensive: a full day report per day, measured at about 230ms
 * each, so a week answers in under two seconds and a month does not — thirty
 * days came back in sixteen. That measurement is the reason the range is capped
 * at a week rather than the ninety days the first draft offered. See MAX_DAYS
 * on the alarms route.
 */
export function alarmBook(from: string, to: string, role: PosRole = "owner"): AlarmBook {
  const actions = actionsFor(from, to);
  const days: AlarmBook["days"] = [];
  const range = daysBetween(from, to);
  const newest = range[range.length - 1];

  for (const businessDate of range) {
    const report = closeoutV2(businessDate);
    const alarms: AlarmRow[] = exceptionsFor(report.exceptions, role)
      /*
        A standing alarm belongs to the newest day in the range and nowhere
        else. It is a fact about the racks as they are — see `Exception.scope` —
        so the day report raises it on every date you open, and left alone it
        would fill a ninety-day log with ninety identical rows that a dismissal
        on one of them would do nothing about. Attached to the newest day it
        says the true thing once: this is wrong now.
      */
      .filter((e: Exception) => e.scope === "day" || businessDate === newest)
      .map((e: Exception) => {
        const history = actions.get(`${businessDate}|${e.code}`) ?? [];
        const latest = history.length ? history[history.length - 1] : null;
        return {
          businessDate,
          code: e.code,
          severity: e.severity,
          scope: e.scope,
          text: e.text,
          dismissed: latest?.kind === "dismiss",
          latest,
          history,
        };
      });

    // A day with nothing wrong is left out entirely. A log padded with "no
    // alarms" rows is a log people scroll past, and the absence of a date is
    // already the clearest way to say the day was clean.
    if (alarms.length > 0) days.push({ businessDate, alarms });
  }

  /*
    The same alarms counted by code rather than by day.

    One alarm on six separate days is a different fact from six alarms, and it
    is the one worth acting on — but nobody sees it until somebody counts, which
    is the entire reason for reading a week at a time instead of a day.
  */
  const recurring = new Map<string, AlarmBook["recurring"][number]>();
  let fired = 0;
  let open = 0;
  let serious = 0;

  // Oldest first, so the last wording written is the newest one and `lastFired`
  // ends up on the most recent day. `days` is still in that order here — it is
  // reversed for the page on the way out, below.
  for (const d of days) {
    for (const a of d.alarms) {
      fired++;
      if (!a.dismissed) open++;
      if (a.severity === "serious") serious++;
      const s = recurring.get(a.code);
      if (s) {
        s.days++;
        if (!a.dismissed) s.open++;
        s.text = a.text;
        s.lastFired = d.businessDate;
      } else {
        recurring.set(a.code, {
          code: a.code,
          severity: a.severity,
          text: a.text,
          days: 1,
          open: a.dismissed ? 0 : 1,
          lastFired: d.businessDate,
        });
      }
    }
  }

  return {
    from,
    to,
    days: days.reverse(),
    recurring: [...recurring.values()].sort(
      (a, b) =>
        Number(b.severity === "serious") - Number(a.severity === "serious") ||
        b.days - a.days,
    ),
    totals: { fired, open, serious },
  };
}

export type Result = { ok: true } | { ok: false; error: string };

/**
 * "I saw that, and here is what it was."
 *
 * Dismissing does not silence anything. The alarm goes on firing for as long as
 * the figures underneath it say it should, and it goes on appearing in this
 * book — it simply carries a name, a time and a sentence from then on. That is
 * deliberate: an alarm that could be switched off would be switched off, and
 * the one thing worth knowing about a recurring problem is that it recurred.
 *
 * `reopen` is the undo, and writes a row of its own rather than erasing the
 * dismissal, so "Ana waved this away and Mario put it back" survives as a fact.
 */
export function actOnAlarm(
  user: PosUser,
  businessDate: string,
  code: string,
  kind: "dismiss" | "reopen",
  note: string,
): Result {
  if (!can(user.role, "reviewAlarms"))
    return { ok: false, error: "Only a manager can work the alarm log" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
    return { ok: false, error: "That is not a business date" };
  if (!code.trim()) return { ok: false, error: "Which alarm?" };

  return inTx(() => {
    const at = nowLocalIso();
    const info = getDb()
      .prepare(
        `INSERT INTO alarm_actions
           (business_date, code, kind, note, employee_id, employee_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(businessDate, code.trim(), kind, note.trim(), user.employeeId, user.role, at);

    logActorAudit(actorOf(user), {
      action: "settings.update",
      targetType: "setting",
      targetId: `alarm:${businessDate}:${code.trim()}`,
      details: { kind, note: note.trim() },
      before: {},
      after: { kind, at },
    });

    return { ok: true as const, id: Number(info.lastInsertRowid) };
  });
}
