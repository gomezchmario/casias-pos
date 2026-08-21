-- @foreign-keys-off
-- The mechanic, admitted by the database.
--
-- A mechanic is a technician who never appears on a ticket: same rung, same
-- capabilities, and no place in the register's picker. They work the bays on
-- jobs nobody rings a tire against — they punch the clock, they are rostered,
-- they are paid, and they are simply not one of the answers to "who did this
-- line". See RANK in roles.ts for the reasoning and listMechanics in
-- employees.ts for the exclusion, which names this role rather than trusting
-- anybody to type the job label a particular way.
--
-- `employees.pos_role` carries a CHECK listing every role by name, which is
-- the right way round — a typo in a role is a permission bug, and the database
-- refusing it is cheaper than finding out later. The cost is that adding a
-- role means rebuilding the table, because SQLite cannot alter a constraint in
-- place. This is the same dance as 039_viewer_role.sql.
--
-- WITH ONE DIFFERENCE WORTH READING BEFORE THE NEXT ONE IS COPIED. 039 rebuilt
-- this table before 046 added `hourly_rate_cents`, so its column list is no
-- longer the whole table. A rebuild that copies an old migration's list drops
-- every column added since — here, silently, everybody's wage. The list below
-- was taken from the live table, not from the file above it.
--
-- The rebuild is safe here for the reason 039 gives: every foreign key that
-- points at employees points at `id`, and `id` is preserved exactly. Nothing
-- is renumbered, so nothing that references an employee needs touching. There
-- are no indexes, triggers or views on this table to recreate.

CREATE TABLE employees_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pos_role TEXT NOT NULL DEFAULT 'technician'
    CHECK (pos_role IN ('technician', 'mechanic', 'writer', 'cashier',
                        'accountant', 'manager', 'owner', 'viewer')),
  pos_locked_until TEXT,
  pos_failed_attempts INTEGER NOT NULL DEFAULT 0,
  hourly_rate_cents INTEGER
);

INSERT INTO employees_new
  (id, name, pin_hash, role, active, created_at, updated_at, pos_role,
   pos_locked_until, pos_failed_attempts, hourly_rate_cents)
SELECT
   id, name, pin_hash, role, active, created_at, updated_at, pos_role,
   pos_locked_until, pos_failed_attempts, hourly_rate_cents
  FROM employees;

DROP TABLE employees;
ALTER TABLE employees_new RENAME TO employees;
