-- The counter's note becomes a corkboard.
--
-- One standing note was the design, and the shop outgrew it in a week: the
-- owner wants his note AND the manager's note up at once, each signed, each
-- taken down by whoever decides it is done — which is a table, not a pair of
-- settings keys. One ACTIVE note per author keeps it a corkboard rather than
-- a feed: writing again replaces your note, it does not pile a new one on.
--
-- Nothing is deleted. A note taken down keeps its row, who took it down and
-- when — "who removed my note" is exactly the question a shared board gets
-- asked, and a DELETE would eat the answer.
CREATE TABLE IF NOT EXISTS pos_notices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Nullable because the note carried over from the old settings pair has a
  -- name but no id — it predates the board knowing who its authors are.
  employee_id   INTEGER REFERENCES employees(id),
  author_name   TEXT NOT NULL,
  body          TEXT NOT NULL,
  -- A pastel key the component maps to real colors — a key, not a hex, so
  -- the palette can be tuned later without repainting saved rows.
  color         TEXT NOT NULL DEFAULT 'amber',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  taken_down_by INTEGER REFERENCES employees(id),
  taken_down_by_name TEXT,
  taken_down_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pos_notices_active
  ON pos_notices(taken_down_at, created_at);

-- Carry the standing note over so the board does not open blank the morning
-- after the deploy. The settings keys are emptied rather than dropped —
-- setSetting still knows them, they just no longer say anything.
INSERT INTO pos_notices (employee_id, author_name, body, color, created_at, updated_at)
SELECT NULL,
       COALESCE((SELECT value FROM settings WHERE key = 'pos_notice_by'), ''),
       s.value,
       'amber',
       COALESCE(NULLIF((SELECT value FROM settings WHERE key = 'pos_notice_at'), ''), datetime('now')),
       COALESCE(NULLIF((SELECT value FROM settings WHERE key = 'pos_notice_at'), ''), datetime('now'))
  FROM settings s
 WHERE s.key = 'pos_notice' AND s.value != '';

UPDATE settings SET value = '' WHERE key IN ('pos_notice', 'pos_notice_by', 'pos_notice_at');
