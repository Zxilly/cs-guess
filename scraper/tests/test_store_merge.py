import sqlite3
from pathlib import Path

import pytest

from cs_guess_scraper.store import PlayerStore

SCHEMA_PATH = Path(__file__).parents[1] / "schema.sql"


def test_opening_legacy_database_migrates_provider_constraints(tmp_path):
    db_path = tmp_path / "legacy.sqlite3"
    legacy_schema = SCHEMA_PATH.read_text(encoding="utf-8").replace(
        "'balldontlie', ",
        "",
    )
    connection = sqlite3.connect(db_path)
    connection.executescript(legacy_schema)
    connection.close()

    with PlayerStore(db_path, schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "balldontlie",
            {
                "external_id": "294",
                "nickname": "ZywOo",
                "birth_date": "2000-11-09",
            },
        )

    assert player_id.startswith("player_")


def test_source_player_ingestion_is_auditable_and_keeps_provider_id_separate(tmp_path):
    db_path = tmp_path / "players.sqlite3"

    with PlayerStore(db_path, schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "external_id": "12345",
                "nickname": "device",
                "full_name": "Nicolai Reedtz",
                "country_code": "DK",
                "birth_date": "1995-09-08",
            },
            {
                "source_url": "https://api.pandascore.co/players/12345",
                "fetched_at": "2026-07-27T10:00:00Z",
                "payload": {"id": 12345, "name": "device"},
            },
        )

        report = store.audit(player_id)

    assert player_id.startswith("player_")
    assert player_id != "12345"
    assert report["player"]["id"] == player_id
    assert report["player"]["canonical_nickname"] == "device"
    assert report["source_ids"] == [
        {
            "source": "pandascore",
            "external_id": "12345",
            "source_url": "https://api.pandascore.co/players/12345",
        }
    ]
    assert report["source_records"]["pandascore"] == 1
    assert {
        item["field_name"] for item in report["evidence"]
    } >= {"nickname", "full_name", "country_code", "birth_date"}


def test_merge_cleans_html_separated_legal_name_aliases(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Ahang (Zheng Hang)",
                "nickname": "Ahang",
                "full_name": "Zheng Hang<br>Zheng Ruihang",
            },
        )

        store.merge_all()
        report = store.audit(player_id)

    assert report["player"]["full_name"] == "Zheng Hang"


def test_rechecking_unchanged_source_updates_fetch_freshness_not_record_count(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        parsed = {"external_id": "ZywOo", "nickname": "ZywOo"}
        store.upsert_source_player(
            "liquipedia",
            parsed,
            {
                "fetched_at": "2026-07-27T01:00:00Z",
                "source_modified_at": "2026-07-20T01:00:00Z",
                "source_revision_id": "100",
            },
        )
        store.upsert_source_player(
            "liquipedia",
            parsed,
            {
                "fetched_at": "2026-07-27T02:00:00Z",
                "source_modified_at": "2026-07-20T01:00:00Z",
                "source_revision_id": "100",
            },
        )
        row = store.connection.execute(
            """
            SELECT fetched_at, source_modified_at, source_revision_id
            FROM source_records
            WHERE source = 'liquipedia' AND record_type = 'player'
            """
        ).fetchone()
        count = store.connection.execute(
            "SELECT COUNT(*) FROM source_records"
        ).fetchone()[0]

    assert count == 1
    assert dict(row) == {
        "fetched_at": "2026-07-27T02:00:00Z",
        "source_modified_at": "2026-07-20T01:00:00Z",
        "source_revision_id": "100",
    }


def test_merge_resolves_exact_identity_and_preserves_field_conflicts(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        pandascore_id = store.upsert_source_player(
            "pandascore",
            {
                "external_id": "12345",
                "nickname": "dev1ce",
                "full_name": "Nicolai Reedtz",
                "country_code": "DK",
                "birth_date": "1995-09-08",
            },
            {"fetched_at": "2026-07-27T09:00:00Z"},
        )
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "device",
                "nickname": "device",
                "full_name": "Nicolai Reedtz",
                "country_code": "DK",
                "birth_date": "1995-09-08",
            },
            {"fetched_at": "2026-07-27T10:00:00Z"},
        )

        assert pandascore_id != liquipedia_id

        result = store.merge_all()
        merged_id = store.resolve_player_id("pandascore", "12345")
        report = store.audit(merged_id)

        assert result["players_merged"] == 1
        assert store.resolve_player_id("liquipedia", "device") == merged_id
        assert report["player"]["canonical_nickname"] == "device"
        assert {item["source"] for item in report["source_ids"]} == {
            "liquipedia",
            "pandascore",
        }
        nickname_conflict = next(
            item for item in report["conflicts"]
            if item["field_name"] == "nickname"
        )
        assert nickname_conflict["resolution_status"] == "automatic"
        assert nickname_conflict["resolved_value"] == "device"
        assert {
            candidate["value"] for candidate in nickname_conflict["candidates"]
        } == {"device", "dev1ce"}


def test_exact_name_and_birth_date_do_not_override_country_conflict(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "SaVage",
                "nickname": "SaVage",
                "full_name": "James Savage",
                "country_code": "AU",
                "birth_date": "2005-02-02",
            },
        )
        pandascore_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "32315",
                "nickname": "sAvAgE",
                "full_name": "James Savage",
                "country_code": "IN",
                "birth_date": "2005-02-02",
            },
        )

        result = store.merge_all()

    assert result["players_merged"] == 0
    assert store.resolve_player_id("liquipedia", "SaVage") == liquipedia_id
    assert store.resolve_player_id("pandascore", "32315") == pandascore_id


def test_exact_name_and_birth_date_do_not_collapse_same_provider_ids(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        first_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "44254",
                "nickname": "HodorS",
                "full_name": "Waseem Nowyhed",
                "country_code": "LB",
                "birth_date": "2000-01-01",
            },
        )
        second_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "58379",
                "nickname": "HodorS",
                "full_name": "Waseem Nowyhed",
                "country_code": "LB",
                "birth_date": "2000-01-01",
            },
        )

        result = store.merge_all()

    assert result["players_merged"] == 0
    assert store.resolve_player_id("pandascore", "44254") == first_id
    assert store.resolve_player_id("pandascore", "58379") == second_id


