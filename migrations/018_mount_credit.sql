-- Who FITTED the tire, as opposed to who sold it.
--
-- A special order is the one job in this shop that reliably splits across two
-- people and a week of calendar. Somebody at the counter takes the order, rings
-- the ticket and gets the credit for the tire. The tire then turns up on a
-- Thursday, and whoever is free that afternoon mounts and balances it -- which
-- is the actual physical work, and until now it earned that person nothing at
-- all. The board showed the seller the whole price and the fitter a blank.
--
-- The customer is not charged a cent more for this. Mount-and-balance was
-- always inside the price of an ordered tire; the only thing that was missing
-- was a way to say who did that part of it. So this moves credit BETWEEN two
-- technicians and never changes `line_total_cents`, the subtotal, the frozen
-- total or any payment. The shop's income for the day is identical either way,
-- which is the property that makes it safe to apply to tickets that are already
-- paid: no report that footed before will stop footing.
--
--   mount_mechanic_id  who fitted it. NULL -- the overwhelming majority of
--                      lines -- means the seller did it, or nobody said, and
--                      every report behaves exactly as it did before.
--   mount_unit_cents   what one tire's fitting was worth WHEN THE NAME WAS PUT
--                      ON THE LINE, copied off the `mount_credit_cents`
--                      setting.
--
-- The rate is snapshotted rather than read live at report time, for the same
-- reason a ticket's total freezes when it completes: raising the shop's mount
-- rate in October must not quietly restate what a technician was already paid
-- for a week in August. Per TIRE rather than per line, so the stored number
-- stays right if the quantity on the line is later corrected -- four tires
-- fitted is four tires of work, the same way MOUNT & BALANCE is rung 2x for a
-- pair.
--
-- Deliberately NOT a second sale_items row priced at zero. A $0 line would be
-- one more thing on the customer's receipt, would count as a line on the
-- services board whether or not anything moved, and would have to be found and
-- cleaned up every time the tire line beneath it was voided or re-rung. This is
-- an attribute of the tire line, and it lives and dies with it.

ALTER TABLE sale_items ADD COLUMN mount_mechanic_id INTEGER REFERENCES employees(id);
ALTER TABLE sale_items ADD COLUMN mount_unit_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sale_items_mount ON sale_items(mount_mechanic_id)
  WHERE mount_mechanic_id IS NOT NULL;

INSERT OR IGNORE INTO settings (key, value) VALUES ('mount_credit_cents', '3500');
