-- A pinned note on a customer, the same idea as the one on a ticket.
--
-- `customers.notes` already exists and is the other kind of note: it belongs to
-- the record, it is typed when the customer is set up, and it describes who
-- they are — "fleet, bills monthly", "always wants the old tires back". It is
-- stable and it is nobody's message.
--
-- This is the one the shop leaves for itself on the way past: "owes for the
-- Landsails, said he would come Friday", "do not release the truck to the son",
-- "wants a call before we order". It is written by whoever is on the counter
-- now for whoever is on it next week, and it is exactly what has been living on
-- a sticky note beside the phone.
--
-- Kept apart from `notes` for the reason ticket notes are: two things with
-- different lifetimes and different audiences in one column means the sentence
-- that describes the customer and the sentence that chases them become the same
-- string, and people stop writing either honestly.
--
-- Author and time ride with it. A message with nobody's name on it is one
-- nobody owns, and one with no time on it cannot be judged stale — which for a
-- note that says "he is coming Friday" is the whole of its meaning.
--
-- Plain ALTERs, no table rebuild — adding a column is the one schema change
-- SQLite does in place.

ALTER TABLE customers ADD COLUMN pinned_note TEXT;
ALTER TABLE customers ADD COLUMN pinned_note_by TEXT;
ALTER TABLE customers ADD COLUMN pinned_note_at TEXT;
