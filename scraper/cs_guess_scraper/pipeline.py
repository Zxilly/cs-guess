"""End-to-end ingestion orchestration for the canonical player store."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .app_catalog import build_app_catalog, read_previous_catalog
from .liquipedia import parse_major_player_database, parse_player_page
from .merge import (
    normalize_identity_text,
    person_name_token_signature,
    person_name_tokens_compatible,
)
from .store import PlayerStore


Progress = Callable[[str], None]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_json(path: str | Path, value: Any) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(destination)


def _begin_run(store: PlayerStore, source: str) -> str:
    run_id = f"run_{uuid.uuid4().hex}"
    with store.connection:
        store.connection.execute(
            """
            INSERT INTO ingestion_runs (
                id, source, started_at, status, records_seen, records_changed
            ) VALUES (?, ?, ?, 'running', 0, 0)
            """,
            (run_id, source, _now()),
        )
    return run_id


def _finish_run(
    store: PlayerStore,
    run_id: str,
    *,
    status: str,
    seen: int,
    changed: int,
    errors: list[dict[str, str]] | None = None,
) -> None:
    error_summary = (
        json.dumps(errors, ensure_ascii=False, separators=(",", ":"))
        if errors
        else None
    )
    with store.connection:
        store.connection.execute(
            """
            UPDATE ingestion_runs
            SET finished_at = ?, status = ?, records_seen = ?,
                records_changed = ?, error_summary = ?
            WHERE id = ?
            """,
            (_now(), status, seen, changed, error_summary, run_id),
        )


def group_liquipedia_major_records(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """Convert Liquipedia's player-oriented table rows into event records."""

    events: dict[tuple[str, str, str], dict[str, Any]] = {}
    rejected = 0
    for row in rows:
        external_id = row.get("event_external_id")
        name = row.get("event_name")
        game_title = row.get("game_title")
        starts_on = row.get("starts_on")
        player_external_id = row.get("player_external_id")
        if not all(
            (external_id, name, game_title, starts_on, player_external_id)
        ):
            rejected += 1
            continue
        key = (str(external_id), str(game_title), str(starts_on))
        event = events.setdefault(
            key,
            {
                "external_id": str(external_id),
                "canonical_name": str(name),
                "game_title": str(game_title),
                "starts_on": str(starts_on),
                "source_url": (
                    "https://liquipedia.net/counterstrike/"
                    + str(external_id).replace(" ", "_")
                ),
                "appearances": [],
            },
        )
        appearance: dict[str, Any] = {
            "player_source": "liquipedia",
            "player_external_id": str(player_external_id),
            "participation_kind": row.get(
                "participation_kind", "participant"
            ),
            "placement": row.get("placement"),
            "stage_reached": row.get("stage_reached"),
            "matches_played": row.get("matches_played"),
            "counts_toward_total": bool(
                row.get("counts_toward_total", True)
            ),
        }
        team_external_id = row.get("team_external_id")
        team_name = row.get("team_name")
        if team_external_id and team_name:
            appearance["team"] = {
                "external_id": str(team_external_id),
                "name": str(team_name),
            }
        event["appearances"].append(appearance)
    return list(events.values()), rejected


