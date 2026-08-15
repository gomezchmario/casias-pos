/**
 * Backfill the time clock from ticket activity, for the last five weeks.
 *
 * WHY THIS EXISTS. The shop's technicians have not been clocking in, so every
 * per-hour figure in the reports is either blank or a guess, and the staffing
 * report cannot work out the shop's own pace. This writes the shift each person
 * evidently worked, inferred from the tickets they were credited with, so those
 * reports have something real-shaped to run on.
 *
 * WHAT IT IS NOT. These are not punches. Nobody stood at the kiosk at 8:00 and
 * pressed a button; the shop is being credited with a shift because it rang
 * tickets in that person's name that day. So EVERY ROW IT WRITES SAYS SO in its
 * notes, in words, and can be found again with one query:
 *
 *     SELECT * FROM time_entries WHERE notes LIKE 'Backfilled%'
 *
 * That matters more than it looks. Hours worked is a payroll-shaped number, and
 * an invented one that cannot be told from a real one is the kind of thing that
 * gets quoted back in an argument two years from now. Marked, it stays useful
 * and stays honest; unmarked it would be neither.
 *
 * THE SHIFT IT INFERS, per the shop's own description of how it runs:
 *   · in at 8:00
 *   · an hour of lunch, found as an hour between 11 and 2 where that person was
 *     credited with nothing — the gap is the evidence, which is why it is
 *     looked for rather than assumed at noon
 *   · out at 19:00 if they were still ringing work at or after 17:00, else 18:00
 *
 * Days a person was credited with nothing are left empty: they did not work.
 *
 * TECHNICIANS ONLY, and their existing entries in the window are cleared first.
 * The managers and the owner HAVE been using the kiosk and those punches are
 * real, so they are not touched and not overwritten. The only technician entry
 * that exists is a seven-minute test against Franklin, which is not a shift and
 * is replaced rather than worked around.
 *
 * Run:  node scripts/backfill-timeclock.mjs           (dry run, writes nothing)
 *       node scripts/backfill-timeclock.mjs --apply
 */
import Database from "better-sqlite3";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "timeclock.db"));

