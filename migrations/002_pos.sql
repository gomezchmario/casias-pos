-- Casias Tire Shop — Point of Sale
--
-- Conventions, enforced everywhere below:
--   * Money is INTEGER CENTS. Never a float.
--   * Timestamps are LOCAL time TEXT 'YYYY-MM-DDTHH:MM:SS' (matches 001_initial).
--   * business_date is TEXT 'YYYY-MM-DD' and is NOT derived from created_at.
--   * Entity tables soft-delete (deleted/deleted_by/deleted_at/deleted_reason).
--   * Ledger tables (payments, inventory_movements) are APPEND-ONLY and have no
--     soft-delete columns at all — undo means writing a reversing row.

------------------------------------------------------------------------------
-- Employees: POS permissions
------------------------------------------------------------------------------
-- Deliberately a new column rather than reusing employees.role, which is free
-- text used as a job title by the existing time-clock admin UI.
ALTER TABLE employees ADD COLUMN pos_role TEXT NOT NULL DEFAULT 'technician'
  CHECK (pos_role IN ('technician', 'cashier', 'manager', 'owner'));
ALTER TABLE employees ADD COLUMN pos_locked_until TEXT;
ALTER TABLE employees ADD COLUMN pos_failed_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_employees_pos_role ON employees(pos_role) WHERE active = 1;

------------------------------------------------------------------------------
-- Audit log: attribute actions to employees, not just admins
------------------------------------------------------------------------------
ALTER TABLE audit_log ADD COLUMN actor_type TEXT;      -- 'admin' | 'employee' | 'system'
ALTER TABLE audit_log ADD COLUMN employee_id INTEGER REFERENCES employees(id);
ALTER TABLE audit_log ADD COLUMN employee_name TEXT;   -- snapshot: survives a rename
ALTER TABLE audit_log ADD COLUMN employee_role TEXT;   -- role AT TIME OF ACTION
ALTER TABLE audit_log ADD COLUMN before_json TEXT;
ALTER TABLE audit_log ADD COLUMN after_json TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_employee ON audit_log(employee_id, timestamp);

------------------------------------------------------------------------------
-- POS sessions
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT UNIQUE NOT NULL,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  role_snapshot TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_pos_sessions_employee ON pos_sessions(employee_id, expires_at);

------------------------------------------------------------------------------
-- Counters: human-readable keys allocated transactionally
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  name       TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

INSERT INTO counters (name, next_value) VALUES
  ('sale_no', 1), ('customer_no', 1), ('lot_no', 1)
ON CONFLICT(name) DO NOTHING;

------------------------------------------------------------------------------
-- Lookups
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE NOT NULL,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('cash', 'card', 'financing', 'house_account', 'other')),
  is_card    INTEGER NOT NULL DEFAULT 0,   -- drives whether a SEQ is expected
  allows_tip INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

INSERT INTO payment_methods (code, label, kind, is_card, allows_tip, sort_order) VALUES
  ('cash',           'Cash',           'cash',          0, 0, 10),
  ('cc',             'Credit Card',    'card',          1, 1, 20),
  ('snap',           'SNAP',           'financing',     0, 0, 30),
  ('aff',            'AFF',            'financing',     0, 0, 40),
  ('clover',         'Clover',         'card',          1, 1, 50),
  ('po_shop',        'PO Shop',        'other',         0, 0, 60),
  ('credit_account', 'Credit Account', 'house_account', 0, 0, 70),
  ('other',          'Other',          'other',         0, 0, 80)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS service_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE NOT NULL,
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

INSERT INTO service_categories (code, label, sort_order) VALUES
  ('new_tire',   'New Tire',      10),
  ('used_tire',  'Used Tire',     20),
  ('oil_change', 'Oil Change',    30),
  ('disposal',   'Disposal',      40),
  ('other',      'Other Service', 50)
ON CONFLICT(code) DO NOTHING;

