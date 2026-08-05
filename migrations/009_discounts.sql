-- Money taken off a ticket at the counter.
--
-- WHY THIS IS A HEADER COLUMN AND NOT A NEGATIVE LINE
--
-- A negative `sale_items` row is the obvious shape: `subtotal_cents` is already
-- SUM(line_total_cents), so a -$10 line would flow through `recalcSubtotal`,
-- `dayTotals`, the receipt and `integrityCheck` with no code changed at all.
-- That is genuinely the cheaper design, and it is the wrong one here for two
-- reasons.
--
-- First, `sale_items` carries CHECK (unit_price_cents >= 0) and
-- CHECK (line_total_cents >= 0). SQLite cannot drop a CHECK without rebuilding
-- the table, and rebuilding it to permit one negative row would permit EVERY
-- row to go negative -- trading a guarantee the database enforces on thousands
-- of lines for the convenience of one feature. A discount would stop being a
-- distinct thing and become "a line that happens to be under zero", which is
-- also what a fat-fingered price would look like.
--
-- Second, the shop wants discounts flagged loudly at close. On the header that
-- is `WHERE discount_cents > 0` against an indexed column. As a line it would
-- be a join to `service_categories` plus a sign test, on the one report that
-- must not quietly miss any.
--
-- The cost is that `total_cents` is no longer `subtotal + tip + comm`, so
-- `recalcMoney` and `integrityCheck` both learn about this column. That is two
-- places, both of which already exist to own exactly this arithmetic.

-- Positive cents, subtracted. Stored positive rather than as a negative number
-- so that nothing downstream has to remember which way the sign runs -- the
-- subtraction is written out once, in recalcMoney, where it can be read.
ALTER TABLE sales ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;

-- Required by the application whenever the amount is non-zero, and free text for
-- the same reason as `drawer_movements.reason`: six weeks later this is the only
-- thing that explains why a $60 ticket brought in $45, and a dropdown of four
-- options would have people picking the nearest wrong one.
ALTER TABLE sales ADD COLUMN discount_reason TEXT;

-- Who authorised it and when. NOT the cashier on the ticket: a manager stepping
-- in to approve more than the counter limit is the single most important fact
-- about a large discount, and reading it off `cashier_id` would credit it to
-- whoever happened to be ringing.
ALTER TABLE sales ADD COLUMN discount_by INTEGER REFERENCES employees(id);
ALTER TABLE sales ADD COLUMN discount_at TEXT;

-- Partial: discounted tickets are a small fraction of a day's rows, and the
-- close-out asks for exactly this set.
CREATE INDEX IF NOT EXISTS idx_sales_discounted
  ON sales(business_date) WHERE discount_cents > 0;
