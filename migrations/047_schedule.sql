-- Who is expected in, and when.
--
-- The time clock has always recorded what HAPPENED — somebody pressed a button
-- and a row appeared. It has never held what was meant to happen, so there was
-- nothing to compare a day against: a technician who did not turn up looks
-- exactly like a technician who was not rostered, and the staffing report could
-- say the shop needs five people on a Saturday without anybody being able to
-- see how many were actually going to be there.
--
-- ONE ROW IS ONE PERSON ON ONE DAY. Not a shift pattern, not a recurring rule —
-- a shop of five technicians rosters by writing names on days, and a rule engine
-- would be a week of work to save a minute of typing. Repeating a week is a copy
-- button, not a schema.
--
-- MINUTES FROM MIDNIGHT rather than a time string, for the same reason money is
-- in cents: arithmetic on "08:00" is string surgery, and the one thing this
-- table exists to support is arithmetic — hours rostered against hours needed.
CREATE TABLE IF NOT EXISTS schedule_shifts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- The business date, matching every other date in this database.
  work_date    TEXT NOT NULL,
  start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute   INTEGER NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
  -- Unpaid break inside the shift. Held as a length rather than a time because
  -- nobody rosters WHEN lunch is, only that there is one.
  break_minutes INTEGER NOT NULL DEFAULT 60,
  note         TEXT,
  created_by   INTEGER REFERENCES admin_users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (end_minute > start_minute)
);

-- One shift per person per day, and the uniqueness is the point rather than a
-- precaution: two rows for the same person on the same day is a double booking
-- nobody would ever type on purpose, and letting it in would double that
-- person's hours in every total drawn off this table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_person_day
  ON schedule_shifts(employee_id, work_date);

-- The week view reads a date range and nothing else.
CREATE INDEX IF NOT EXISTS ix_schedule_date ON schedule_shifts(work_date);