------------------------------------------------------------------------------
-- Catalog
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                TEXT NOT NULL,
  name               TEXT NOT NULL,
  category_id        INTEGER REFERENCES service_categories(id),
  kind               TEXT NOT NULL CHECK (kind IN ('tire', 'part', 'service', 'fee')),
  tire_size          TEXT,
  brand              TEXT,
  model              TEXT,
  ply                TEXT,
  condition          TEXT CHECK (condition IS NULL OR condition IN ('new', 'used')),
  price_cents        INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),        -- tax-inclusive
  default_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (default_cost_cents >= 0),
  track_inventory    INTEGER NOT NULL DEFAULT 0,
  track_lots         INTEGER NOT NULL DEFAULT 0,   -- tires only
  reorder_point      INTEGER NOT NULL DEFAULT 0,   -- low-stock alarm threshold
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted            INTEGER NOT NULL DEFAULT 0,
  deleted_by         INTEGER REFERENCES employees(id),
  deleted_at         TEXT,
  deleted_reason     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products(sku) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_products_size ON products(tire_size) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_products_lowstock ON products(reorder_point)
  WHERE deleted = 0 AND active = 1 AND track_inventory = 1;

-- The VBA quick-entry grid, data-driven so presets change without a deploy.
CREATE TABLE IF NOT EXISTS quick_buttons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('amount', 'service', 'product')),
  amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  description  TEXT,
  category_id  INTEGER REFERENCES service_categories(id),
  product_id   INTEGER REFERENCES products(id),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  CHECK (
    (kind = 'amount'  AND amount_cents IS NOT NULL) OR
    (kind = 'service' AND description  IS NOT NULL) OR
    (kind = 'product' AND product_id   IS NOT NULL)
  )
);

-- Price presets (left grid of the VBA form)
INSERT INTO quick_buttons (label, kind, amount_cents, sort_order) VALUES
  ('$10', 'amount', 1000, 10), ('$12', 'amount', 1200, 20),
  ('$15', 'amount', 1500, 30), ('$20', 'amount', 2000, 40),
  ('$25', 'amount', 2500, 50), ('$30', 'amount', 3000, 60),
  ('$35', 'amount', 3500, 70), ('$45', 'amount', 4500, 80);

-- Service presets (right grid of the VBA form)
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'FLAT', 'service', 'FLAT', id, 110 FROM service_categories WHERE code = 'other';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'MOUNT & B', 'service', 'MOUNT & BALANCE', id, 120 FROM service_categories WHERE code = 'other';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'TIRE CHK', 'service', 'CHECK TIRE', id, 130 FROM service_categories WHERE code = 'other';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'ROTACION', 'service', 'ROTACION', id, 140 FROM service_categories WHERE code = 'other';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'DISPOSAL', 'service', 'DISPOSAL', id, 150 FROM service_categories WHERE code = 'disposal';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'OIL SB', 'service', 'OIL CHANGE SYNTHETIC BLEND', id, 160 FROM service_categories WHERE code = 'oil_change';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'OIL FS', 'service', 'OIL CHANGE FULL SYNTHETIC', id, 170 FROM service_categories WHERE code = 'oil_change';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'OIL M1', 'service', 'OIL CHANGE MOBIL 1', id, 180 FROM service_categories WHERE code = 'oil_change';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'NEW TIRE', 'service', 'NEW TIRE', id, 190 FROM service_categories WHERE code = 'new_tire';
INSERT INTO quick_buttons (label, kind, description, category_id, sort_order)
SELECT 'USED TIRE', 'service', 'USED TIRE', id, 200 FROM service_categories WHERE code = 'used_tire';

------------------------------------------------------------------------------
-- Customers & vehicles (optional on a sale — only for big tickets / orders)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_no    TEXT NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  deleted_by     INTEGER REFERENCES employees(id),
  deleted_at     TEXT,
  deleted_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_no ON customers(customer_no);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name) WHERE deleted = 0;

CREATE TABLE IF NOT EXISTS vehicles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  year           TEXT,
  make           TEXT,
  model          TEXT,
  plate          TEXT,
  tire_size      TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  deleted_by     INTEGER REFERENCES employees(id),
  deleted_at     TEXT,
  deleted_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id) WHERE deleted = 0;