def test_complete_player_exports_current_team_tenures_and_multiple_roles(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "ZywOo",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
                "country_code": "France",
                "birth_date": "2000-11-09",
                "status": "active",
                "age": 25,
                "current_team": {
                    "external_id": "Team_Vitality",
                    "name": "Team Vitality",
                    "short_name": "VIT",
                    "country_code": "FR",
                    "from": "2018-10",
                    "from_precision": "month",
                },
                "team_history": [
                    {
                        "team": {
                            "external_id": "against_All_authority",
                            "name": "against All authority",
                        },
                        "kind": "active",
                        "from": "2018-02-04",
                        "from_precision": "day",
                        "to": "2018-10-08",
                        "to_precision": "day",
                    }
                ],
                "roles": [
                    {"kind": "weapon", "value": "awper", "primary": True},
                    {"kind": "tactical", "value": "igl", "primary": True},
                ],
            },
            {"fetched_at": "2026-07-27T10:00:00Z"},
        )

        result = store.merge_all()
        records = store.export_game_records()
        report = store.audit(player_id)

    assert result["guessable"] == 1
    assert len(records) == 1
    record = records[0]
    assert record["schemaVersion"] == 1
    assert record["id"] == player_id
    assert record["countryCode"] == "FR"
    assert record["birthDate"] == "2000-11-09"
    assert "age" not in record
    assert record["currentTeam"] == {
        "id": report["current_team"]["id"],
        "name": "Team Vitality",
        "shortName": "VIT",
    }
    assert record["role"] == "IGL"
    assert record["roles"] == [
        {"kind": "tactical", "value": "igl", "primary": True},
        {"kind": "weapon", "value": "awper", "primary": True},
    ]
    assert [
        (item["team"]["name"], item["current"])
        for item in record["teamHistory"]
    ] == [
        ("Team Vitality", True),
        ("against All authority", False),
    ]


def test_player_without_a_current_team_remains_guessable(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "retired-player",
                "nickname": "retired",
                "full_name": "Retired Player",
                "country_code": "SE",
                "birth_date": "1990-01-01",
                "status": "retired",
                "current_team": None,
                "roles": ["rifler"],
            },
        )

        result = store.merge_all()
        records = store.export_game_records()
        report = store.audit(player_id)
        quality = store.data_quality_report()

    assert result["guessable"] == 1
    assert report["player"]["is_guessable"] == 1
    assert records[0]["currentTeam"] is None
    assert "guessable_player_missing_core_data" not in {
        issue["code"] for issue in quality["criticalIssues"]
    }


def test_new_source_snapshot_without_team_clears_that_sources_old_claim(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        current = {
            "source_id": "retired-player",
            "nickname": "retired",
            "full_name": "Retired Player",
            "country_code": "SE",
            "birth_date": "1990-01-01",
            "status": "active",
            "current_team": {
                "source_id": "old-team",
                "name": "Old Team",
            },
            "roles": ["rifler"],
        }
        player_id = store.upsert_source_player(
            "pandascore",
            current,
            {"fetched_at": "2026-07-27T10:00:00Z"},
        )
        store.merge_all()
        assert store.export_game_records()[0]["currentTeam"]["name"] == "Old Team"

        store.upsert_source_player(
            "pandascore",
            {**current, "status": "retired", "current_team": None},
            {"fetched_at": "2026-07-28T10:00:00Z"},
        )
        store.merge_all()
        record = store.export_game_records()[0]
        report = store.audit(player_id)

    assert record["currentTeam"] is None
    assert all(not item["current"] for item in record["teamHistory"])
    assert report["current_team"] is None


def test_current_team_consensus_resolves_multiple_provider_claims(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "consensus-player",
                "nickname": "consensus",
                "full_name": "Consensus Player",
                "country_code": "SE",
                "birth_date": "1990-01-01",
                "current_team": {
                    "external_id": "current-team",
                    "name": "Current Team",
                },
                "roles": ["rifler"],
            },
        )
        store.link_source_player(player_id, "pandascore", "100")
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "100",
                "nickname": "consensus",
                "full_name": "Consensus Player",
                "country_code": "SE",
                "current_team": {
                    "source_id": "stale-team",
                    "name": "Stale Team",
                },
            },
        )
        store.link_source_player(player_id, "bo3", "200")
        store.upsert_source_player(
            "bo3",
            {
                "source_id": "200",
                "nickname": "consensus",
                "full_name": "Consensus Player",
                "country_code": "SE",
                "current_team": {
                    "source_id": "current-team",
                    "name": "Current Team",
                },
            },
        )

        store.merge_all()
        record = store.export_game_records()[0]
        conflict = next(
            item
            for item in store.audit(player_id)["conflicts"]
            if item["field_name"] == "current_team_id"
        )

    assert record["currentTeam"]["name"] == "Current Team"
    assert conflict["resolution_status"] == "automatic"


def test_departed_roster_label_is_retained_only_as_history(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "departed-player",
                "nickname": "departed",
                "full_name": "Departed Player",
                "country_code": "DK",
                "birth_date": "1990-01-01",
                "current_team": {
                    "external_id": "ex-old-team",
                    "name": "ex-Old Team",
                },
                "team_history": [
                    {
                        "team": {
                            "external_id": "ex-old-team",
                            "name": "ex-Old Team",
                        },
                        "current": True,
                        "from": "2020-01-01",
                        "to": "2021-01-01",
                    }
                ],
                "roles": ["rifler"],
            },
        )

        result = store.merge_all()
        record = store.export_game_records()[0]

    assert record["currentTeam"] is None
    assert record["teamHistory"][0]["team"]["name"] == "ex-Old Team"
    assert record["teamHistory"][0]["current"] is False
    assert result["departed_team_claims_retired"] == 0


def test_historical_major_player_without_a_current_role_defaults_to_rifler(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "major-legend",
                "nickname": "legend",
                "full_name": "Major Legend",
                "country_code": "SE",
                "birth_date": "1990-01-01",
                "status": "retired",
                "is_coach": True,
                "current_team": None,
                "roles": [],
            },
        )
        store.upsert_major_records(
            "liquipedia",
            [
                {
                    "external_id": "historic-major",
                    "canonical_name": "Historic Major",
                    "game_title": "csgo",
                    "starts_on": "2014-01-01",
                    "appearances": [
                        {
                            "player_external_id": "major-legend",
                            "counts_toward_total": True,
                        }
                    ],
                }
            ],
        )

        result = store.merge_all()
        records = store.export_game_records()
        report = store.audit(player_id)

    assert result["guessable"] == 1
    assert report["player"]["is_guessable"] == 1
    assert records[0]["role"] == "Rifler"


