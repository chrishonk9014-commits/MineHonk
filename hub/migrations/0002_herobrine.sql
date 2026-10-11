-- The Haunting: how many times Herobrine has answered through Claude each day
-- (the hub stops at HEROBRINE_DAILY_LIMIT and the game uses his scripted lines).

CREATE TABLE IF NOT EXISTS herobrine_usage (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
