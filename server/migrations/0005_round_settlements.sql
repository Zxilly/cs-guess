-- The bounded profile JSON is a UI cache, not an idempotency ledger.
CREATE TABLE IF NOT EXISTS round_settlements (
    anonymous_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    history_entry_json TEXT,
    legacy_unknown INTEGER NOT NULL DEFAULT 0 CHECK (legacy_unknown IN (0, 1)),
    PRIMARY KEY (anonymous_id, round_id),
    FOREIGN KEY (anonymous_id) REFERENCES profiles(anonymous_id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS settlement_migrations (
    version INTEGER PRIMARY KEY NOT NULL
);

-- Backfill all recoverable receipts before marking unrecoverable expired rounds.
INSERT OR IGNORE INTO round_settlements (anonymous_id, round_id, history_entry_json)
SELECT profiles.anonymous_id, json_extract(history.value, '$.id'), history.value
FROM profiles, json_each(profiles.state_json, '$.matchHistory') AS history
WHERE NOT EXISTS (SELECT 1 FROM settlement_migrations WHERE version = 1);

INSERT OR IGNORE INTO round_settlements (anonymous_id, round_id)
SELECT profiles.anonymous_id, recorded.value
FROM profiles, json_each(profiles.state_json, '$.recordedRounds') AS recorded
WHERE NOT EXISTS (SELECT 1 FROM settlement_migrations WHERE version = 1);

-- Old evicted outcomes cannot be reconstructed. Seal expired legacy solo rounds
-- without changing rewards or fabricating a win/loss. Active rounds remain open.
INSERT OR IGNORE INTO round_settlements (anonymous_id, round_id, legacy_unknown)
SELECT anonymous_id, round_id, 1 FROM solo_rounds
WHERE deadline_unix_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  AND NOT EXISTS (SELECT 1 FROM settlement_migrations WHERE version = 1);

INSERT OR IGNORE INTO round_settlements (anonymous_id, round_id, legacy_unknown)
SELECT anonymous_id, 'daily:' || challenge_date, 1 FROM daily_attempts
WHERE deadline_unix_ms <= CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  AND NOT EXISTS (SELECT 1 FROM settlement_migrations WHERE version = 1);

INSERT OR IGNORE INTO settlement_migrations (version) VALUES (1);
