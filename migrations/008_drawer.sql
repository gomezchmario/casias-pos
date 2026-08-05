-- Money moving in and out of the drawer that is not a sale.
--
-- A manager empties the till at three in the afternoon because there is four
-- hundred dollars sitting in a wooden box in a tire shop. That is not income,
-- not an expense, not a refund, and not a purchase -- it is the same money in a
-- different place. The shop's takings for the day are exactly what they were a
-- minute before.
--
-- WHY THIS IS NOT A ROW IN `payments`
--
-- Because `payments` is the revenue ledger, and everything downstream trusts
-- that. `dayTotals` sums it for what was collected, `expectedByMethod` sums it
-- for what should be in the drawer, the leaderboard reads it for tips, the
-- method breakdown groups it, the EOD variance is built on it. Putting a
-- withdrawal in there would mean adding "and not a withdrawal" to every one of
-- those queries and to every query written afterwards, forever. One missed
-- clause and a manager moving cash to the safe silently books a four hundred
-- dollar loss against the day.
--
-- A separate table cannot make that mistake. Revenue queries do not join to it,
-- so they cannot be wrong about it. The only thing that reads it is the drawer
-- count, which is the only thing that should care.
--
-- Append-only, like every other ledger here. Pulling cash out is a physical act
-- that happened; the way to undo it is to put the money back, which is another
-- row, not an edit to this one.

CREATE TABLE IF NOT EXISTS drawer_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id       INTEGER REFERENCES shifts(id),
  business_date  TEXT NOT NULL,
  -- Signed, and negative for money leaving, so the drawer expectation is a plain
  -- SUM with no CASE on kind. `kind` says what happened; the sign says which way.
  amount_cents   INTEGER NOT NULL CHECK (amount_cents <> 0),
  kind           TEXT NOT NULL CHECK (kind IN ('withdrawal', 'deposit', 'reversal')),
  -- Required, and free text on purpose. "To the bank", "to the safe", "paid the
  -- water bill". Six weeks later this column is the only thing that explains a
  -- gap in the drawer, and a dropdown of four options would have people picking
  -- the nearest wrong one.
  reason         TEXT NOT NULL,
  note           TEXT,
  reverses_id    INTEGER REFERENCES drawer_movements(id),
  created_by     INTEGER NOT NULL REFERENCES employees(id),
  created_at     TEXT NOT NULL,
  CHECK (kind <> 'reversal' OR reverses_id IS NOT NULL)
);

-- The day report and the shift count are the only two readers, and they filter
-- on exactly these.
CREATE INDEX IF NOT EXISTS idx_drawer_date  ON drawer_movements(business_date);
CREATE INDEX IF NOT EXISTS idx_drawer_shift ON drawer_movements(shift_id);
