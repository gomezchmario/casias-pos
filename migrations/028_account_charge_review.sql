-- A charge on an unapproved account, looked at and signed off.
--
-- Money going onto the tab of somebody nobody approved is worth flagging, and
-- the accountant's "Not approved" list is that flag. But a flag that cannot be
-- cleared is a list that only grows: after the third month it is forty rows
-- long, thirty-eight of them already dealt with, and nobody reads it. A control
-- nobody reads is worse than no control, because the shop believes it has one.
--
-- So each charge can be marked audited. It does not approve the customer and it
-- does not change a cent — it records that a person looked at this particular
-- transaction and was satisfied. The customer drops off the list only when
-- every one of their charges has been looked at; a new charge tomorrow puts
-- them straight back on it, which is the behaviour that makes the list worth
-- opening.
--
-- ITS OWN TABLE, NOT COLUMNS ON `payments`. That ledger is append-only and its
-- rows are never edited — the whole system leans on that. A review is a second,
-- later fact ABOUT a payment rather than a property of it, and giving it its own
-- row keeps the rule intact and the reviewer's name and time beside it.
--
-- `payment_id` is the primary key: a charge is either reviewed or it is not, and
-- reviewing one twice is the same fact said again.

CREATE TABLE IF NOT EXISTS account_charge_reviews (
  payment_id   INTEGER PRIMARY KEY REFERENCES payments(id),
  reviewed_by  INTEGER NOT NULL REFERENCES employees(id),
  reviewed_at  TEXT NOT NULL,
  note         TEXT
);
