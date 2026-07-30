CREATE TABLE IF NOT EXISTS solo_rounds (
    round_id TEXT PRIMARY KEY NOT NULL,
    anonymous_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    difficulty TEXT NOT NULL,
    mystery_player_id TEXT NOT NULL,
    deadline_unix_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (anonymous_id) REFERENCES profiles(anonymous_id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS solo_rounds_anonymous_created_idx
    ON solo_rounds(anonymous_id, created_at DESC);
