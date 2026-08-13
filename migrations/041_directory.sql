-- The company directory: a fleet's own read-only window on its account.
--
-- WHAT THIS OPENS. Every other screen in this program is behind a PIN belonging
-- to somebody who works here. This is the first that is not: a company gets a
-- link and a four-letter code, and reads what it owes, which of its drivers ran
-- it up, on which tickets and which trucks. It cannot move a cent — no
-- payments, no discounts, no voids, nothing that writes to a ledger. What it
-- CAN do is keep its own drivers and vehicles correct, which is work the shop
-- currently does over the phone and gets wrong.
--
-- THE CODE IS FOUR LETTERS BECAUSE IT IS READ DOWN A PHONE. That is 456,976
-- combinations and would be poor protection on its own, so it is not on its
-- own: the login is throttled per device exactly like the time clock's, and the
-- code is stored as a bcrypt hash rather than in a column somebody can read off
-- a screen while standing at the counter.
--
-- The slug is the address. Derived from the company name, because it is going
-- to be typed and read out, and a random string would be neither. That does
-- mean the address is guessable — a competitor knows the company's name — which
-- is precisely why the code exists and why the throttle matters. 'customers' is
-- reserved: the shop's own directory index lives at /dir/customers and a
-- company slugged the same would shadow it.

ALTER TABLE customers ADD COLUMN dir_slug TEXT;
ALTER TABLE customers ADD COLUMN dir_pin_hash TEXT;
ALTER TABLE customers ADD COLUMN dir_pin_set_at TEXT;
ALTER TABLE customers ADD COLUMN dir_pin_set_by INTEGER REFERENCES employees(id);

-- One address, one company. Partial so the great majority of customers, who
-- will never have a portal, do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_dir_slug
  ON customers (dir_slug) WHERE dir_slug IS NOT NULL;

-- A company that got the code right, until it expires or somebody revokes it.
--
-- A table rather than a signed cookie, for the same reason `pos_sessions` is a
-- table: the shop has to be able to end a session it did not start. A company
-- changes its office manager, the code goes with them, and the answer has to be
-- something the owner can press — not a wait for a cookie to age out. The token
-- is stored hashed, exactly as `hashToken` does for the register, so a copy of
-- the database is not a drawer full of live keys.
CREATE TABLE IF NOT EXISTS dir_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT NOT NULL UNIQUE,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_dir_sessions_customer
  ON dir_sessions (customer_id);

-- Who has been in, and when — successes and failures both. This is the only way
-- the shop ever finds out that a code has been passed around, or that somebody
-- is sitting on the address trying words.
CREATE TABLE IF NOT EXISTS dir_visits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  at           TEXT NOT NULL,
  ok           INTEGER NOT NULL,
  note         TEXT
);

CREATE INDEX IF NOT EXISTS idx_dir_visits_customer
  ON dir_visits (customer_id, id);