def test_reviewed_role_override_is_replayable_and_precedes_role_fallback(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "friberg",
                "nickname": "friberg",
                "full_name": "Adam Friberg",
                "country_code": "SE",
                "birth_date": "1991-10-19",
                "roles": [],
            },
        )
        store.upsert_major_records(
            "liquipedia",
            [
                {
                    "external_id": "major",
                    "canonical_name": "Historic Major",
                    "game_title": "csgo",
                    "starts_on": "2013-01-01",
                    "appearances": [
                        {
                            "player_external_id": "friberg",
                            "counts_toward_total": True,
                        }
                    ],
                }
            ],
        )
        store.merge_all()

        result = store.apply_reviewed_role_overrides(
            [
                {
                    "player": {
                        "source": "liquipedia",
                        "external_id": "friberg",
                    },
                    "role": "entry",
                    "basis": "Reviewed editorial role attribution.",
                    "evidence": [
                        {
                            "url": "https://www.hltv.org/news/35286/"
                            "is-the-entry-fragging-role-dead",
                            "source": "HLTV",
                        }
                    ],
                }
            ]
        )
        records = store.export_game_records()
        report = store.audit(player_id)

    assert result == {"applied": 1, "already_applied": 0}
    assert records[0]["role"] == "Entry"
    assert report["player"]["game_role_override"] == "entry"
    assert any(
        conflict["field_name"] == "role:reviewed_override"
        and conflict["resolution_status"] == "manual"
        for conflict in report["conflicts"]
    )


def test_reviewed_role_override_requires_a_citable_evidence_url(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "friberg",
                "nickname": "friberg",
            },
        )

        with pytest.raises(ValueError, match="source URL"):
            store.apply_reviewed_role_overrides(
                [
                    {
                        "player": {
                            "source": "liquipedia",
                            "external_id": "friberg",
                        },
                        "role": "entry",
                        "evidence": [{"source": "HLTV editorial"}],
                    }
                ]
            )


def test_partial_birth_date_is_retained_but_not_marked_guessable(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "year-only",
                "nickname": "year-only",
                "full_name": "Year Only",
                "country_code": "SE",
                "birth_date": "2003",
                "current_team": {"external_id": "team", "name": "Team"},
                "roles": ["rifler"],
            },
        )

        result = store.merge_all()
        report = store.audit(player_id)

    assert result["guessable"] == 0
    assert report["player"]["birth_date"] == "2003"
    assert report["player"]["is_guessable"] == 0
    assert "birth_date_full" in report["player"]["exclusion_reason"]


def test_major_total_is_derived_from_idempotent_appearance_records(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "ZywOo",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
                "country_code": "FR",
                "birth_date": "2000-11-09",
                "current_team": {
                    "external_id": "Team_Vitality",
                    "name": "Team Vitality",
                },
                "roles": ["awper"],
            },
            {"fetched_at": "2026-07-27T10:00:00Z"},
        )
        majors = [
            {
                "external_id": "blast-paris-2023",
                "canonical_name": "BLAST.tv Paris Major 2023",
                "game_title": "csgo",
                "starts_on": "2023-05-08",
                "ends_on": "2023-05-21",
                "appearances": [
                    {
                        "player_external_id": "ZywOo",
                        "team_external_id": "Team_Vitality",
                        "participation_kind": "participant",
                        "placement": "1",
                        "matches_played": 10,
                        "counts_toward_total": True,
                    }
                ],
            },
            {
                "external_id": "pgl-stockholm-2021",
                "canonical_name": "PGL Major Stockholm 2021",
                "game_title": "csgo",
                "starts_on": "2021-10-26",
                "appearances": [
                    {
                        "player_external_id": "ZywOo",
                        "participation_kind": "registered_only",
                        "counts_toward_total": False,
                    }
                ],
            },
        ]

        first = store.upsert_major_records(
            "liquipedia",
            majors,
            {"fetched_at": "2026-07-27T11:00:00Z"},
        )
        second = store.upsert_major_records(
            "liquipedia",
            majors,
            {"fetched_at": "2026-07-27T11:00:00Z"},
        )
        store.merge_all()
        record = store.export_game_records()[0]
        report = store.audit(player_id)

    assert first == {"events": 2, "appearances": 2, "unresolved_players": []}
    assert second == first
    assert record["majorAppearances"] == 1
    assert report["major_appearances_total"] == 1
    assert [
        (item["major_name"], item["counts_toward_total"])
        for item in report["major_appearances"]
    ] == [
        ("PGL Major Stockholm 2021", False),
        ("BLAST.tv Paris Major 2023", True),
    ]


