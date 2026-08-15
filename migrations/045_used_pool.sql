-- One general pool for used tires, and the old one folded into it.
--
-- Used tires arrive by the truckload with no sizes on them, so the shop has
-- always needed somewhere to ring "a used tire" before anybody has read a size
-- off it. It had one already, invented at the counter: somebody typed USED into
-- the size box and got a product called "Used USED", size "USED", and that row
-- carried seven tickets between the 8th and the 13th of August.
--
-- It is the right idea recorded in the only place that would take it. The
-- trouble is that it is a SIZE — every size query in the app treats "USED" as a
-- tire size, so it sorts among the passenger sizes on the rack sheet, it can be
-- searched for, and nothing about it says it means "we do not know". The proper
-- pool has no size at all, which is what keeps it out of all of those by
-- construction rather than by everyone remembering.
--
-- So: make sure the pool exists, name it the way the shop says it out loud, and
-- move the old row's history onto it. The seven lines keep their money exactly
-- as rung — quantity, price and line total are untouched, and the ticket totals
-- were frozen when they completed. What changes is which product they point at,
-- so those sales count as pool sales, and what the line READS, because "Used
-- USED" on a reprinted receipt is not a thing anybody can act on.
--
-- The old row is retired rather than deleted. It is what seven real tickets
-- were rung against, and "this row existed and we stopped using it on the 15th"
-- is a question worth being able to answer.

-- The pool, if the shop has not opened one yet. Its identity is the sku; the
-- NULL size is the load-bearing part.
INSERT INTO products
  (sku, name, category_id, kind, tire_size, condition,
   price_cents, default_cost_cents, track_inventory, track_lots,
   specialized, active, created_at, updated_at)
SELECT 'USED-GENERAL', 'Used Tires - General',
       (SELECT id FROM service_categories WHERE code = 'used_tire'),
       'tire', NULL, 'used', 0, 0, 1, 0, 0, 1,
       datetime('now', 'localtime'), datetime('now', 'localtime')
WHERE NOT EXISTS (SELECT 1 FROM products WHERE sku = 'USED-GENERAL' AND deleted = 0);

-- Named the way it is asked for at the counter, replacing the longer sentence
-- it was born with.
UPDATE products
   SET name = 'Used Tires - General',
       updated_at = datetime('now', 'localtime')
 WHERE sku = 'USED-GENERAL' AND deleted = 0;

-- The seven lines move to the pool. Guarded on the old row still being live so
-- re-running this migration cannot touch anything a second time.
UPDATE sale_items
   SET product_id = (SELECT id FROM products WHERE sku = 'USED-GENERAL' AND deleted = 0),
       description = 'Used Tires - General',
       updated_at = datetime('now', 'localtime')
 WHERE product_id = (SELECT id FROM products WHERE sku = 'USED-USED' AND deleted = 0);

-- Any stock ledger it picked up comes too, so a count is never split across two
-- rows for the same tires. There is none today; this is here so that a shop
-- that did receive against it does not lose the movements.
UPDATE inventory_movements
   SET product_id = (SELECT id FROM products WHERE sku = 'USED-GENERAL' AND deleted = 0)
 WHERE product_id = (SELECT id FROM products WHERE sku = 'USED-USED' AND deleted = 0);

UPDATE inventory_lots
   SET product_id = (SELECT id FROM products WHERE sku = 'USED-GENERAL' AND deleted = 0),
       updated_at = datetime('now', 'localtime')
 WHERE product_id = (SELECT id FROM products WHERE sku = 'USED-USED' AND deleted = 0);

-- Retired, not removed. The sku is freed at the same time, because the unique
-- index only covers live rows and a future "Used USED" typed at the counter
-- would otherwise collide with a row nobody can see.
UPDATE products
   SET deleted = 1,
       active = 0,
       sku = 'USED-USED-RETIRED',
       updated_at = datetime('now', 'localtime')
 WHERE sku = 'USED-USED' AND deleted = 0;
