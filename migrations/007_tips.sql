-- Tips, the tenders that take them, and the money that starts in the drawer.

-- AFF and Clover are gone from the counter.
--
-- Deactivated, never deleted: `payments.method_id` is a foreign key into this
-- table and the ledger is append-only, so a row that any historical payment
-- points at has to keep existing or that payment stops being readable. Setting
-- active = 0 drops them from every picker -- `listPaymentMethods` already
-- filters on it -- while yesterday's books still resolve their own tender.
UPDATE payment_methods SET active = 0 WHERE code IN ('aff', 'clover');

-- Who the tip belongs to.
--
-- A tip is left for the person who did the work, so it has to name them, and
-- the ticket cannot answer that on its own: a ticket with a tire from Jose and
-- two flats from Jerry has no single technician. The register asks when the
-- answer is ambiguous and fills it in when it is not.
--
-- Nullable, because the honest answer is sometimes "nobody in particular" --
-- a counter sale with no technician on any line -- and inventing an attribution
-- is worse than admitting there isn't one. It is also NULL on every payment
-- written before today, which is exactly right: those tips were never assigned
-- and this migration must not pretend otherwise.
ALTER TABLE payments ADD COLUMN mechanic_id INTEGER REFERENCES employees(id);

-- The leaderboard reads this per technician per day; without it that is a scan
-- of the whole ledger every time the dashboard loads.
CREATE INDEX IF NOT EXISTS idx_payments_mechanic
  ON payments(mechanic_id, business_date);

-- What is in the drawer before the first sale.
--
-- The shop keeps a standing $100 to make change with. It is not takings and
-- must never be counted as such: at close the drawer is expected to hold the
-- float plus the day's cash, and `expectationsFrom` already adds it back for
-- cash tenders only. Storing it as a setting rather than a constant means the
-- day the owner decides $200 is more sensible, nobody needs a deploy.
INSERT INTO settings (key, value) VALUES ('register_float_cents', '10000')
ON CONFLICT(key) DO NOTHING;