def test_reviewed_major_winner_marks_every_player_on_winning_team(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        for external_id, nickname in (("NiKo", "NiKo"), ("m0NESY", "m0NESY")):
            store.upsert_source_player(
                "liquipedia",
                {
                    "external_id": external_id,
                    "nickname": nickname,
                    "full_name": nickname,
                    "country_code": "BA",
                    "birth_date": "1997-02-16",
                    "current_team": {
                        "external_id": "falcons",
                        "name": "Falcons",
                    },
                    "roles": ["rifler"],
                },
            )
        store.upsert_major_records(
            "liquipedia",
            [
                {
                    "external_id": "Intel_Extreme_Masters/2026/Cologne",
                    "canonical_name": "IEM Cologne Major 2026",
                    "game_title": "cs2",
                    "starts_on": "2026-06-02",
                    "appearances": [
                        {
                            "player_external_id": "NiKo",
                            "team_external_id": "falcons",
                        },
                        {
                            "player_external_id": "m0NESY",
                            "team_external_id": "falcons",
                        },
                    ],
                }
            ],
        )
        store.merge_all()

        first = store.apply_reviewed_major_winners(
            [
                {
                    "major": {
                        "source": "liquipedia",
                        "external_id": "Intel_Extreme_Masters/2026/Cologne",
                    },
                    "team": {
                        "source": "liquipedia",
                        "external_id": "falcons",
                    },
                    "source_url": (
                        "https://www.hltv.org/events/8301/"
                        "iem-cologne-major-2026"
                    ),
                }
            ]
        )
        second = store.apply_reviewed_major_winners(
            [
                {
                    "major": {
                        "source": "liquipedia",
                        "external_id": "Intel_Extreme_Masters/2026/Cologne",
                    },
                    "team": {
                        "source": "liquipedia",
                        "external_id": "falcons",
                    },
                    "source_url": (
                        "https://www.hltv.org/events/8301/"
                        "iem-cologne-major-2026"
                    ),
                }
            ]
        )
        records = {
            record["nickname"]: record
            for record in store.export_game_records()
        }

    assert first == {"events": 1, "appearances": 2}
    assert second == first
    assert records["NiKo"]["majorWins"] == 1
    assert records["m0NESY"]["majorWins"] == 1


def test_reviewed_major_appearance_can_add_and_correct_roster_rows(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        for external_id in ("chrisJ", "kioShiMa"):
            store.upsert_source_player(
                "liquipedia",
                {
                    "external_id": external_id,
                    "nickname": external_id,
                    "full_name": external_id,
                    "birth_date": "1990-01-01",
                },
            )
        store.upsert_major_records(
            "liquipedia",
            [
                {
                    "external_id": "ESL/One/2016/Cologne",
                    "canonical_name": "ESL One Cologne 2016",
                    "game_title": "csgo",
                    "starts_on": "2016-07-05",
                    "appearances": [
                        {
                            "player_external_id": "kioShiMa",
                            "team": {
                                "external_id": "envyus",
                                "name": "EnVyUs",
                            },
                        }
                    ],
                }
            ],
        )
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "team-link",
                "nickname": "team-link",
                "current_team": {
                    "external_id": "faze",
                    "name": "FaZe",
                },
            },
        )
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "team-link-2",
                "nickname": "team-link-2",
                "current_team": {
                    "external_id": "mousesports",
                    "name": "mousesports",
                },
            },
        )
        store.merge_all()

        first = store.apply_reviewed_major_appearances(
            [
                {
                    "major": {
                        "source": "liquipedia",
                        "external_id": "ESL/One/2016/Cologne",
                    },
                    "player": {
                        "source": "liquipedia",
                        "external_id": "kioShiMa",
                    },
                    "team": {
                        "source": "liquipedia",
                        "external_id": "faze",
                    },
                    "overrides": {"placement": "9-12"},
                },
                {
                    "major": {
                        "source": "liquipedia",
                        "external_id": "ESL/One/2016/Cologne",
                    },
                    "player": {
                        "source": "liquipedia",
                        "external_id": "chrisJ",
                    },
                    "team": {
                        "source": "liquipedia",
                        "external_id": "mousesports",
                    },
                    "overrides": {"placement": "9-12"},
                },
            ]
        )
        second = store.apply_reviewed_major_appearances(
            [
                {
                    "major": {
                        "source": "liquipedia",
                        "external_id": "ESL/One/2016/Cologne",
                    },
                    "player": {
                        "source": "liquipedia",
                        "external_id": "kioShiMa",
                    },
                    "team": {
                        "source": "liquipedia",
                        "external_id": "faze",
                    },
                    "overrides": {"placement": "9-12"},
                },
                {
                    "major": {
                        "source": "liquipedia",
                        "external_id": "ESL/One/2016/Cologne",
                    },
                    "player": {
                        "source": "liquipedia",
                        "external_id": "chrisJ",
                    },
                    "team": {
                        "source": "liquipedia",
                        "external_id": "mousesports",
                    },
                    "overrides": {"placement": "9-12"},
                },
            ]
        )
        rows = list(
            store.connection.execute(
                """
                SELECT player.canonical_nickname, team.canonical_name,
                       appearance.placement
                FROM major_appearances appearance
                JOIN players player ON player.id = appearance.player_id
                JOIN teams team ON team.id = appearance.team_id
                ORDER BY player.canonical_nickname
                """
            )
        )

    assert first == {"reviewed": 2, "created": 1, "updated": 1}
    assert second == {"reviewed": 2, "created": 0, "updated": 2}
    assert [tuple(row) for row in rows] == [
        ("chrisJ", "mousesports", "9-12"),
        ("kioShiMa", "FaZe", "9-12"),
    ]


def test_data_quality_report_flags_incomplete_major_rosters(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        for index in range(4):
            store.upsert_source_player(
                "liquipedia",
                {
                    "external_id": f"player-{index}",
                    "nickname": f"player-{index}",
                    "full_name": f"Player {index}",
                    "country_code": "DK",
                    "birth_date": "2000-01-01",
                    "current_team": {
                        "external_id": "team-a",
                        "name": "Team A",
                    },
                    "roles": ["rifler"],
                },
            )
        store.upsert_major_records(
            "liquipedia",
            [
                {
                    "external_id": "major-a",
                    "canonical_name": "Major A",
                    "game_title": "cs2",
                    "starts_on": "2026-01-01",
                    "appearances": [
                        {
                            "player_external_id": f"player-{index}",
                            "team_external_id": "team-a",
                            "placement": "1",
                        }
                        for index in range(4)
                    ],
                }
            ],
        )
        store.merge_all()
        report = store.data_quality_report()

    assert report["summary"]["guessablePlayers"] == 4
    assert report["summary"]["criticalIssues"] == 2
    assert {
        issue["code"] for issue in report["criticalIssues"]
    } == {
        "major_winner_roster_size",
        "underfilled_major_roster",
    }


def test_merge_matches_exact_nickname_birth_country_across_stale_teams(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        survivor_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Snax",
                "nickname": "Snax",
                "full_name": "Janusz Andrzej Pogorzelski",
                "country_code": "PL",
                "birth_date": "1993-07-05",
                "current_team": {
                    "external_id": "g2",
                    "name": "G2",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "external_id": "17502",
                "nickname": "Snax-",
                "full_name": "Janusz Pogorzelski",
                "country_code": "PL",
                "birth_date": "1993-07-05",
                "image_url": "https://cdn.example/snax.png",
                "current_team": {
                    "external_id": "mouz",
                    "name": "MOUZ",
                },
            },
        )

        result = store.merge_all()
        players = list(store.connection.execute("SELECT * FROM players"))
        pandascore_id = store.resolve_player_id("pandascore", "17502")

    assert result["high_confidence_identity_merges"] == 1
    assert len(players) == 1
    assert pandascore_id == survivor_id
    assert players[0]["image_url"] == "https://cdn.example/snax.png"


def test_merge_accepts_exact_name_nickname_country_with_provider_date_typo(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        survivor_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "shox",
                "nickname": "shox",
                "full_name": "Richard Papillon",
                "country_code": "FR",
                "birth_date": "1992-05-27",
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "external_id": "17513",
                "nickname": "shox",
                "full_name": "Richard Papillon",
                "country_code": "FR",
                "birth_date": "1997-05-27",
            },
        )

        result = store.merge_all()
        player = store.connection.execute(
            "SELECT birth_date FROM players WHERE id = ?",
            (survivor_id,),
        ).fetchone()

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "17513") == survivor_id
    assert player["birth_date"] == "1992-05-27"


