-- The terminal's batch joins the movement ledger.
--
-- The case that forced it: the close-out was forgotten one night, the batch
-- was settled the next morning AFTER the day's first charges, and from then
-- on the terminal's second batch could never match the register — the books
-- expected the whole day on one batch that physically left in two. A
-- CC BATCH-OUT records the settled amount the way a cash withdrawal records
-- cash leaving: signed negative, reasoned, and subtracted from the CARD
-- expectation instead of the drawer's. Close a batch at noon on purpose and
-- the afternoon starts a clean one at zero, on the books as in the machine.
--
-- A rebuild because the kind lives in a CHECK. Columns are the LIVE table's —
-- `hidden` arrived in 026, after this table's CREATE — copying the original
-- list would silently drop every hidden flag on record.

-- @foreign-keys-off

CREATE TABLE drawer_movements_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id       INTEGER REFERENCES shifts(id),
  business_date  TEXT NOT NULL,
  -- Signed, and negative for money leaving, so the expectations are a plain
  -- SUM with no CASE on kind. `kind` says what happened; the sign says which
  -- way — and for cc_batch_out it also says WHICH LEDGER, the batch rather
  -- than the drawer. See `drawerAdjustFor` / `ccBatchAdjustFor`.
  amount_cents   INTEGER NOT NULL CHECK (amount_cents <> 0),
  kind           TEXT NOT NULL CHECK (kind IN ('withdrawal', 'deposit', 'reversal', 'cc_batch_out')),
  reason         TEXT NOT NULL,
  note           TEXT,
  reverses_id    INTEGER REFERENCES drawer_movements(id),
  created_by     INTEGER NOT NULL REFERENCES employees(id),
  created_at     TEXT NOT NULL,
  hidden         INTEGER NOT NULL DEFAULT 0,
  CHECK (kind <> 'reversal' OR reverses_id IS NOT NULL)
);

INSERT INTO drawer_movements_new
  (id, shift_id, business_date, amount_cents, kind, reason, note, reverses_id,
   created_by, created_at, hidden)
SELECT id, shift_id, business_date, amount_cents, kind, reason, note, reverses_id,
       created_by, created_at, hidden
  FROM drawer_movements;

DROP TABLE drawer_movements;
ALTER TABLE drawer_movements_new RENAME TO drawer_movements;

CREATE INDEX IF NOT EXISTS idx_drawer_date  ON drawer_movements(business_date);
CREATE INDEX IF NOT EXISTS idx_drawer_shift ON drawer_movements(shift_id);
