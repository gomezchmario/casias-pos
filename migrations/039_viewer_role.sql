-- @foreign-keys-off
-- The read-only account, admitted by the database.
--
-- `employees.pos_role` carries a CHECK listing every role by name, which is
-- the right way round — a typo in a role is a permission bug, and the database
-- refusing it is cheaper than finding out later. The cost is that adding a
-- role means rebuilding the table, because SQLite cannot alter a constraint in
-- place.
--
-- Worth saying plainly what this role is, since the constraint is where
-- somebody will next read the list: 'viewer' opens every screen an owner can
-- and is refused everything that writes. See VIEWER_MAY in roles.ts, which is
-- an allowlist precisely so a capability nobody has thought about is denied
-- rather than granted.
--
-- The rebuild is the standard SQLite dance and it is safe here for one reason
-- worth checking before copying it elsewhere: every foreign key that points at
-- employees points at `id`, and `id` is preserved exactly. Nothing is
-- renumbered, so nothing that references an employee needs touching.
--
-- The `@foreign-keys-off` marker on the first line is how a rebuild says so:
-- the runner switches the constraint off around this file and then runs
-- `foreign_key_check` before committing, so an orphan rolls the whole thing
-- back rather than reaching the ledger. A pragma written in here instead would
-- be silently ignored — the runner has already opened a transaction by the
-- time this file is read, and SQLite ignores `PRAGMA foreign_keys` inside one.
-- Both were tried the wrong way round first, and both failed identically on
-- the DROP, because every sale, movement and time entry points at an employee.

CREATE TABLE employees_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pos_role TEXT NOT NULL DEFAULT 'technician'
    CHECK (pos_role IN ('technician', 'writer', 'cashier', 'accountant', 'manager', 'owner', 'viewer')),
  pos_locked_until TEXT,
  pos_failed_attempts INTEGER NOT NULL DEFAULT 0
);

INSERT INTO employees_new
  (id, name, pin_hash, role, active, created_at, updated_at, pos_role,
   pos_locked_until, pos_failed_attempts)
SELECT
   id, name, pin_hash, role, active, created_at, updated_at, pos_role,
   pos_locked_until, pos_failed_attempts
  FROM employees;

DROP TABLE employees;
ALTER TABLE employees_new RENAME TO employees;


