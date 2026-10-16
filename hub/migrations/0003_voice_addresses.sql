-- V7 phase 5: the haunting voices' answers a day per address, so one address
-- cannot use up the daily limit everyone shares. Addresses are never stored:
-- only a hash of the day and the address (an IPv6 address by its /64), which
-- cannot be matched across days. Rows from earlier days are deleted.

CREATE TABLE IF NOT EXISTS voice_address_usage (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
