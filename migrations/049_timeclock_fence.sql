-- Where a punch was taken from.
--
-- The shop's problem is not a mystery about hours; it is that a time clock
-- reachable from the internet can be punched from a bed. The fence answers it
-- the way a lock answers a door: it does not stop somebody determined to fake
-- a GPS reading, it stops the ordinary morning where clocking in from home is
-- simply easier than driving in. The owner's own words for this were that
-- locks keep honest men honest.
--
-- WHAT IS STORED, AND WHY EVEN WHEN IT PASSES. Every punch keeps the reading
-- it was allowed on, not only the refused ones. A record that only remembers
-- failures cannot answer "was Jose really here on the 3rd" — the question that
-- actually gets asked — and it cannot be used to check whether the fence is
-- the right size, which it will not be on the first guess.
--
-- `accuracy_m` rides along because a coordinate without it is a claim with no
-- error bars. A phone in the lot reports five metres; a desktop with no GPS
-- guesses from wi-fi and can be a kilometre out while sitting in the office.
-- Judging a punch, or a fence, without knowing which kind of reading it was
-- means judging noise.
--
-- NULL is the honest answer for every punch already in this table, and for
-- every punch made from a trusted device that was never asked for a location.
-- It is not "at the shop" and not "somewhere else"; it is "nobody asked".
ALTER TABLE time_entries ADD COLUMN lat REAL;
ALTER TABLE time_entries ADD COLUMN lng REAL;
ALTER TABLE time_entries ADD COLUMN accuracy_m REAL;

-- How the punch got past the fence: 'inside' (it was in range), 'trusted' (a
-- device the shop enrolled, never asked for a location), 'off' (there was no
-- fence set at the time), or 'manual' (a manager entered it by hand). Text
-- rather than a pair of booleans because these are four different stories and
-- a future fifth one should not need a schema change to be told.
ALTER TABLE time_entries ADD COLUMN fence_verdict TEXT;

CREATE INDEX IF NOT EXISTS idx_entries_fence ON time_entries(fence_verdict, timestamp);
