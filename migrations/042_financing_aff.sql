-- Financing is two providers, not one.
--
-- The shop takes SNAP and AFF, and until now only SNAP was switched on — so an
-- AFF deal was rung as SNAP and the two settle from different places on
-- different days. That is a reconciliation nobody can do afterwards: the money
-- arrives from AFF and the ledger says SNAP.
--
-- `aff` has existed as an inactive row since the methods were first seeded, so
-- this only turns it on and puts it next to its sibling in the sort order.
-- Both already carry kind = 'financing', which is what the register groups them
-- by — see the Financing button in PaymentPanel. Nothing about existing SNAP
-- payments changes; they stay SNAP, because that is what they were rung as and
-- a ledger is not improved by being rewritten.

UPDATE payment_methods
   SET active = 1,
       sort_order = 35   -- immediately after snap (30), before po_shop (60)
 WHERE code = 'aff';
