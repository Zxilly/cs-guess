PRAGMA foreign_keys = ON;

-- Canonical players. Volatile and multi-valued facts live in related tables.
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    canonical_nickname TEXT NOT NULL,
    full_name TEXT,
    country_code TEXT CHECK (
        country_code IS NULL OR length(country_code) = 2
    ),
    birth_date TEXT,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK (
        status IN ('active', 'inactive', 'retired', 'deceased', 'unknown')
    ),
    image_url TEXT,
    is_coach INTEGER NOT NULL DEFAULT 0 CHECK (
        is_coach IN (0, 1)
    ),
    has_player_career_evidence INTEGER NOT NULL DEFAULT 0 CHECK (
        has_player_career_evidence IN (0, 1)
    ),
    game_role_override TEXT CHECK (
        game_role_override IS NULL OR
        game_role_override IN ('awper', 'rifler', 'igl', 'entry')
    ),
    is_guessable INTEGER NOT NULL DEFAULT 0 CHECK (
        is_guessable IN (0, 1)
    ),
    exclusion_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_players_nickname
    ON players(canonical_nickname);
CREATE INDEX IF NOT EXISTS idx_players_nickname_nocase
    ON players(canonical_nickname COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_players_guessable
    ON players(is_guessable, status);

CREATE TABLE IF NOT EXISTS player_aliases (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    alias_kind TEXT NOT NULL DEFAULT 'alternate' CHECK (
        alias_kind IN ('alternate', 'native_name')
    ),
    source_record_id INTEGER REFERENCES source_records(id) ON DELETE SET NULL,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (player_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_player_aliases_player
    ON player_aliases(player_id);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    short_name TEXT,
    country_code TEXT CHECK (
        country_code IS NULL OR length(country_code) = 2
    ),
    logo_url TEXT,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK (
        status IN ('active', 'inactive', 'disbanded', 'unknown')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teams_name
    ON teams(canonical_name);

-- Provider IDs are never used as the canonical primary key.
CREATE TABLE IF NOT EXISTS player_source_ids (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (
        source IN (
            'liquipedia', 'pandascore', 'balldontlie', 'bo3',
            'hltv', 'steam', 'faceit'
        )
    ),
    external_id TEXT NOT NULL,
    source_url TEXT,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id),
    UNIQUE (player_id, source, external_id)
);

CREATE TABLE IF NOT EXISTS team_source_ids (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (
        source IN ('liquipedia', 'pandascore', 'balldontlie', 'bo3', 'hltv')
    ),
    external_id TEXT NOT NULL,
    source_url TEXT,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id),
    UNIQUE (team_id, source, external_id)
);

-- A player may have simultaneous or overlapping memberships, such as a loan,
-- bench period, academy roster, or stand-in appearance.
CREATE TABLE IF NOT EXISTS player_team_tenures (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    game_title TEXT NOT NULL DEFAULT 'counter-strike' CHECK (
        game_title IN ('counter-strike', 'csgo', 'cs2')
    ),
    membership_kind TEXT NOT NULL DEFAULT 'active' CHECK (
        membership_kind IN (
            'active', 'benched', 'inactive', 'loan', 'standin',
            'academy', 'trial', 'unknown'
        )
    ),
    start_value TEXT,
    start_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (
        start_precision IN ('day', 'month', 'year', 'unknown')
    ),
    end_value TEXT,
    end_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (
        end_precision IN ('day', 'month', 'year', 'unknown')
    ),
    is_current INTEGER NOT NULL DEFAULT 0 CHECK (
        is_current IN (0, 1)
    ),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (
        is_primary IN (0, 1)
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenures_player
    ON player_team_tenures(player_id, is_current, start_value);
CREATE INDEX IF NOT EXISTS idx_tenures_team
    ON player_team_tenures(team_id, is_current);

-- Keep weapon and tactical roles separate. For example, a player can be both
-- an AWPer and an IGL without losing either fact.
CREATE TABLE IF NOT EXISTS player_roles (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    role_kind TEXT NOT NULL CHECK (
        role_kind IN ('weapon', 'tactical')
    ),
    role TEXT NOT NULL CHECK (
        role IN ('awper', 'rifler', 'igl', 'entry', 'lurker', 'support')
    ),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (
        is_primary IN (0, 1)
    ),
    valid_from TEXT,
    valid_to TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (player_id, role_kind, role, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_roles_player
    ON player_roles(player_id, valid_to, is_primary);

CREATE TABLE IF NOT EXISTS major_events (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    game_title TEXT NOT NULL CHECK (
        game_title IN ('csgo', 'cs2')
    ),
    starts_on TEXT NOT NULL,
    ends_on TEXT,
    location_country_code TEXT CHECK (
        location_country_code IS NULL OR length(location_country_code) = 2
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- One row per player and Major. counts_toward_total makes the exact counting
-- policy explicit for substitutes, registered-only players, and disputed data.
CREATE TABLE IF NOT EXISTS major_appearances (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    major_id TEXT NOT NULL REFERENCES major_events(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    participation_kind TEXT NOT NULL DEFAULT 'participant' CHECK (
        participation_kind IN (
            'participant', 'standin', 'substitute', 'registered_only', 'unknown'
        )
    ),
    placement TEXT,
    stage_reached TEXT,
    matches_played INTEGER CHECK (
        matches_played IS NULL OR matches_played >= 0
    ),
    counts_toward_total INTEGER NOT NULL DEFAULT 1 CHECK (
        counts_toward_total IN (0, 1)
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, major_id)
);

CREATE INDEX IF NOT EXISTS idx_major_appearances_player
    ON major_appearances(player_id, counts_toward_total);

-- Every fetch is auditable and raw payloads can be retained outside the DB.
CREATE TABLE IF NOT EXISTS source_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK (
        source IN (
            'liquipedia', 'pandascore', 'balldontlie', 'bo3',
            'hltv', 'manual'
        )
    ),
    record_type TEXT NOT NULL CHECK (
        record_type IN (
            'player', 'team', 'team_history', 'role',
            'major', 'major_appearance'
        )
    ),
    external_id TEXT NOT NULL,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    source_modified_at TEXT,
    source_revision_id TEXT,
    http_etag TEXT,
    payload_sha256 TEXT NOT NULL,
    raw_payload_path TEXT,
    UNIQUE (source, record_type, external_id, payload_sha256)
);

-- Field-level evidence lets the merger select a canonical value without
-- destroying alternatives from other providers.
CREATE TABLE IF NOT EXISTS field_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (
        entity_type IN (
            'player', 'team', 'team_tenure', 'player_role',
            'major', 'major_appearance'
        )
    ),
    entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    source_record_id INTEGER NOT NULL
        REFERENCES source_records(id) ON DELETE CASCADE,
    normalized_value_json TEXT,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (
        confidence >= 0.0 AND confidence <= 1.0
    ),
    is_selected INTEGER NOT NULL DEFAULT 0 CHECK (
        is_selected IN (0, 1)
    ),
    observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_field_evidence_entity
    ON field_evidence(entity_type, entity_id, field_name, is_selected);
CREATE INDEX IF NOT EXISTS idx_field_evidence_source_record
    ON field_evidence(source_record_id);

CREATE TABLE IF NOT EXISTS merge_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    candidate_values_json TEXT NOT NULL,
    resolution_status TEXT NOT NULL DEFAULT 'open' CHECK (
        resolution_status IN ('open', 'automatic', 'manual', 'ignored')
    ),
    resolved_value_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (
        source IN (
            'liquipedia', 'pandascore', 'balldontlie', 'bo3',
            'hltv', 'merge'
        )
    ),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('running', 'succeeded', 'partial', 'failed')
    ),
    records_seen INTEGER NOT NULL DEFAULT 0,
    records_changed INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT
);

CREATE VIEW IF NOT EXISTS player_major_totals AS
SELECT
    player_id,
    COUNT(*) AS major_appearances
FROM major_appearances
WHERE counts_toward_total = 1
GROUP BY player_id;

CREATE VIEW IF NOT EXISTS player_current_primary_teams AS
SELECT
    player_id,
    team_id,
    membership_kind,
    start_value
FROM player_team_tenures
WHERE is_current = 1 AND is_primary = 1;
