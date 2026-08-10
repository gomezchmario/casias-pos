-- Tires the shop was asked for and could not sell.
--
-- The only number in this business nobody has: what walked out of the door.
-- Sales say what the shop sold, and the racks say what it holds, and neither of
-- them says a word about the customer who asked for a 245/45R20, was told no,
-- and drove to the shop down the road. That happens several times a week, it is
-- the single best guide to what to buy next, and until now it lived entirely in
-- whatever the person at the counter happened to remember on the day somebody
-- asked them.
--
-- ITS OWN TABLE, NOT `product_searches`. That one already logs what was typed
-- into the search box, automatically, on every keystroke that found nothing —
-- and that is a different fact. A search is a guess, a typo, somebody checking
-- a price, or the same person trying four spellings of one size. This is a
-- person deciding that a real customer really did want a real size and really
-- did leave without it. One is exhaust from using the system; the other is a
-- deliberate observation, and mixing them would bury the observations under
-- hundreds of keystrokes and make the count meaningless.
--
-- `qty` is how many tires they wanted, not how many times they asked. Somebody
-- who needs four of a size is four tires of demand, and a report that counted
-- them as one would rank a set of tires level with a single spare.
--
-- The size is kept BOTH ways. `size_raw` is exactly what was typed, because it
-- is evidence and because the shop's own shorthand is worth reading back.
-- `size_norm` is what the report groups on, so "245 45 20", "245/45R20" and
-- "245/45/20" are one row rather than three ways of missing the same sale.
--
-- No soft delete and no correction path, on purpose. An entry is one sentence
-- about one afternoon; the fix for a wrong one is another entry, and a table
-- somebody can tidy is a table whose totals mean whatever the last person
-- decided they should mean.

CREATE TABLE IF NOT EXISTS tire_demand (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  size_raw      TEXT    NOT NULL,
  size_norm     TEXT    NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1,
  -- Anything the counter wants to add: "wanted them today", "asked for used",
  -- the brand they named. Free text because the useful part of these is the
  -- part nobody anticipated.
  note          TEXT,
  business_date TEXT    NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES employees(id),
  created_at    TEXT    NOT NULL
);

-- The two ways the report reads it: what is most asked for, and what was asked
-- for this month.
CREATE INDEX IF NOT EXISTS idx_tire_demand_norm ON tire_demand (size_norm);
CREATE INDEX IF NOT EXISTS idx_tire_demand_date ON tire_demand (business_date);
