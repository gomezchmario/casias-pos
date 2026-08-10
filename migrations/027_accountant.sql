-- @foreign-keys-off
--
-- A sixth role, and the ledger it exists to keep: the accountant.
--
-- The shop lets some customers run a tab. Those tickets are settled at the
-- counter against the `credit_account` tender, so the till balances and the
-- ticket reads paid — which is right, because as far as the register is
-- concerned the transaction is finished. The debt is somewhere else entirely.
--
-- Up to now it was nowhere. A charge went onto the account and the only record
-- was a payment row with a tender on it; nothing added them up, nothing recorded
-- the cheque that arrived three weeks later, and the question "what does this
-- man owe us" was answered from memory. This is that missing half.
--
-- IT IS DELIBERATELY NOT THE OUTSTANDING LIST. A ticket part-paid at the
-- counter is a debt against THAT TICKET, chased by ringing the customer about
-- that job, and the close-out is where it belongs. An account is a running
-- relationship: charges accumulate, a payment arrives against the total rather
-- than against any one ticket, and it is reconciled monthly by one person. Two
-- different debts, two different rhythms, two different people — so two systems,
-- and the existing one is untouched.
--
-- THE ACCOUNTANT SITS AT CASHIER RANK, like the service writer, and for the same
-- reason: she is sideways from a cashier rather than above one. She has the run
-- of the customer book — editing people, editing cars, removing either — which
-- is manager and owner work everywhere else, and she alone with the owner may
-- touch account money. A ladder cannot say that, so `roles.ts` grants those by
-- name. See `GRANTED` there, the mirror of `WITHHELD`.
--
-- Same rebuild dance as 021 and 022: SQLite cannot widen a CHECK in place, and
-- seventeen tables carry a foreign key into `employees`, which is why
-- `foreign_key_check` runs before this commits.
--
-- NO PERSON IS CREATED HERE. The role becomes available; moving somebody into it
-- is done from the admin employees screen, where a PIN can be set properly.

CREATE TABLE employees_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pos_role TEXT NOT NULL DEFAULT 'technician'
    CHECK (pos_role IN ('technician', 'writer', 'cashier', 'accountant', 'manager', 'owner')),
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

-- Money paid against an ACCOUNT, not against a ticket.
--
-- There is no `sale_id` and that absence is the design. A customer with nine
-- open charges hands over $400; nobody at the counter decides which nine-ninths
-- of which ticket that settles, and forcing an allocation would invent a fact
-- the shop does not have. The account carries a balance, charges push it up,
-- these push it down.
--
-- `paid_at` is when the money actually arrived and is typed by the accountant —
-- a cheque dated the 3rd that reaches the desk on the 11th is the 3rd's money.
-- `created_at` is when the row was written. They are different questions and a
-- reconciliation needs both.
--
-- `how` and `to_account` are free text on purpose. Some customers post a cheque,
-- some walk in with cash, some read a card number over the phone; and the shop
-- banks it wherever it banks it. A dropdown here would be a list somebody has to
-- maintain forever to describe something that is already written on the stub.
--
-- Append-only, like every other ledger in this system: `reverses_id` points at
-- the row being undone and both survive. A payment recorded against the wrong
-- customer is a fact about what happened, and the correction is another fact.
CREATE TABLE IF NOT EXISTS account_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  amount_cents  INTEGER NOT NULL,
  paid_at       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  how           TEXT,
  to_account    TEXT,
  note          TEXT,
  reverses_id   INTEGER REFERENCES account_payments(id),
  created_by    INTEGER NOT NULL REFERENCES employees(id),
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_payments_customer ON account_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_account_payments_date     ON account_payments(business_date);
