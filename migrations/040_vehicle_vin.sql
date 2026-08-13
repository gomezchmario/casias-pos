-- The VIN, on the car.
--
-- Deliberately nullable, and it will stay that way. This shop puts tires on
-- lawnmowers, skid steers and trailers, and a column that refuses to be empty
-- would either lock those out of the book or invite somebody to type "NONE"
-- seventeen times — which is worse than blank, because blank is honestly
-- unknown and NONE looks like a fact.
--
-- Where it is nearly always wanted is a fleet: a company being billed for work
-- on eleven trucks needs the trucks told apart on the statement, and a plate
-- changes hands while a VIN does not. So the register ASKS when a house-account
-- ticket has a car with no VIN on it, and takes no for an answer.
--
-- Not unique either. The same VIN legitimately appears twice while a vehicle is
-- being moved between customers or entered before an older duplicate is found,
-- and a unique index would refuse the correction rather than the mistake.

ALTER TABLE vehicles ADD COLUMN vin TEXT;

-- The one lookup this exists for: "whose truck is this" from a VIN read off a
-- windscreen. Partial, because the great majority of rows will never have one
-- and there is no sense indexing six hundred NULLs.
CREATE INDEX IF NOT EXISTS idx_vehicles_vin
  ON vehicles (vin) WHERE vin IS NOT NULL;