const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
const from = db.prepare("SELECT date(?, '-34 days') AS d").get(today).d;

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${from} to ${today}\n`);

/*
  Who worked, and when they were working, off the ticket lines they were
  credited with. Voided lines and deleted tickets are excluded for the same
  reason they are everywhere else: they are not work the shop did.
*/
const rows = db
  .prepare(
    `SELECT s.business_date AS day,
            i.mechanic_id   AS employeeId,
            e.name          AS name,
            CAST(strftime('%H', s.opened_at) AS INTEGER) AS hour,
            COUNT(*)        AS lines
       FROM sale_items i
       JOIN sales s     ON s.id = i.sale_id
       JOIN employees e ON e.id = i.mechanic_id
      WHERE s.business_date BETWEEN ? AND ?
        AND s.deleted = 0 AND s.status = 'completed' AND s.kind = 'sale'
        AND i.voided = 0 AND i.mechanic_id IS NOT NULL
        AND e.pos_role = 'technician'
   GROUP BY s.business_date, i.mechanic_id, hour`,
  )
  .all(from, today);

/*
  Technician entries already in the window, which get cleared before writing.

  There is one, a seven-minute test against Franklin, and leaving it would be
  worse than replacing it: seven minutes sitting alongside inferred full shifts
  would drag that day's pace to nonsense and could not be told apart afterwards.
  Managers and the owner are NOT in this count — their punches are real and are
  not touched.
*/
const stale = db
  .prepare(
    `SELECT COUNT(*) AS n FROM time_entries t
       JOIN employees e ON e.id = t.employee_id
      WHERE e.pos_role = 'technician'
        AND substr(t.timestamp, 1, 10) BETWEEN ? AND ?`,
  )
  .get(from, today).n;

const clear = db.prepare(
  `DELETE FROM time_entries
     WHERE employee_id IN (SELECT id FROM employees WHERE pos_role = 'technician')
       AND substr(timestamp, 1, 10) BETWEEN ? AND ?`,
);

/** day|employee -> { name, hours: Set<number> } */
const shifts = new Map();
for (const r of rows) {
  const key = `${r.day}|${r.employeeId}`;
  if (!shifts.has(key))
    shifts.set(key, { day: r.day, employeeId: r.employeeId, name: r.name, hours: new Set() });
  shifts.get(key).hours.add(r.hour);
}

/**
 * The hour somebody ate, read off the hour they rang nothing.
 *
 * The shop's own description of the rule: a full day with one hour of lunch,
 * "you should be able to spot it by an hour they did nothing in the tickets".
 * So the gap IS the evidence and this looks for it rather than assuming noon.
 *
 * Around the middle of the day first, because that is when a lunch hour usually
 * falls and a quiet 8am is the shop being empty rather than anybody eating. But
 * NOT only there — the first version searched 11 to 2 and gave up, which put
 * Jose's lunch at noon on a day he rang tickets through noon and had a clear
 * hour at three. The gap was in the data and the search was not wide enough to
 * see it. So a clear hour anywhere inside the shift will do, taken nearest the
 * middle of the day.
 *
 * Nothing clear at all means somebody worked straight through. They still get
 * an hour — a twelve-hour unbroken shift is not what happened either — and it
 * goes at noon, which is the honest guess when there is no evidence to read.
 */
function findLunch(hours, first, last) {
  const inside = [];
  for (let h = first + 1; h < last; h++) if (!hours.has(h)) inside.push(h);
  if (inside.length === 0) return 12;
  const middle = [12, 13, 11, 14].find((h) => inside.includes(h));
  if (middle !== undefined) return middle;
  return inside.reduce((a, b) => (Math.abs(b - 12.5) < Math.abs(a - 12.5) ? b : a));
}

const insert = db.prepare(
  `INSERT INTO time_entries (employee_id, type, timestamp, notes, created_at)
   VALUES (?, ?, ?, ?, ?)`,
);
const NOTE =
  "Backfilled from ticket activity — inferred shift, not a real punch";

let written = 0;
const perPerson = new Map();

const apply = db.transaction((list) => {
  clear.run(from, today);
  for (const s of list) {
    const first = Math.min(...s.hours);
    const last = Math.max(...s.hours);
    const lunch = findLunch(s.hours, first, last);

    const end = last >= 17 ? 19 : 18;

    const at = (h) => `${s.day}T${String(h).padStart(2, "0")}:00:00`;
    const stamps = [
      ["check_in", at(8)],
      ["break_start", at(lunch)],
      ["break_end", at(lunch + 1)],
      ["check_out", at(end)],
    ];

    for (const [type, ts] of stamps) insert.run(s.employeeId, type, ts, NOTE, ts);
    written += 4;
    perPerson.set(s.name, (perPerson.get(s.name) ?? 0) + (end - 8 - 1));
  }
});

const list = [...shifts.values()].sort((a, b) => a.day.localeCompare(b.day));

if (APPLY) {
  apply(list);
} else {
  // The same walk, counting rather than writing.
  for (const s of list) {
    const end = Math.max(...s.hours) >= 17 ? 19 : 18;
    written += 4;
    perPerson.set(s.name, (perPerson.get(s.name) ?? 0) + (end - 8 - 1));
  }
}

console.log(`shifts found         ${list.length}`);
console.log(`old tech entries     ${stale}  (${APPLY ? "cleared" : "would be cleared"})`);
console.log(`entries ${APPLY ? "written     " : "to write    "} ${written}\n`);
console.log("hours per person over the window:");
for (const [name, hrs] of [...perPerson].sort((a, b) => b[1] - a[1]))
  console.log(`   ${name.padEnd(12)} ${String(hrs).padStart(5)} hours`);

const sample = list[Math.floor(list.length / 2)];
if (sample) {
  const lunch = findLunch(sample.hours, Math.min(...sample.hours), Math.max(...sample.hours));
  const end = Math.max(...sample.hours) >= 17 ? 19 : 18;
  console.log(
    `\nsample — ${sample.name} on ${sample.day}: in 8:00, lunch ${lunch}:00–${lunch + 1}:00, out ${end}:00`,
  );
  console.log(`   (rang work in hours: ${[...sample.hours].sort((a, b) => a - b).join(", ")})`);
}

if (!APPLY) console.log("\nNothing written. Re-run with --apply.");
db.close();