def supplement_liquipedia_major_players(
    store: PlayerStore,
    client: Any,
    rows: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Fetch known Major player titles absent from the category enumeration."""

    required = {
        str(row["player_external_id"])
        for row in rows
        if row.get("player_external_id")
    }
    existing = {
        str(row["external_id"]).replace("_", " ").strip().casefold()
        for row in store.connection.execute(
            """
            SELECT external_id
            FROM player_source_ids
            WHERE source = 'liquipedia'
            """
        )
    }
    missing = sorted(
        (
            external_id
            for external_id in required
            if external_id.replace("_", " ").strip().casefold() not in existing
        ),
        key=str.casefold,
    )
    stats: dict[str, Any] = {
        "requested": len(missing),
        "stored": 0,
        "errors": 0,
        "error_details": [],
    }
    if not missing:
        return stats

    returned: set[str] = set()
    for page in client.iter_player_pages_by_titles(missing):
        title = str(page.get("title") or "")
        requested_titles = [
            str(item)
            for item in page.get("requested_titles", [title])
            if item
        ]
        wikitext = str(page.get("wikitext") or "")
        try:
            canonical = parse_player_page(title, wikitext)
            for requested_title in requested_titles:
                returned.add(requested_title)
                parsed = {**canonical, "external_id": requested_title}
                store.upsert_source_player(
                    "liquipedia",
                    parsed,
                    {
                        "fetched_at": _now(),
                        "source_modified_at": page.get("timestamp"),
                        "source_revision_id": page.get("revid"),
                        "source_url": canonical.get("source_url"),
                        "payload_sha256": hashlib.sha256(
                            wikitext.encode("utf-8")
                        ).hexdigest(),
                    },
                )
                stats["stored"] += 1
        except (KeyError, TypeError, ValueError) as error:
            for requested_title in requested_titles:
                returned.add(requested_title)
                stats["errors"] += 1
                stats["error_details"].append(
                    {"external_id": requested_title, "error": str(error)}
                )

    for requested_title in missing:
        if requested_title not in returned:
            stats["errors"] += 1
            stats["error_details"].append(
                {
                    "external_id": requested_title,
                    "error": "Liquipedia title was missing or had no revision",
                }
            )
    return stats


def sync_liquipedia(
    store: PlayerStore,
    client: Any,
    *,
    limit: int | None = None,
    include_majors: bool = True,
    progress: Progress | None = None,
) -> dict[str, Any]:
    run_id = _begin_run(store, "liquipedia")
    stats: dict[str, Any] = {
        "seen": 0,
        "stored": 0,
        "errors": 0,
        "error_details": [],
        "major_rows": 0,
        "major_events": 0,
        "major_appearances": 0,
        "major_unresolved_players": 0,
        "major_rejected_rows": 0,
        "major_players_supplemented": 0,
        "major_player_fetch_errors": 0,
    }
    try:
        for page in client.iter_player_pages():
            if limit is not None and stats["seen"] >= limit:
                break
            stats["seen"] += 1
            title = str(page.get("title") or "")
            try:
                wikitext = str(page.get("wikitext") or "")
                parsed = parse_player_page(title, wikitext)
                store.upsert_source_player(
                    "liquipedia",
                    parsed,
                    {
                        "fetched_at": _now(),
                        "source_modified_at": page.get("timestamp"),
                        "source_revision_id": page.get("revid"),
                        "source_url": parsed.get("source_url"),
                        "payload_sha256": hashlib.sha256(
                            wikitext.encode("utf-8")
                        ).hexdigest(),
                    },
                )
                stats["stored"] += 1
            except (KeyError, TypeError, ValueError) as error:
                stats["errors"] += 1
                stats["error_details"].append(
                    {"external_id": title, "error": str(error)}
                )
            if progress and stats["seen"] % 100 == 0:
                progress(
                    "Liquipedia: "
                    f"{stats['seen']} seen, {stats['stored']} stored, "
                    f"{stats['errors']} skipped"
                )

        if include_majors:
            major_page = client.fetch_major_player_database()
            major_wikitext = str(major_page.get("wikitext") or "")
            major_rows = parse_major_player_database(major_wikitext)
            supplemental = supplement_liquipedia_major_players(
                store, client, major_rows
            )
            events, rejected = group_liquipedia_major_records(major_rows)
            major_result = store.upsert_major_records(
                "liquipedia",
                events,
                {
                    "fetched_at": _now(),
                    "payload_sha256": hashlib.sha256(
                        major_wikitext.encode("utf-8")
                    ).hexdigest(),
                },
            )
            stats["major_rows"] = len(major_rows)
            stats["major_events"] = major_result["events"]
            stats["major_appearances"] = major_result["appearances"]
            stats["major_unresolved_players"] = len(
                major_result["unresolved_players"]
            )
            stats["major_rejected_rows"] = rejected
            stats["major_players_supplemented"] = supplemental["stored"]
            stats["major_player_fetch_errors"] = supplemental["errors"]
            stats["error_details"].extend(supplemental["error_details"])
            if progress:
                progress(
                    "Liquipedia Majors: "
                    f"{len(major_rows)} rows, "
                    f"{major_result['appearances']} linked appearances"
                )
    except Exception as error:
        stats["error_details"].append(
            {"external_id": "*source*", "error": str(error)}
        )
        _finish_run(
            store,
            run_id,
            status="failed",
            seen=stats["seen"],
            changed=stats["stored"],
            errors=stats["error_details"],
        )
        raise

    partial = (
        stats["errors"] > 0
        or stats["major_rejected_rows"] > 0
        or stats["major_unresolved_players"] > 0
        or stats["major_player_fetch_errors"] > 0
    )
    _finish_run(
        store,
        run_id,
        status="partial" if partial else "succeeded",
        seen=stats["seen"] + stats["major_rows"],
        changed=stats["stored"] + stats["major_appearances"],
        errors=stats["error_details"],
    )
    return stats


def sync_pandascore(
    store: PlayerStore,
    client: Any,
    *,
    limit: int | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    run_id = _begin_run(store, "pandascore")
    stats: dict[str, Any] = {
        "seen": 0,
        "stored": 0,
        "errors": 0,
        "error_details": [],
    }
    try:
        for parsed in client.iter_cs_players():
            if limit is not None and stats["seen"] >= limit:
                break
            stats["seen"] += 1
            external_id = parsed.get("source_id") or parsed.get("external_id")
            try:
                store.upsert_source_player(
                    "pandascore",
                    parsed,
                    {
                        "fetched_at": _now(),
                        "source_modified_at": parsed.get("modified_at"),
                        "source_url": (
                            "https://api.pandascore.co/csgo/players/"
                            f"{external_id}"
                        ),
                        "payload": dict(parsed),
                    },
                )
                stats["stored"] += 1
            except (KeyError, TypeError, ValueError) as error:
                stats["errors"] += 1
                stats["error_details"].append(
                    {"external_id": str(external_id), "error": str(error)}
                )
            if progress and stats["seen"] % 500 == 0:
                progress(
                    "PandaScore: "
                    f"{stats['seen']} seen, {stats['stored']} stored, "
                    f"{stats['errors']} skipped"
                )
    except Exception as error:
        stats["error_details"].append(
            {"external_id": "*source*", "error": str(error)}
        )
        _finish_run(
            store,
            run_id,
            status="failed",
            seen=stats["seen"],
            changed=stats["stored"],
            errors=stats["error_details"],
        )
        raise

    _finish_run(
        store,
        run_id,
        status="partial" if stats["errors"] else "succeeded",
        seen=stats["seen"],
        changed=stats["stored"],
        errors=stats["error_details"],
    )
    return stats


def sync_balldontlie(
    store: PlayerStore,
    client: Any,
    *,
    limit: int | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """Enrich known PandaScore players with verified BALLDONTLIE records."""
    run_id = _begin_run(store, "balldontlie")
    stats: dict[str, Any] = {
        "seen": 0,
        "stored": 0,
        "linked_pandascore": 0,
        "unmatched": 0,
        "errors": 0,
        "error_details": [],
    }
    try:
        for parsed in client.iter_cs_players():
            if limit is not None and stats["seen"] >= limit:
                break
            stats["seen"] += 1
            external_id = parsed.get("external_id")
            pandascore_external_id = parsed.get("pandascore_external_id")
            try:
                pandascore_player = store.connection.execute(
                    """
                    SELECT p.id, p.canonical_nickname, p.full_name
                    FROM player_source_ids source_id
                    JOIN players p ON p.id = source_id.player_id
                    WHERE source_id.source = 'pandascore'
                      AND source_id.external_id = ?
                    """,
                    (str(pandascore_external_id),),
                ).fetchone()
                if pandascore_player is None:
                    stats["unmatched"] += 1
                    continue
                nickname_matches = normalize_identity_text(
                    pandascore_player["canonical_nickname"]
                ) == normalize_identity_text(parsed.get("nickname"))
                parsed_name = person_name_token_signature(
                    parsed.get("full_name")
                )
                pandascore_name = person_name_token_signature(
                    pandascore_player["full_name"]
                )
                name_matches = bool(parsed_name) and bool(pandascore_name) and (
                    parsed_name == pandascore_name
                    or person_name_tokens_compatible(
                        parsed.get("full_name"),
                        pandascore_player["full_name"],
                    )
                )
                names_conflict = (
                    bool(parsed_name)
                    and bool(pandascore_name)
                    and not name_matches
                )
                if names_conflict or (
                    not nickname_matches and not name_matches
                ):
                    stats["errors"] += 1
                    stats["error_details"].append(
                        {
                            "external_id": str(external_id),
                            "error": (
                                "vendor PandaScore ID contradicted the "
                                "canonical nickname or full name"
                            ),
                        }
                    )
                    continue
                player_id = str(pandascore_player["id"])
                source_url = (
                    "https://api.balldontlie.io/cs/v1/players/"
                    f"{external_id}"
                )
                store.link_source_player(
                    player_id,
                    "balldontlie",
                    str(external_id),
                    source_url=source_url,
                )
                store.upsert_source_player(
                    "balldontlie",
                    parsed,
                    {
                        "fetched_at": _now(),
                        "source_url": source_url,
                        "payload": dict(parsed),
                    },
                )
                stats["stored"] += 1
                stats["linked_pandascore"] += 1
            except (KeyError, TypeError, ValueError) as error:
                stats["errors"] += 1
                stats["error_details"].append(
                    {"external_id": str(external_id), "error": str(error)}
                )
            if progress and stats["seen"] % 500 == 0:
                progress(
                    "BALLDONTLIE: "
                    f"{stats['seen']} seen, {stats['stored']} linked, "
                    f"{stats['unmatched']} unmatched"
                )
    except Exception as error:
        stats["error_details"].append(
            {"external_id": "*source*", "error": str(error)}
        )
        _finish_run(
            store,
            run_id,
            status="failed",
            seen=stats["seen"],
            changed=stats["stored"],
            errors=stats["error_details"],
        )
        raise
    _finish_run(
        store,
        run_id,
        status="partial" if stats["errors"] else "succeeded",
        seen=stats["seen"],
        changed=stats["stored"],
        errors=stats["error_details"],
    )
    return stats


def sync_bo3(
    store: PlayerStore,
    client: Any,
    *,
    limit: int | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """Enrich existing identities with conservatively matched bo3.gg data."""
    run_id = _begin_run(store, "bo3")
    stats: dict[str, Any] = {
        "seen": 0,
        "stored": 0,
        "linked_pandascore": 0,
        "linked_exact_profile": 0,
        "unmatched": 0,
        "errors": 0,
        "error_details": [],
    }
    try:
        for parsed in client.iter_cs_players():
            if limit is not None and stats["seen"] >= limit:
                break
            stats["seen"] += 1
            external_id = parsed.get("source_id") or parsed.get("external_id")
            try:
                player_id: str | None = None
                match_basis: str | None = None
                pandascore_external_id = parsed.get(
                    "pandascore_external_id"
                )
                if pandascore_external_id is not None:
                    pandascore_player = store.connection.execute(
                        """
                        SELECT p.id, p.canonical_nickname, p.full_name
                        FROM player_source_ids source_id
                        JOIN players p ON p.id = source_id.player_id
                        WHERE source_id.source = 'pandascore'
                          AND source_id.external_id = ?
                        """,
                        (str(pandascore_external_id),),
                    ).fetchone()
                    if pandascore_player is not None:
                        nickname_matches = normalize_identity_text(
                            pandascore_player["canonical_nickname"]
                        ) == normalize_identity_text(parsed.get("nickname"))
                        parsed_name = person_name_token_signature(
                            parsed.get("full_name")
                        )
                        known_name = person_name_token_signature(
                            pandascore_player["full_name"]
                        )
                        name_matches = bool(parsed_name) and bool(
                            known_name
                        ) and (
                            parsed_name == known_name
                            or person_name_tokens_compatible(
                                parsed.get("full_name"),
                                pandascore_player["full_name"],
                            )
                        )
                        names_conflict = (
                            bool(parsed_name)
                            and bool(known_name)
                            and not name_matches
                        )
                        if names_conflict or (
                            not nickname_matches and not name_matches
                        ):
                            raise ValueError(
                                "bo3 ps_id contradicted the canonical "
                                "nickname or full name"
                            )
                        player_id = str(pandascore_player["id"])
                        match_basis = "pandascore"

                if player_id is None:
                    candidates = []
                    for candidate in store.connection.execute(
                        """
                        SELECT
                            p.id, p.canonical_nickname, p.full_name,
                            p.country_code, p.birth_date,
                            current_team.canonical_name AS current_team_name
                        FROM players p
                        LEFT JOIN player_current_primary_teams current
                          ON current.player_id = p.id
                        LEFT JOIN teams current_team
                          ON current_team.id = current.team_id
                        WHERE p.canonical_nickname = ? COLLATE NOCASE
                        """,
                        (str(parsed.get("nickname") or ""),),
                    ):
                        if normalize_identity_text(
                            candidate["canonical_nickname"]
                        ) != normalize_identity_text(parsed.get("nickname")):
                            continue
                        parsed_name = person_name_token_signature(
                            parsed.get("full_name")
                        )
                        candidate_name = person_name_token_signature(
                            candidate["full_name"]
                        )
                        if not parsed_name or parsed_name != candidate_name:
                            continue
                        birth_matches = bool(parsed.get("birth_date")) and (
                            str(parsed.get("birth_date"))
                            == str(candidate["birth_date"] or "")
                        )
                        country_matches = bool(
                            parsed.get("country_code")
                        ) and (
                            str(parsed.get("country_code")).upper()
                            == str(candidate["country_code"] or "").upper()
                        )
                        parsed_team = parsed.get("current_team")
                        parsed_team_name = (
                            parsed_team.get("name")
                            if isinstance(parsed_team, Mapping)
                            else None
                        )
                        team_matches = bool(parsed_team_name) and (
                            normalize_identity_text(parsed_team_name)
                            == normalize_identity_text(
                                candidate["current_team_name"]
                            )
                        )
                        if birth_matches or (
                            country_matches and team_matches
                        ):
                            candidates.append(str(candidate["id"]))
                    if len(candidates) == 1:
                        player_id = candidates[0]
                        match_basis = "exact_profile"

                if player_id is None:
                    stats["unmatched"] += 1
                    continue
                slug = str(parsed.get("slug") or external_id)
                source_url = f"https://bo3.gg/players/{slug}"
                store.link_source_player(
                    player_id,
                    "bo3",
                    str(external_id),
                    source_url=source_url,
                )
                if parsed.get("current_team") is None:
                    store.clear_source_current_team(
                        player_id,
                        "bo3",
                        str(external_id),
                    )
                store.upsert_source_player(
                    "bo3",
                    parsed,
                    {
                        "fetched_at": _now(),
                        "source_modified_at": parsed.get("modified_at"),
                        "source_url": source_url,
                        "payload": dict(parsed),
                    },
                )
                stats["stored"] += 1
                stats[f"linked_{match_basis}"] += 1
            except (KeyError, TypeError, ValueError) as error:
                stats["errors"] += 1
                stats["error_details"].append(
                    {"external_id": str(external_id), "error": str(error)}
                )
            if progress and stats["seen"] % 500 == 0:
                progress(
                    "bo3.gg: "
                    f"{stats['seen']} seen, {stats['stored']} linked, "
                    f"{stats['unmatched']} unmatched"
                )
    except Exception as error:
        stats["error_details"].append(
            {"external_id": "*source*", "error": str(error)}
        )
        _finish_run(
            store,
            run_id,
            status="failed",
            seen=stats["seen"],
            changed=stats["stored"],
            errors=stats["error_details"],
        )
        raise
    _finish_run(
        store,
        run_id,
        status="partial" if stats["errors"] else "succeeded",
        seen=stats["seen"],
        changed=stats["stored"],
        errors=stats["error_details"],
    )
    return stats


def run_sync(
    store: PlayerStore,
    *,
    liquipedia_client: Any | None = None,
    pandascore_client: Any | None = None,
    balldontlie_client: Any | None = None,
    bo3_client: Any | None = None,
    limit: int | None = None,
    include_majors: bool = True,
    output_path: str | Path | None = None,
    catalog_output_path: str | Path | None = None,
    report_path: str | Path | None = None,
    progress: Progress | None = None,
) -> dict[str, Any]:
    """Synchronize configured sources, merge identities, and export game data."""

    report: dict[str, Any] = {
        "startedAt": _now(),
        "finishedAt": None,
        "scope": {
            "limitPerSource": limit,
            "includeMajors": include_majors,
        },
        "sources": {},
        "merge": {},
        "audit": {},
        "exportedRecords": 0,
        "catalogRecords": 0,
    }
    if liquipedia_client is not None:
        report["sources"]["liquipedia"] = sync_liquipedia(
            store,
            liquipedia_client,
            limit=limit,
            include_majors=include_majors,
            progress=progress,
        )
    if pandascore_client is not None:
        report["sources"]["pandascore"] = sync_pandascore(
            store,
            pandascore_client,
            limit=limit,
            progress=progress,
        )
    if balldontlie_client is not None:
        report["sources"]["balldontlie"] = sync_balldontlie(
            store,
            balldontlie_client,
            limit=limit,
            progress=progress,
        )
    if bo3_client is not None:
        report["sources"]["bo3"] = sync_bo3(
            store,
            bo3_client,
            limit=limit,
            progress=progress,
        )

    merge_run_id = _begin_run(store, "merge")
    try:
        report["merge"] = store.merge_all()
    except Exception as error:
        _finish_run(
            store,
            merge_run_id,
            status="failed",
            seen=0,
            changed=0,
            errors=[{"external_id": "*merge*", "error": str(error)}],
        )
        raise
    _finish_run(
        store,
        merge_run_id,
        status="succeeded",
        seen=report["merge"].get("guessable", 0),
        changed=report["merge"].get("players_merged", 0),
    )

    records = store.export_game_records()
    report["audit"] = store.audit()
    report["exportedRecords"] = len(records)
    report["finishedAt"] = _now()
    if output_path is not None:
        _write_json(output_path, records)
    if catalog_output_path is not None:
        catalog = build_app_catalog(
            records,
            previous_catalog=read_previous_catalog(catalog_output_path),
        )
        _write_json(catalog_output_path, catalog)
        report["catalogRecords"] = len(catalog)
    if report_path is not None:
        _write_json(report_path, report)
    return report