def test_major_player_reference_matches_liquipedia_title_case_insensitively(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "S1mple",
                "nickname": "s1mple",
                "full_name": "Oleksandr Kostyliev",
                "birth_date": "1997-10-02",
            },
        )

        result = store.upsert_major_records(
            "liquipedia",
            [
                {
                    "external_id": "example-major",
                    "canonical_name": "Example Major",
                    "game_title": "csgo",
                    "starts_on": "2020-01-01",
                    "appearances": [
                        {
                            "player_external_id": "s1mple",
                            "counts_toward_total": True,
                        }
                    ],
                }
            ],
        )

    assert result["appearances"] == 1
    assert result["unresolved_players"] == []
    assert player_id


def test_strong_platform_id_reuses_canonical_player_before_nickname_matching(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        first_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "player-page",
                "nickname": "shared",
                "full_name": "First Person",
                "birth_date": "1990-01-01",
                "platform_ids": {"steam": "76561198000000001"},
            },
        )
        second_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "999",
                "nickname": "totally-different",
                "platform_ids": {"steam": "76561198000000001"},
            },
        )
        report = store.audit(first_id)

    assert second_id == first_id
    assert {
        (item["source"], item["external_id"]) for item in report["source_ids"]
    } == {
        ("liquipedia", "player-page"),
        ("pandascore", "999"),
        ("steam", "76561198000000001"),
    }


def test_targeted_fallback_source_can_be_linked_to_known_canonical_player(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {"external_id": "ZywOo", "nickname": "ZywOo"},
        )

        store.link_source_player(
            player_id,
            "hltv",
            "11893",
            source_url="https://www.hltv.org/player/11893/zywoo",
        )
        linked_id = store.upsert_source_player(
            "hltv",
            {
                "external_id": "11893",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
            },
        )

    assert linked_id == player_id


def test_nickname_and_current_team_match_is_queued_not_auto_merged(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        first_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "first-page",
                "nickname": "duplicate",
                "current_team": {"external_id": "same-team", "name": "Same Team"},
            },
        )
        second_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "222",
                "nickname": "duplicate",
                "current_team": {"source_id": "333", "name": "Same Team"},
            },
        )

        result = store.merge_all()
        first_report = store.audit(first_id)
        global_report = store.audit()

    assert first_id != second_id
    assert result["players_merged"] == 0
    assert result["identity_reviews"] == 1
    identity_conflict = next(
        item
        for item in first_report["conflicts"]
        if item["field_name"] == "identity:nickname_current_team"
    )
    assert identity_conflict["resolution_status"] == "open"
    assert {
        candidate["player_id"] for candidate in identity_conflict["candidates"]
    } == {first_id, second_id}
    assert global_report["conflicts"]["open"] == 2
    assert global_report["sources"]["liquipedia"] > 0
    assert global_report["sources"]["pandascore"] > 0
    assert global_report["guessability"]["excluded"] == 2


def test_nickname_and_team_alias_match_is_queued_for_review(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        first_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "first-alias-page",
                "nickname": "review-alias",
                "current_team": {
                    "external_id": "Alias_Team_Gaming",
                    "name": "Alias Team Gaming",
                },
            },
        )
        second_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "223",
                "nickname": "review-alias",
                "current_team": {
                    "source_id": "334",
                    "name": "alias team",
                },
            },
        )

        result = store.merge_all()
        first_report = store.audit(first_id)

    assert first_id != second_id
    assert result["players_merged"] == 0
    assert result["identity_reviews"] == 1
    identity_conflict = next(
        item
        for item in first_report["conflicts"]
        if item["field_name"] == "identity:nickname_current_team"
    )
    assert identity_conflict["resolution_status"] == "open"
    assert {
        candidate["current_team_signature"]
        for candidate in identity_conflict["candidates"]
    } == {"alias"}


def test_cross_source_identity_with_matching_biography_is_auto_merged(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Player_Page",
                "nickname": "same-player",
                "full_name": "Álvaro de Souza",
                "country_code": "BR",
                "birth_date": "2001-02-03",
                "current_team": {
                    "external_id": "Same_Team",
                    "name": "Same Team",
                },
            },
        )
        pandascore_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "222",
                "nickname": "same-player",
                "full_name": "Alvaro de Souza",
                "country_code": "BR",
                "current_team": {"source_id": "333", "name": "Same Team"},
            },
        )

        result = store.merge_all()
        report = store.audit(liquipedia_id)

    assert pandascore_id != liquipedia_id
    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "222") == liquipedia_id
    decision = next(
        item
        for item in report["conflicts"]
        if item["field_name"] == "identity:high_confidence_cross_source"
    )
    assert decision["resolution_status"] == "automatic"
    assert decision["resolved_value"] == liquipedia_id


def test_cross_source_identity_accepts_only_a_full_name_token_reordering(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Chinese_Player",
                "nickname": "reordered",
                "full_name": "Wang Guoliang",
                "country_code": "CN",
                "current_team": {
                    "external_id": "Same_Team",
                    "name": "Same Team",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "224",
                "nickname": "reordered",
                "full_name": "Guoliang Wang",
                "country_code": "CN",
                "current_team": {"source_id": "334", "name": "Same Team"},
            },
        )

        result = store.merge_all()

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "224") == liquipedia_id


def test_cross_source_identity_accepts_generic_team_suffix_alias(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Z4kr",
                "nickname": "z4kr",
                "full_name": "Zhang Sike",
                "country_code": "CN",
                "birth_date": "2002-11-14",
                "status": "active",
                "current_team": {
                    "external_id": "Lynn_Vision_Gaming",
                    "name": "Lynn Vision Gaming",
                },
                "roles": ["awper"],
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "24434",
                "nickname": "z4kr",
                "full_name": "Sike Zhang",
                "country_code": "CN",
                "current_team": {
                    "source_id": "126439",
                    "name": "lynn vision",
                    "image_url": (
                        "https://files.bo3.gg/uploads/team/476/image/team.webp"
                    ),
                },
            },
        )

        result = store.merge_all()
        records = store.export_game_records()

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "24434") == liquipedia_id
    assert records[0]["currentTeam"]["name"] == "Lynn Vision Gaming"
    assert records[0]["currentTeam"]["logoUrl"].endswith("/team.webp")


