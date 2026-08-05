-- The shop's own details, for the top of a receipt.
--
-- Settings rather than constants in the receipt template: an address and a
-- phone number are exactly the sort of thing that changes once every few years
-- and must not require a developer when it does.
--
-- ON CONFLICT DO NOTHING throughout, so this is a seed and never an overwrite.
INSERT INTO settings (key, value) VALUES
  ('company_address', '8715 Grissom Rd, San Antonio, TX 78251'),
  ('company_phone',   '(210) 543-0909')
ON CONFLICT(key) DO NOTHING;

-- The full legal name is "Casias Muffler and Tire Shop"; the seed in 002 had
-- the short form. Corrected only where it is still untouched, so a name typed
-- by the owner in the meantime is left exactly as they left it.
UPDATE settings
   SET value = 'Casias Muffler and Tire Shop'
 WHERE key = 'company_name'
   AND value = 'Casias Tire Shop';
