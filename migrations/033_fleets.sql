-- Fleets: a company account with drivers under it.
--
-- THE SHOP ALREADY HAD TWO OF THESE AND NO WAY TO SAY SO. Williams Insulation
-- is a customer with an approved tab; so is Steve Carrillo, who turns out to
-- own Carrillo Construction. Their drivers come in with company trucks, charge
-- to the company, and until now each driver was either an unconnected customer
-- with a tab nobody approved, or the charge was rung under the company name
-- and nobody could say which driver brought the truck in.
--
-- A FLEET IS A CUSTOMER, not a new kind of thing, and that is the whole design.
-- Williams Insulation already exists as a customer: it has a customer number, a
-- phone, an approved tab, a year of history. Giving fleets their own table would
-- create a second kind of "who owes us money" and every balance, statement and
-- report in the program would have to union two shapes forever. So the parent
-- is a row in this same table with `is_fleet = 1`, and a driver points at it.
--
-- `fleet_id` MEANS "BILL THIS PERSON'S TAB TO THAT ACCOUNT". It is the billing
-- relationship and nothing else — it does not move the ticket, the vehicle or
-- the history, which all stay with the driver who was actually served. That
-- separation is what makes the fleet's own report possible: every charge on the
-- company tab still knows which driver made it, because the sale still names
-- them.
--
-- Consequence worth stating plainly: a driver in a fleet does NOT keep a
-- separate tab. Membership IS the billing arrangement, so a driver who should
-- be invoiced on their own belongs outside the fleet. Anything else would need
-- a per-charge choice at the counter, which is a question nobody at a register
-- wants to be asked twice a day.
--
-- Approval is inherited rather than copied. A driver under an approved fleet is
-- approved BECAUSE the fleet is, so the "running a tab nobody approved" review
-- reads through the parent instead of flagging every driver the day they are
-- added. Copying the flag onto the driver would leave it behind the day the
-- shop stops carrying the company.

ALTER TABLE customers ADD COLUMN fleet_id INTEGER REFERENCES customers(id);
ALTER TABLE customers ADD COLUMN is_fleet INTEGER NOT NULL DEFAULT 0;

-- Every balance, statement and roll-up looks a member up by parent, so the
-- lookup is indexed; partial, because the overwhelming majority of customers
-- are not in a fleet and there is no reason to carry them in it.
CREATE INDEX IF NOT EXISTS idx_customers_fleet
    ON customers (fleet_id) WHERE fleet_id IS NOT NULL;