def test_export_uses_best_fields_from_global_team_alias_group(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquid_player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Liquid_Player",
                "nickname": "liquid-player",
                "full_name": "Liquid Player",
                "country_code": "US",
                "birth_date": "2000-01-02",
                "status": "active",
                "current_team": {
                    "external_id": "Team_Liquid",
                    "name": "Team Liquid",
                },
                "roles": ["rifler"],
            },
        )
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Liquid_Bridge",
                "nickname": "liquid-bridge",
                "full_name": "Liquid Bridge",
                "country_code": "US",
                "current_team": {
                    "external_id": "Team_Liquid",
                    "name": "Team Liquid",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "999",
                "nickname": "liquid-bridge",
                "full_name": "Liquid Bridge",
                "country_code": "US",
                "current_team": {
                    "source_id": "100",
                    "name": "liquid",
                    "image_url": "https://cdn.example.com/liquid.png",
                },
            },
        )

        store.merge_all()
        record = next(
            item
            for item in store.export_game_records()
            if item["id"] == liquid_player_id
        )

    assert record["currentTeam"]["name"] == "Team Liquid"
    assert record["currentTeam"]["logoUrl"] == (
        "https://cdn.example.com/liquid.png"
    )


def test_export_does_not_share_assets_between_unconfirmed_team_names(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        phoenix_player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Phoenix_Player",
                "nickname": "phoenix-player",
                "full_name": "Phoenix Player",
                "country_code": "US",
                "birth_date": "2000-01-02",
                "status": "active",
                "current_team": {
                    "external_id": "Team_Phoenix",
                    "name": "Team Phoenix",
                },
                "roles": ["rifler"],
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "998",
                "nickname": "unrelated-player",
                "current_team": {
                    "source_id": "101",
                    "name": "Phoenix Esports",
                    "image_url": "https://cdn.example.com/other-phoenix.png",
                },
            },
        )

        store.merge_all()
        record = next(
            item
            for item in store.export_game_records()
            if item["id"] == phoenix_player_id
        )

    assert record["currentTeam"]["name"] == "Team Phoenix"
    assert "logoUrl" not in record["currentTeam"]


def test_cross_source_identity_accepts_conservative_legal_name_variants(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "s1mple",
                "nickname": "s1mple",
                "full_name": "Oleksandr Olehovych Kostyliev",
                "country_code": "UA",
                "birth_date": "1997-10-02",
                "current_team": {
                    "external_id": "BC_Game",
                    "name": "BC.Game",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "41",
                "nickname": "s1mple",
                "full_name": "Aleksandr Kostyliev",
                "country_code": "UA",
                "current_team": {"source_id": "512", "name": "BC.Game"},
            },
        )

        result = store.merge_all()
        report = store.audit(liquipedia_id)

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "41") == liquipedia_id
    decision = next(
        item
        for item in report["conflicts"]
        if item["field_name"] == "identity:high_confidence_cross_source"
    )
    assert {
        candidate["match_basis"] for candidate in decision["candidates"]
    } == {"compatible_legal_name_tokens"}


def test_cross_source_identity_accepts_exact_birth_date_when_names_diverge(
    tmp_path,
):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "AdreN (Kazakh player)",
                "nickname": "adreN",
                "full_name": "Däuren Qystaubaev",
                "country_code": "KZ",
                "birth_date": "1990-02-04",
                "current_team": {
                    "external_id": "Same_Team",
                    "name": "Same Team",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "17533",
                "nickname": "adreN",
                "full_name": "Dauren Kystaubayev",
                "country_code": "KZ",
                "birth_date": "1990-02-04",
                "current_team": {"source_id": "335", "name": "Same Team"},
            },
        )

        result = store.merge_all()
        report = store.audit(liquipedia_id)

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "17533") == liquipedia_id
    decision = next(
        item
        for item in report["conflicts"]
        if item["field_name"] == "identity:high_confidence_cross_source"
    )
    assert {
        candidate["match_basis"] for candidate in decision["candidates"]
    } == {"exact_birth_date"}


def test_cross_source_identity_checks_unmerged_birth_date_evidence(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "ArT",
                "nickname": "arT",
                "full_name": "Andrei Felipe Piovezan Machado",
                "country_code": "BR",
                "birth_date": "1996-03-27",
                "current_team": {
                    "external_id": "Same_Team",
                    "name": "Same Team",
                },
            },
        )
        pandascore_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "19665",
                "nickname": "arT",
                "full_name": "Andrei Piovezan",
                "country_code": "BR",
                "current_team": {"source_id": "335", "name": "Same Team"},
            },
        )
        store.link_source_player(pandascore_id, "balldontlie", "357")
        store.upsert_source_player(
            "balldontlie",
            {
                "external_id": "357",
                "nickname": "arT",
                "full_name": "Andrei Piovezan",
                "birth_date": "1997-03-27",
            },
        )

        result = store.merge_all()

    assert result["high_confidence_identity_merges"] == 0
    assert store.resolve_player_id("liquipedia", "ArT") == liquipedia_id
    assert store.resolve_player_id("pandascore", "19665") == pandascore_id
    assert result["identity_reviews"] == 1


def test_reviewed_identity_merge_is_auditable_and_idempotent(tmp_path):
    mapping = {
        "survivor": {"source": "liquipedia", "external_id": "0SAMAS"},
        "duplicate": {"source": "pandascore", "external_id": "44168"},
        "evidence": [
            {
                "source": "hltv",
                "external_id": "22419",
                "url": "https://www.hltv.org/player/22419/0samas",
            }
        ],
    }
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        survivor_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "0SAMAS",
                "nickname": "0SAMAS",
                "country_code": "PS",
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "44168",
                "nickname": "0SAMAS",
                "country_code": "JO",
            },
        )

        first = store.apply_reviewed_identity_merges([mapping])
        second = store.apply_reviewed_identity_merges([mapping])
        report = store.audit(survivor_id)

    assert first == {"merged": 1, "already_merged": 0}
    assert second == {"merged": 0, "already_merged": 1}
    assert store.resolve_player_id("pandascore", "44168") == survivor_id
    assert store.resolve_player_id("hltv", "22419") == survivor_id
    decision = next(
        item
        for item in report["conflicts"]
        if item["field_name"] == "identity:reviewed_cross_source"
    )
    assert decision["resolution_status"] == "manual"
    assert decision["candidates"][0]["evidence"][0]["external_id"] == "22419"


