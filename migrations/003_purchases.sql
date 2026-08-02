-- Cash purchases: the shop buying goods over the counter, mostly used tires.
--
-- Money leaves the drawer, so this is the mirror image of a sale. It is still a
-- sale document -- it gets a number, lines, an audit trail, a receipt for the
-- person selling to us, and in Phase 4 it is what brings the tire into stock
-- with its real cost already recorded.
--
-- The sign convention is deliberate. The HEADER stays positive: a $20 used tire
-- is $20 of goods acquired, and unit_cost_cents is a positive cost. Only the
-- PAYMENT row goes negative, which is where negatives already live for refunds
-- and reversals. That keeps every `>= 0` CHECK on sales and sale_items intact,
-- so this migration is one column instead of a table rebuild.
--
-- Consequence for reporting: revenue, the tax back-calculation, and the mechanic
-- leaderboard must all filter `kind = 'sale'`. The drawer count needs no change,
-- because it reads the ledger and the ledger is already signed correctly.

ALTER TABLE sales ADD COLUMN kind TEXT NOT NULL DEFAULT 'sale'
  CHECK (kind IN ('sale', 'purchase'));

CREATE INDEX IF NOT EXISTS idx_sales_kind_date ON sales (kind, business_date);
