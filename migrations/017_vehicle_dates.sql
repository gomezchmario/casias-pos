-- When the car was dropped off, and when it went home.
--
-- WHY THIS IS NOT DERIVED FROM `work_status`
--
-- `work_status` is a single column holding one word. It says the car is waiting
-- right now; it cannot say when it started waiting, and the moment somebody
-- moves it from Waiting to Working the previous answer is gone. "How long has
-- that truck been out there" and "did we really have it three days" are the two
-- questions the shop actually asks about a car on the lot, and neither can be
-- answered from a column that only remembers its latest value.
--
-- WHY NOT READ IT OUT OF `audit_log`
--
-- Because that log is a record of who did what, kept for arguments about money,
-- and pruning or filtering it must never be able to change what a ticket says
-- about the car. A fact the counter screen prints is a column on the ticket.
--
-- WHY TWO COLUMNS AND NOT ONE PLUS A FLAG
--
-- A car can come back. Both stamps are rewritten on a fresh drop-off -- the new
-- visit is the one anybody is asking about -- and keeping them separate means
-- "in, not yet out" is a NULL rather than a state to be decoded.
--
-- Both NULL on every existing row, deliberately. No backfill from created_at:
-- most tickets are somebody standing at the counter for four minutes, and
-- stamping those as vehicle drop-offs would invent a lot of cars that were
-- never left here.

ALTER TABLE sales ADD COLUMN vehicle_in_at TEXT;
ALTER TABLE sales ADD COLUMN vehicle_out_at TEXT;
