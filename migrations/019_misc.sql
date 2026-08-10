-- Miscellaneous: the shelf for things that are neither a tire nor a battery.
--
-- The first of them is a TPMS sensor, and it is exactly the case this section
-- exists for. The shop sells them -- two went out on 5 August at $75 each --
-- and until now the only way to ring one was a free-text line, which carries no
-- product, moves no stock and lands in reports as an anonymous amount. That is
-- the same drift the spreadsheet already had.
--
-- WHY A SECTION RATHER THAN FILING IT UNDER Other Service
--
-- 'other' is a category for LABOUR: a flat, a rotation, a mount. Nothing under
-- it is a thing on a shelf that can run out. A sensor is stock -- it is bought,
-- counted, sold and reordered -- and putting it in with the labour would mean
-- the one category in the system where some rows have a count and most do not.
--
-- Same shape as batteries and for the same reasons: ordinary `products` rows
-- with track_inventory = 1, so receiving, counting, selling, void-returns and
-- the oversell flag all work with no new code. track_lots = 0 because FIFO by
-- cost buys nothing on a part with one cost at a time.
--
-- No opening stock. Batteries arrived with a count because the owner had one to
-- give; nobody has counted the sensors, and a made-up opening figure would be a
-- number this system has no business inventing. It starts at zero and the first
-- delivery receives against it.

INSERT INTO service_categories (code, label, sort_order) VALUES
  ('misc', 'Miscellaneous', 47)
ON CONFLICT(code) DO NOTHING;

-- Brand and model in their own columns, not folded into the name. The name is
-- what a receipt and a search show, where the context is gone, so it carries
-- the whole thing; the columns are what lets a second Autel sensor or a rival
-- brand sort beside this one rather than as an unrelated row.
INSERT INTO products
  (sku, name, brand, model, category_id, kind, condition, price_cents,
   default_cost_cents, track_inventory, track_lots, reorder_point, active,
   created_at, updated_at)
SELECT 'TPMS-AUTEL-MX', 'TPMS SENSOR AUTEL MX-SENSOR', 'AUTEL', 'MX-SENSOR',
       (SELECT id FROM service_categories WHERE code = 'misc'),
       'part', NULL, 7500, 0, 1, 0, 4, 1,
       datetime('now', 'localtime'), datetime('now', 'localtime')
 WHERE NOT EXISTS (
   SELECT 1 FROM products p WHERE p.sku = 'TPMS-AUTEL-MX' AND p.deleted = 0
 );
