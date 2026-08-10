-- What a service costs the shop to perform.
--
-- THE MISSING HALF OF EVERY MARGIN FIGURE. A tire carries a cost — it was
-- bought from a supplier at a price the shop knows — and that cost is
-- snapshotted onto the line when it is rung. Nothing else does. A flat repair,
-- a mount and balance, a rotation, an oil change: all of them consume a patch,
-- a weight, a valve, five quarts of oil and half an hour of somebody's time,
-- and the register has never had anywhere to record that.
--
-- The consequence was a Gross Margin panel that said "not enough cost data" on
-- most windows, because two thirds of what this shop sells is labour and the
-- only lines carrying a cost were the tires.
--
-- KEYED ON THE DESCRIPTION, not on a product or a quick button, and that is the
-- whole design. Services reach a ticket three ways — a quick button, a typed
-- line, and forty thousand rows of imported history — and the only thing all
-- three share is the words on the line. A key on `quick_buttons` would cost
-- nothing to add and would cover the first of the three.
--
-- `description_key` is the description upper-cased and squeezed of runs of
-- spaces, so "Mount & Balance" and "MOUNT &  BALANCE" are one entry. It is
-- normalised by the caller rather than by a trigger, because the same
-- normalisation has to happen on the read side to match a line against it, and
-- one function doing it in both directions cannot disagree with itself.
--
-- A cost of ZERO is a real answer and is stored as one. "This service consumes
-- nothing" is a fact worth recording — it is what makes an inspection 100%
-- margin rather than unknown margin — and it is different from never having
-- been asked, which is the row being absent.

CREATE TABLE IF NOT EXISTS service_costs (
  description_key TEXT    PRIMARY KEY,
  -- What performing it costs the shop in materials, per unit sold. Labour is
  -- deliberately excluded: it is a fixed cost of opening the doors, it does not
  -- scale with one more flat repair, and folding it in here would turn every
  -- margin on the page into a figure that depends on how busy the day was.
  cost_cents      INTEGER NOT NULL CHECK (cost_cents >= 0),
  note            TEXT,
  set_by          INTEGER REFERENCES employees(id),
  set_at          TEXT    NOT NULL
);
