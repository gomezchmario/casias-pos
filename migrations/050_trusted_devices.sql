-- Devices the shop has decided it trusts.
--
-- A trusted device punches the clock without being asked where it is. That is
-- the whole privilege, and it is the counterpart to the fence in 049: the
-- shop's own counter tablet works when the roof blocks GPS, and the register
-- PC — which has no GPS and would guess its position off wi-fi, badly — is
-- never asked to guess.
--
-- THE TOKEN IS NEVER STORED, only its sha256. Same rule as `pos_sessions`, for
-- the same reason: a database that leaks cannot hand anybody a working device
-- cookie, because what is in here does not open anything.
--
-- ENROLLED FROM THE ADMIN PANEL, by pressing a button on the device being
-- trusted. That is the only way in, and it means trusting a device requires
-- already holding an admin password on it — a stronger credential than the
-- 4-digit PIN this whole mechanism is protecting.
--
-- REVOCATION IS A STAMP, NOT A DELETE. "Which device was this, when did we
-- trust it, and when did we stop" is the question that gets asked after a
-- phone walks out of the shop, and a deleted row cannot answer it.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT NOT NULL UNIQUE,
  -- What a person calls it: "counter tablet", "Jose's phone". Typed by whoever
  -- enrolls it, because a list of user-agent strings is a list nobody reads.
  label         TEXT NOT NULL DEFAULT '',
  user_agent    TEXT,
  first_ip      TEXT,
  enrolled_by   INTEGER REFERENCES admin_users(id),
  enrolled_by_name TEXT,
  enrolled_at   TEXT NOT NULL,
  last_seen_at  TEXT,
  revoked_at    TEXT,
  revoked_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_trusted_live ON trusted_devices(revoked_at);
