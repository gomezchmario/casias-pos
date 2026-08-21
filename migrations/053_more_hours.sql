-- The fourth thing an employee says to the roster: "I want more hours."
--
-- A rebuild rather than an ALTER because the kind lives in a CHECK, and
-- SQLite does not renegotiate a CHECK in place. The table is days old and
-- nearly empty, so the rebuild is the cheap and honest move now rather than
-- the expensive one later.
--
-- Two shape changes ride along:
--   work_date becomes NULLABLE — "more hours" is not about a day, and filing
--   it under a fake date would make the inbox sort by a lie;
--   hours_wanted carries how many, because "more" is not a number and the
--   manager reading the inbox needs one.

-- @foreign-keys-off

CREATE TABLE schedule_requests_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  kind          TEXT NOT NULL CHECK (kind IN ('call_off','change','cover_offer','more_hours')),
  work_date     TEXT,
  proposed_start_minute INTEGER CHECK (proposed_start_minute IS NULL
                                       OR (proposed_start_minute >= 0 AND proposed_start_minute < 1440)),
  proposed_end_minute   INTEGER CHECK (proposed_end_minute IS NULL
                                       OR (proposed_end_minute > 0 AND proposed_end_minute <= 1440)),
  -- Hours a week they are asking for, where the kind is more_hours.
  hours_wanted  INTEGER CHECK (hours_wanted IS NULL OR (hours_wanted > 0 AND hours_wanted <= 80)),
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','approved','declined','withdrawn')),
  created_at    TEXT NOT NULL,
  resolved_by   INTEGER REFERENCES employees(id),
  resolved_at   TEXT,
  resolution_note TEXT
);

INSERT INTO schedule_requests_new
  (id, employee_id, kind, work_date, proposed_start_minute, proposed_end_minute,
   note, status, created_at, resolved_by, resolved_at, resolution_note)
SELECT id, employee_id, kind, work_date, proposed_start_minute, proposed_end_minute,
       note, status, created_at, resolved_by, resolved_at, resolution_note
  FROM schedule_requests;

DROP TABLE schedule_requests;
ALTER TABLE schedule_requests_new RENAME TO schedule_requests;

CREATE INDEX IF NOT EXISTS idx_schedule_requests_status
  ON schedule_requests(status, work_date);
CREATE INDEX IF NOT EXISTS idx_schedule_requests_employee
  ON schedule_requests(employee_id, created_at);
