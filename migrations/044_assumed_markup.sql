-- What the shop assumes it paid, on the years it never recorded.
--
-- The register has cost data from the day it went in and none at all before
-- that: the 62,451 imported tickets came out of the old cashier workbooks,
-- which recorded what a customer paid and nothing about what the shop paid.
-- Two and a half years of margin therefore read as "not enough cost data",
-- which is true and useless.
--
-- 20% markup on cost is the floor the shop works to — $20 on every $120 sold,
-- so the assumed cost is price ÷ 1.2. Applied ONLY to imported lines. Anything
-- rung on this register is left alone: an un-costed line there is a question
-- somebody can still answer, and covering it with a guess would hide the one
-- kind of gap that is still worth chasing.
--
-- Stored as basis points so it can be changed without a migration. Its own key
-- rather than reusing assumed_tire_markup_bp, which answers a different
-- question: that one covers a tire nobody priced on ANY ticket, including one
-- rung this morning, and the two should be able to move apart.

INSERT INTO settings (key, value)
VALUES ('assumed_history_markup_bp', '2000')
ON CONFLICT (key) DO NOTHING;
