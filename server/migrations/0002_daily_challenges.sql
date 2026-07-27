CREATE TABLE IF NOT EXISTS daily_challenges (
    challenge_date TEXT PRIMARY KEY NOT NULL,
    round_number INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    player_snapshot_json TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS daily_challenges_created_at_idx
    ON daily_challenges(created_at);
