-- Dismissing an alarm, and saying why.
--
-- The alarms themselves are not stored. They are judgements the Daily Report
-- makes fresh off the day's figures every time it is opened -- see
-- `findExceptions` in day-report.ts -- and storing them would create a second
-- version of the truth that goes stale the moment somebody fixes the ticket
-- underneath it. What IS worth keeping is the human answer: "I saw that, here
-- is what it was." That is what this table holds.
--
-- An alarm is identified by the day it fired on and its code. Nothing else is
-- needed: the same code cannot fire twice on one business date, because each
-- one is a single judgement about the whole day.
--
-- Append-only, like payments and inventory movements. Reopening a dismissed
-- alarm writes a `reopen` row rather than deleting the `dismiss` row, so the
-- history reads as what actually happened -- somebody waved it away on Tuesday
-- and somebody put it back on Thursday -- rather than as if the first person
-- never touched it. Current state is the newest row for the pair.

CREATE TABLE IF NOT EXISTS alarm_actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('dismiss', 'reopen')),
  -- The whole point of the feature. Not NOT NULL-with-a-default-of-empty by
  -- accident: a dismissal with no note is allowed to exist, because forcing
  -- prose out of somebody at 9pm produces "ok" and teaches them the field is
  -- a toll booth. The page asks for one and does not insist.
  note          TEXT    NOT NULL DEFAULT '',
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  -- The role AT THE TIME, frozen like every other actor record here. Who could
  -- do what last March is not a question the current employees table answers.
  employee_role TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);

-- The read is always "everything for these days, newest first per code".
CREATE INDEX IF NOT EXISTS idx_alarm_actions_day
  ON alarm_actions (business_date, code, id);
