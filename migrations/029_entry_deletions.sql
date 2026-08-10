-- A row struck off the Logs list by the owner.
--
-- The day's list accumulates rows that happened but that nobody wants to read
-- again: a line rung and voided ten seconds later, a test ticket put through to
-- check a printer, a payment taken twice and reversed. They are already dead —
-- struck through, counted nowhere — but they are still there, and on a day with
-- a few of them the ledger stops being a record of what the shop did and starts
-- being a record of what it fumbled. This lets the owner take them off.
--
-- WHAT IT IS NOT: it never moves money, and it cannot be used on a row that
-- still carries any. Only rows that are already dead may be struck — a voided
-- line, anything on a voided ticket, a reversal or a payment that has been
-- reversed. That restriction is the entire safety of the feature. A live $20
-- cash payment hidden from the ledger would leave the drawer $20 over with no
-- row on any screen to explain it, which is worse than the row it removed.
--
-- ITS OWN TABLE, NOT A COLUMN. `payments` is append-only and `sale_items` is
-- the ticket as it was rung; neither should grow a field about how a screen
-- draws them. A strike is a later fact about a row rather than a property of
-- it, which is the same reasoning as `account_charge_reviews`.
--
-- UNDOING ONE DELETES THE ROW rather than flagging it. This table is a list of
-- what is currently struck, not a history — the history is in `audit_log`, with
-- both the strike and its undo attributed and timestamped. A flag would have to
-- be excluded by every future reader, and the first one to forget it puts a
-- deleted row back in front of the floor.

CREATE TABLE IF NOT EXISTS entry_deletions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Which half of the Logs union this points at: `line` is a `sale_items` row,
  -- `money` is a `payments` row. The two id spaces overlap, so neither one
  -- identifies an entry on its own.
  entry_kind TEXT    NOT NULL CHECK (entry_kind IN ('line', 'money')),
  target_id  INTEGER NOT NULL,
  reason     TEXT,
  deleted_by INTEGER NOT NULL REFERENCES employees(id),
  deleted_at TEXT    NOT NULL,
  -- Struck or not struck. Striking the same row twice is the same fact said
  -- again, and the first person to do it keeps their name on it.
  UNIQUE (entry_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_deletions_target
  ON entry_deletions (entry_kind, target_id);
