CREATE TABLE IF NOT EXISTS profiles (
    anonymous_id TEXT PRIMARY KEY NOT NULL,
    token_hash BLOB NOT NULL,
    player_id TEXT NOT NULL,
    identity_confirmed INTEGER NOT NULL CHECK (identity_confirmed IN (0, 1)),
    updated_at INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS profiles_updated_at_idx
    ON profiles(updated_at);

PRAGMA user_version = 1;
