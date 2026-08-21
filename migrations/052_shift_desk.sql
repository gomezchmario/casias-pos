-- The shift desk: what employees ask about the roster, and who answered.
--
-- The roster (047) wrote down what is MEANT to happen. This adds the two-way
-- half: an employee saying "I can't come Thursday", "could I start at nine",
-- "call me if somebody doesn't show" — and a manager saying yes or no, on the
-- record. Until now every one of those conversations happened out loud and
-- left nothing behind, so "you never told me" and "you never answered" were
-- both unanswerable.
--
-- APPEND-ONLY, like every ledger in this file. A request is never deleted and
-- never edited into a different request; it is resolved, and the resolution
-- names who decided and what they said. A declined request is history, not
-- garbage.

CREATE TABLE IF NOT EXISTS schedule_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  -- call_off: I am not coming on work_date.
  -- change:   different hours on work_date (proposed_* say which), or a day
  --           they want that they do not have.
  -- cover_offer: I can come in on work_date if somebody does not.
  kind          TEXT NOT NULL CHECK (kind IN ('call_off','change','cover_offer')),
  work_date     TEXT NOT NULL,
  -- Only a change proposes hours; minutes from midnight like the roster.
  proposed_start_minute INTEGER CHECK (proposed_start_minute IS NULL
                                       OR (proposed_start_minute >= 0 AND proposed_start_minute < 1440)),
  proposed_end_minute   INTEGER CHECK (proposed_end_minute IS NULL
                                       OR (proposed_end_minute > 0 AND proposed_end_minute <= 1440)),
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','approved','declined','withdrawn')),
  created_at    TEXT NOT NULL,
  -- The manager who answered — an employee, because the shift desk lives in
  -- the register behind a capability, not behind the admin password.
  resolved_by   INTEGER REFERENCES employees(id),
  resolved_at   TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_requests_status
  ON schedule_requests(status, work_date);
CREATE INDEX IF NOT EXISTS idx_schedule_requests_employee
  ON schedule_requests(employee_id, created_at);

-- A phone number on the employee, not on the request. The whole point of
-- collecting it is the morning somebody rostered has not shown: the board
-- needs a number to call NOW, not the number that was on a request last month.
ALTER TABLE employees ADD COLUMN phone TEXT;

-- Who pressed the button, when it was not the person being punched. A manager
-- clocking somebody out from the board writes an ordinary entry — same table,
-- same state machine — but an entry that claims Jerry punched at 5:02 when a
-- manager did it for him would be the one lie in an otherwise honest table.
-- Null means what it has always meant: the person punched for themselves.
ALTER TABLE time_entries ADD COLUMN recorded_by INTEGER REFERENCES employees(id);

-- The two skills a roster can be short of. Not a skills table — the shop has
-- exactly two jobs that only some hands can do, and the question the grid has
-- to answer is "is there a muffler man in on Thursday", per day, at a glance.
-- Two named columns keep that a WHERE clause; a tag system would be a schema
-- for a problem the shop does not have. A third skill someday is a third
-- column and one more line on the grid's footer.
ALTER TABLE employees ADD COLUMN can_mufflers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN can_big_rigs INTEGER NOT NULL DEFAULT 0;