def test_reviewed_identity_merge_can_apply_replayable_field_overrides(tmp_path):
    mapping = {
        "survivor": {"source": "liquipedia", "external_id": "pita"},
        "duplicate": {"source": "pandascore", "external_id": "17655"},
        "overrides": {"country_code": "BA", "is_coach": True},
    }
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        survivor_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "pita",
                "nickname": "pita",
                "country_code": "SE",
                "is_coach": False,
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "17655",
                "nickname": "pita",
                "country_code": "BA",
                "is_coach": True,
            },
        )

        first = store.apply_reviewed_identity_merges([mapping])
        second = store.apply_reviewed_identity_merges([mapping])
        store.merge_all()
        player = store.connection.execute(
            """
            SELECT country_code, is_coach
            FROM players
            WHERE id = ?
            """,
            (survivor_id,),
        ).fetchone()

    assert first == {"merged": 1, "already_merged": 0}
    assert second == {"merged": 0, "already_merged": 1}
    assert dict(player) == {"country_code": "BA", "is_coach": 1}


def test_reviewed_identity_separation_suppresses_false_positive_review(
    tmp_path,
):
    separation = {
        "left": {"source": "pandascore", "external_id": "18305"},
        "right": {"source": "pandascore", "external_id": "34589"},
        "basis": "Distinct legal names and countries.",
    }
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        for external_id, full_name, country_code in (
            ("18305", "Qingyu Deng", "CN"),
            ("34589", "Mateusz Mnich", "PL"),
        ):
            store.upsert_source_player(
                "pandascore",
                {
                    "source_id": external_id,
                    "nickname": "Monster",
                    "full_name": full_name,
                    "country_code": country_code,
                    "current_team": {
                        "source_id": "900",
                        "name": "Last Rites Gaming",
                    },
                },
            )

        before = store.merge_all()
        first = store.apply_reviewed_identity_separations([separation])
        second = store.apply_reviewed_identity_separations([separation])
        after = store.merge_all()

    assert before["identity_reviews"] == 1
    assert first == {"separated": 1, "already_separated": 0}
    assert second == {"separated": 0, "already_separated": 1}
    assert after["identity_reviews"] == 0


def test_reviewed_source_quarantine_removes_mixed_identity_evidence(tmp_path):
    quarantine = {
        "target": {"source": "balldontlie", "external_id": "4535"},
        "canonical": {"source": "pandascore", "external_id": "33530"},
        "reason": "BALLDONTLIE mixed a different legal name into this record.",
        "evidence": [
            {
                "source": "hltv",
                "external_id": "20729",
                "url": "https://www.hltv.org/player/20729/koala",
            }
        ],
    }
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "33530",
                "nickname": "Koala",
                "full_name": "João Pedro",
            },
        )
        store.link_source_player(player_id, "balldontlie", "4535")
        store.upsert_source_player(
            "balldontlie",
            {
                "external_id": "4535",
                "nickname": "Koala",
                "full_name": "Fahad Khaled Alkadyan",
                "birth_date": "2005-02-26",
                "current_team": {
                    "external_id": "83723",
                    "name": "Sharks",
                },
            },
        )

        first = store.apply_reviewed_source_quarantines([quarantine])
        second = store.apply_reviewed_source_quarantines([quarantine])
        store.merge_all()
        report = store.audit(player_id)

    assert first == {"quarantined": 1, "already_quarantined": 0}
    assert second == {"quarantined": 0, "already_quarantined": 1}
    assert report["player"]["full_name"] == "João Pedro"
    assert report["team_history"] == []
    assert any(
        item["field_name"] == "identity:quarantined_source"
        and item["resolution_status"] == "manual"
        for item in report["conflicts"]
    )
    try:
        store.resolve_player_id("balldontlie", "4535")
    except KeyError:
        pass
    else:
        raise AssertionError("quarantined provider ID still resolves")


def test_inconsistent_balldontlie_names_are_quarantined_in_bulk(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        bad_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "33530",
                "nickname": "Koala",
                "full_name": "João Pedro",
            },
        )
        store.link_source_player(bad_id, "balldontlie", "4535")
        store.upsert_source_player(
            "balldontlie",
            {
                "external_id": "4535",
                "nickname": "Koala",
                "full_name": "Fahad Khaled Alkadyan",
            },
        )
        good_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "18452",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
            },
        )
        store.link_source_player(good_id, "balldontlie", "294")
        store.upsert_source_player(
            "balldontlie",
            {
                "external_id": "294",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
            },
        )

        result = store.quarantine_inconsistent_balldontlie_identities()

    assert result == {"quarantined": 1, "already_quarantined": 0}
    assert store.resolve_player_id("balldontlie", "294") == good_id
    try:
        store.resolve_player_id("balldontlie", "4535")
    except KeyError:
        pass
    else:
        raise AssertionError("mixed BALLDONTLIE identity was not quarantined")


def test_hltv_can_triangulate_a_shorter_pandascore_legal_name(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "KRIMZ",
                "nickname": "KRIMZ",
                "full_name": "Lars Freddy Johansson",
                "country_code": "SE",
                "birth_date": "1994-04-25",
                "current_team": {
                    "external_id": "EYEBALLERS",
                    "name": "EYEBALLERS",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "225",
                "nickname": "KRIMZ",
                "full_name": "Freddy Johansson",
                "country_code": "SE",
                "current_team": {"source_id": "335", "name": "EYEBALLERS"},
            },
        )
        store.link_source_player(liquipedia_id, "hltv", "7528")
        store.upsert_source_player(
            "hltv",
            {
                "external_id": "7528",
                "nickname": "KRIMZ",
                "full_name": "Freddy Johansson",
                "country_code": "SE",
                "current_team": {"external_id": "335", "name": "EYEBALLERS"},
            },
        )

        result = store.merge_all()
        report = store.audit(liquipedia_id)

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "225") == liquipedia_id
    decision = next(
        item
        for item in report["conflicts"]
        if item["field_name"] == "identity:high_confidence_cross_source"
    )
    assert {
        candidate["match_basis"] for candidate in decision["candidates"]
    } == {"hltv_triangulation"}


