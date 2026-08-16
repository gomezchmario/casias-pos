-- Everything the website's stock search was ever asked.
--
-- The owner's instruction, verbatim in spirit: store ALL of it, we are not
-- doing anything with the data yet, I just want it on hand. So this table has
-- no reader, no report and no page — it is raw material for studies that have
-- not been designed, and the design of the table follows from that: keep what
-- was actually typed, keep the register's normal form beside it so future
-- grouping is possible at all, keep what we answered, and keep nothing else.
--
-- ITS OWN TABLE, NOT `product_searches`. That one is a curated purchasing
-- signal — misses only, shared with the register, read by the what-left study
-- — and pouring every yes-answer into it would bury the signal it exists to
-- carry. The two overlap on misses by design: a no-answer lands here AND
-- there, because "raw archive" and "purchasing signal" are different questions
-- asked of the same afternoon.
--
-- `answer` is what the website said back: 'yes' (in stock today), 'no' (a
-- complete size we did not have), 'incomplete' (refused — half a size, a
-- word). Incomplete queries are kept too; what people fail to type is also
-- evidence, and this table's whole job is not to decide today what will be
-- interesting later.
--
-- THE ONE-MINUTE HANDRAIL lives at the write door, in logWebSearch: the same
-- normalized size is not written twice inside sixty seconds. A visitor mashing
-- Check, or a phone retrying a slow request, should not manufacture rows — and
-- one row a minute per size still records every real question. This is the
-- only filtering anywhere in the path; everything past it is append-only, with
-- no delete and no correction column, because an archive somebody can tidy is
-- an archive whose gaps mean whatever the last person decided.

CREATE TABLE IF NOT EXISTS web_searches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Exactly as typed, evidence-grade; trimmed and capped but never rewritten.
  query         TEXT NOT NULL,
  -- The register's normal form (195-65-15), so a future study can group
  -- spellings without re-deriving the parser's opinion years later.
  size_norm     TEXT NOT NULL,
  answer        TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'incomplete')),
  business_date TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- (size, time) serves the handrail's "same size in the last minute" lookup;
-- business_date serves whatever per-day study comes later.
CREATE INDEX IF NOT EXISTS idx_web_searches_norm ON web_searches(size_norm, created_at);
CREATE INDEX IF NOT EXISTS idx_web_searches_date ON web_searches(business_date);
