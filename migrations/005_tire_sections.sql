-- Where a tire sits on the rack sheet.
--
-- The sheet is ordered the way the racks are: by rim diameter, 13 up to 28. That
-- ordering is derived from the size itself, so it needs no column -- but the last
-- section does. Eighteen-wheeler and specialty tires (semi, trailer, tow truck,
-- mower, the odd forklift size) are kept together at the end rather than scattered
-- through the passenger sizes, because nobody counting passenger stock wants to
-- walk past them and nobody pulling a semi tire wants to hunt for it.
--
-- Why a stored flag instead of inferring it from the size: the half-inch rims
-- (17.5, 19.5, 22.5, 24.5) really are all commercial and could be detected, but
-- the rest cannot. 480-8 and 570-8 are trailer tires, 16-6 8-6.5 is a mower tire,
-- and 35-12.50-20 is a light truck tire that belongs in the 20 section with the
-- passenger sizes. No rule separates those from the size string alone. The person
-- adding the tire knows; the parser does not. So they tick a box and we store the
-- answer instead of re-deriving a guess on every render.
--
-- Defaulting to 0 is right for the existing rows: everything in the system today
-- is passenger stock.

ALTER TABLE products ADD COLUMN specialized INTEGER NOT NULL DEFAULT 0;

-- Who we buy this tire from, normally.
--
-- Deliberately separate from `inventory_lots.supplier`, which is already stored
-- and answers a different question. The lot says where THIS batch actually came
-- from -- a fact about a delivery that happened, frozen on an append-only row.
-- This says where the tire USUALLY comes from, which is what you want when the
-- rack is empty and there is no recent lot to look at: it is the answer to
-- "who do I call to get more of these".
--
-- Free text rather than a suppliers table. The shop buys from a handful of
-- places and sometimes a one-off, and forcing every entry through a lookup
-- table would mean stopping to create a supplier record mid-delivery. If it
-- turns out to be worth normalising, the distinct values here are the seed for
-- doing it later.
ALTER TABLE products ADD COLUMN supplier TEXT;

-- The rack sheet reads every active tire in one go and buckets them; this keeps
-- the specialty split from being a scan when the real price list lands and the
-- table is a few thousand rows.
CREATE INDEX IF NOT EXISTS idx_products_specialized ON products(specialized)
  WHERE deleted = 0 AND kind = 'tire';
