from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from collections.abc import Mapping
from datetime import date, datetime, timezone
from pathlib import Path
from types import TracebackType
from typing import Any, Self

from .merge import (
    choose_display_casing,
    choose_evidence,
    derive_game_role,
    nickname_identity_signature,
    normalize_identity_text,
    person_name_token_signature,
    person_name_tokens_compatible,
    primary_person_name,
    team_name_identity_signature,
)

try:
    from .normalization import normalize_country_code
except ModuleNotFoundError as exc:
    if exc.name != "pycountry":
        raise

    def normalize_country_code(raw: str | None) -> str | None:
        value = (raw or "").strip()
        if len(value) == 2:
            return value.upper()
        return {
            "denmark": "DK",
            "france": "FR",
            "germany": "DE",
            "russia": "RU",
            "sweden": "SE",
            "united states": "US",
        }.get(value.casefold())


DEFAULT_SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _is_departed_team_name(value: object) -> bool:
    return str(value or "").strip().casefold().startswith("ex-")


class PlayerStore:
    """SQLite-backed canonical store for normalized player source data."""

    def __init__(
        self,
        db_path: str | Path,
        schema_path: str | Path = DEFAULT_SCHEMA_PATH,
    ) -> None:
        self.db_path = str(db_path)
        self.schema_path = Path(schema_path)
        self._connection: sqlite3.Connection | None = None
        self.init()

    def init(self) -> Self:
        if self._connection is None:
            self._connection = sqlite3.connect(self.db_path)
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.executescript(self.schema_path.read_text(encoding="utf-8"))
            source_columns = {
                str(row["name"])
                for row in self._connection.execute(
                    "PRAGMA table_info(source_records)"
                )
            }
            for column in ("source_modified_at", "source_revision_id"):
                if column not in source_columns:
                    self._connection.execute(
                        f"ALTER TABLE source_records ADD COLUMN {column} TEXT"
                    )
            player_columns = {
                str(row["name"])
                for row in self._connection.execute(
                    "PRAGMA table_info(players)"
                )
            }
            if "is_coach" not in player_columns:
                self._connection.execute(
                    "ALTER TABLE players ADD COLUMN "
                    "is_coach INTEGER NOT NULL DEFAULT 0 "
                    "CHECK (is_coach IN (0, 1))"
                )
            self._connection.commit()
            self._migrate_provider_constraints()
        return self

    initialize = init

    def __enter__(self) -> Self:
        return self.init()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._connection is not None:
            if exc_type is None:
                self._connection.commit()
            else:
                self._connection.rollback()
        self.close()

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    @property
    def connection(self) -> sqlite3.Connection:
        if self._connection is None:
            self.init()
        assert self._connection is not None
        return self._connection

    def _migrate_provider_constraints(self) -> None:
        assert self._connection is not None
        constrained_tables = (
            "player_source_ids",
            "team_source_ids",
            "source_records",
            "ingestion_runs",
        )
        table_sql = {
            str(row["name"]): str(row["sql"] or "")
            for row in self._connection.execute(
                """
                SELECT name, sql FROM sqlite_master
                WHERE type = 'table'
                  AND name IN (
                    'player_source_ids', 'team_source_ids',
                    'source_records', 'ingestion_runs'
                  )
                """
            )
        }
        if all(
            all(
                provider in table_sql.get(table_name, "")
                for provider in ("balldontlie", "bo3")
            )
            for table_name in constrained_tables
        ):
            return

        definitions = {
            "player_source_ids": """
                CREATE TABLE player_source_ids_new (
                    player_id TEXT NOT NULL
                        REFERENCES players(id) ON DELETE CASCADE,
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
                )
            """,
            "team_source_ids": """
                CREATE TABLE team_source_ids_new (
                    team_id TEXT NOT NULL
                        REFERENCES teams(id) ON DELETE CASCADE,
                    source TEXT NOT NULL CHECK (
                        source IN (
                            'liquipedia', 'pandascore',
                            'balldontlie', 'bo3', 'hltv'
                        )
                    ),
                    external_id TEXT NOT NULL,
                    source_url TEXT,
                    last_seen_at TEXT NOT NULL,
                    PRIMARY KEY (source, external_id),
                    UNIQUE (team_id, source, external_id)
                )
            """,
            "source_records": """
                CREATE TABLE source_records_new (
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
                    UNIQUE (
                        source, record_type, external_id, payload_sha256
                    )
                )
            """,
            "ingestion_runs": """
                CREATE TABLE ingestion_runs_new (
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
                        status IN (
                            'running', 'succeeded', 'partial', 'failed'
                        )
                    ),
                    records_seen INTEGER NOT NULL DEFAULT 0,
                    records_changed INTEGER NOT NULL DEFAULT 0,
                    error_summary TEXT
                )
            """,
        }
        columns = {
            "player_source_ids": (
                "player_id, source, external_id, source_url, last_seen_at"
            ),
            "team_source_ids": (
                "team_id, source, external_id, source_url, last_seen_at"
            ),
            "source_records": (
                "id, source, record_type, external_id, source_url, "
                "fetched_at, source_modified_at, source_revision_id, "
                "http_etag, payload_sha256, raw_payload_path"
            ),
            "ingestion_runs": (
                "id, source, started_at, finished_at, status, records_seen, "
                "records_changed, error_summary"
            ),
        }

        self._connection.execute("PRAGMA foreign_keys = OFF")
        try:
            self._connection.execute("BEGIN")
            for table_name in constrained_tables:
                if all(
                    provider in table_sql.get(table_name, "")
                    for provider in ("balldontlie", "bo3")
                ):
                    continue
                self._connection.execute(definitions[table_name])
                selected_columns = columns[table_name]
                self._connection.execute(
                    f"""
                    INSERT INTO {table_name}_new ({selected_columns})
                    SELECT {selected_columns} FROM {table_name}
                    """
                )
                self._connection.execute(f"DROP TABLE {table_name}")
                self._connection.execute(
                    f"ALTER TABLE {table_name}_new RENAME TO {table_name}"
                )
            self._connection.commit()
        except Exception:
            self._connection.rollback()
            raise
        finally:
            self._connection.execute("PRAGMA foreign_keys = ON")
        violations = list(
            self._connection.execute("PRAGMA foreign_key_check")
        )
        if violations:
            raise sqlite3.IntegrityError(
                "provider constraint migration created foreign-key violations"
            )

    def upsert_source_player(
        self,
        source: str,
        parsed: Mapping[str, Any],
        raw_metadata: Mapping[str, Any] | None = None,
    ) -> str:
        raw_metadata = raw_metadata or {}
        raw_external_id = (
            parsed.get("external_id")
            or parsed.get("source_id")
            or (
                parsed.get("source_ids", {}).get(source)
                if isinstance(parsed.get("source_ids"), Mapping)
                else None
            )
        )
        if raw_external_id is None:
            raise ValueError("parsed.external_id or parsed.source_id is required")
        external_id = str(raw_external_id)
        nickname = str(parsed["nickname"]).strip()
        if not nickname:
            raise ValueError("parsed.nickname must not be empty")
        country_code = normalize_country_code(
            parsed.get("country_code") or parsed.get("country")
        )
        status = parsed.get("status")
        if status is None and parsed.get("active") is not None:
            status = "active" if parsed.get("active") else "inactive"
        status = str(status or "unknown").casefold()
        if status not in {"active", "inactive", "retired", "deceased", "unknown"}:
            status = "unknown"

        existing = self.connection.execute(
            """
            SELECT player_id
            FROM player_source_ids
            WHERE source = ? AND external_id = ?
            """,
            (source, external_id),
        ).fetchone()
        platform_player_ids: set[str] = set()
        platform_ids = parsed.get("platform_ids") or {}
        if existing is None and isinstance(platform_ids, Mapping):
            for platform_source in ("steam", "faceit"):
                platform_external_id = platform_ids.get(platform_source)
                if not platform_external_id:
                    continue
                mapped = self.connection.execute(
                    """
                    SELECT player_id FROM player_source_ids
                    WHERE source = ? AND external_id = ?
                    """,
                    (platform_source, str(platform_external_id)),
                ).fetchone()
                if mapped:
                    platform_player_ids.add(str(mapped["player_id"]))
        matched_platform_player_id = (
            next(iter(platform_player_ids))
            if len(platform_player_ids) == 1
            else None
        )
        player_id = (
            str(existing["player_id"])
            if existing
            else (
                matched_platform_player_id
                or f"player_{uuid.uuid4().hex}"
            )
        )
        is_new_player = existing is None and matched_platform_player_id is None
        timestamp = str(raw_metadata.get("fetched_at") or _now())
        source_url = raw_metadata.get("source_url") or parsed.get("source_url")
        current_team = parsed.get("current_team")
        has_live_current_team = isinstance(current_team, Mapping) and not (
            _is_departed_team_name(current_team.get("name"))
        )

        if existing and "current_team" in parsed and not has_live_current_team:
            self.clear_source_current_team(player_id, source, external_id)

        with self.connection:
            if is_new_player:
                self.connection.execute(
                    """
                    INSERT INTO players (
                        id, canonical_nickname, full_name, country_code,
                        birth_date, status, image_url, is_coach,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        player_id,
                        nickname,
                        parsed.get("full_name"),
                        country_code,
                        parsed.get("birth_date"),
                        status,
                        parsed.get("image_url"),
                        int(bool(parsed.get("is_coach"))),
                        timestamp,
                        timestamp,
                    ),
                )
            if existing:
                self.connection.execute(
                    """
                    UPDATE player_source_ids
                    SET source_url = COALESCE(?, source_url), last_seen_at = ?
                    WHERE source = ? AND external_id = ?
                    """,
                    (source_url, timestamp, source, external_id),
                )
            else:
                self.connection.execute(
                    """
                    INSERT INTO player_source_ids (
                        player_id, source, external_id, source_url, last_seen_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (player_id, source, external_id, source_url, timestamp),
                )

            source_record_id, is_new = self._upsert_source_record(
                source=source,
                record_type="player",
                external_id=external_id,
                raw_metadata=raw_metadata,
                parsed=parsed,
                source_url=source_url,
                fetched_at=timestamp,
            )
            if is_new:
                fields = {
                    "nickname": nickname,
                    "full_name": parsed.get("full_name"),
                    "country_code": country_code,
                    "birth_date": parsed.get("birth_date"),
                    "status": status,
                    "image_url": parsed.get("image_url"),
                    "is_coach": (
                        bool(parsed.get("is_coach"))
                        if parsed.get("is_coach") is not None
                        else None
                    ),
                }
                for field_name, value in fields.items():
                    if value is not None:
                        self.connection.execute(
                            """
                            INSERT INTO field_evidence (
                                entity_type, entity_id, field_name,
                                source_record_id, normalized_value_json,
                                confidence, is_selected, observed_at
                            ) VALUES ('player', ?, ?, ?, ?, ?, 0, ?)
                            """,
                            (
                                player_id,
                                field_name,
                                source_record_id,
                                _json(value),
                                float(raw_metadata.get("confidence", 1.0)),
                                timestamp,
                            ),
                        )
            self._ingest_player_relationships(
                source=source,
                player_id=player_id,
                player_external_id=external_id,
                parsed=parsed,
                player_source_record_id=source_record_id,
                fetched_at=timestamp,
            )
        return player_id

    def apply_reviewed_identity_merges(
        self,
        mappings: list[Mapping[str, Any]],
    ) -> dict[str, int]:
        """Apply explicit identity mappings that were verified externally.

        Provider references make these mappings replayable after a database
        rebuild, unlike canonical UUID pairs.
        """
        result = {"merged": 0, "already_merged": 0}
        allowed_overrides = {
            "nickname",
            "full_name",
            "country_code",
            "birth_date",
            "status",
            "image_url",
            "is_coach",
        }
        with self.connection:
            for mapping in mappings:
                survivor_ref = mapping.get("survivor")
                duplicate_ref = mapping.get("duplicate")
                if not isinstance(survivor_ref, Mapping) or not isinstance(
                    duplicate_ref,
                    Mapping,
                ):
                    raise TypeError(
                        "reviewed identity mapping requires survivor and "
                        "duplicate provider references"
                    )
                try:
                    survivor_id = self.resolve_player_id(
                        str(survivor_ref["source"]),
                        str(survivor_ref["external_id"]),
                    )
                    duplicate_id = self.resolve_player_id(
                        str(duplicate_ref["source"]),
                        str(duplicate_ref["external_id"]),
                    )
                except KeyError as error:
                    raise ValueError(
                        f"reviewed identity mapping is unresolved: {error}"
                    ) from error

                raw_overrides = mapping.get("overrides") or {}
                if not isinstance(raw_overrides, Mapping):
                    raise TypeError(
                        "reviewed identity mapping overrides must be an object"
                    )
                overrides = dict(raw_overrides)
                unknown_overrides = set(overrides) - allowed_overrides
                if unknown_overrides:
                    raise ValueError(
                        "reviewed identity mapping has unsupported overrides: "
                        + ", ".join(sorted(unknown_overrides))
                    )
                audit_mapping = {
                    "survivor": dict(survivor_ref),
                    "duplicate": dict(duplicate_ref),
                    "evidence": list(mapping.get("evidence") or []),
                    "basis": mapping.get("basis"),
                    "overrides": overrides,
                }
                if survivor_id == duplicate_id:
                    result["already_merged"] += 1
                else:
                    self._merge_player_into(survivor_id, duplicate_id)
                    result["merged"] += 1
                for evidence in audit_mapping["evidence"]:
                    if not isinstance(evidence, Mapping):
                        continue
                    evidence_source = str(evidence.get("source") or "")
                    evidence_external_id = evidence.get("external_id")
                    if (
                        evidence_source not in {"hltv", "steam", "faceit"}
                        or evidence_external_id is None
                    ):
                        continue
                    self.link_source_player(
                        survivor_id,
                        evidence_source,
                        str(evidence_external_id),
                        source_url=str(evidence.get("url") or "") or None,
                    )
                if overrides:
                    observed_at = _now()
                    source_record_id, is_new = self._upsert_source_record(
                        source="manual",
                        record_type="player",
                        external_id=(
                            "reviewed-identity:"
                            f"{survivor_ref['source']}:"
                            f"{survivor_ref['external_id']}"
                        ),
                        raw_metadata={"payload": audit_mapping},
                        parsed=overrides,
                        source_url=None,
                        fetched_at=observed_at,
                    )
                    if is_new:
                        for field_name, value in overrides.items():
                            self._insert_evidence(
                                entity_type="player",
                                entity_id=survivor_id,
                                field_name=field_name,
                                source_record_id=source_record_id,
                                value=value,
                                observed_at=observed_at,
                            )
                self._record_conflict(
                    entity_type="player",
                    entity_id=survivor_id,
                    field_name="identity:reviewed_cross_source",
                    candidates=[audit_mapping],
                    resolved_value=survivor_id,
                    status="manual",
                )
        return result

    def apply_reviewed_role_overrides(
        self,
        overrides: list[Mapping[str, Any]],
    ) -> dict[str, int]:
        """Apply externally reviewed game-role corrections reproducibly.

        Most source pages do not expose a stable historical weapon role.  A
        reviewed override is therefore intentionally separate from source-role
        ingestion: it is keyed by a provider identity, retains its cited
        evidence in ``source_records`` and stays visible in the normal audit
        trail after a full database rebuild.
        """

        labels = {"awper", "rifler", "igl", "entry"}
        result = {"applied": 0, "already_applied": 0}
        with self.connection:
            for override in overrides:
                player_ref = override.get("player")
                if not isinstance(player_ref, Mapping):
                    raise TypeError(
                        "reviewed role override requires a player provider reference"
                    )
                source = str(player_ref.get("source") or "").strip()
                external_id = str(player_ref.get("external_id") or "").strip()
                if not source or not external_id:
                    raise ValueError(
                        "reviewed role override requires player.source and "
                        "player.external_id"
                    )
                role = str(override.get("role") or "").casefold().strip()
                if role not in labels:
                    raise ValueError(
                        "reviewed role override role must be one of: "
                        + ", ".join(sorted(labels))
                    )
                evidence = override.get("evidence") or []
                if not isinstance(evidence, list) or not evidence:
                    raise ValueError(
                        "reviewed role override requires non-empty evidence"
                    )
                if not all(isinstance(item, Mapping) for item in evidence):
                    raise TypeError(
                        "reviewed role override evidence entries must be objects"
                    )
                if not any(str(item.get("url") or "").strip() for item in evidence):
                    raise ValueError(
                        "reviewed role override evidence requires a source URL"
                    )
                player_id = self.resolve_player_id(source, external_id)
                existing = self.connection.execute(
                    "SELECT game_role_override FROM players WHERE id = ?",
                    (player_id,),
                ).fetchone()
                assert existing is not None
                already_applied = str(existing["game_role_override"] or "") == role
                payload = {
                    "player": {"source": source, "external_id": external_id},
                    "role": role,
                    "basis": override.get("basis"),
                    "evidence": [dict(item) for item in evidence],
                }
                observed_at = _now()
                source_record_id, is_new = self._upsert_source_record(
                    source="manual",
                    record_type="role",
                    external_id=f"reviewed-role:{source}:{external_id}",
                    raw_metadata={"payload": payload},
                    parsed={"game_role_override": role},
                    source_url=next(
                        (
                            str(item["url"])
                            for item in evidence
                            if str(item.get("url") or "").strip()
                        ),
                        None,
                    ),
                    fetched_at=observed_at,
                )
                self.connection.execute(
                    "UPDATE players SET game_role_override = ?, updated_at = ? "
                    "WHERE id = ?",
                    (role, observed_at, player_id),
                )
                if is_new:
                    self._insert_evidence(
                        entity_type="player",
                        entity_id=player_id,
                        field_name="game_role_override",
                        source_record_id=source_record_id,
                        value=role,
                        observed_at=observed_at,
                    )
                self._record_conflict(
                    entity_type="player",
                    entity_id=player_id,
                    field_name="role:reviewed_override",
                    candidates=[payload],
                    resolved_value=role,
                    status="manual",
                )
                if already_applied:
                    result["already_applied"] += 1
                else:
                    result["applied"] += 1
        return result

    def apply_reviewed_major_winners(
        self,
        winners: list[Mapping[str, Any]],
    ) -> dict[str, int]:
        """Apply externally verified Major winners to every roster member.

        Major participation tables do not always publish placements. Provider
        references keep the correction replayable after rebuilding the local
        database, while manual evidence remains visible to the normal merge and
        audit machinery.
        """

        result = {"events": 0, "appearances": 0}
        with self.connection:
            for winner in winners:
                major_ref = winner.get("major")
                team_ref = winner.get("team")
                if not isinstance(major_ref, Mapping) or not isinstance(
                    team_ref,
                    Mapping,
                ):
                    raise TypeError(
                        "reviewed Major winner requires major and team "
                        "provider references"
                    )

                major_row = self.connection.execute(
                    """
                    SELECT DISTINCT fe.entity_id
                    FROM source_records sr
                    JOIN field_evidence fe ON fe.source_record_id = sr.id
                    WHERE sr.source = ?
                      AND sr.record_type = 'major'
                      AND sr.external_id = ?
                      AND fe.entity_type = 'major'
                    ORDER BY fe.id
                    LIMIT 1
                    """,
                    (
                        str(major_ref["source"]),
                        str(major_ref["external_id"]),
                    ),
                ).fetchone()
                team_row = self.connection.execute(
                    """
                    SELECT team_id
                    FROM team_source_ids
                    WHERE source = ? AND external_id = ?
                    """,
                    (
                        str(team_ref["source"]),
                        str(team_ref["external_id"]),
                    ),
                ).fetchone()
                if major_row is None or team_row is None:
                    raise ValueError(
                        "reviewed Major winner references are unresolved"
                    )

                major_id = str(major_row["entity_id"])
                team_id = str(team_row["team_id"])
                conflicting_winner = self.connection.execute(
                    """
                    SELECT team_id
                    FROM major_appearances
                    WHERE major_id = ? AND placement = '1'
                      AND team_id IS NOT ?
                    LIMIT 1
                    """,
                    (major_id, team_id),
                ).fetchone()
                if conflicting_winner is not None:
                    raise ValueError(
                        "reviewed Major winner conflicts with an existing "
                        "winning team"
                    )

                appearances = list(
                    self.connection.execute(
                        """
                        SELECT player_id
                        FROM major_appearances
                        WHERE major_id = ? AND team_id = ?
                        ORDER BY player_id
                        """,
                        (major_id, team_id),
                    )
                )
                if not appearances:
                    raise ValueError(
                        "reviewed Major winner has no linked roster"
                    )

                observed_at = _now()
                for appearance in appearances:
                    player_id = str(appearance["player_id"])
                    audit_payload = {
                        "major": dict(major_ref),
                        "team": dict(team_ref),
                        "player_id": player_id,
                        "placement": "1",
                        "basis": winner.get("basis"),
                    }
                    source_record_id, is_new = self._upsert_source_record(
                        source="manual",
                        record_type="major_appearance",
                        external_id=(
                            "reviewed-major-winner:"
                            f"{major_ref['source']}:"
                            f"{major_ref['external_id']}:"
                            f"{player_id}"
                        ),
                        raw_metadata={"payload": audit_payload},
                        parsed=audit_payload,
                        source_url=winner.get("source_url"),
                        fetched_at=observed_at,
                    )
                    if is_new:
                        self._insert_evidence(
                            entity_type="major_appearance",
                            entity_id=f"{player_id}:{major_id}",
                            field_name="placement",
                            source_record_id=source_record_id,
                            value="1",
                            observed_at=observed_at,
                        )

                self._merge_major_appearances()
                result["events"] += 1
                result["appearances"] += len(appearances)
        return result

    def apply_reviewed_major_appearances(
        self,
        appearances: list[Mapping[str, Any]],
    ) -> dict[str, int]:
        """Add or correct Major roster rows using reviewed provider refs."""

        allowed_fields = {
            "participation_kind",
            "placement",
            "stage_reached",
            "matches_played",
            "counts_toward_total",
        }
        result = {"reviewed": 0, "created": 0, "updated": 0}
        with self.connection:
            for review in appearances:
                major_ref = review.get("major")
                player_ref = review.get("player")
                team_ref = review.get("team")
                overrides = review.get("overrides") or {}
                if (
                    not isinstance(major_ref, Mapping)
                    or not isinstance(player_ref, Mapping)
                    or not isinstance(team_ref, Mapping)
                    or not isinstance(overrides, Mapping)
                ):
                    raise TypeError(
                        "reviewed Major appearance requires major, player, "
                        "team, and overrides objects"
                    )
                unknown_fields = set(overrides) - allowed_fields
                if unknown_fields:
                    raise ValueError(
                        "unsupported reviewed Major appearance fields: "
                        + ", ".join(sorted(unknown_fields))
                    )

                major_row = self.connection.execute(
                    """
                    SELECT DISTINCT fe.entity_id
                    FROM source_records sr
                    JOIN field_evidence fe ON fe.source_record_id = sr.id
                    WHERE sr.source = ?
                      AND sr.record_type = 'major'
                      AND sr.external_id = ?
                      AND fe.entity_type = 'major'
                    ORDER BY fe.id
                    LIMIT 1
                    """,
                    (
                        str(major_ref["source"]),
                        str(major_ref["external_id"]),
                    ),
                ).fetchone()
                if major_row is None:
                    raise ValueError(
                        "reviewed Major appearance event is unresolved"
                    )
                major_id = str(major_row["entity_id"])
                player_id = self.resolve_player_id(
                    str(player_ref["source"]),
                    str(player_ref["external_id"]),
                )
                team_row = self.connection.execute(
                    """
                    SELECT team_id
                    FROM team_source_ids
                    WHERE source = ? AND external_id = ?
                    """,
                    (
                        str(team_ref["source"]),
                        str(team_ref["external_id"]),
                    ),
                ).fetchone()
                if team_row is None:
                    raise ValueError(
                        "reviewed Major appearance team is unresolved"
                    )
                team_id = str(team_row["team_id"])

                existing = self.connection.execute(
                    """
                    SELECT 1
                    FROM major_appearances
                    WHERE player_id = ? AND major_id = ?
                    """,
                    (player_id, major_id),
                ).fetchone()
                observed_at = _now()
                if existing is None:
                    self.connection.execute(
                        """
                        INSERT INTO major_appearances (
                            player_id, major_id, team_id,
                            participation_kind, placement, stage_reached,
                            matches_played, counts_toward_total,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            player_id,
                            major_id,
                            team_id,
                            str(
                                overrides.get(
                                    "participation_kind",
                                    "participant",
                                )
                            ).casefold(),
                            overrides.get("placement"),
                            overrides.get("stage_reached"),
                            overrides.get("matches_played"),
                            int(
                                bool(
                                    overrides.get(
                                        "counts_toward_total",
                                        True,
                                    )
                                )
                            ),
                            observed_at,
                            observed_at,
                        ),
                    )
                    result["created"] += 1
                else:
                    result["updated"] += 1

                evidence_values = {"team_id": team_id, **dict(overrides)}
                audit_payload = {
                    "major": dict(major_ref),
                    "player": dict(player_ref),
                    "team": dict(team_ref),
                    "overrides": dict(overrides),
                    "basis": review.get("basis"),
                }
                source_record_id, is_new = self._upsert_source_record(
                    source="manual",
                    record_type="major_appearance",
                    external_id=(
                        "reviewed-major-appearance:"
                        f"{major_ref['source']}:"
                        f"{major_ref['external_id']}:"
                        f"{player_ref['source']}:"
                        f"{player_ref['external_id']}"
                    ),
                    raw_metadata={"payload": audit_payload},
                    parsed=audit_payload,
                    source_url=review.get("source_url"),
                    fetched_at=observed_at,
                )
                if is_new:
                    entity_id = f"{player_id}:{major_id}"
                    for field_name, value in evidence_values.items():
                        self._insert_evidence(
                            entity_type="major_appearance",
                            entity_id=entity_id,
                            field_name=field_name,
                            source_record_id=source_record_id,
                            value=value,
                            observed_at=observed_at,
                        )
                result["reviewed"] += 1

            self._merge_major_appearances()
        return result

    def apply_reviewed_source_quarantines(
        self,
        quarantines: list[Mapping[str, Any]],
    ) -> dict[str, int]:
        """Detach provider evidence that was verified to mix two identities."""
        result = {"quarantined": 0, "already_quarantined": 0}
        with self.connection:
            for quarantine in quarantines:
                target_ref = quarantine.get("target")
                canonical_ref = quarantine.get("canonical")
                if not isinstance(target_ref, Mapping) or not isinstance(
                    canonical_ref,
                    Mapping,
                ):
                    raise TypeError(
                        "reviewed source quarantine requires target and "
                        "canonical provider references"
                    )
                canonical_id = self.resolve_player_id(
                    str(canonical_ref["source"]),
                    str(canonical_ref["external_id"]),
                )
                target_source = str(target_ref["source"])
                target_external_id = str(target_ref["external_id"])
                try:
                    target_id = self.resolve_player_id(
                        target_source,
                        target_external_id,
                    )
                except KeyError:
                    result["already_quarantined"] += 1
                    continue
                if target_id != canonical_id:
                    raise ValueError(
                        "quarantined provider ID does not belong to the "
                        "reviewed canonical player"
                    )

                source_record_ids = [
                    int(row["id"])
                    for row in self.connection.execute(
                        """
                        SELECT id FROM source_records
                        WHERE source = ?
                          AND (
                            external_id = ?
                            OR external_id LIKE ?
                          )
                        """,
                        (
                            target_source,
                            target_external_id,
                            f"{target_external_id}:%",
                        ),
                    )
                ]
                tenure_ids: set[str] = set()
                if source_record_ids:
                    placeholders = ",".join("?" for _ in source_record_ids)
                    tenure_ids = {
                        str(row["entity_id"])
                        for row in self.connection.execute(
                            f"""
                            SELECT DISTINCT entity_id
                            FROM field_evidence
                            WHERE entity_type = 'team_tenure'
                              AND source_record_id IN ({placeholders})
                            """,
                            source_record_ids,
                        )
                    }
                    self.connection.execute(
                        f"""
                        DELETE FROM field_evidence
                        WHERE source_record_id IN ({placeholders})
                        """,
                        source_record_ids,
                    )
                for tenure_id in tenure_ids:
                    remaining = self.connection.execute(
                        """
                        SELECT 1 FROM field_evidence
                        WHERE entity_type = 'team_tenure' AND entity_id = ?
                        LIMIT 1
                        """,
                        (tenure_id,),
                    ).fetchone()
                    if remaining is None:
                        self.connection.execute(
                            "DELETE FROM player_team_tenures WHERE id = ?",
                            (tenure_id,),
                        )
                self.connection.execute(
                    """
                    DELETE FROM player_source_ids
                    WHERE source = ? AND external_id = ?
                    """,
                    (target_source, target_external_id),
                )
                self._record_conflict(
                    entity_type="player",
                    entity_id=canonical_id,
                    field_name="identity:quarantined_source",
                    candidates=[
                        {
                            "target": dict(target_ref),
                            "canonical": dict(canonical_ref),
                            "reason": quarantine.get("reason"),
                            "evidence": list(
                                quarantine.get("evidence") or []
                            ),
                        }
                    ],
                    resolved_value=False,
                    status="manual",
                )
                result["quarantined"] += 1
        return result

    def apply_reviewed_identity_separations(
        self,
        separations: list[Mapping[str, Any]],
    ) -> dict[str, int]:
        """Persist reviewed same-nickname pairs that represent different people."""
        result = {"separated": 0, "already_separated": 0}
        with self.connection:
            for separation in separations:
                left_ref = separation.get("left")
                right_ref = separation.get("right")
                if not isinstance(left_ref, Mapping) or not isinstance(
                    right_ref,
                    Mapping,
                ):
                    raise TypeError(
                        "reviewed identity separation requires left and right "
                        "provider references"
                    )
                try:
                    player_ids = sorted(
                        {
                            self.resolve_player_id(
                                str(reference["source"]),
                                str(reference["external_id"]),
                            )
                            for reference in (left_ref, right_ref)
                        }
                    )
                except KeyError as error:
                    raise ValueError(
                        f"reviewed identity separation is unresolved: {error}"
                    ) from error
                if len(player_ids) != 2:
                    raise ValueError(
                        "reviewed identity separation resolved to one player"
                    )

                audit_separation = {
                    "left": dict(left_ref),
                    "right": dict(right_ref),
                    "player_ids": player_ids,
                    "evidence": list(separation.get("evidence") or []),
                    "basis": separation.get("basis"),
                }
                existed = self.connection.execute(
                    """
                    SELECT 1
                    FROM merge_conflicts
                    WHERE field_name = 'identity:reviewed_separate'
                      AND resolution_status = 'manual'
                      AND resolved_value_json = ?
                    LIMIT 1
                    """,
                    (_json(player_ids),),
                ).fetchone()
                for player_id in player_ids:
                    self._record_conflict(
                        entity_type="player",
                        entity_id=player_id,
                        field_name="identity:reviewed_separate",
                        candidates=[audit_separation],
                        resolved_value=player_ids,
                        status="manual",
                    )
                if existed:
                    result["already_separated"] += 1
                else:
                    result["separated"] += 1
        return result

    def quarantine_inconsistent_balldontlie_identities(
        self,
    ) -> dict[str, int]:
        """Replay the strict BDL/Panda legal-name gate on existing links."""
        quarantines: list[dict[str, Any]] = []
        linked_rows = list(
            self.connection.execute(
                """
                SELECT
                    bdl.player_id,
                    bdl.external_id AS balldontlie_id,
                    GROUP_CONCAT(DISTINCT panda.external_id) AS pandascore_ids
                FROM player_source_ids bdl
                JOIN player_source_ids panda
                  ON panda.player_id = bdl.player_id
                 AND panda.source = 'pandascore'
                WHERE bdl.source = 'balldontlie'
                GROUP BY bdl.player_id, bdl.external_id
                ORDER BY bdl.external_id
                """
            )
        )
        for row in linked_rows:
            player_id = str(row["player_id"])
            balldontlie_id = str(row["balldontlie_id"])
            pandascore_ids = sorted(
                item
                for item in str(row["pandascore_ids"] or "").split(",")
                if item
            )
            if not pandascore_ids:
                continue
            balldontlie_name_row = self.connection.execute(
                """
                SELECT fe.normalized_value_json
                FROM field_evidence fe
                JOIN source_records sr ON sr.id = fe.source_record_id
                WHERE fe.entity_type = 'player'
                  AND fe.entity_id = ?
                  AND fe.field_name = 'full_name'
                  AND sr.source = 'balldontlie'
                  AND sr.external_id = ?
                ORDER BY sr.fetched_at DESC, fe.id DESC
                LIMIT 1
                """,
                (player_id, balldontlie_id),
            ).fetchone()
            if balldontlie_name_row is None:
                continue
            balldontlie_name = json.loads(
                balldontlie_name_row["normalized_value_json"]
            )
            pandascore_names: list[tuple[str, Any]] = []
            for pandascore_id in pandascore_ids:
                pandascore_name_row = self.connection.execute(
                    """
                    SELECT fe.normalized_value_json
                    FROM field_evidence fe
                    JOIN source_records sr ON sr.id = fe.source_record_id
                    WHERE fe.entity_type = 'player'
                      AND fe.entity_id = ?
                      AND fe.field_name = 'full_name'
                      AND sr.source = 'pandascore'
                      AND sr.external_id = ?
                    ORDER BY sr.fetched_at DESC, fe.id DESC
                    LIMIT 1
                    """,
                    (player_id, pandascore_id),
                ).fetchone()
                if pandascore_name_row is not None:
                    pandascore_names.append(
                        (
                            pandascore_id,
                            json.loads(
                                pandascore_name_row[
                                    "normalized_value_json"
                                ]
                            ),
                        )
                    )
            if not balldontlie_name or not pandascore_names:
                continue
            if any(
                (
                    person_name_token_signature(balldontlie_name)
                    == person_name_token_signature(pandascore_name)
                    or person_name_tokens_compatible(
                        balldontlie_name,
                        pandascore_name,
                    )
                )
                for _, pandascore_name in pandascore_names
            ):
                continue
            quarantines.append(
                {
                    "target": {
                        "source": "balldontlie",
                        "external_id": balldontlie_id,
                    },
                    "canonical": {
                        "source": "pandascore",
                        "external_id": pandascore_ids[0],
                    },
                    "reason": (
                        "BALLDONTLIE and every linked PandaScore record "
                        "have incompatible legal names"
                    ),
                    "evidence": [
                        {
                            "source": "balldontlie",
                            "external_id": balldontlie_id,
                            "full_name": balldontlie_name,
                        },
                        *[
                            {
                                "source": "pandascore",
                                "external_id": pandascore_id,
                                "full_name": pandascore_name,
                            }
                            for pandascore_id, pandascore_name
                            in pandascore_names
                        ],
                    ],
                }
            )
        return self.apply_reviewed_source_quarantines(quarantines)

    def resolve_player_id(self, source: str, external_id: str | int) -> str:
        row = self.connection.execute(
            """
            SELECT player_id
            FROM player_source_ids
            WHERE source = ? AND external_id = ?
            """,
            (source, str(external_id)),
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown {source} player: {external_id}")
        return str(row["player_id"])

    def link_source_player(
        self,
        player_id: str,
        source: str,
        external_id: str | int,
        *,
        source_url: str | None = None,
        seen_at: str | None = None,
    ) -> None:
        """Attach an explicitly verified provider ID to a canonical player."""

        player = self.connection.execute(
            "SELECT id FROM players WHERE id = ?", (player_id,)
        ).fetchone()
        if player is None:
            raise KeyError(f"unknown canonical player: {player_id}")
        normalized_external_id = str(external_id)
        existing = self.connection.execute(
            """
            SELECT player_id FROM player_source_ids
            WHERE source = ? AND external_id = ?
            """,
            (source, normalized_external_id),
        ).fetchone()
        if existing and str(existing["player_id"]) != player_id:
            raise ValueError(
                f"{source} player {normalized_external_id} is already linked"
            )
        timestamp = seen_at or _now()
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO player_source_ids (
                    player_id, source, external_id, source_url, last_seen_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(source, external_id) DO UPDATE SET
                    source_url = COALESCE(excluded.source_url, source_url),
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    player_id,
                    source,
                    normalized_external_id,
                    source_url,
                    timestamp,
                ),
            )

    def clear_source_current_team(
        self,
        player_id: str,
        source: str,
        external_id: str | int,
    ) -> int:
        """Detach a provider's stale current-team claim but retain raw records."""
        normalized_external_id = str(external_id)
        with self.connection:
            player_record_ids = [
                int(row["id"])
                for row in self.connection.execute(
                    """
                    SELECT id FROM source_records
                    WHERE source = ? AND record_type = 'player'
                      AND external_id = ?
                    """,
                    (source, normalized_external_id),
                )
            ]
            removed = 0
            if player_record_ids:
                placeholders = ",".join("?" for _ in player_record_ids)
                cursor = self.connection.execute(
                    f"""
                    DELETE FROM field_evidence
                    WHERE entity_type = 'player'
                      AND entity_id = ?
                      AND field_name = 'current_team_id'
                      AND source_record_id IN ({placeholders})
                    """,
                    (player_id, *player_record_ids),
                )
                removed += int(cursor.rowcount)

            tenure_ids = [
                str(row["entity_id"])
                for row in self.connection.execute(
                    """
                    SELECT DISTINCT fe.entity_id
                    FROM field_evidence fe
                    JOIN source_records sr ON sr.id = fe.source_record_id
                    JOIN player_team_tenures tenure
                      ON tenure.id = fe.entity_id
                    WHERE fe.entity_type = 'team_tenure'
                      AND tenure.player_id = ?
                      AND sr.source = ?
                      AND sr.record_type = 'team_history'
                      AND sr.external_id GLOB ?
                    """,
                    (player_id, source, f"{normalized_external_id}:*"),
                )
            ]
            for tenure_id in tenure_ids:
                cursor = self.connection.execute(
                    """
                    DELETE FROM field_evidence
                    WHERE entity_type = 'team_tenure'
                      AND entity_id = ?
                      AND source_record_id IN (
                          SELECT id FROM source_records
                          WHERE source = ?
                            AND record_type = 'team_history'
                            AND external_id GLOB ?
                      )
                    """,
                    (tenure_id, source, f"{normalized_external_id}:*"),
                )
                removed += int(cursor.rowcount)
                still_supported = self.connection.execute(
                    """
                    SELECT 1 FROM field_evidence
                    WHERE entity_type = 'team_tenure' AND entity_id = ?
                    LIMIT 1
                    """,
                    (tenure_id,),
                ).fetchone()
                if still_supported is None:
                    self.connection.execute(
                        "DELETE FROM player_team_tenures WHERE id = ?",
                        (tenure_id,),
                    )
        return removed

    def upsert_major_records(
        self,
        source: str,
        records: Mapping[str, Any] | list[Mapping[str, Any]],
        raw_metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        raw_metadata = raw_metadata or {}
        if isinstance(records, Mapping):
            raw_events = records.get("events", [records])
        else:
            raw_events = records
        if not isinstance(raw_events, list):
            raise TypeError("major records must be a list or an events mapping")

        fetched_at = str(raw_metadata.get("fetched_at") or _now())
        result: dict[str, Any] = {
            "events": 0,
            "appearances": 0,
            "unresolved_players": [],
        }
        with self.connection:
            for event in raw_events:
                if not isinstance(event, Mapping):
                    continue
                major_id = self._upsert_major_event(
                    source, event, fetched_at=fetched_at
                )
                result["events"] += 1
                appearances = event.get("appearances") or []
                if not isinstance(appearances, list):
                    continue
                for appearance in appearances:
                    if not isinstance(appearance, Mapping):
                        continue
                    player_source = str(
                        appearance.get("player_source") or source
                    )
                    player_external_id = appearance.get("player_external_id")
                    player_id = appearance.get("player_id")
                    if player_id is None and player_external_id is not None:
                        row = self.connection.execute(
                            """
                            SELECT player_id FROM player_source_ids
                            WHERE source = ?
                              AND replace(external_id, '_', ' ')
                                  = replace(?, '_', ' ') COLLATE NOCASE
                            ORDER BY external_id
                            LIMIT 1
                            """,
                            (player_source, str(player_external_id)),
                        ).fetchone()
                        player_id = row["player_id"] if row else None
                    if player_id is None:
                        unresolved = {
                            "source": player_source,
                            "external_id": (
                                str(player_external_id)
                                if player_external_id is not None
                                else None
                            ),
                            "major_external_id": self._major_external_id(event),
                        }
                        if unresolved not in result["unresolved_players"]:
                            result["unresolved_players"].append(unresolved)
                        continue
                    self._upsert_major_appearance(
                        source=source,
                        major_id=major_id,
                        major_external_id=self._major_external_id(event),
                        player_id=str(player_id),
                        player_source=player_source,
                        player_external_id=str(
                            player_external_id
                            if player_external_id is not None
                            else player_id
                        ),
                        appearance=appearance,
                        fetched_at=fetched_at,
                    )
                    result["appearances"] += 1
        return result

    @staticmethod
    def _major_external_id(event: Mapping[str, Any]) -> str:
        value = (
            event.get("external_id")
            or event.get("source_id")
            or event.get("id")
            or event.get("canonical_name")
            or event.get("name")
        )
        if value is None:
            raise ValueError("major external_id/source_id/name is required")
        return str(value)

    def _upsert_major_event(
        self,
        source: str,
        event: Mapping[str, Any],
        *,
        fetched_at: str,
    ) -> str:
        external_id = self._major_external_id(event)
        canonical_name = str(
            event.get("canonical_name") or event.get("name") or ""
        ).strip()
        starts_on = event.get("starts_on") or event.get("start_date")
        if not canonical_name or not starts_on:
            raise ValueError("major canonical_name and starts_on are required")

        existing = self.connection.execute(
            """
            SELECT DISTINCT fe.entity_id
            FROM source_records sr
            JOIN field_evidence fe ON fe.source_record_id = sr.id
            WHERE sr.source = ? AND sr.record_type = 'major'
              AND sr.external_id = ? AND fe.entity_type = 'major'
            ORDER BY fe.id LIMIT 1
            """,
            (source, external_id),
        ).fetchone()
        if existing:
            major_id = str(existing["entity_id"])
        else:
            same_event = self.connection.execute(
                """
                SELECT id FROM major_events
                WHERE lower(trim(canonical_name)) = lower(trim(?))
                  AND starts_on = ?
                ORDER BY created_at, id LIMIT 1
                """,
                (canonical_name, str(starts_on)),
            ).fetchone()
            major_id = (
                str(same_event["id"])
                if same_event
                else f"major_{uuid.uuid4().hex}"
            )
            if not same_event:
                game_title = str(event.get("game_title") or "cs2").casefold()
                self.connection.execute(
                    """
                    INSERT INTO major_events (
                        id, canonical_name, game_title, starts_on, ends_on,
                        location_country_code, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        major_id,
                        canonical_name,
                        game_title,
                        str(starts_on),
                        event.get("ends_on") or event.get("end_date"),
                        normalize_country_code(
                            event.get("location_country_code")
                        ),
                        fetched_at,
                        fetched_at,
                    ),
                )

        source_record_id, is_new = self._upsert_source_record(
            source=source,
            record_type="major",
            external_id=external_id,
            raw_metadata={"payload": dict(event), "fetched_at": fetched_at},
            parsed=event,
            source_url=event.get("source_url"),
            fetched_at=fetched_at,
        )
        if is_new:
            for field_name, value in {
                "canonical_name": canonical_name,
                "game_title": event.get("game_title") or "cs2",
                "starts_on": str(starts_on),
                "ends_on": event.get("ends_on") or event.get("end_date"),
                "location_country_code": normalize_country_code(
                    event.get("location_country_code")
                ),
            }.items():
                if value is not None:
                    self._insert_evidence(
                        entity_type="major",
                        entity_id=major_id,
                        field_name=field_name,
                        source_record_id=source_record_id,
                        value=value,
                        observed_at=fetched_at,
                    )
        return major_id

    def _upsert_major_appearance(
        self,
        *,
        source: str,
        major_id: str,
        major_external_id: str,
        player_id: str,
        player_source: str,
        player_external_id: str,
        appearance: Mapping[str, Any],
        fetched_at: str,
    ) -> None:
        team_id = appearance.get("team_id")
        team = appearance.get("team")
        if team_id is None and isinstance(team, Mapping):
            team_id = self._upsert_team(source, team, fetched_at=fetched_at)
        if team_id is None and appearance.get("team_external_id") is not None:
            team_source = str(appearance.get("team_source") or source)
            row = self.connection.execute(
                """
                SELECT team_id FROM team_source_ids
                WHERE source = ? AND external_id = ?
                """,
                (team_source, str(appearance["team_external_id"])),
            ).fetchone()
            team_id = row["team_id"] if row else None

        values = {
            "team_id": team_id,
            "participation_kind": str(
                appearance.get("participation_kind") or "participant"
            ).casefold(),
            "placement": appearance.get("placement"),
            "stage_reached": appearance.get("stage_reached"),
            "matches_played": appearance.get("matches_played"),
            "counts_toward_total": bool(
                appearance.get("counts_toward_total", True)
            ),
        }
        self.connection.execute(
            """
            INSERT INTO major_appearances (
                player_id, major_id, team_id, participation_kind, placement,
                stage_reached, matches_played, counts_toward_total,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(player_id, major_id) DO NOTHING
            """,
            (
                player_id,
                major_id,
                team_id,
                values["participation_kind"],
                values["placement"],
                values["stage_reached"],
                values["matches_played"],
                int(values["counts_toward_total"]),
                fetched_at,
                fetched_at,
            ),
        )
        record_external_id = (
            f"{major_external_id}:{player_source}:{player_external_id}"
        )
        source_record_id, is_new = self._upsert_source_record(
            source=source,
            record_type="major_appearance",
            external_id=record_external_id,
            raw_metadata={
                "payload": dict(appearance),
                "fetched_at": fetched_at,
            },
            parsed=appearance,
            source_url=appearance.get("source_url"),
            fetched_at=fetched_at,
        )
        if is_new:
            entity_id = f"{player_id}:{major_id}"
            for field_name, value in values.items():
                self._insert_evidence(
                    entity_type="major_appearance",
                    entity_id=entity_id,
                    field_name=field_name,
                    source_record_id=source_record_id,
                    value=value,
                    observed_at=fetched_at,
                )

    def merge_all(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "players_merged": 0,
            "exact_identity_merges": 0,
            "high_confidence_identity_merges": 0,
            "teams_merged": 0,
            "conflicts_created": 0,
            "identity_reviews": 0,
            "guessable": 0,
            "departed_team_claims_retired": 0,
        }
        with self.connection:
            exact_merges, conflicts_created = (
                self._merge_exact_name_birth_date_identities()
            )
            result["exact_identity_merges"] = exact_merges
            result["players_merged"] += exact_merges
            result["conflicts_created"] += conflicts_created

            self._coalesce_current_tenures()
            identity_merges, conflicts_created = (
                self._merge_high_confidence_cross_source_identities()
            )
            alias_merges, alias_conflicts = (
                self._merge_hltv_alias_confirmed_identities()
            )
            identity_merges += alias_merges
            conflicts_created += alias_conflicts
            result["high_confidence_identity_merges"] += identity_merges
            result["players_merged"] += identity_merges
            result["conflicts_created"] += conflicts_created

            nickname_merges, conflicts_created = (
                self._merge_exact_nickname_birth_country_identities()
            )
            result["high_confidence_identity_merges"] += nickname_merges
            result["players_merged"] += nickname_merges
            result["conflicts_created"] += conflicts_created

            biography_merges, conflicts_created = (
                self._merge_exact_name_nickname_country_identities()
            )
            result["high_confidence_identity_merges"] += biography_merges
            result["players_merged"] += biography_merges
            result["conflicts_created"] += conflicts_created

            self._coalesce_current_tenures()
            result["conflicts_created"] += self._merge_major_appearances()
            for row in self.connection.execute("SELECT id FROM teams"):
                result["conflicts_created"] += self._merge_team_fields(
                    str(row["id"])
                )
            result["departed_team_claims_retired"] = (
                self._retire_departed_team_claims()
            )
            for row in self.connection.execute("SELECT id FROM players"):
                player_id = str(row["id"])
                result["conflicts_created"] += self._merge_player_fields(player_id)
                result["conflicts_created"] += self._select_current_team(player_id)
                if self._refresh_guessability(player_id):
                    result["guessable"] += 1
            identity_reviews, conflicts_created = self._queue_identity_reviews()
            result["identity_reviews"] = identity_reviews
            result["conflicts_created"] += conflicts_created

        return result

    def _retire_departed_team_claims(self) -> int:
        """Keep ``ex-*`` rosters as history, never as a current affiliation."""
        departed_team_ids = [
            str(row["id"])
            for row in self.connection.execute(
                """
                SELECT id FROM teams
                WHERE lower(trim(canonical_name)) GLOB 'ex-*'
                """
            )
        ]
        if not departed_team_ids:
            return 0
        placeholders = ",".join("?" for _ in departed_team_ids)
        self.connection.execute(
            f"""
            DELETE FROM field_evidence
            WHERE entity_type = 'player'
              AND field_name = 'current_team_id'
              AND CAST(json_extract(normalized_value_json, '$') AS TEXT)
                  IN ({placeholders})
            """,
            departed_team_ids,
        )
        cursor = self.connection.execute(
            f"""
            UPDATE player_team_tenures
            SET is_current = 0, is_primary = 0
            WHERE is_current = 1 AND team_id IN ({placeholders})
            """,
            departed_team_ids,
        )
        return int(cursor.rowcount)

    def _merge_exact_name_birth_date_identities(self) -> tuple[int, int]:
        """Merge complementary LP/Panda identities on exact biography.

        Equal legal name and exact birth date are strong, but not sufficient to
        override country conflicts or collapse two IDs from the same provider.
        Every decision is retained for audit.
        """
        reviewed_separations = self._reviewed_identity_separation_pairs()
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in self.connection.execute(
            """
            SELECT
                p.id,
                p.canonical_nickname,
                p.full_name,
                p.country_code,
                p.birth_date,
                p.created_at,
                GROUP_CONCAT(DISTINCT source_id.source) AS sources
            FROM players p
            LEFT JOIN player_source_ids source_id
              ON source_id.player_id = p.id
            WHERE p.full_name IS NOT NULL AND trim(p.full_name) != ''
              AND p.birth_date IS NOT NULL AND trim(p.birth_date) != ''
            GROUP BY p.id
            ORDER BY p.created_at, p.id
            """
        ):
            candidate = dict(row)
            candidate["source_set"] = set(
                str(candidate["sources"] or "").split(",")
            )
            identity_full_name = candidate["full_name"]
            if (
                "liquipedia" in candidate["source_set"]
                and "pandascore" not in candidate["source_set"]
            ):
                identity_full_name = (
                    self._latest_player_values_from_source(
                        str(candidate["id"]),
                        "liquipedia",
                    ).get("full_name")
                    or identity_full_name
                )
            elif (
                "pandascore" in candidate["source_set"]
                and "liquipedia" not in candidate["source_set"]
            ):
                identity_full_name = (
                    self._latest_player_values_from_source(
                        str(candidate["id"]),
                        "pandascore",
                    ).get("full_name")
                    or identity_full_name
                )
            candidate["identity_full_name"] = identity_full_name
            key = (
                normalize_identity_text(identity_full_name),
                str(candidate["birth_date"]),
            )
            grouped.setdefault(key, []).append(candidate)

        merges = 0
        conflicts_created = 0
        for candidates in grouped.values():
            if len(candidates) != 2:
                continue
            liquipedia = [
                candidate
                for candidate in candidates
                if "liquipedia" in candidate["source_set"]
                and "pandascore" not in candidate["source_set"]
            ]
            pandascore = [
                candidate
                for candidate in candidates
                if "pandascore" in candidate["source_set"]
                and "liquipedia" not in candidate["source_set"]
            ]
            if len(liquipedia) != 1 or len(pandascore) != 1:
                continue
            countries = {
                str(candidate["country_code"])
                for candidate in candidates
                if candidate["country_code"]
            }
            if len(countries) > 1:
                continue

            birth_dates: set[str] = set()
            for candidate in candidates:
                candidate_birth_dates = {
                    str(evidence["value"])
                    for evidence in self._latest_player_evidence(
                        str(candidate["id"]),
                        "birth_date",
                    )
                    if evidence["value"]
                }
                candidate["birth_date_evidence"] = sorted(
                    candidate_birth_dates
                )
                birth_dates.update(candidate_birth_dates)
            if len(birth_dates) != 1 or not all(
                candidate["birth_date_evidence"] for candidate in candidates
            ):
                continue

            survivor = liquipedia[0]
            duplicate = pandascore[0]
            if (
                frozenset(
                    (str(survivor["id"]), str(duplicate["id"]))
                )
                in reviewed_separations
            ):
                continue
            survivor_id = str(survivor["id"])
            audit_candidates = [
                {
                    "player_id": str(candidate["id"]),
                    "sources": sorted(candidate["source_set"]),
                    "nickname": candidate["canonical_nickname"],
                    "full_name": candidate["identity_full_name"],
                    "country_code": candidate["country_code"],
                    "birth_date_evidence": candidate[
                        "birth_date_evidence"
                    ],
                    "match_basis": "exact_legal_name_and_birth_date",
                }
                for candidate in candidates
            ]
            self._merge_player_into(survivor_id, str(duplicate["id"]))
            conflicts_created += self._record_conflict(
                entity_type="player",
                entity_id=survivor_id,
                field_name="identity:exact_name_birth_date",
                candidates=audit_candidates,
                resolved_value=survivor_id,
                status="automatic",
            )
            merges += 1
        return merges, conflicts_created

    def _reviewed_identity_separation_pairs(
        self,
    ) -> set[frozenset[str]]:
        """Resolve reviewed separation refs against the current identities.

        Canonical player IDs can change after an unrelated provider half is
        merged. The provider references recorded in the audit payload are
        stable, so prefer them over the historical resolved ID list.
        """

        pairs: set[frozenset[str]] = set()
        for row in self.connection.execute(
            """
            SELECT candidate_values_json, resolved_value_json
            FROM merge_conflicts
            WHERE field_name = 'identity:reviewed_separate'
              AND resolution_status = 'manual'
            """
        ):
            candidates = json.loads(row["candidate_values_json"])
            audit = candidates[0] if isinstance(candidates, list) and candidates else {}
            if isinstance(audit, Mapping):
                references = (audit.get("left"), audit.get("right"))
                try:
                    resolved_ids = {
                        self.resolve_player_id(
                            str(reference["source"]),
                            str(reference["external_id"]),
                        )
                        for reference in references
                        if isinstance(reference, Mapping)
                    }
                except KeyError:
                    resolved_ids = set()
                if len(resolved_ids) == 2:
                    pairs.add(frozenset(resolved_ids))
                    continue

            if row["resolved_value_json"] is None:
                continue
            player_ids = json.loads(row["resolved_value_json"])
            if isinstance(player_ids, list) and len(player_ids) == 2:
                existing_ids = {
                    str(player_id)
                    for player_id in player_ids
                    if self.connection.execute(
                        "SELECT 1 FROM players WHERE id = ?",
                        (str(player_id),),
                    ).fetchone()
                    is not None
                }
                if len(existing_ids) == 2:
                    pairs.add(frozenset(existing_ids))
        return pairs

    def _merge_exact_nickname_birth_country_identities(
        self,
    ) -> tuple[int, int]:
        """Merge provider halves when three stable identity fields agree.

        Current-team data becomes stale quickly and legal names vary by
        transliteration or omitted middle names. An exact nickname, birth
        date, and country match is stronger than current-team agreement, but
        only when the provider split is one-to-one and neither side contains
        contradictory date or country evidence.
        """

        reviewed_separations = self._reviewed_identity_separation_pairs()

        grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for row in self.connection.execute(
            """
            SELECT
                player.id,
                player.canonical_nickname,
                player.full_name,
                player.country_code,
                player.birth_date,
                GROUP_CONCAT(DISTINCT source_id.source) AS sources
            FROM players player
            LEFT JOIN player_source_ids source_id
              ON source_id.player_id = player.id
            WHERE player.canonical_nickname IS NOT NULL
              AND trim(player.canonical_nickname) != ''
              AND player.country_code IS NOT NULL
              AND player.birth_date IS NOT NULL
            GROUP BY player.id
            ORDER BY player.id
            """
        ):
            candidate = dict(row)
            candidate["source_set"] = set(
                str(candidate["sources"] or "").split(",")
            )
            key = (
                nickname_identity_signature(
                    candidate["canonical_nickname"]
                ),
                str(candidate["country_code"]),
                str(candidate["birth_date"]),
            )
            grouped.setdefault(key, []).append(candidate)

        merges = 0
        conflicts_created = 0
        for (
            nickname,
            country_code,
            birth_date,
        ), candidates in grouped.items():
            if not nickname or len(candidates) != 2:
                continue
            survivor_candidates = [
                candidate
                for candidate in candidates
                if "liquipedia" in candidate["source_set"]
                and "pandascore" not in candidate["source_set"]
            ]
            duplicate_candidates = [
                candidate
                for candidate in candidates
                if "pandascore" in candidate["source_set"]
                and "liquipedia" not in candidate["source_set"]
            ]
            if (
                len(survivor_candidates) != 1
                or len(duplicate_candidates) != 1
            ):
                continue
            survivor = survivor_candidates[0]
            duplicate = duplicate_candidates[0]
            pair = frozenset(
                (str(survivor["id"]), str(duplicate["id"]))
            )
            if pair in reviewed_separations:
                continue

            evidence_is_consistent = True
            for candidate in candidates:
                player_id = str(candidate["id"])
                dates = {
                    str(evidence["value"])
                    for evidence in self._latest_player_evidence(
                        player_id,
                        "birth_date",
                    )
                    if evidence["value"]
                }
                countries = {
                    str(evidence["value"])
                    for evidence in self._latest_player_evidence(
                        player_id,
                        "country_code",
                    )
                    if evidence["value"]
                }
                if (
                    dates
                    and dates != {birth_date}
                    or countries
                    and countries != {country_code}
                ):
                    evidence_is_consistent = False
                    break
            if not evidence_is_consistent:
                continue

            survivor_id = str(survivor["id"])
            audit_candidates = [
                {
                    "player_id": str(candidate["id"]),
                    "sources": sorted(candidate["source_set"]),
                    "nickname": candidate["canonical_nickname"],
                    "full_name": candidate["full_name"],
                    "country_code": candidate["country_code"],
                    "birth_date": candidate["birth_date"],
                    "match_basis": (
                        "exact_nickname_birth_date_and_country"
                    ),
                }
                for candidate in candidates
            ]
            self._merge_player_into(survivor_id, str(duplicate["id"]))
            conflicts_created += self._record_conflict(
                entity_type="player",
                entity_id=survivor_id,
                field_name=(
                    "identity:exact_nickname_birth_date_country"
                ),
                candidates=audit_candidates,
                resolved_value=survivor_id,
                status="automatic",
            )
            merges += 1

        return merges, conflicts_created

    def _merge_exact_name_nickname_country_identities(
        self,
    ) -> tuple[int, int]:
        """Merge a one-to-one provider split despite a birth-date typo."""

        reviewed_separations = self._reviewed_identity_separation_pairs()

        grouped: dict[
            tuple[str, str, tuple[str, ...]],
            list[dict[str, Any]],
        ] = {}
        for row in self.connection.execute(
            """
            SELECT
                player.id,
                player.canonical_nickname,
                player.full_name,
                player.country_code,
                player.birth_date,
                GROUP_CONCAT(DISTINCT source_id.source) AS sources
            FROM players player
            LEFT JOIN player_source_ids source_id
              ON source_id.player_id = player.id
            WHERE player.canonical_nickname IS NOT NULL
              AND player.full_name IS NOT NULL
              AND trim(player.full_name) != ''
              AND player.country_code IS NOT NULL
            GROUP BY player.id
            ORDER BY player.id
            """
        ):
            candidate = dict(row)
            candidate["source_set"] = set(
                str(candidate["sources"] or "").split(",")
            )
            name_signature = person_name_token_signature(
                candidate["full_name"]
            )
            key = (
                nickname_identity_signature(
                    candidate["canonical_nickname"]
                ),
                str(candidate["country_code"]),
                name_signature,
            )
            grouped.setdefault(key, []).append(candidate)

        merges = 0
        conflicts_created = 0
        for (
            nickname,
            country_code,
            name_signature,
        ), candidates in grouped.items():
            if (
                not nickname
                or not name_signature
                or len(candidates) != 2
            ):
                continue
            survivor_candidates = [
                candidate
                for candidate in candidates
                if "liquipedia" in candidate["source_set"]
                and "pandascore" not in candidate["source_set"]
            ]
            duplicate_candidates = [
                candidate
                for candidate in candidates
                if "pandascore" in candidate["source_set"]
                and "liquipedia" not in candidate["source_set"]
            ]
            if (
                len(survivor_candidates) != 1
                or len(duplicate_candidates) != 1
            ):
                continue
            survivor = survivor_candidates[0]
            duplicate = duplicate_candidates[0]
            pair = frozenset(
                (str(survivor["id"]), str(duplicate["id"]))
            )
            if pair in reviewed_separations:
                continue

            country_evidence = set()
            for candidate in candidates:
                country_evidence.update(
                    str(evidence["value"])
                    for evidence in self._latest_player_evidence(
                        str(candidate["id"]),
                        "country_code",
                    )
                    if evidence["value"]
                )
            if country_evidence != {country_code}:
                continue

            survivor_id = str(survivor["id"])
            audit_candidates = [
                {
                    "player_id": str(candidate["id"]),
                    "sources": sorted(candidate["source_set"]),
                    "nickname": candidate["canonical_nickname"],
                    "full_name": candidate["full_name"],
                    "country_code": candidate["country_code"],
                    "birth_date": candidate["birth_date"],
                    "match_basis": (
                        "exact_name_nickname_and_country"
                    ),
                }
                for candidate in candidates
            ]
            self._merge_player_into(survivor_id, str(duplicate["id"]))
            conflicts_created += self._record_conflict(
                entity_type="player",
                entity_id=survivor_id,
                field_name=(
                    "identity:exact_name_nickname_country"
                ),
                candidates=audit_candidates,
                resolved_value=survivor_id,
                status="automatic",
            )
            merges += 1

        return merges, conflicts_created

    def _merge_high_confidence_cross_source_identities(
        self,
    ) -> tuple[int, int]:
        """Merge only one-to-one Liquipedia/PandaScore identity agreements.

        Nickname and current team select the candidate pair. A merge additionally
        requires compatible full-name tokens or an equal exact birth date, the
        same non-empty country, and no conflicting non-empty birth dates.
        Liquipedia survives because it owns the richer biography and historical
        relationships in this dataset.
        """
        reviewed_separations = self._reviewed_identity_separation_pairs()
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
        rows = self.connection.execute(
            """
            SELECT
                p.id,
                p.canonical_nickname,
                p.full_name,
                p.country_code,
                p.birth_date,
                tenure.team_id,
                team.canonical_name AS team_name,
                GROUP_CONCAT(DISTINCT source_id.source) AS sources
            FROM players p
            JOIN player_team_tenures tenure
              ON tenure.player_id = p.id
             AND tenure.is_current = 1
             AND tenure.is_primary = 1
            JOIN teams team
              ON team.id = tenure.team_id
            LEFT JOIN player_source_ids source_id
              ON source_id.player_id = p.id
            GROUP BY p.id, tenure.team_id, team.canonical_name
            ORDER BY p.id
            """
        )
        for row in rows:
            key = (
                normalize_identity_text(row["canonical_nickname"]),
                " ".join(team_name_identity_signature(row["team_name"])),
            )
            grouped.setdefault(key, []).append(dict(row))

        merges = 0
        conflicts_created = 0
        for (nickname, team_signature), candidates in grouped.items():
            if not nickname or not team_signature or len(candidates) != 2:
                continue
            for candidate in candidates:
                candidate["source_set"] = set(
                    str(candidate["sources"] or "").split(",")
                )
            liquipedia = [
                candidate
                for candidate in candidates
                if "liquipedia" in candidate["source_set"]
                and "pandascore" not in candidate["source_set"]
            ]
            pandascore = [
                candidate
                for candidate in candidates
                if "pandascore" in candidate["source_set"]
                and "liquipedia" not in candidate["source_set"]
            ]
            if len(liquipedia) != 1 or len(pandascore) != 1:
                continue

            survivor = liquipedia[0]
            duplicate = pandascore[0]
            if (
                frozenset(
                    (str(survivor["id"]), str(duplicate["id"]))
                )
                in reviewed_separations
            ):
                continue
            survivor_source_values = self._latest_player_values_from_source(
                str(survivor["id"]),
                "liquipedia",
            )
            duplicate_source_values = self._latest_player_values_from_source(
                str(duplicate["id"]),
                "pandascore",
            )
            survivor_full_name = (
                survivor_source_values.get("full_name")
                or survivor["full_name"]
            )
            duplicate_full_name = (
                duplicate_source_values.get("full_name")
                or duplicate["full_name"]
            )
            survivor_name = person_name_token_signature(survivor_full_name)
            duplicate_name = person_name_token_signature(duplicate_full_name)
            if (
                not survivor["country_code"]
                or survivor["country_code"] != duplicate["country_code"]
            ):
                continue
            birth_dates: set[str] = set()
            for candidate in candidates:
                candidate_birth_dates = {
                    str(evidence["value"])
                    for evidence in self._latest_player_evidence(
                        str(candidate["id"]),
                        "birth_date",
                    )
                    if evidence["value"]
                }
                if not candidate_birth_dates and candidate["birth_date"]:
                    candidate_birth_dates.add(str(candidate["birth_date"]))
                candidate["birth_date_evidence"] = sorted(
                    candidate_birth_dates
                )
                birth_dates.update(candidate_birth_dates)
            if len(birth_dates) > 1:
                continue
            exact_birth_date = len(birth_dates) == 1 and all(
                candidate["birth_date_evidence"] for candidate in candidates
            )

            if survivor_name and survivor_name == duplicate_name:
                match_basis = "legal_name_tokens"
            else:
                compatible_names = person_name_tokens_compatible(
                    survivor_full_name,
                    duplicate_full_name,
                )
                hltv_values = self._latest_player_values_from_source(
                    str(survivor["id"]),
                    "hltv",
                )
                hltv_name = person_name_token_signature(
                    hltv_values.get("full_name")
                )
                if not (
                    duplicate_name
                    and hltv_name == duplicate_name
                    and normalize_identity_text(
                        hltv_values.get("nickname")
                    ) == nickname
                    and hltv_values.get("country_code")
                    == survivor["country_code"]
                    and hltv_values.get("current_team_id")
                    in {
                        candidate["team_id"]
                        for candidate in candidates
                    }
                ):
                    if compatible_names:
                        match_basis = "compatible_legal_name_tokens"
                    elif exact_birth_date:
                        match_basis = "exact_birth_date"
                    else:
                        continue
                else:
                    match_basis = "hltv_triangulation"

            audit_candidates = [
                {
                    "player_id": str(candidate["id"]),
                    "sources": sorted(candidate["source_set"]),
                    "nickname": candidate["canonical_nickname"],
                    "full_name": (
                        survivor_full_name
                        if candidate is survivor
                        else duplicate_full_name
                    ),
                    "country_code": candidate["country_code"],
                    "birth_date": candidate["birth_date"],
                    "birth_date_evidence": candidate[
                        "birth_date_evidence"
                    ],
                    "current_team_id": candidate["team_id"],
                    "current_team_name": candidate["team_name"],
                    "current_team_signature": team_signature,
                    "match_basis": match_basis,
                }
                for candidate in candidates
            ]
            survivor_id = str(survivor["id"])
            self._merge_player_into(survivor_id, str(duplicate["id"]))
            conflicts_created += self._record_conflict(
                entity_type="player",
                entity_id=survivor_id,
                field_name="identity:high_confidence_cross_source",
                candidates=audit_candidates,
                resolved_value=survivor_id,
                status="automatic",
            )
            merges += 1
        return merges, conflicts_created

    def _merge_hltv_alias_confirmed_identities(self) -> tuple[int, int]:
        """Merge a PandaScore nickname confirmed by HLTV and an LP alias."""
        reviewed_separations = self._reviewed_identity_separation_pairs()
        rows = list(
            self.connection.execute(
                """
                SELECT
                    p.id,
                    p.canonical_nickname,
                    p.full_name,
                    p.country_code,
                    p.birth_date,
                    tenure.team_id
                FROM players p
                JOIN player_source_ids lp
                  ON lp.player_id = p.id AND lp.source = 'liquipedia'
                JOIN player_source_ids hltv
                  ON hltv.player_id = p.id AND hltv.source = 'hltv'
                JOIN player_team_tenures tenure
                  ON tenure.player_id = p.id
                 AND tenure.is_current = 1
                 AND tenure.is_primary = 1
                WHERE NOT EXISTS (
                    SELECT 1 FROM player_source_ids pandascore
                    WHERE pandascore.player_id = p.id
                      AND pandascore.source = 'pandascore'
                )
                GROUP BY p.id, tenure.team_id
                ORDER BY p.id
                """
            )
        )
        merges = 0
        conflicts_created = 0
        for row in rows:
            survivor = dict(row)
            survivor_id = str(survivor["id"])
            team_id = str(survivor["team_id"])
            hltv_values = self._latest_player_values_from_source(
                survivor_id,
                "hltv",
            )
            hltv_nickname = normalize_identity_text(
                hltv_values.get("nickname")
            )
            aliases = {
                normalize_identity_text(
                    str(alias["external_id"]).replace("_", " ")
                )
                for alias in self.connection.execute(
                    """
                    SELECT external_id FROM player_source_ids
                    WHERE player_id = ? AND source = 'liquipedia'
                    """,
                    (survivor_id,),
                )
            }
            if not hltv_nickname or hltv_nickname not in aliases:
                continue

            pandascore_candidates = [
                dict(candidate)
                for candidate in self.connection.execute(
                    """
                    SELECT
                        p.id,
                        p.canonical_nickname,
                        p.full_name,
                        p.country_code,
                        p.birth_date,
                        tenure.team_id
                    FROM players p
                    JOIN player_source_ids source_id
                      ON source_id.player_id = p.id
                     AND source_id.source = 'pandascore'
                    JOIN player_team_tenures tenure
                      ON tenure.player_id = p.id
                     AND tenure.is_current = 1
                     AND tenure.is_primary = 1
                    WHERE lower(trim(p.canonical_nickname))
                          = lower(trim(?))
                      AND tenure.team_id = ?
                      AND NOT EXISTS (
                          SELECT 1 FROM player_source_ids lp
                          WHERE lp.player_id = p.id
                            AND lp.source = 'liquipedia'
                      )
                    GROUP BY p.id, tenure.team_id
                    """,
                    (hltv_values.get("nickname"), team_id),
                )
            ]
            if len(pandascore_candidates) != 1:
                continue
            duplicate = pandascore_candidates[0]
            if (
                frozenset((survivor_id, str(duplicate["id"])))
                in reviewed_separations
            ):
                continue
            if (
                not survivor["country_code"]
                or survivor["country_code"] != duplicate["country_code"]
                or hltv_values.get("country_code")
                != survivor["country_code"]
                or hltv_values.get("current_team_id") != team_id
                or person_name_token_signature(
                    hltv_values.get("full_name")
                )
                != person_name_token_signature(duplicate["full_name"])
            ):
                continue
            birth_dates = {
                str(candidate["birth_date"])
                for candidate in (survivor, duplicate)
                if candidate["birth_date"]
            }
            if len(birth_dates) > 1:
                continue

            audit_candidates = [
                {
                    "player_id": str(candidate["id"]),
                    "nickname": candidate["canonical_nickname"],
                    "full_name": candidate["full_name"],
                    "country_code": candidate["country_code"],
                    "birth_date": candidate["birth_date"],
                    "current_team_id": team_id,
                    "match_basis": "hltv_alias_triangulation",
                }
                for candidate in (survivor, duplicate)
            ]
            self._merge_player_into(survivor_id, str(duplicate["id"]))
            conflicts_created += self._record_conflict(
                entity_type="player",
                entity_id=survivor_id,
                field_name="identity:high_confidence_cross_source",
                candidates=audit_candidates,
                resolved_value=survivor_id,
                status="automatic",
            )
            merges += 1
        return merges, conflicts_created

    def _latest_player_values_from_source(
        self,
        player_id: str,
        source: str,
    ) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for row in self.connection.execute(
            """
            SELECT fe.field_name, fe.normalized_value_json
            FROM field_evidence fe
            JOIN source_records sr ON sr.id = fe.source_record_id
            WHERE fe.entity_type = 'player'
              AND fe.entity_id = ?
              AND sr.source = ?
            ORDER BY sr.fetched_at DESC, fe.id DESC
            """,
            (player_id, source),
        ):
            field_name = str(row["field_name"])
            if field_name not in values:
                values[field_name] = json.loads(
                    row["normalized_value_json"]
                )
        return values

    def _coalesce_current_tenures(self) -> None:
        groups: dict[tuple[str, str, str, str], list[sqlite3.Row]] = {}
        for row in self.connection.execute(
            """
            SELECT * FROM player_team_tenures
            WHERE is_current = 1
            ORDER BY player_id, team_id, membership_kind, game_title, id
            """
        ):
            key = (
                str(row["player_id"]),
                str(row["team_id"]),
                str(row["membership_kind"]),
                str(row["game_title"]),
            )
            groups.setdefault(key, []).append(row)
        precision_rank = {"unknown": 0, "year": 1, "month": 2, "day": 3}
        for rows in groups.values():
            if len(rows) < 2:
                continue
            kept = max(
                rows,
                key=lambda row: (
                    row["start_value"] is not None,
                    precision_rank.get(str(row["start_precision"]), 0),
                    row["end_value"] is not None,
                    str(row["updated_at"]),
                    str(row["id"]),
                ),
            )
            for duplicate in rows:
                if duplicate["id"] == kept["id"]:
                    continue
                self.connection.execute(
                    """
                    UPDATE field_evidence SET entity_id = ?
                    WHERE entity_type = 'team_tenure' AND entity_id = ?
                    """,
                    (kept["id"], duplicate["id"]),
                )
                self.connection.execute(
                    "DELETE FROM player_team_tenures WHERE id = ?",
                    (duplicate["id"],),
                )

    def _merge_major_appearances(self) -> int:
        conflicts_created = 0
        for appearance in self.connection.execute(
            "SELECT player_id, major_id FROM major_appearances"
        ):
            player_id = str(appearance["player_id"])
            major_id = str(appearance["major_id"])
            entity_id = f"{player_id}:{major_id}"
            updates: dict[str, Any] = {}
            for field_name in (
                "team_id",
                "participation_kind",
                "placement",
                "stage_reached",
                "matches_played",
                "counts_toward_total",
            ):
                rows = self.connection.execute(
                    """
                    WITH ranked AS (
                        SELECT
                            fe.id,
                            fe.normalized_value_json,
                            fe.confidence,
                            fe.observed_at,
                            sr.source,
                            ROW_NUMBER() OVER (
                                PARTITION BY sr.source
                                ORDER BY sr.fetched_at DESC, fe.id DESC
                            ) AS source_rank
                        FROM field_evidence fe
                        JOIN source_records sr
                          ON sr.id = fe.source_record_id
                        WHERE fe.entity_type = 'major_appearance'
                          AND fe.entity_id = ?
                          AND fe.field_name = ?
                    )
                    SELECT * FROM ranked WHERE source_rank = 1
                    """,
                    (entity_id, field_name),
                )
                evidence = [
                    {
                        "id": int(row["id"]),
                        "value": json.loads(row["normalized_value_json"]),
                        "confidence": float(row["confidence"]),
                        "observed_at": row["observed_at"],
                        "source": row["source"],
                    }
                    for row in rows
                ]
                selected, candidates = choose_evidence(field_name, evidence)
                if selected is None:
                    continue
                updates[field_name] = selected["value"]
                self.connection.execute(
                    """
                    UPDATE field_evidence
                    SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END
                    WHERE entity_type = 'major_appearance'
                      AND entity_id = ? AND field_name = ?
                    """,
                    (selected["id"], entity_id, field_name),
                )
                if len({_json(item["value"]) for item in candidates}) > 1:
                    conflicts_created += self._record_conflict(
                        entity_type="major_appearance",
                        entity_id=entity_id,
                        field_name=field_name,
                        candidates=candidates,
                        resolved_value=selected["value"],
                        status="automatic",
                    )
            if updates:
                updates["counts_toward_total"] = int(
                    bool(updates.get("counts_toward_total", True))
                )
                assignments = ", ".join(
                    f"{column} = ?" for column in updates
                )
                self.connection.execute(
                    f"""
                    UPDATE major_appearances
                    SET {assignments}, updated_at = ?
                    WHERE player_id = ? AND major_id = ?
                    """,
                    (
                        *updates.values(),
                        _now(),
                        player_id,
                        major_id,
                    ),
                )
        return conflicts_created

    def _queue_identity_reviews(self) -> tuple[int, int]:
        self.connection.execute(
            """
            UPDATE merge_conflicts
            SET resolution_status = 'ignored', resolved_at = ?
            WHERE field_name = 'identity:nickname_current_team'
              AND resolution_status = 'open'
            """,
            (_now(),),
        )
        reviewed_separations = self._reviewed_identity_separation_pairs()
        groups: dict[tuple[str, str], list[dict[str, str]]] = {}
        for row in self.connection.execute(
            """
            SELECT
                p.id,
                p.canonical_nickname,
                tenure.team_id,
                team.canonical_name AS team_name
            FROM players p
            JOIN player_team_tenures tenure ON tenure.player_id = p.id
            JOIN teams team ON team.id = tenure.team_id
            WHERE tenure.is_current = 1 AND tenure.is_primary = 1
            ORDER BY p.id
            """
        ):
            team_signature = " ".join(
                team_name_identity_signature(row["team_name"])
            )
            key = (
                normalize_identity_text(row["canonical_nickname"]),
                team_signature,
            )
            groups.setdefault(key, []).append(
                {
                    "player_id": str(row["id"]),
                    "team_id": str(row["team_id"]),
                    "team_name": str(row["team_name"]),
                }
            )
        review_count = 0
        conflicts_created = 0
        for (nickname, team_signature), player_rows in groups.items():
            if not nickname or not team_signature or len(player_rows) < 2:
                continue
            if (
                len(player_rows) == 2
                and frozenset(
                    player_row["player_id"] for player_row in player_rows
                )
                in reviewed_separations
            ):
                continue
            review_count += 1
            candidates = [
                {
                    "player_id": player_row["player_id"],
                    "nickname": nickname,
                    "current_team_id": player_row["team_id"],
                    "current_team_name": player_row["team_name"],
                    "current_team_signature": team_signature,
                }
                for player_row in player_rows
            ]
            for player_row in player_rows:
                conflicts_created += self._record_conflict(
                    entity_type="player",
                    entity_id=player_row["player_id"],
                    field_name="identity:nickname_current_team",
                    candidates=candidates,
                    status="open",
                )
        return review_count, conflicts_created

    def _merge_player_into(self, survivor_id: str, duplicate_id: str) -> None:
        if survivor_id == duplicate_id:
            return

        self.connection.execute(
            "UPDATE player_source_ids SET player_id = ? WHERE player_id = ?",
            (survivor_id, duplicate_id),
        )
        self.connection.execute(
            """
            UPDATE field_evidence SET entity_id = ?
            WHERE entity_type = 'player' AND entity_id = ?
            """,
            (survivor_id, duplicate_id),
        )
        self.connection.execute(
            "UPDATE player_team_tenures SET player_id = ? WHERE player_id = ?",
            (survivor_id, duplicate_id),
        )

        duplicate_roles = list(
            self.connection.execute(
                "SELECT * FROM player_roles WHERE player_id = ?",
                (duplicate_id,),
            )
        )
        for role in duplicate_roles:
            existing = self.connection.execute(
                """
                SELECT id FROM player_roles
                WHERE player_id = ? AND role_kind = ? AND role = ?
                  AND valid_from IS ?
                ORDER BY id LIMIT 1
                """,
                (
                    survivor_id,
                    role["role_kind"],
                    role["role"],
                    role["valid_from"],
                ),
            ).fetchone()
            if existing:
                self.connection.execute(
                    """
                    UPDATE field_evidence SET entity_id = ?
                    WHERE entity_type = 'player_role' AND entity_id = ?
                    """,
                    (existing["id"], role["id"]),
                )
                self.connection.execute(
                    "DELETE FROM player_roles WHERE id = ?", (role["id"],)
                )
            else:
                self.connection.execute(
                    "UPDATE player_roles SET player_id = ? WHERE id = ?",
                    (survivor_id, role["id"]),
                )

        for appearance in list(
            self.connection.execute(
                "SELECT * FROM major_appearances WHERE player_id = ?",
                (duplicate_id,),
            )
        ):
            duplicate_entity_id = f"{duplicate_id}:{appearance['major_id']}"
            survivor_entity_id = f"{survivor_id}:{appearance['major_id']}"
            self.connection.execute(
                """
                UPDATE field_evidence SET entity_id = ?
                WHERE entity_type = 'major_appearance' AND entity_id = ?
                """,
                (survivor_entity_id, duplicate_entity_id),
            )
            self.connection.execute(
                """
                UPDATE merge_conflicts SET entity_id = ?
                WHERE entity_type = 'major_appearance' AND entity_id = ?
                """,
                (survivor_entity_id, duplicate_entity_id),
            )
            existing = self.connection.execute(
                """
                SELECT 1 FROM major_appearances
                WHERE player_id = ? AND major_id = ?
                """,
                (survivor_id, appearance["major_id"]),
            ).fetchone()
            if existing:
                self.connection.execute(
                    """
                    DELETE FROM major_appearances
                    WHERE player_id = ? AND major_id = ?
                    """,
                    (duplicate_id, appearance["major_id"]),
                )
            else:
                self.connection.execute(
                    """
                    UPDATE major_appearances SET player_id = ?
                    WHERE player_id = ? AND major_id = ?
                    """,
                    (survivor_id, duplicate_id, appearance["major_id"]),
                )

        self.connection.execute(
            """
            UPDATE merge_conflicts SET entity_id = ?
            WHERE entity_type = 'player' AND entity_id = ?
            """,
            (survivor_id, duplicate_id),
        )
        self.connection.execute(
            "DELETE FROM players WHERE id = ?", (duplicate_id,)
        )

    def _latest_player_evidence(
        self,
        player_id: str,
        field_name: str,
    ) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """
            WITH ranked AS (
                SELECT
                    fe.id,
                    fe.normalized_value_json,
                    fe.confidence,
                    fe.observed_at,
                    sr.source,
                    ROW_NUMBER() OVER (
                        PARTITION BY sr.source
                        ORDER BY sr.fetched_at DESC, fe.id DESC
                    ) AS source_rank
                FROM field_evidence fe
                JOIN source_records sr ON sr.id = fe.source_record_id
                WHERE fe.entity_type = 'player'
                  AND fe.entity_id = ?
                  AND fe.field_name = ?
            )
            SELECT * FROM ranked WHERE source_rank = 1
            """,
            (player_id, field_name),
        )
        return [
            {
                "id": int(row["id"]),
                "value": json.loads(row["normalized_value_json"]),
                "confidence": float(row["confidence"]),
                "observed_at": row["observed_at"],
                "source": row["source"],
            }
            for row in rows
        ]

    def _merge_team_fields(self, team_id: str) -> int:
        column_by_field = {
            "canonical_name": "canonical_name",
            "short_name": "short_name",
            "country_code": "country_code",
            "logo_url": "logo_url",
        }
        updates: dict[str, Any] = {}
        conflicts_created = 0
        for field_name, column_name in column_by_field.items():
            rows = self.connection.execute(
                """
                WITH ranked AS (
                    SELECT
                        fe.id,
                        fe.normalized_value_json,
                        fe.confidence,
                        fe.observed_at,
                        sr.source,
                        ROW_NUMBER() OVER (
                            PARTITION BY sr.source
                            ORDER BY sr.fetched_at DESC, fe.id DESC
                        ) AS source_rank
                    FROM field_evidence fe
                    JOIN source_records sr ON sr.id = fe.source_record_id
                    WHERE fe.entity_type = 'team'
                      AND fe.entity_id = ?
                      AND fe.field_name = ?
                )
                SELECT * FROM ranked WHERE source_rank = 1
                """,
                (team_id, field_name),
            )
            evidence = [
                {
                    "id": int(row["id"]),
                    "value": json.loads(row["normalized_value_json"]),
                    "confidence": float(row["confidence"]),
                    "observed_at": row["observed_at"],
                    "source": row["source"],
                }
                for row in rows
            ]
            selected, candidates = choose_evidence(field_name, evidence)
            if selected is None:
                continue
            updates[column_name] = selected["value"]
            self.connection.execute(
                """
                UPDATE field_evidence
                SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END
                WHERE entity_type = 'team' AND entity_id = ?
                  AND field_name = ?
                """,
                (selected["id"], team_id, field_name),
            )
            if len({_json(item["value"]) for item in candidates}) > 1:
                conflicts_created += self._record_conflict(
                    entity_type="team",
                    entity_id=team_id,
                    field_name=field_name,
                    candidates=candidates,
                    resolved_value=selected["value"],
                    status="automatic",
                )
        if updates:
            assignments = ", ".join(f"{column} = ?" for column in updates)
            self.connection.execute(
                f"UPDATE teams SET {assignments}, updated_at = ? WHERE id = ?",
                (*updates.values(), _now(), team_id),
            )
        return conflicts_created

    def _merge_player_fields(self, player_id: str) -> int:
        column_by_field = {
            "nickname": "canonical_nickname",
            "full_name": "full_name",
            "country_code": "country_code",
            "birth_date": "birth_date",
            "status": "status",
            "image_url": "image_url",
            "is_coach": "is_coach",
        }
        updates: dict[str, Any] = {}
        conflicts_created = 0
        for field_name, column_name in column_by_field.items():
            evidence = self._latest_player_evidence(player_id, field_name)
            selected, candidates = choose_evidence(field_name, evidence)
            if selected is None:
                continue
            selected_value = (
                primary_person_name(selected["value"])
                if field_name == "full_name"
                else selected["value"]
            )
            updates[column_name] = selected_value
            self.connection.execute(
                """
                UPDATE field_evidence
                SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END
                WHERE entity_type = 'player' AND entity_id = ?
                  AND field_name = ?
                """,
                (selected["id"], player_id, field_name),
            )
            distinct_values = {_json(item["value"]) for item in candidates}
            if len(distinct_values) > 1:
                conflicts_created += self._record_conflict(
                    entity_type="player",
                    entity_id=player_id,
                    field_name=field_name,
                    candidates=candidates,
                    resolved_value=selected_value,
                    status="automatic",
                )

        if updates:
            assignments = ", ".join(f"{column} = ?" for column in updates)
            self.connection.execute(
                f"UPDATE players SET {assignments}, updated_at = ? WHERE id = ?",
                (*updates.values(), _now(), player_id),
            )
        return conflicts_created

    def _select_current_team(self, player_id: str) -> int:
        evidence = self._latest_player_evidence(player_id, "current_team_id")
        selected, candidates = choose_evidence("current_team_id", evidence)
        self.connection.execute(
            "UPDATE player_team_tenures SET is_primary = 0 WHERE player_id = ?",
            (player_id,),
        )
        if selected is None:
            return 0
        self.connection.execute(
            """
            UPDATE field_evidence
            SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END
            WHERE entity_type = 'player' AND entity_id = ?
              AND field_name = 'current_team_id'
            """,
            (selected["id"], player_id),
        )
        tenure = self.connection.execute(
            """
            SELECT id FROM player_team_tenures
            WHERE player_id = ? AND team_id = ? AND is_current = 1
            ORDER BY start_value DESC, updated_at DESC, id
            LIMIT 1
            """,
            (player_id, selected["value"]),
        ).fetchone()
        if tenure:
            self.connection.execute(
                "UPDATE player_team_tenures SET is_primary = 1 WHERE id = ?",
                (tenure["id"],),
            )
        distinct_values = {_json(item["value"]) for item in candidates}
        if len(distinct_values) <= 1:
            return 0
        return self._record_conflict(
            entity_type="player",
            entity_id=player_id,
            field_name="current_team_id",
            candidates=candidates,
            resolved_value=selected["value"],
            status="automatic",
        )

    def _refresh_guessability(self, player_id: str) -> bool:
        player = self.connection.execute(
            "SELECT * FROM players WHERE id = ?", (player_id,)
        ).fetchone()
        assert player is not None
        roles = self._role_rows(player_id)
        game_role = derive_game_role(player["game_role_override"], roles)
        has_major_appearance = self.connection.execute(
            """
            SELECT 1
            FROM major_appearances
            WHERE player_id = ? AND counts_toward_total = 1
            LIMIT 1
            """,
            (player_id,),
        ).fetchone() is not None
        missing = []
        if bool(player["is_coach"]) and not has_major_appearance:
            missing.append("not_player:coach")
        for field_name, value in (
            ("nickname", player["canonical_nickname"]),
            ("full_name", player["full_name"]),
            ("country_code", player["country_code"]),
            ("birth_date", player["birth_date"]),
        ):
            if value is None or not str(value).strip():
                missing.append(field_name)
        birth_date = str(player["birth_date"] or "")
        if birth_date:
            try:
                parsed_birth_date = date.fromisoformat(birth_date)
            except ValueError:
                parsed_birth_date = None
            if (
                parsed_birth_date is None
                or parsed_birth_date.isoformat() != birth_date
            ):
                missing.append("birth_date_full")
        if game_role is None and not has_major_appearance:
            missing.append("game_role")
        is_guessable = not missing
        self.connection.execute(
            """
            UPDATE players
            SET is_guessable = ?, exclusion_reason = ?
            WHERE id = ?
            """,
            (
                int(is_guessable),
                (
                    None
                    if is_guessable
                    else (
                        "not_player:coach"
                        if missing == ["not_player:coach"]
                        else "missing:" + ",".join(missing)
                    )
                ),
                player_id,
            ),
        )
        return is_guessable

    def _current_team_row(self, player_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            """
            SELECT t.*
            FROM player_team_tenures tenure
            JOIN teams t ON t.id = tenure.team_id
            WHERE tenure.player_id = ?
              AND tenure.is_current = 1
              AND tenure.is_primary = 1
            ORDER BY tenure.start_value DESC, tenure.updated_at DESC
            LIMIT 1
            """,
            (player_id,),
        ).fetchone()

    def _team_presentation_records(self) -> dict[str, dict[str, Any]]:
        """Compose display fields across aliases confirmed by a shared player."""
        teams = [
            dict(row)
            for row in self.connection.execute("SELECT * FROM teams")
        ]
        team_by_id = {str(team["id"]): team for team in teams}
        parent = {team_id: team_id for team_id in team_by_id}

        def find(team_id: str) -> str:
            root = team_id
            while parent[root] != root:
                root = parent[root]
            while parent[team_id] != team_id:
                next_team_id = parent[team_id]
                parent[team_id] = root
                team_id = next_team_id
            return root

        def union(first_id: str, second_id: str) -> None:
            first_root = find(first_id)
            second_root = find(second_id)
            if first_root != second_root:
                parent[second_root] = first_root

        player_signature_teams: dict[
            tuple[str, tuple[str, ...]],
            list[str],
        ] = {}
        for row in self.connection.execute(
            """
            SELECT
                tenure.player_id,
                team.id AS team_id,
                team.canonical_name
            FROM player_team_tenures tenure
            JOIN teams team ON team.id = tenure.team_id
            ORDER BY tenure.player_id, team.id
            """
        ):
            signature = team_name_identity_signature(
                row["canonical_name"]
            )
            if not signature:
                continue
            key = (str(row["player_id"]), signature)
            team_ids = player_signature_teams.setdefault(key, [])
            team_id = str(row["team_id"])
            if team_id not in team_ids:
                team_ids.append(team_id)
        for team_ids in player_signature_teams.values():
            for team_id in team_ids[1:]:
                union(team_ids[0], team_id)

        grouped: dict[str, list[dict[str, Any]]] = {}
        for team_id, team in team_by_id.items():
            grouped.setdefault(find(team_id), []).append(team)

        evidence_by_field: dict[str, list[dict[str, Any]]] = {
            "canonical_name": [],
            "short_name": [],
            "logo_url": [],
        }
        evidence_by_team: dict[
            str,
            dict[str, list[dict[str, Any]]],
        ] = {}
        for row in self.connection.execute(
            """
            WITH ranked AS (
                SELECT
                    fe.id,
                    fe.entity_id,
                    fe.field_name,
                    fe.normalized_value_json,
                    fe.confidence,
                    fe.observed_at,
                    sr.source,
                    ROW_NUMBER() OVER (
                        PARTITION BY fe.entity_id, fe.field_name, sr.source
                        ORDER BY sr.fetched_at DESC, fe.id DESC
                    ) AS source_rank
                FROM field_evidence fe
                JOIN source_records sr ON sr.id = fe.source_record_id
                WHERE fe.entity_type = 'team'
                  AND fe.field_name IN (
                      'canonical_name', 'short_name', 'logo_url'
                  )
            )
            SELECT * FROM ranked WHERE source_rank = 1
            ORDER BY id
            """
        ):
            team_evidence = evidence_by_team.setdefault(
                str(row["entity_id"]),
                {
                    "canonical_name": [],
                    "short_name": [],
                    "logo_url": [],
                },
            )
            team_evidence[str(row["field_name"])].append(
                {
                    "id": int(row["id"]),
                    "value": json.loads(row["normalized_value_json"]),
                    "confidence": float(row["confidence"]),
                    "observed_at": row["observed_at"],
                    "source": row["source"],
                }
            )

        presentations: dict[str, dict[str, Any]] = {}
        for aliases in grouped.values():
            for values in evidence_by_field.values():
                values.clear()
            for alias in aliases:
                alias_evidence = evidence_by_team.get(str(alias["id"]), {})
                for field_name, field_evidence in evidence_by_field.items():
                    field_evidence.extend(alias_evidence.get(field_name, []))
            selected_name, _ = choose_evidence(
                "canonical_name",
                evidence_by_field["canonical_name"],
            )
            selected_short_name, _ = choose_evidence(
                "short_name",
                evidence_by_field["short_name"],
            )
            selected_logo, _ = choose_evidence(
                "logo_url",
                evidence_by_field["logo_url"],
            )
            selected_display_name = (
                choose_display_casing(
                    str(selected_name["value"]),
                    evidence_by_field["canonical_name"],
                )
                if selected_name is not None
                else None
            )
            for alias in aliases:
                record: dict[str, Any] = {
                    "id": alias["id"],
                    "name": (
                        selected_display_name
                        if selected_display_name is not None
                        else alias["canonical_name"]
                    ),
                }
                short_name = (
                    selected_short_name["value"]
                    if selected_short_name is not None
                    else alias["short_name"]
                )
                logo_url = (
                    selected_logo["value"]
                    if selected_logo is not None
                    else alias["logo_url"]
                )
                if short_name:
                    record["shortName"] = short_name
                if logo_url:
                    record["logoUrl"] = logo_url
                presentations[str(alias["id"])] = record
        return presentations

    def _role_rows(self, player_id: str) -> list[dict[str, Any]]:
        return [
            dict(row)
            for row in self.connection.execute(
                """
                SELECT role_kind, role, is_primary, valid_from, valid_to
                FROM player_roles
                WHERE player_id = ? AND valid_to IS NULL
                ORDER BY role_kind, role
                """,
                (player_id,),
            )
        ]

    def export_game_records(
        self,
        *,
        guessable_only: bool = True,
    ) -> list[dict[str, Any]]:
        condition = "WHERE p.is_guessable = 1" if guessable_only else ""
        players = self.connection.execute(
            f"""
            SELECT p.*,
                   COALESCE(mt.major_appearances, 0) AS major_appearances,
                   COALESCE(mw.major_wins, 0) AS major_wins
            FROM players p
            LEFT JOIN player_major_totals mt ON mt.player_id = p.id
            LEFT JOIN (
                SELECT player_id, COUNT(*) AS major_wins
                FROM major_appearances
                WHERE placement = '1'
                GROUP BY player_id
            ) mw ON mw.player_id = p.id
            {condition}
            ORDER BY lower(p.canonical_nickname), p.id
            """
        )
        team_presentations = self._team_presentation_records()
        records: list[dict[str, Any]] = []
        for player in players:
            player_id = str(player["id"])
            current_team = self._current_team_row(player_id)
            roles = self._role_rows(player_id)
            role = derive_game_role(
                player["game_role_override"],
                roles,
                fallback_to_rifler=True,
            )
            if role is None and int(player["major_appearances"]) > 0:
                role = "Unknown"
            team_history = []
            for tenure in self.connection.execute(
                """
                SELECT tenure.*, team.canonical_name
                FROM player_team_tenures tenure
                JOIN teams team ON team.id = tenure.team_id
                WHERE tenure.player_id = ?
                ORDER BY tenure.is_current DESC, tenure.is_primary DESC,
                         tenure.start_value DESC, tenure.id
                """,
                (player_id,),
            ):
                presentation = team_presentations.get(str(tenure["team_id"]))
                history_item: dict[str, Any] = {
                    "team": {
                        "id": tenure["team_id"],
                        "name": (
                            presentation["name"]
                            if presentation is not None
                            else tenure["canonical_name"]
                        ),
                    },
                    "kind": tenure["membership_kind"],
                    "fromPrecision": tenure["start_precision"],
                    "toPrecision": tenure["end_precision"],
                    "current": bool(tenure["is_current"]),
                }
                if tenure["start_value"] is not None:
                    history_item["from"] = tenure["start_value"]
                if tenure["end_value"] is not None:
                    history_item["to"] = tenure["end_value"]
                team_history.append(history_item)

            team_record: dict[str, Any] | None = None
            if current_team is not None:
                team_record = dict(
                    team_presentations.get(
                        str(current_team["id"]),
                        {
                            "id": current_team["id"],
                            "name": current_team["canonical_name"],
                        },
                    )
                )
            records.append(
                {
                    "schemaVersion": 1,
                    "id": player_id,
                    "nickname": player["canonical_nickname"],
                    "fullName": player["full_name"],
                    "countryCode": player["country_code"],
                    "birthDate": player["birth_date"],
                    "currentTeam": team_record,
                    "role": role,
                    "roles": [
                        {
                            "kind": row["role_kind"],
                            "value": row["role"],
                            "primary": bool(row["is_primary"]),
                        }
                        for row in roles
                    ],
                    "majorAppearances": int(player["major_appearances"]),
                    "majorWins": int(player["major_wins"]),
                    "teamHistory": team_history,
                    "updatedAt": player["updated_at"],
                    "imageUrl": player["image_url"],
                }
            )
        return records

    def _record_conflict(
        self,
        *,
        entity_type: str,
        entity_id: str,
        field_name: str,
        candidates: list[dict[str, Any]],
        resolved_value: Any = None,
        status: str = "open",
    ) -> int:
        existing = self.connection.execute(
            """
            SELECT id FROM merge_conflicts
            WHERE entity_type = ? AND entity_id = ? AND field_name = ?
            ORDER BY id DESC LIMIT 1
            """,
            (entity_type, entity_id, field_name),
        ).fetchone()
        resolved_at = _now() if status in {"automatic", "manual"} else None
        if existing:
            self.connection.execute(
                """
                UPDATE merge_conflicts
                SET candidate_values_json = ?, resolution_status = ?,
                    resolved_value_json = ?, resolved_at = ?
                WHERE id = ?
                """,
                (
                    _json(candidates),
                    status,
                    _json(resolved_value) if resolved_value is not None else None,
                    resolved_at,
                    existing["id"],
                ),
            )
            return 0
        self.connection.execute(
            """
            INSERT INTO merge_conflicts (
                entity_type, entity_id, field_name, candidate_values_json,
                resolution_status, resolved_value_json, created_at, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entity_type,
                entity_id,
                field_name,
                _json(candidates),
                status,
                _json(resolved_value) if resolved_value is not None else None,
                _now(),
                resolved_at,
            ),
        )
        return 1

    def _ingest_player_relationships(
        self,
        *,
        source: str,
        player_id: str,
        player_external_id: str,
        parsed: Mapping[str, Any],
        player_source_record_id: int,
        fetched_at: str,
    ) -> None:
        current_team = parsed.get("current_team")
        current_team_id: str | None = None
        if isinstance(current_team, Mapping) and not _is_departed_team_name(
            current_team.get("name")
        ):
            current_team_id = self._upsert_team(
                source, current_team, fetched_at=fetched_at
            )
            self._insert_evidence(
                entity_type="player",
                entity_id=player_id,
                field_name="current_team_id",
                source_record_id=player_source_record_id,
                value=current_team_id,
                observed_at=fetched_at,
            )

        history = parsed.get("team_history") or []
        current_team_has_tenure = False
        if isinstance(history, list):
            for item in history:
                if not isinstance(item, Mapping):
                    continue
                team_data = item.get("team")
                if not isinstance(team_data, Mapping):
                    continue
                team_id = self._upsert_team(
                    source, team_data, fetched_at=fetched_at
                )
                is_current = bool(
                    item.get("is_current", item.get("current", False))
                ) and not _is_departed_team_name(team_data.get("name"))
                is_primary = bool(
                    item.get("is_primary", item.get("primary", False))
                )
                if current_team_id == team_id and is_current:
                    current_team_has_tenure = True
                    if not is_primary:
                        is_primary = True
                self._upsert_tenure(
                    source=source,
                    player_id=player_id,
                    player_external_id=player_external_id,
                    team_id=team_id,
                    team_external_id=self._team_external_id(team_data),
                    item=item,
                    is_current=is_current,
                    is_primary=is_primary,
                    fetched_at=fetched_at,
                )

        if current_team_id and not current_team_has_tenure:
            self._upsert_tenure(
                source=source,
                player_id=player_id,
                player_external_id=player_external_id,
                team_id=current_team_id,
                team_external_id=self._team_external_id(current_team),
                item=current_team,
                is_current=True,
                is_primary=True,
                fetched_at=fetched_at,
            )

        roles = parsed.get("roles") or []
        if isinstance(roles, list):
            seen_kinds: set[str] = set()
            for role_item in roles:
                if isinstance(role_item, str):
                    role_value = role_item.casefold().strip()
                    role_kind = (
                        "weapon"
                        if role_value in {"awper", "rifler"}
                        else "tactical"
                    )
                    is_primary = role_kind not in seen_kinds
                    role_data: Mapping[str, Any] = {}
                elif isinstance(role_item, Mapping):
                    role_value = str(
                        role_item.get("value") or role_item.get("role") or ""
                    ).casefold().strip()
                    role_kind = str(
                        role_item.get("kind")
                        or role_item.get("role_kind")
                        or (
                            "weapon"
                            if role_value in {"awper", "rifler"}
                            else "tactical"
                        )
                    ).casefold()
                    is_primary = bool(
                        role_item.get(
                            "primary",
                            role_item.get("is_primary", role_kind not in seen_kinds),
                        )
                    )
                    role_data = role_item
                else:
                    continue
                if role_value not in {
                    "awper",
                    "rifler",
                    "igl",
                    "entry",
                    "lurker",
                    "support",
                }:
                    continue
                if role_kind not in {"weapon", "tactical"}:
                    continue
                seen_kinds.add(role_kind)
                self._upsert_role(
                    source=source,
                    player_id=player_id,
                    player_external_id=player_external_id,
                    role_kind=role_kind,
                    role=role_value,
                    is_primary=is_primary,
                    valid_from=role_data.get("valid_from"),
                    valid_to=role_data.get("valid_to"),
                    fetched_at=fetched_at,
                )

        platform_ids = parsed.get("platform_ids") or {}
        if isinstance(platform_ids, Mapping):
            for platform_source in ("steam", "faceit"):
                platform_external_id = platform_ids.get(platform_source)
                if not platform_external_id:
                    continue
                existing = self.connection.execute(
                    """
                    SELECT player_id FROM player_source_ids
                    WHERE source = ? AND external_id = ?
                    """,
                    (platform_source, str(platform_external_id)),
                ).fetchone()
                if existing and existing["player_id"] != player_id:
                    self._record_conflict(
                        entity_type="player",
                        entity_id=player_id,
                        field_name=f"identity:{platform_source}",
                        candidates=[
                            {"player_id": existing["player_id"]},
                            {"player_id": player_id},
                        ],
                    )
                    continue
                self.connection.execute(
                    """
                    INSERT INTO player_source_ids (
                        player_id, source, external_id, source_url, last_seen_at
                    ) VALUES (?, ?, ?, NULL, ?)
                    ON CONFLICT(source, external_id) DO UPDATE SET
                        last_seen_at = excluded.last_seen_at
                    """,
                    (
                        player_id,
                        platform_source,
                        str(platform_external_id),
                        fetched_at,
                    ),
                )

    @staticmethod
    def _team_external_id(team: Mapping[str, Any]) -> str:
        value = (
            team.get("external_id")
            or team.get("source_id")
            or team.get("id")
            or team.get("name")
        )
        if value is None:
            raise ValueError("team external_id/source_id/name is required")
        return str(value)

    def _upsert_team(
        self,
        source: str,
        team: Mapping[str, Any],
        *,
        fetched_at: str,
    ) -> str:
        external_id = self._team_external_id(team)
        name = str(team.get("name") or team.get("canonical_name") or "").strip()
        if not name:
            raise ValueError("team.name is required")
        source_url = team.get("source_url")
        existing = self.connection.execute(
            """
            SELECT team_id FROM team_source_ids
            WHERE source = ? AND external_id = ?
            """,
            (source, external_id),
        ).fetchone()
        if existing:
            team_id = str(existing["team_id"])
        else:
            same_name = self.connection.execute(
                """
                SELECT id FROM teams
                WHERE lower(trim(canonical_name)) = lower(trim(?))
                ORDER BY created_at, id LIMIT 1
                """,
                (name,),
            ).fetchone()
            team_id = (
                str(same_name["id"])
                if same_name
                else f"team_{uuid.uuid4().hex}"
            )
            if not same_name:
                self.connection.execute(
                    """
                    INSERT INTO teams (
                        id, canonical_name, short_name, country_code, logo_url,
                        status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        team_id,
                        name,
                        team.get("short_name") or team.get("acronym"),
                        normalize_country_code(team.get("country_code")),
                        team.get("logo_url") or team.get("image_url"),
                        team.get("status", "unknown"),
                        fetched_at,
                        fetched_at,
                    ),
                )
            self.connection.execute(
                """
                INSERT INTO team_source_ids (
                    team_id, source, external_id, source_url, last_seen_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (team_id, source, external_id, source_url, fetched_at),
            )

        source_record_id, is_new = self._upsert_source_record(
            source=source,
            record_type="team",
            external_id=external_id,
            raw_metadata={"payload": dict(team), "fetched_at": fetched_at},
            parsed=team,
            source_url=source_url,
            fetched_at=fetched_at,
        )
        if is_new:
            fields = {
                "canonical_name": name,
                "short_name": team.get("short_name") or team.get("acronym"),
                "country_code": normalize_country_code(team.get("country_code")),
                "logo_url": team.get("logo_url") or team.get("image_url"),
            }
            for field_name, value in fields.items():
                if value is not None:
                    self._insert_evidence(
                        entity_type="team",
                        entity_id=team_id,
                        field_name=field_name,
                        source_record_id=source_record_id,
                        value=value,
                        observed_at=fetched_at,
                    )
        return team_id

    def _upsert_tenure(
        self,
        *,
        source: str,
        player_id: str,
        player_external_id: str,
        team_id: str,
        team_external_id: str,
        item: Mapping[str, Any],
        is_current: bool,
        is_primary: bool,
        fetched_at: str,
    ) -> str:
        membership_kind = str(
            item.get("membership_kind") or item.get("kind") or "active"
        ).casefold()
        start_value = item.get("start_value", item.get("from"))
        start_precision = str(
            item.get("start_precision")
            or item.get("from_precision")
            or "unknown"
        ).casefold()
        end_value = item.get("end_value", item.get("to"))
        end_precision = str(
            item.get("end_precision")
            or item.get("to_precision")
            or "unknown"
        ).casefold()
        game_title = str(item.get("game_title") or "counter-strike").casefold()
        identity = _json(
            [
                player_id,
                team_id,
                membership_kind,
                start_value,
                end_value,
                game_title,
            ]
        )
        tenure_id = (
            "tenure_"
            + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
        )
        self.connection.execute(
            """
            INSERT INTO player_team_tenures (
                id, player_id, team_id, game_title, membership_kind,
                start_value, start_precision, end_value, end_precision,
                is_current, is_primary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                start_precision = excluded.start_precision,
                end_precision = excluded.end_precision,
                is_current = excluded.is_current,
                is_primary = excluded.is_primary,
                updated_at = excluded.updated_at
            """,
            (
                tenure_id,
                player_id,
                team_id,
                game_title,
                membership_kind,
                start_value,
                start_precision,
                end_value,
                end_precision,
                int(is_current),
                int(is_primary),
                fetched_at,
                fetched_at,
            ),
        )
        record_external_id = ":".join(
            (
                player_external_id,
                team_external_id,
                str(start_value or ""),
                membership_kind,
            )
        )
        source_record_id, is_new = self._upsert_source_record(
            source=source,
            record_type="team_history",
            external_id=record_external_id,
            raw_metadata={"payload": dict(item), "fetched_at": fetched_at},
            parsed=item,
            source_url=None,
            fetched_at=fetched_at,
        )
        if is_new:
            for field_name, value in {
                "team_id": team_id,
                "membership_kind": membership_kind,
                "start_value": start_value,
                "start_precision": start_precision,
                "end_value": end_value,
                "end_precision": end_precision,
                "is_current": bool(is_current),
                "is_primary": bool(is_primary),
            }.items():
                self._insert_evidence(
                    entity_type="team_tenure",
                    entity_id=tenure_id,
                    field_name=field_name,
                    source_record_id=source_record_id,
                    value=value,
                    observed_at=fetched_at,
                )
        return tenure_id

    def _upsert_role(
        self,
        *,
        source: str,
        player_id: str,
        player_external_id: str,
        role_kind: str,
        role: str,
        is_primary: bool,
        valid_from: Any,
        valid_to: Any,
        fetched_at: str,
    ) -> str:
        identity = _json([player_id, role_kind, role, valid_from])
        role_id = (
            "role_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
        )
        self.connection.execute(
            """
            INSERT INTO player_roles (
                id, player_id, role_kind, role, is_primary,
                valid_from, valid_to, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                is_primary = excluded.is_primary,
                valid_to = excluded.valid_to,
                updated_at = excluded.updated_at
            """,
            (
                role_id,
                player_id,
                role_kind,
                role,
                int(is_primary),
                valid_from,
                valid_to,
                fetched_at,
                fetched_at,
            ),
        )
        source_record_id, is_new = self._upsert_source_record(
            source=source,
            record_type="role",
            external_id=f"{player_external_id}:{role_kind}:{role}:{valid_from or ''}",
            raw_metadata={
                "payload": {
                    "role_kind": role_kind,
                    "role": role,
                    "is_primary": is_primary,
                    "valid_from": valid_from,
                    "valid_to": valid_to,
                },
                "fetched_at": fetched_at,
            },
            parsed={"role": role},
            source_url=None,
            fetched_at=fetched_at,
        )
        if is_new:
            for field_name, value in {
                "role_kind": role_kind,
                "role": role,
                "is_primary": bool(is_primary),
                "valid_from": valid_from,
                "valid_to": valid_to,
            }.items():
                self._insert_evidence(
                    entity_type="player_role",
                    entity_id=role_id,
                    field_name=field_name,
                    source_record_id=source_record_id,
                    value=value,
                    observed_at=fetched_at,
                )
        return role_id

    def _insert_evidence(
        self,
        *,
        entity_type: str,
        entity_id: str,
        field_name: str,
        source_record_id: int,
        value: Any,
        observed_at: str,
        confidence: float = 1.0,
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO field_evidence (
                entity_type, entity_id, field_name, source_record_id,
                normalized_value_json, confidence, is_selected, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                entity_type,
                entity_id,
                field_name,
                source_record_id,
                _json(value),
                confidence,
                observed_at,
            ),
        )

    def _upsert_source_record(
        self,
        *,
        source: str,
        record_type: str,
        external_id: str,
        raw_metadata: Mapping[str, Any],
        parsed: Mapping[str, Any],
        source_url: Any,
        fetched_at: str,
    ) -> tuple[int, bool]:
        payload = raw_metadata.get("payload", parsed)
        payload_sha256 = str(
            raw_metadata.get("payload_sha256")
            or hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()
        )
        existing = self.connection.execute(
            """
            SELECT id FROM source_records
            WHERE source = ? AND record_type = ? AND external_id = ?
              AND payload_sha256 = ?
            """,
            (source, record_type, external_id, payload_sha256),
        ).fetchone()
        self.connection.execute(
            """
            INSERT INTO source_records (
                source, record_type, external_id, source_url, fetched_at,
                source_modified_at, source_revision_id, http_etag,
                payload_sha256, raw_payload_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, record_type, external_id, payload_sha256)
            DO UPDATE SET
                source_url = COALESCE(excluded.source_url, source_url),
                fetched_at = excluded.fetched_at,
                source_modified_at = COALESCE(
                    excluded.source_modified_at, source_modified_at
                ),
                source_revision_id = COALESCE(
                    excluded.source_revision_id, source_revision_id
                ),
                http_etag = COALESCE(excluded.http_etag, http_etag),
                raw_payload_path = COALESCE(
                    excluded.raw_payload_path, raw_payload_path
                )
            """,
            (
                source,
                record_type,
                external_id,
                source_url,
                fetched_at,
                raw_metadata.get("source_modified_at"),
                raw_metadata.get("source_revision_id"),
                raw_metadata.get("http_etag") or raw_metadata.get("etag"),
                payload_sha256,
                raw_metadata.get("raw_payload_path"),
            ),
        )
        row = self.connection.execute(
            """
            SELECT id FROM source_records
            WHERE source = ? AND record_type = ? AND external_id = ?
              AND payload_sha256 = ?
            """,
            (source, record_type, external_id, payload_sha256),
        ).fetchone()
        assert row is not None
        return int(row["id"]), existing is None

    def data_quality_report(self) -> dict[str, Any]:
        """Return actionable integrity failures and non-blocking coverage gaps."""

        critical_issues: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []

        core_missing = int(
            self.connection.execute(
                """
                SELECT COUNT(*)
                FROM players player
                WHERE player.is_guessable = 1
                  AND (
                    player.full_name IS NULL
                    OR trim(player.full_name) = ''
                    OR player.country_code IS NULL
                    OR player.birth_date IS NULL
                  )
                """
            ).fetchone()[0]
        )
        if core_missing:
            critical_issues.append(
                {
                    "code": "guessable_player_missing_core_data",
                    "count": core_missing,
                }
            )

        open_conflicts = int(
            self.connection.execute(
                """
                SELECT COUNT(*)
                FROM merge_conflicts
                WHERE resolution_status = 'open'
                """
            ).fetchone()[0]
        )
        if open_conflicts:
            critical_issues.append(
                {
                    "code": "open_merge_conflicts",
                    "count": open_conflicts,
                }
            )

        winner_rows = list(
            self.connection.execute(
                """
                SELECT
                    major.id,
                    major.canonical_name,
                    COUNT(
                        DISTINCT CASE
                            WHEN appearance.placement = '1'
                            THEN appearance.team_id
                        END
                    ) AS winner_teams,
                    SUM(
                        CASE WHEN appearance.placement = '1' THEN 1 ELSE 0 END
                    ) AS winner_players
                FROM major_events major
                LEFT JOIN major_appearances appearance
                  ON appearance.major_id = major.id
                GROUP BY major.id
                ORDER BY major.starts_on
                """
            )
        )
        for row in winner_rows:
            winner_teams = int(row["winner_teams"] or 0)
            winner_players = int(row["winner_players"] or 0)
            if winner_teams != 1:
                critical_issues.append(
                    {
                        "code": "major_winner_team_count",
                        "major": row["canonical_name"],
                        "actual": winner_teams,
                        "expected": 1,
                    }
                )
            elif winner_players != 5:
                critical_issues.append(
                    {
                        "code": "major_winner_roster_size",
                        "major": row["canonical_name"],
                        "actual": winner_players,
                        "expected": 5,
                    }
                )

        roster_rows = list(
            self.connection.execute(
                """
                SELECT
                    major.canonical_name AS major,
                    team.canonical_name AS team,
                    COUNT(*) AS players,
                    SUM(
                        CASE
                            WHEN appearance.participation_kind != 'participant'
                            THEN 1 ELSE 0
                        END
                    ) AS special_participants,
                    GROUP_CONCAT(
                        CASE
                            WHEN appearance.participation_kind != 'participant'
                            THEN player.canonical_nickname
                                 || ':' || appearance.participation_kind
                        END,
                        ', '
                    ) AS special_players
                FROM major_appearances appearance
                JOIN major_events major ON major.id = appearance.major_id
                LEFT JOIN teams team ON team.id = appearance.team_id
                JOIN players player ON player.id = appearance.player_id
                GROUP BY appearance.major_id, appearance.team_id
                ORDER BY major.starts_on, team.canonical_name
                """
            )
        )
        roster_exceptions: list[dict[str, Any]] = []
        for row in roster_rows:
            players = int(row["players"])
            special = int(row["special_participants"] or 0)
            details = {
                "major": row["major"],
                "team": row["team"],
                "players": players,
                "specialParticipants": special,
                "specialPlayers": row["special_players"],
            }
            if row["team"] is None:
                critical_issues.append(
                    {"code": "major_roster_missing_team", **details}
                )
            elif players < 5:
                critical_issues.append(
                    {"code": "underfilled_major_roster", **details}
                )
            elif players > 6 or (players > 5 and special == 0):
                critical_issues.append(
                    {
                        "code": "unclassified_oversized_major_roster",
                        **details,
                    }
                )
            elif players != 5:
                roster_exceptions.append(details)

        missing_avatar_players = [
            {
                "id": row["id"],
                "nickname": row["canonical_nickname"],
            }
            for row in self.connection.execute(
                """
                SELECT id, canonical_nickname
                FROM players
                WHERE is_guessable = 1
                  AND (image_url IS NULL OR trim(image_url) = '')
                ORDER BY lower(canonical_nickname), id
                """
            )
        ]
        team_presentations = self._team_presentation_records()
        current_team_rows = list(
            self.connection.execute(
                """
                SELECT
                    team.id,
                    team.canonical_name,
                    COUNT(DISTINCT tenure.player_id) AS players
                FROM teams team
                JOIN player_team_tenures tenure ON tenure.team_id = team.id
                JOIN players player ON player.id = tenure.player_id
                WHERE tenure.is_current = 1
                  AND tenure.is_primary = 1
                  AND player.is_guessable = 1
                GROUP BY team.id
                ORDER BY players DESC, lower(team.canonical_name)
                """
            )
        )
        teams_missing_logo = []
        for row in current_team_rows:
            presentation = team_presentations.get(str(row["id"]), {})
            if presentation.get("logoUrl"):
                continue
            teams_missing_logo.append(
                {
                    "id": row["id"],
                    "name": presentation.get(
                        "name",
                        row["canonical_name"],
                    ),
                    "players": int(row["players"]),
                }
            )
        duplicate_nicknames = [
            {
                "nickname": row["nickname"],
                "players": int(row["players"]),
            }
            for row in self.connection.execute(
                """
                SELECT
                    lower(trim(canonical_nickname)) AS nickname,
                    COUNT(*) AS players
                FROM players
                WHERE is_guessable = 1
                GROUP BY lower(trim(canonical_nickname))
                HAVING COUNT(*) > 1
                ORDER BY nickname
                """
            )
        ]
        if missing_avatar_players:
            warnings.append(
                {
                    "code": "missing_player_avatar",
                    "count": len(missing_avatar_players),
                }
            )
        if teams_missing_logo:
            warnings.append(
                {
                    "code": "missing_current_team_logo",
                    "count": len(teams_missing_logo),
                }
            )
        if duplicate_nicknames:
            warnings.append(
                {
                    "code": "duplicate_guessable_nickname",
                    "count": len(duplicate_nicknames),
                }
            )

        counts = self.audit()["counts"]
        guessable_players = int(
            self.connection.execute(
                "SELECT COUNT(*) FROM players WHERE is_guessable = 1"
            ).fetchone()[0]
        )
        return {
            "generatedAt": _now(),
            "summary": {
                "players": counts["players"],
                "guessablePlayers": guessable_players,
                "teams": counts["teams"],
                "majors": counts["major_events"],
                "majorAppearances": counts["major_appearances"],
                "criticalIssues": len(critical_issues),
                "warnings": len(warnings),
            },
            "criticalIssues": critical_issues,
            "warnings": warnings,
            "majorRosterExceptions": roster_exceptions,
            "duplicateNicknames": duplicate_nicknames,
            "missingAvatarPlayers": missing_avatar_players,
            "currentTeamsMissingLogo": teams_missing_logo,
        }

    def audit(self, player_id: str | None = None) -> dict[str, Any]:
        if player_id is None:
            counts = {}
            for table in (
                "players",
                "teams",
                "player_team_tenures",
                "player_roles",
                "major_events",
                "major_appearances",
                "source_records",
                "field_evidence",
                "merge_conflicts",
            ):
                counts[table] = int(
                    self.connection.execute(
                        f"SELECT COUNT(*) AS count FROM {table}"
                    ).fetchone()["count"]
                )
            sources = {
                row["source"]: int(row["record_count"])
                for row in self.connection.execute(
                    """
                    SELECT source, COUNT(*) AS record_count
                    FROM source_records
                    GROUP BY source
                    ORDER BY source
                    """
                )
            }
            conflicts = {
                status: 0
                for status in ("open", "automatic", "manual", "ignored")
            }
            conflicts.update(
                {
                    row["resolution_status"]: int(row["conflict_count"])
                    for row in self.connection.execute(
                        """
                        SELECT resolution_status, COUNT(*) AS conflict_count
                        FROM merge_conflicts
                        GROUP BY resolution_status
                        """
                    )
                }
            )
            guessability_row = self.connection.execute(
                """
                SELECT
                    SUM(CASE WHEN is_guessable = 1 THEN 1 ELSE 0 END)
                        AS guessable,
                    SUM(CASE WHEN is_guessable = 0 THEN 1 ELSE 0 END)
                        AS excluded
                FROM players
                """
            ).fetchone()
            guessability = {
                "guessable": int(guessability_row["guessable"] or 0),
                "excluded": int(guessability_row["excluded"] or 0),
            }
            return {
                "counts": counts,
                "sources": sources,
                "conflicts": conflicts,
                "guessability": guessability,
            }

        player = self.connection.execute(
            "SELECT * FROM players WHERE id = ?", (player_id,)
        ).fetchone()
        if player is None:
            raise KeyError(f"unknown player: {player_id}")
        source_ids = [
            {
                "source": row["source"],
                "external_id": row["external_id"],
                "source_url": row["source_url"],
            }
            for row in self.connection.execute(
                """
                SELECT source, external_id, source_url
                FROM player_source_ids
                WHERE player_id = ?
                ORDER BY source, external_id
                """,
                (player_id,),
            )
        ]
        source_records = {
            row["source"]: int(row["record_count"])
            for row in self.connection.execute(
                """
                SELECT sr.source, COUNT(DISTINCT sr.id) AS record_count
                FROM source_records sr
                JOIN field_evidence fe ON fe.source_record_id = sr.id
                WHERE fe.entity_type = 'player' AND fe.entity_id = ?
                GROUP BY sr.source
                ORDER BY sr.source
                """,
                (player_id,),
            )
        }
        evidence = [
            {
                "field_name": row["field_name"],
                "value": json.loads(row["normalized_value_json"]),
                "source": row["source"],
                "selected": bool(row["is_selected"]),
                "observed_at": row["observed_at"],
            }
            for row in self.connection.execute(
                """
                SELECT fe.field_name, fe.normalized_value_json,
                       fe.is_selected, fe.observed_at, sr.source
                FROM field_evidence fe
                JOIN source_records sr ON sr.id = fe.source_record_id
                WHERE fe.entity_type = 'player' AND fe.entity_id = ?
                ORDER BY fe.field_name, sr.source, fe.id
                """,
                (player_id,),
            )
        ]
        conflicts = [
            {
                "entity_type": row["entity_type"],
                "entity_id": row["entity_id"],
                "field_name": row["field_name"],
                "candidates": json.loads(row["candidate_values_json"]),
                "resolution_status": row["resolution_status"],
                "resolved_value": (
                    json.loads(row["resolved_value_json"])
                    if row["resolved_value_json"] is not None
                    else None
                ),
                "created_at": row["created_at"],
                "resolved_at": row["resolved_at"],
            }
            for row in self.connection.execute(
                """
                SELECT entity_type, entity_id, field_name,
                       candidate_values_json, resolution_status,
                       resolved_value_json, created_at, resolved_at
                FROM merge_conflicts
                WHERE (entity_type = 'player' AND entity_id = ?)
                   OR (
                       entity_type = 'major_appearance'
                       AND entity_id LIKE ?
                   )
                ORDER BY field_name, id
                """,
                (player_id, f"{player_id}:%"),
            )
        ]
        current_team_row = self._current_team_row(player_id)
        current_team = (
            {
                "id": current_team_row["id"],
                "name": current_team_row["canonical_name"],
                "short_name": current_team_row["short_name"],
            }
            if current_team_row is not None
            else None
        )
        roles = [
            {
                "kind": row["role_kind"],
                "value": row["role"],
                "primary": bool(row["is_primary"]),
                "valid_from": row["valid_from"],
                "valid_to": row["valid_to"],
            }
            for row in self._role_rows(player_id)
        ]
        tenures = [
            {
                "id": row["id"],
                "team_id": row["team_id"],
                "team_name": row["canonical_name"],
                "kind": row["membership_kind"],
                "from": row["start_value"],
                "from_precision": row["start_precision"],
                "to": row["end_value"],
                "to_precision": row["end_precision"],
                "current": bool(row["is_current"]),
                "primary": bool(row["is_primary"]),
            }
            for row in self.connection.execute(
                """
                SELECT tenure.*, team.canonical_name
                FROM player_team_tenures tenure
                JOIN teams team ON team.id = tenure.team_id
                WHERE tenure.player_id = ?
                ORDER BY tenure.is_current DESC, tenure.start_value DESC
                """,
                (player_id,),
            )
        ]
        major_appearances = [
            {
                "major_id": row["major_id"],
                "major_name": row["canonical_name"],
                "starts_on": row["starts_on"],
                "participation_kind": row["participation_kind"],
                "team_id": row["team_id"],
                "placement": row["placement"],
                "matches_played": row["matches_played"],
                "counts_toward_total": bool(row["counts_toward_total"]),
            }
            for row in self.connection.execute(
                """
                SELECT appearance.*, major.canonical_name, major.starts_on
                FROM major_appearances appearance
                JOIN major_events major ON major.id = appearance.major_id
                WHERE appearance.player_id = ?
                ORDER BY major.starts_on, major.id
                """,
                (player_id,),
            )
        ]
        return {
            "player": dict(player),
            "source_ids": source_ids,
            "source_records": source_records,
            "evidence": evidence,
            "conflicts": conflicts,
            "current_team": current_team,
            "roles": roles,
            "team_history": tenures,
            "major_appearances": major_appearances,
            "major_appearances_total": sum(
                1
                for appearance in major_appearances
                if appearance["counts_toward_total"]
            ),
        }
