-- MineHonk cloud hub: accounts, friends, blocks and the world registry.
-- Applied by the deploy workflow (wrangler d1 migrations apply --remote).

CREATE TABLE IF NOT EXISTS users (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  uuid TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);

-- Friendships are stored both ways (a -> b and b -> a)
CREATE TABLE IF NOT EXISTS friends (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  PRIMARY KEY (a, b)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  from_uuid TEXT NOT NULL,
  to_uuid TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (from_uuid, to_uuid)
);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests (to_uuid);

CREATE TABLE IF NOT EXISTS blocks (
  by_uuid TEXT NOT NULL,
  who TEXT NOT NULL,
  PRIMARY KEY (by_uuid, who)
);

-- The world registry: one row per world (settings as JSON), its join code,
-- and the members (allowlist, operators, roles) for listing
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  visibility TEXT NOT NULL,
  join_code TEXT UNIQUE,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS worlds_owner ON worlds (owner);
CREATE INDEX IF NOT EXISTS worlds_visibility ON worlds (visibility);

CREATE TABLE IF NOT EXISTS world_members (
  world_id TEXT NOT NULL,
  uuid TEXT NOT NULL,
  PRIMARY KEY (world_id, uuid)
);
CREATE INDEX IF NOT EXISTS world_members_uuid ON world_members (uuid);

-- The hub's join-ticket signing key (made on first use)
CREATE TABLE IF NOT EXISTS hub_keys (
  id TEXT PRIMARY KEY,
  private_jwk TEXT NOT NULL,
  public_jwk TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
