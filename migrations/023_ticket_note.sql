-- A pinned note on a ticket, separate from the ticket's details note.
--
-- `sales.notes` already exists and is a different thing: it is part of the
-- ticket's DETAILS, typed alongside the customer and the PO, describing the
-- job — "deposit, balance on pickup", "left rim here". It belongs to the
-- record.
--
-- This is the other kind of note, the one the shop leaves for itself on the way
-- past: "customer says he will be back after 5", "called twice, no answer",
-- "do not release until Hector checks the torque". It is a message between
-- whoever is on the counter now and whoever is on it in two hours, and it is
-- exactly the note that has been living on a sticky on the monitor.
--
-- Deliberately NOT folded into `notes`. Two things with different lifetimes and
-- different audiences sharing one column means the one that prints on paperwork
-- and the one that says "ring him again" become the same string, and the shop
-- would learn to write neither honestly.
--
-- Author and time ride with it for the same reason the counter's notice board
-- carries them: a message with nobody's name on it is one nobody owns, and a
-- message with no time on it cannot be judged stale.
--
-- Plain ALTERs, no table rebuild — adding a column is the one schema change
-- SQLite does in place.

ALTER TABLE sales ADD COLUMN pinned_note TEXT;
ALTER TABLE sales ADD COLUMN pinned_note_by TEXT;
ALTER TABLE sales ADD COLUMN pinned_note_at TEXT;
