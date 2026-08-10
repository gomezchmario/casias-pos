-- One capability, given to one person, over and above their role.
--
-- The permission model has been a ladder plus two lists of role-wide
-- exceptions, and that shape answers "what can a cashier do". It cannot answer
-- "Patricia specifically may see the management reports" — the only way to say
-- that was to promote her, which hands over voids, refunds, receiving and the
-- close-out on the way past. A much larger grant than anybody asked for, made
-- accidentally by a rank.
--
-- So a third layer, and deliberately the smallest one that works.
--
-- IT ONLY EVER ADDS. There is no per-person denial and there should not be: a
-- role is a job, and a job somebody has to be individually stopped from doing
-- parts of is the wrong job for them. Taking something away is still done by
-- moving them, which keeps "what can a cashier do" a question with one answer.
--
-- WITHHELD STILL WINS — see `can` in roles.ts. A capability a role is denied
-- outright stays denied however it is granted, because a denial that any grant
-- could override would not be a denial. The service writer keeps no access to
-- the day's books whoever ticks what.
--
-- A revoked grant is DELETED rather than flagged. This table is the list of
-- what is currently granted, not a history of what has been; the history is in
-- `audit_log`, with both the grant and its removal attributed and timestamped.
-- A flag would have to be excluded by every future reader, and the first one to
-- forget it hands somebody a permission that was taken away.

CREATE TABLE IF NOT EXISTS employee_capabilities (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  -- The capability's key from `CAPABILITIES` in roles.ts. Text rather than a
  -- lookup table: the list lives in code, is read by the type checker, and a
  -- second copy in the database would be a second thing to keep in step.
  capability  TEXT    NOT NULL,
  granted_by  INTEGER NOT NULL REFERENCES employees(id),
  granted_at  TEXT    NOT NULL,
  note        TEXT,
  -- Granting the same thing twice is the same fact said again, and the first
  -- person to grant it keeps their name on it.
  PRIMARY KEY (employee_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_employee_capabilities_employee
  ON employee_capabilities (employee_id);
