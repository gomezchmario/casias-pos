-- What a company account needs that a walk-in customer does not.
--
-- A tab that gets invoiced is a different kind of relationship from a name and
-- a number taken over the counter. Somebody has to be sent the statement, at an
-- address, and a company's switchboard is rarely the person who pays: the
-- driver hands over the keys, the office settles the account, and those are two
-- humans with two numbers.
--
-- ON `customers`, NOT ON A COMPANIES TABLE, for the same reason a fleet is a
-- customer at all (see `033_fleets.sql`): Williams Insulation is one row with
-- one history, and splitting its billing address into a second table would mean
-- every screen that shows a company joins two places to say one thing. These
-- columns are simply empty for the several thousand customers who are not
-- companies, which costs nothing.
--
-- Kept rather than cleared if a company stops being one. Un-ticking "this is a
-- company" is usually a correction of a mis-tick, and throwing away an address
-- somebody typed because a checkbox moved would be the program deciding it knew
-- better than the person who typed it.
--
-- `phone` is deliberately NOT duplicated here. The company's own number is the
-- customer's `phone`, the column every screen already reads; a second one would
-- be two answers to one question, and the first time they disagreed nobody
-- would know which was right.

ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN email TEXT;

-- The person who pays, as opposed to the person who drives. One contact, by
-- instruction and by judgement: a list would need its own table, its own
-- screen and a rule about which of them the statement goes to, and every shop
-- that has asked for "contacts" has meant "the one who pays".
ALTER TABLE customers ADD COLUMN billing_name TEXT;
ALTER TABLE customers ADD COLUMN billing_phone TEXT;
ALTER TABLE customers ADD COLUMN billing_email TEXT;
