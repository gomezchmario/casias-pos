-- Where a person SORTS on the shift desk, when their register role lies
-- about their hands.
--
-- Americo is the case: his pos_role is writer because he uses the register,
-- but he works as a mechanic and the owner rosters him with the mechanics.
-- Deriving the desk's grouping from pos_role alone made the role do two jobs
-- - what you may touch on the register, and where you stand on the floor -
-- and the first person whose answers differ proved they are two columns.
--
-- NULL means "derive from pos_role", which is everybody but the exceptions.
ALTER TABLE employees ADD COLUMN desk_group TEXT
  CHECK (desk_group IS NULL OR desk_group IN ('technicians','mechanics','office'));

-- The exception the column was built for.
UPDATE employees SET desk_group = 'mechanics' WHERE id = 43 AND name = 'Americo';
