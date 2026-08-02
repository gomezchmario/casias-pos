-- Shifts and the end-of-day count.
--
-- A shift is a cash-out boundary. The shop hands the drawer over during the day,
-- and whoever is leaving wants their own numbers, not the whole day's -- but the
-- owner still wants the day. So a business day is made of one or more shifts and
-- the day report is the sum of them. A day nobody ever split is simply a day with
-- one shift, which means there is no second code path for "no shifts today".
--
-- Every payment carries the shift it was taken in. That is a fact about when the
-- money moved, not mutable state, so it belongs on the append-only row and is
-- never rewritten afterwards.
--
-- The count is the physical reality: what is actually in the drawer and what the
-- card terminal actually reports. Storing `expected_cents` alongside the counted
-- figure freezes the comparison at the moment of the count, in line with the rule
-- that totals freeze when they are acted on -- a late tip booked an hour after
-- close must not silently rewrite the variance somebody already signed off.

CREATE TABLE IF NOT EXISTS shifts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_no            TEXT UNIQUE NOT NULL,          -- 'SH-2026-000012'
  business_date       TEXT NOT NULL,
  opened_at           TEXT NOT NULL,
  opened_by           INTEGER NOT NULL REFERENCES employees(id),
  -- What was in the drawer at open. Counted cash has to be measured against
  -- takings PLUS the float, or every count is short by the float.
  opening_float_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
  closed_at           TEXT,
  closed_by           INTEGER REFERENCES employees(id),
  closing_note        TEXT,
  -- Kept as a real column purely so the partial unique index below can enforce
  -- one open shift at a time. SQLite treats NULLs as distinct in a unique index,
  -- so `UNIQUE(closed_at) WHERE closed_at IS NULL` would enforce nothing.
  is_open             INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (is_open = 1 OR closed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts (business_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open ON shifts (is_open) WHERE is_open = 1;

-- The counted drawer, one row per tender.
--
-- `expected_cents` is a snapshot, not a lookup: see the note above. `counted_cents`
-- is signed only in the sense that it can be zero -- you cannot have negative cash
-- in your hand -- but the variance derived from the pair certainly can be.
CREATE TABLE IF NOT EXISTS shift_counts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id       INTEGER NOT NULL REFERENCES shifts(id),
  method_id      INTEGER NOT NULL REFERENCES payment_methods(id),
  counted_cents  INTEGER NOT NULL,
  expected_cents INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (shift_id, method_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_counts_shift ON shift_counts (shift_id);

-- Which shift the money moved in. Nullable because every payment already written
-- predates shifts entirely, and backfilling them into an invented shift would be
-- fabricating a fact about the past.
ALTER TABLE payments ADD COLUMN shift_id INTEGER REFERENCES shifts(id);

CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments (shift_id);

INSERT OR IGNORE INTO counters (name, next_value) VALUES ('shift_no', 1);
