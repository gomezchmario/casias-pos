-- When the answer reached its asker.
--
-- A request is filed on a phone and answered at the desk, and until now the
-- answer sat waiting for the employee to think of looking. The punch is the
-- one moment the clock knows exactly who is standing in front of it, so the
-- punch is where the answer gets delivered — and this column is what keeps it
-- from being delivered again at every punch until the row falls off the list.
-- Null means the person has not been told yet.
ALTER TABLE schedule_requests ADD COLUMN notified_at TEXT;
