-- Batteries.
--
-- The shop sells three, described the only way anyone in the building describes
-- them: Large, Medium, Small. No brand, no group size, no CCA rating. That is
-- the same shape as a used tire -- the size IS the identity -- and it is
-- deliberate rather than a first pass to be filled in later. A column nobody
-- has a value for is a column somebody eventually guesses at, and a guessed
-- group size on a battery is worse than no group size at all.
--
-- WHY THESE ARE PRODUCTS AND NOT A HARDCODED SECTION
--
-- The counts have to come off `inventory_movements` like every other count in
-- this system. If batteries were three numbers in a table of their own, selling
-- one would not decrement it, voiding that sale would not put it back, and the
-- inventory sheet would carry two kinds of number that look identical and mean
-- different things. As `products` rows with track_inventory = 1 they get
-- receiving, counting, selling, void-returns and the oversell flag for free,
-- and the only new code is the section heading that renders them.
--
-- track_lots = 0: FIFO by cost buys nothing here. There is one cost per size at
-- a time and batteries do not age on the rack the way a tire does.

INSERT INTO service_categories (code, label, sort_order) VALUES
  ('battery', 'Battery', 45)
ON CONFLICT(code) DO NOTHING;

INSERT INTO products
  (sku, name, category_id, kind, condition, price_cents, default_cost_cents,
   track_inventory, track_lots, reorder_point, active, created_at, updated_at)
SELECT v.sku, v.name,
       (SELECT id FROM service_categories WHERE code = 'battery'),
       'part', NULL, v.price, 0, 1, 0, v.reorder, 1,
       datetime('now', 'localtime'), datetime('now', 'localtime')
  FROM (
    SELECT 'BAT-L' AS sku, 'BATTERY LARGE'  AS name, 12000 AS price, 5 AS reorder
    UNION ALL SELECT 'BAT-M', 'BATTERY MEDIUM', 9000, 5
    UNION ALL SELECT 'BAT-S', 'BATTERY SMALL',  7000, 5
  ) v
 WHERE NOT EXISTS (
   SELECT 1 FROM products p WHERE p.sku = v.sku AND p.deleted = 0
 );

-- Opening stock: what is on the shelf on the day this lands.
--
-- Booked as ledger rows rather than written anywhere as a count, because there
-- is no such thing as a stored count in this system and this figure must not be
-- the first. `reason = 'opening'` exists for exactly this -- the balance carried
-- in from however the shop was keeping track before -- and the note says so, so
-- that a year from now nobody mistakes it for a delivery that was never
-- invoiced.
--
-- Attributed to the owner because a movement must name someone, and the person
-- who told us these numbers is the right someone. `WHERE EXISTS` guards a
-- brand-new database with no employees yet: there, batteries simply start at
-- zero, which is true of a shop that does not exist.

INSERT INTO inventory_lots
  (lot_no, product_id, received_at, unit_cost_cents, qty_received, qty_remaining,
   reference, is_default, created_at, updated_at)
SELECT 'L-OPEN-' || p.sku, p.id, datetime('now', 'localtime'), 0,
       v.qty, v.qty, 'Opening count', 1,
       datetime('now', 'localtime'), datetime('now', 'localtime')
  FROM (
    SELECT 'BAT-L' AS sku, 55 AS qty
    UNION ALL SELECT 'BAT-M', 45
    UNION ALL SELECT 'BAT-S', 35
  ) v
  JOIN products p ON p.sku = v.sku AND p.deleted = 0
 WHERE NOT EXISTS (
   SELECT 1 FROM inventory_lots l WHERE l.product_id = p.id AND l.is_default = 1
 );

INSERT INTO inventory_movements
  (product_id, lot_id, qty_delta, unit_cost_cents, reason, note,
   business_date, created_by, created_at)
SELECT l.product_id, l.id, l.qty_received, 0, 'opening',
       'Opening count when batteries were added to the system',
       date('now', 'localtime'),
       (SELECT id FROM employees WHERE pos_role = 'owner' ORDER BY id LIMIT 1),
       datetime('now', 'localtime')
  FROM inventory_lots l
  JOIN products p ON p.id = l.product_id
 WHERE l.lot_no = 'L-OPEN-' || p.sku
   AND EXISTS (SELECT 1 FROM employees WHERE pos_role = 'owner')
   AND NOT EXISTS (
     SELECT 1 FROM inventory_movements m
      WHERE m.product_id = l.product_id AND m.reason = 'opening'
   );