------------------------------------------------------------------------------
-- Sales
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_no            TEXT UNIQUE NOT NULL,       -- 'S-2026-000412', never reused
  business_date      TEXT NOT NULL,              -- 'YYYY-MM-DD'
  opened_at          TEXT NOT NULL,
  completed_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'completed', 'voided')),
  fulfillment_status TEXT NOT NULL DEFAULT 'none'
                       CHECK (fulfillment_status IN
                         ('none', 'pending', 'ordered', 'arrived', 'installed', 'delivered', 'cancelled')),
  is_special_order   INTEGER NOT NULL DEFAULT 0,
  cashier_id         INTEGER NOT NULL REFERENCES employees(id),
  customer_id        INTEGER REFERENCES customers(id),
  vehicle_id         INTEGER REFERENCES vehicles(id),
  seq                TEXT,                       -- card terminal sequence number
  po                 TEXT,                       -- paper receipt reference
  notes              TEXT,
  subtotal_cents     INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tip_cents          INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  comm_cents         INTEGER NOT NULL DEFAULT 0 CHECK (comm_cents >= 0),
  total_cents        INTEGER NOT NULL DEFAULT 0,
  paid_cents         INTEGER NOT NULL DEFAULT 0,   -- cached SUM(payments)
  balance_cents      INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp        INTEGER,                      -- basis points in effect at completion (825 = 8.25%)
  voided_by          INTEGER REFERENCES employees(id),
  voided_at          TEXT,
  void_reason        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted            INTEGER NOT NULL DEFAULT 0,
  deleted_by         INTEGER REFERENCES employees(id),
  deleted_at         TEXT,
  deleted_reason     TEXT,
  CHECK (status <> 'voided'    OR void_reason  IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(business_date, status);
CREATE INDEX IF NOT EXISTS idx_sales_seq ON sales(business_date, seq);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_open ON sales(status) WHERE status = 'open' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_sales_fulfillment ON sales(fulfillment_status)
  WHERE fulfillment_status NOT IN ('none', 'delivered', 'cancelled');

CREATE TABLE IF NOT EXISTS sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id),
  line_no           INTEGER NOT NULL,
  product_id        INTEGER REFERENCES products(id),
  description       TEXT NOT NULL,               -- snapshot; free-text lines allowed
  category_id       INTEGER REFERENCES service_categories(id),
  mechanic_id       INTEGER REFERENCES employees(id),   -- commission owner, per LINE
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents  INTEGER NOT NULL CHECK (line_total_cents >= 0),
  unit_cost_cents   INTEGER NOT NULL DEFAULT 0,  -- COGS snapshot at completion
  voided            INTEGER NOT NULL DEFAULT 0,
  voided_by         INTEGER REFERENCES employees(id),
  voided_at         TEXT,
  void_reason       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (sale_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_mechanic ON sale_items(mechanic_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- APPEND-ONLY LEDGER. No soft delete: undo by writing a reversing row.
CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id             INTEGER NOT NULL REFERENCES sales(id),
  method_id           INTEGER NOT NULL REFERENCES payment_methods(id),
  kind                TEXT NOT NULL DEFAULT 'payment'
                        CHECK (kind IN ('payment', 'tip_adjustment', 'refund', 'reversal', 'deposit')),
  amount_cents        INTEGER NOT NULL,          -- negative = money going back out
  tip_cents           INTEGER NOT NULL DEFAULT 0,
  comm_cents          INTEGER NOT NULL DEFAULT 0,
  comm_overridden     INTEGER NOT NULL DEFAULT 0,
  seq                 TEXT,
  reverses_payment_id INTEGER REFERENCES payments(id),
  taken_by            INTEGER NOT NULL REFERENCES employees(id),
  business_date       TEXT NOT NULL,
  note                TEXT,
  created_at          TEXT NOT NULL,
  CHECK (kind <> 'reversal' OR reverses_payment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(business_date, method_id);

------------------------------------------------------------------------------
-- Inventory
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_lots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_no          TEXT UNIQUE NOT NULL,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  received_at     TEXT NOT NULL,                 -- drives aging reports
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  qty_received    INTEGER NOT NULL CHECK (qty_received > 0),
  qty_remaining   INTEGER NOT NULL,
  supplier        TEXT,
  reference       TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0,    -- catch-all lot for non-lot-tracked products
  received_by     INTEGER REFERENCES employees(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted         INTEGER NOT NULL DEFAULT 0,
  deleted_by      INTEGER REFERENCES employees(id),
  deleted_at      TEXT,
  deleted_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_lots_fifo ON inventory_lots(product_id, received_at)
  WHERE deleted = 0 AND qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_lots_product ON inventory_lots(product_id) WHERE deleted = 0;

-- APPEND-ONLY LEDGER. Stock on hand is derived from this, never stored.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id            INTEGER NOT NULL REFERENCES products(id),
  lot_id                INTEGER REFERENCES inventory_lots(id),
  qty_delta             INTEGER NOT NULL CHECK (qty_delta <> 0),   -- negative = out
  unit_cost_cents       INTEGER NOT NULL DEFAULT 0,
  reason                TEXT NOT NULL CHECK (reason IN
                          ('receive', 'sale', 'void_return', 'refund_return',
                           'adjust', 'count', 'damage', 'opening')),
  sale_id               INTEGER REFERENCES sales(id),
  sale_item_id          INTEGER REFERENCES sale_items(id),
  reverses_movement_id  INTEGER REFERENCES inventory_movements(id),
  oversold              INTEGER NOT NULL DEFAULT 0,   -- cashier forced stock negative
  reviewed_by           INTEGER REFERENCES employees(id),
  reviewed_at           TEXT,
  note                  TEXT,
  business_date         TEXT NOT NULL,
  created_by            INTEGER NOT NULL REFERENCES employees(id),
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moves_product ON inventory_movements(product_id, id);
CREATE INDEX IF NOT EXISTS idx_moves_sale ON inventory_movements(sale_id);
CREATE INDEX IF NOT EXISTS idx_moves_lot ON inventory_movements(lot_id);
CREATE INDEX IF NOT EXISTS idx_moves_oversold ON inventory_movements(business_date)
  WHERE oversold = 1 AND reviewed_at IS NULL;

-- Only searches that found nothing (or nothing in stock) are logged — that is
-- the purchasing signal. Everything else is noise.
CREATE TABLE IF NOT EXISTS product_searches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  query              TEXT NOT NULL,
  normalized_query   TEXT NOT NULL,
  matched_product_id INTEGER REFERENCES products(id),
  result_count       INTEGER NOT NULL DEFAULT 0,
  in_stock           INTEGER NOT NULL DEFAULT 0,
  resulted_in_sale   INTEGER NOT NULL DEFAULT 0,
  employee_id        INTEGER REFERENCES employees(id),
  business_date      TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_searches_norm ON product_searches(normalized_query, business_date);

------------------------------------------------------------------------------
-- Payroll periods: freeze a week once it has been paid out
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_periods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  period_key TEXT UNIQUE NOT NULL,               -- '2026-W31'
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  locked_at  TEXT,
  locked_by  INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id         INTEGER NOT NULL REFERENCES payroll_periods(id),
  employee_id       INTEGER NOT NULL REFERENCES employees(id),
  sales_cents       INTEGER NOT NULL DEFAULT 0,
  tip_cents         INTEGER NOT NULL DEFAULT 0,
  comm_cents        INTEGER NOT NULL DEFAULT 0,
  adjustment_cents  INTEGER NOT NULL DEFAULT 0,  -- late edits to a locked period land here
  new_tire_count    INTEGER NOT NULL DEFAULT 0,
  used_tire_count   INTEGER NOT NULL DEFAULT 0,
  other_count       INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (period_id, employee_id)
);

------------------------------------------------------------------------------
-- POS settings
------------------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('tax_rate_bp',                    '825'),   -- 8.25%, prices are tax-INCLUSIVE
  ('tip_comm_per_cents',             '500'),   -- charge per this much tip taken out
  ('tip_comm_charge_cents',          '100'),   -- ...this much commission ($1 per $5)
  ('customer_prompt_threshold_cents','20000'), -- prompt for customer info above $200
  ('business_day_start_hour',        '4'),     -- business day runs 4am -> 4am
  ('allow_oversell',                 '1'),
  ('pos_idle_lock_seconds',          '900'),   -- 15 min idle -> lock the register
  ('receipt_footer',                 'Thank you for your business!'),
  ('search_log_retention_days',      '180')
ON CONFLICT(key) DO NOTHING;
