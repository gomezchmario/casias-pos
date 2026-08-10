-- @foreign-keys-off
--
-- A fifth role: the service writer.
--
-- The person who works the forecourt rather than the counter. He meets the
-- vehicle, writes up what it needs, and leaves the ticket unpaid for the
-- customer to settle inside at reception. He can ring and take money when he
-- has to — somebody has to cover the register at lunch — but the day's books
-- are not his job and do not belong on a screen that spends the afternoon
-- outside.
--
-- He sits at the SAME rank as a cashier rather than below one, and gives up
-- Logs, the close-out and reports by name. See `WITHHELD` in roles.ts for why
-- a ladder could not express this: he is sideways from a cashier, not under
-- one, and lowering the capabilities he needs would have handed them to every
-- technician as well.
--
-- Same rebuild dance as 021, and for the same reason — SQLite cannot widen a
-- CHECK in place. Seventeen tables carry a foreign key into `employees`, which
-- is exactly why `foreign_key_check` runs before this commits.
--
-- NO PIN AND NO NEW PERSON IS CREATED HERE. Javier already exists; this only
-- makes the role available for him to be moved into, which is done from the
-- admin employees screen where a PIN can be set properly.

CREATE TABLE employees_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pos_role TEXT NOT NULL DEFAULT 'technician'
    CHECK (pos_role IN ('technician', 'writer', 'cashier', 'manager', 'owner')),
  pos_locked_until TEXT,
  pos_failed_attempts INTEGER NOT NULL DEFAULT 0
);

INSERT INTO employees_new
  (id, name, pin_hash, role, active, created_at, updated_at,
   pos_role, pos_locked_until, pos_failed_attempts)
SELECT
   id, name, pin_hash, role, active, created_at, updated_at,
   pos_role, pos_locked_until, pos_failed_attempts
  FROM employees;

DROP TABLE employees;
ALTER TABLE employees_new RENAME TO employees;

CREATE INDEX IF NOT EXISTS idx_employees_active   ON employees(active);
CREATE INDEX IF NOT EXISTS idx_employees_pos_role ON employees(pos_role);
