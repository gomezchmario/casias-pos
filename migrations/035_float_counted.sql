-- Whether the opening float was COUNTED or merely assumed.
--
-- Until now a shift's `opening_float_cents` came from a setting: the shop keeps
-- a hundred dollars in the drawer, so every shift opened claiming a hundred
-- dollars, whether or not anybody had looked. That figure is the first term in
-- every expectation the day produces — expected = float + cash sales + moves —
-- so a morning that actually started with $80 produces a drawer $20 short at
-- nine at night, and the search for the missing twenty covers the whole day
-- rather than the two minutes before opening.
--
-- The columns record the human act, not the number: the number already had a
-- home. `float_counted_at` being NULL is the honest statement "this figure is
-- the standing float, nobody has verified it today", which is what the
-- close-out's checklist can now say out loud instead of implying a count that
-- never happened.
--
-- NOT a drawer movement, and this is the trap worth naming. The obvious way to
-- record the morning cash is a cash-in for $100 — and it is wrong, because the
-- shift ALREADY counts the float on its own. Doing both counts the same
-- hundred dollars twice and makes every count that day read a hundred short.
-- That exact mistake happened on 11 August 2026, was chased for hours, and is
-- now refused outright in `recordDrawerMovement`. This is the correct way to
-- record the same act: it adjusts the figure the shift already carries.

ALTER TABLE shifts ADD COLUMN float_counted_at TEXT;
ALTER TABLE shifts ADD COLUMN float_counted_by INTEGER REFERENCES employees(id);