def test_hltv_can_triangulate_a_liquipedia_nickname_alias(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "device",
                "nickname": "dev1ce",
                "full_name": "Nicolai Hvilshøj Reedtz",
                "country_code": "DK",
                "birth_date": "1995-09-08",
                "current_team": {
                    "external_id": "100_Thieves",
                    "name": "100 Thieves",
                },
            },
        )
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "226",
                "nickname": "device",
                "full_name": "Nicolai Reedtz",
                "country_code": "DK",
                "current_team": {"source_id": "336", "name": "100 Thieves"},
            },
        )
        store.link_source_player(liquipedia_id, "hltv", "7592")
        store.upsert_source_player(
            "hltv",
            {
                "external_id": "7592",
                "nickname": "device",
                "full_name": "Nicolai Reedtz",
                "country_code": "DK",
                "current_team": {"external_id": "336", "name": "100 Thieves"},
            },
        )

        result = store.merge_all()
        report = store.audit(liquipedia_id)

    assert result["high_confidence_identity_merges"] == 1
    assert store.resolve_player_id("pandascore", "226") == liquipedia_id
    decision = next(
        item
        for item in report["conflicts"]
        if item["field_name"] == "identity:high_confidence_cross_source"
    )
    assert {
        candidate["match_basis"] for candidate in decision["candidates"]
    } == {"hltv_alias_triangulation"}


def test_cross_source_identity_conflicts_remain_open_for_review(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        first_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Conflicted_Player",
                "nickname": "conflicted",
                "full_name": "Same Full Name",
                "country_code": "SE",
                "birth_date": "2001-02-03",
                "current_team": {
                    "external_id": "Same_Team",
                    "name": "Same Team",
                },
            },
        )
        second_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "225",
                "nickname": "conflicted",
                "full_name": "Same Full Name",
                "country_code": "DK",
                "birth_date": "2002-03-04",
                "current_team": {"source_id": "335", "name": "Same Team"},
            },
        )

        result = store.merge_all()

    assert result["high_confidence_identity_merges"] == 0
    assert store.resolve_player_id("liquipedia", "Conflicted_Player") == first_id
    assert store.resolve_player_id("pandascore", "225") == second_id
    assert result["identity_reviews"] == 1


def test_major_appearance_conflict_uses_liquipedia_field_precedence(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "10",
                "nickname": "player",
                "platform_ids": {"steam": "76561198000000010"},
            },
        )
        assert store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Player",
                "nickname": "player",
                "platform_ids": {"steam": "76561198000000010"},
            },
        ) == player_id
        pandascore_major = {
            "external_id": "100",
            "canonical_name": "Example Major",
            "game_title": "cs2",
            "starts_on": "2025-01-01",
            "appearances": [
                {
                    "player_external_id": "10",
                    "participation_kind": "registered_only",
                    "counts_toward_total": False,
                }
            ],
        }
        liquipedia_major = {
            "external_id": "Example_Major",
            "canonical_name": "Example Major",
            "game_title": "cs2",
            "starts_on": "2025-01-01",
            "appearances": [
                {
                    "player_external_id": "Player",
                    "participation_kind": "participant",
                    "counts_toward_total": True,
                }
            ],
        }

        store.upsert_major_records("pandascore", [pandascore_major])
        store.upsert_major_records("liquipedia", [liquipedia_major])
        store.merge_all()
        report = store.audit(player_id)

    assert report["major_appearances_total"] == 1
    assert report["major_appearances"][0]["participation_kind"] == "participant"
    assert report["major_appearances"][0]["counts_toward_total"] is True
    major_conflict = next(
        item
        for item in report["conflicts"]
        if item["entity_type"] == "major_appearance"
        and item["field_name"] == "counts_toward_total"
    )
    assert major_conflict["resolution_status"] == "automatic"
    assert major_conflict["resolved_value"] is True


def test_cross_source_current_team_claims_coalesce_into_one_tenure(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "99",
                "nickname": "history-player",
                "platform_ids": {"steam": "76561198000000099"},
                "current_team": {"source_id": "77", "name": "History Team"},
            },
        )
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "History_Player",
                "nickname": "history-player",
                "platform_ids": {"steam": "76561198000000099"},
                "current_team": {
                    "external_id": "History_Team",
                    "name": "History Team",
                },
                "team_history": [
                    {
                        "team": {
                            "external_id": "History_Team",
                            "name": "History Team",
                        },
                        "membership_kind": "active",
                        "start_value": "2024-06-01",
                        "start_precision": "day",
                        "is_current": True,
                        "is_primary": True,
                    }
                ],
            },
        )

        store.merge_all()
        report = store.audit(player_id)

    assert len(report["team_history"]) == 1
    assert report["team_history"][0]["from"] == "2024-06-01"
    assert report["team_history"][0]["from_precision"] == "day"
    assert report["team_history"][0]["current"] is True
    assert report["team_history"][0]["primary"] is True


def test_team_display_name_uses_hltv_capitalization_over_pandascore(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "99",
                "nickname": "team-name-player",
                "current_team": {"source_id": "77", "name": "vitality"},
            },
        )
        store.link_source_player(player_id, "hltv", "100")
        store.upsert_source_player(
            "hltv",
            {
                "external_id": "100",
                "nickname": "team-name-player",
                "current_team": {"external_id": "77", "name": "Vitality"},
            },
        )

        store.merge_all()
        report = store.audit(player_id)

    assert report["current_team"]["name"] == "Vitality"


def test_identity_merge_rekeys_major_evidence_before_resolving_conflict(tmp_path):
    with PlayerStore(tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH) as store:
        store.upsert_source_player(
            "pandascore",
            {
                "source_id": "42",
                "nickname": "merge-player",
                "full_name": "Merge Player",
                "birth_date": "2001-02-03",
            },
        )
        store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "Merge_Player",
                "nickname": "merge-player",
                "full_name": "Merge Player",
                "birth_date": "2001-02-03",
            },
        )
        event_base = {
            "canonical_name": "Merge Major",
            "game_title": "cs2",
            "starts_on": "2026-01-01",
        }
        store.upsert_major_records(
            "pandascore",
            [
                {
                    **event_base,
                    "external_id": "500",
                    "appearances": [
                        {
                            "player_external_id": "42",
                            "participation_kind": "registered_only",
                            "counts_toward_total": False,
                        }
                    ],
                }
            ],
        )
        store.upsert_major_records(
            "liquipedia",
            [
                {
                    **event_base,
                    "external_id": "Merge_Major",
                    "appearances": [
                        {
                            "player_external_id": "Merge_Player",
                            "participation_kind": "participant",
                            "counts_toward_total": True,
                        }
                    ],
                }
            ],
        )

        store.merge_all()
        merged_id = store.resolve_player_id("pandascore", "42")
        report = store.audit(merged_id)

    assert report["major_appearances_total"] == 1
    assert report["major_appearances"][0]["participation_kind"] == "participant"
