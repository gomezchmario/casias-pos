-- The order the tender buttons appear in, which is a shop decision.
--
-- The grid reads two across, so the sort order decides which tenders sit beside
-- each other, and the pairing is what somebody learns rather than the position:
--
--     Cash             Credit Card       the two ordinary ways to pay
--     Credit Account   Financing         the two ways of not paying today
--     PO Shop          Other             the two that need a note
--
-- Credit Account moves up from 70 to sit beside Financing at 30, because they
-- are the same answer to the customer — the work leaves today and the money
-- comes later — and having one at the top of the list and the other at the
-- bottom made them look like unrelated choices.
--
-- Nothing else moves: cash 10, cc 20, the financing providers 30 and 35,
-- po_shop 60, other 80. The register renders the Financing group at the
-- position of its first provider, so this file is the whole of the layout.

UPDATE payment_methods SET sort_order = 25 WHERE code = 'credit_account';
