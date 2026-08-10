-- @foreign-keys-off
--
-- Two more stages between "the tire is here" and "the customer has it".
--
-- The board could say the tire had arrived and it could say it was gone, and
-- nothing in between except "Fitted" — which was never the thing anybody was
-- waiting on. The shop knows when it has bolted a tire on. What it loses track
-- of is the customer: rung once and no answer, rung and coming Friday, rung
-- three times and not seen since. All of those looked identical on the board,
-- so the tire that had been sitting in the corner for nine days looked exactly
-- like the one that arrived this morning.
--
--   arrived         Here — call them
--   no_answer       Called — no answer      <- new, the shop's turn again
--   waiting_pickup  Waiting for pickup      <- new, the customer's turn
--   delivered       Picked up               (was "Gone")
--
-- 'installed' is dropped from the board but KEPT in this constraint on purpose.
-- Four tickets reached it before the change and they still have to load; a
-- value the application will never write again costs nothing to keep allowed,
-- and removing it would turn four historical rows into rows that cannot be read
-- back without an error.
--
-- WHY THE WHOLE TABLE IS REBUILT FOR THIS
--
-- SQLite cannot alter a CHECK constraint in place. The only way to widen one is
-- the twelve-step procedure from its own documentation: build the new table,
-- copy the rows, drop the old, rename. Every index is recreated afterwards and
-- `foreign_key_check` runs before the transaction commits, because sale_items,
-- payments and inventory_movements all point at this table by id and a rebuild
-- that silently orphaned them would be the worst possible outcome.
--
-- `legacy_alter_table` is left alone deliberately: with it OFF, which is the
-- default, the RENAME rewrites nothing in the referencing tables — they name
-- `sales` and go on naming it.
--
-- The `@foreign-keys-off` marker on the first line is what makes the DROP
-- possible. SQLite ignores `PRAGMA foreign_keys` inside a transaction, so the
-- runner turns it off before opening one and runs `foreign_key_check` before
-- committing — see the note in `runMigrations`. Two earlier attempts at this
-- file failed without it: once on the DROP, and once at COMMIT after trying
-- `defer_foreign_keys`, which counts the dropped rows as violations and never
-- forgets them.

CREATE TABLE sales_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_no            TEXT UNIQUE NOT NULL,
  business_date      TEXT NOT NULL,
  opened_at          TEXT NOT NULL,
  completed_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'completed', 'voided')),
  fulfillment_status TEXT NOT NULL DEFAULT 'none'
                       CHECK (fulfillment_status IN
                         ('none', 'pending', 'ordered', 'arrived', 'no_answer',
                          'waiting_pickup', 'installed', 'delivered', 'cancelled')),
  is_special_order   INTEGER NOT NULL DEFAULT 0,
  cashier_id         INTEGER NOT NULL REFERENCES employees(id),
  customer_id        INTEGER REFERENCES customers(id),
  vehicle_id         INTEGER REFERENCES vehicles(id),
  seq                TEXT,
  po                 TEXT,
  notes              TEXT,
  subtotal_cents     INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tip_cents          INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  comm_cents         INTEGER NOT NULL DEFAULT 0 CHECK (comm_cents >= 0),
  total_cents        INTEGER NOT NULL DEFAULT 0,
  paid_cents         INTEGER NOT NULL DEFAULT 0,
  balance_cents      INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp        INTEGER,
  voided_by          INTEGER REFERENCES employees(id),
  voided_at          TEXT,
  void_reason        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted            INTEGER NOT NULL DEFAULT 0,
  deleted_by         INTEGER REFERENCES employees(id),
  deleted_at         TEXT,
  deleted_reason     TEXT,
  kind               TEXT NOT NULL DEFAULT 'sale'
                       CHECK (kind IN ('sale', 'purchase')),
  discount_cents     INTEGER NOT NULL DEFAULT 0,
  discount_reason    TEXT,
  discount_by        INTEGER REFERENCES employees(id),
  discount_at        TEXT,
  fulfillment_at     TEXT,
  work_status        TEXT,
  vehicle_in_at      TEXT,
  vehicle_out_at     TEXT,
  CHECK (status <> 'voided'    OR void_reason  IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

-- Columns named rather than `SELECT *`, so a mismatch is an error here instead
-- of a silent shift of every value one column to the left.
INSERT INTO sales_new
  (id, sale_no, business_date, opened_at, completed_at, status, fulfillment_status,
   is_special_order, cashier_id, customer_id, vehicle_id, seq, po, notes,
   subtotal_cents, tip_cents, comm_cents, total_cents, paid_cents, balance_cents,
   tax_rate_bp, voided_by, voided_at, void_reason, created_at, updated_at,
   deleted, deleted_by, deleted_at, deleted_reason, kind, discount_cents,
   discount_reason, discount_by, discount_at, fulfillment_at, work_status,
   vehicle_in_at, vehicle_out_at)
SELECT
   id, sale_no, business_date, opened_at, completed_at, status, fulfillment_status,
   is_special_order, cashier_id, customer_id, vehicle_id, seq, po, notes,
   subtotal_cents, tip_cents, comm_cents, total_cents, paid_cents, balance_cents,
   tax_rate_bp, voided_by, voided_at, void_reason, created_at, updated_at,
   deleted, deleted_by, deleted_at, deleted_reason, kind, discount_cents,
   discount_reason, discount_by, discount_at, fulfillment_at, work_status,
   vehicle_in_at, vehicle_out_at
  FROM sales;

DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;

-- Every index the old table carried, by name, so nothing gets slower.
CREATE INDEX IF NOT EXISTS idx_sales_date        ON sales(business_date);
CREATE INDEX IF NOT EXISTS idx_sales_seq         ON sales(business_date, seq);
CREATE INDEX IF NOT EXISTS idx_sales_customer    ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_open        ON sales(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_sales_fulfillment ON sales(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_sales_kind_date   ON sales(kind, business_date);
CREATE INDEX IF NOT EXISTS idx_sales_discounted  ON sales(discount_cents) WHERE discount_cents > 0;
