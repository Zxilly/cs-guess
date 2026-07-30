CREATE TABLE IF NOT EXISTS daily_attempts (
    anonymous_id TEXT NOT NULL,
    challenge_date TEXT NOT NULL,
    deadline_unix_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (anonymous_id, challenge_date),
    FOREIGN KEY (anonymous_id) REFERENCES profiles(anonymous_id) ON DELETE CASCADE,
    FOREIGN KEY (challenge_date) REFERENCES daily_challenges(challenge_date) ON DELETE CASCADE
) WITHOUT ROWID;
