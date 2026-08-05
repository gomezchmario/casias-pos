-- The colour of the car, and the two indexes that make a customer findable.
--
-- WHY COLOUR IS ON THE VEHICLE AT ALL
--
-- Everything else recorded about a vehicle -- year, make, model, plate -- is
-- there to identify it on paper. Colour is there to identify it in the lot. The
-- man at the counter says "the silver Tahoe" and nobody in the shop is going to
-- walk the row reading plates. It is the field the old paper tickets always had
-- and the one a database design left to itself would talk itself out of, on the
-- grounds that a plate is already unique -- which is true, and useless, at the
-- moment somebody is holding a set of keys asking which one.
--
-- Free text, not a lookup. "Silver", "gris", "dark blue-ish" are all answers
-- somebody will type, and all three do the job. A dropdown of eleven colours
-- would be slower to use and no more accurate, because the thing being recorded
-- is a description, not a fact.
--
-- WHY THE INDEXES
--
-- Big-boy mode looks a customer up by phone as it is typed, and a vehicle up by
-- plate. Both tables are small today and both will stop being small, and the
-- lookup happens at the counter with somebody waiting -- which is the one place
-- in this app where a table scan turning into a pause is a change in behaviour
-- rather than a change in a number.
--
-- Deliberately NOT unique. Two people share a phone -- a household, a business
-- line, a landlord who brings in four trucks -- and a plate gets transferred
-- between cars. A unique constraint here would reject a real customer at the
-- counter, which the cashier can do nothing about, so the matching is left to
-- code that can offer a choice instead of refusing one.

ALTER TABLE vehicles ADD COLUMN color TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id) WHERE deleted = 0;
