-- Who the shop has agreed to carry.
--
-- The house account already exists as a TENDER — `credit_account` in
-- `payment_methods` — and anybody can be rung on it, because the register has
-- never had a way to know who is allowed. That decision has lived in the head of
-- whoever is on the counter, which means it is made differently by different
-- people and not at all by somebody new.
--
-- This is that decision, written down once: a manager says a customer is good
-- for it, and every screen that meets them afterwards says so too. It is
-- deliberately a flag on the customer and not a limit or a balance — the shop
-- extends credit to PEOPLE it knows, not to accounts with ceilings, and a number
-- here would invite a rule nobody actually applies.
--
-- Defaults to 0. Nobody is approved until somebody approves them, including
-- every customer already in the book.

ALTER TABLE customers ADD COLUMN credit_approved INTEGER NOT NULL DEFAULT 0;
