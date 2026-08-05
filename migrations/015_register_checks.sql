-- Counting the register in the middle of the day, not just at the end of it.
--
-- The close-out answers "was tonight right". It does not answer "when did it go
-- wrong", and on the nights it matters that is the only question worth asking.
-- A drawer that is sixty dollars short at nine o'clock has been short since
-- some moment, and the difference between "sometime today" and "sometime
-- between noon and three, while two named people were on" is the difference
-- between a shrug and a conversation.
--
-- So: anybody counting the drawer can stop at noon, count it, and log it. The
-- log is signed with who counted and when, it prints on the close-out, and it
-- is flagged there if it did not balance. Four clean checks and a short close
-- localises the loss to the last two hours for free.
--
-- WHY THIS IS NOT `shift_counts`
--
-- Because a shift count is terminal. Closing a shift freezes it, hands the
-- drawer over, and the next sale opens a fresh one -- it is a handover, and
-- there is exactly one per shift. A midday check hands nothing over: the same
-- cashier keeps working out of the same drawer with the same float, and there
-- can be five of them. Overloading shift_counts would mean either closing the
-- shift to record one (which changes the shop's day) or adding a nullable
-- "this one doesn't count" column to the table every reconciliation reads.
--
-- WHY EXPECTED IS FROZEN ON THE ROW
--
-- This is the whole reason the child table has an expected_cents column instead
-- of recomputing it. What the register expected at 12:04 is a fact about 12:04.
-- Six hours and ninety tickets later it is a different number, so a check
-- re-derived at closing time would compare a noon count against a nine o'clock
-- expectation and report every clean check as thousands of dollars short. The
-- variance has to be settled at the instant it is taken or it is not a check of
-- anything.

CREATE TABLE IF NOT EXISTS register_checks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date   TEXT NOT NULL,
  shift_id        INTEGER REFERENCES shifts(id),
  -- Free text, optional. "Before the bank run", "after the busy hour".
  note            TEXT,
  checked_by      INTEGER NOT NULL REFERENCES employees(id),
  checked_at      TEXT NOT NULL,
  -- Soft-delete, owner only. A check is an entity, not a ledger row: it is a
  -- record of somebody's observation, and an observation made in error -- the
  -- wrong day picked, a count typed into the wrong tender -- is worth removing
  -- rather than reversing. But it stays in the table, because "there were four
  -- checks tonight and one is gone" is itself worth being able to see.
  deleted         INTEGER NOT NULL DEFAULT 0,
  deleted_by      INTEGER REFERENCES employees(id),
  deleted_at      TEXT,
  deleted_reason  TEXT
);

CREATE TABLE IF NOT EXISTS register_check_counts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id       INTEGER NOT NULL REFERENCES register_checks(id) ON DELETE CASCADE,
  method_id      INTEGER NOT NULL REFERENCES payment_methods(id),
  counted_cents  INTEGER NOT NULL,
  -- Frozen at the moment of the count. See the note at the top.
  expected_cents INTEGER NOT NULL,
  UNIQUE (check_id, method_id)
);

CREATE INDEX IF NOT EXISTS idx_register_checks_date  ON register_checks(business_date);
CREATE INDEX IF NOT EXISTS idx_register_checks_shift ON register_checks(shift_id);
