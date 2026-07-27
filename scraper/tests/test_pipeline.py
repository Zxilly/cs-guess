import json
from pathlib import Path

from cs_guess_scraper.pipeline import (
    group_liquipedia_major_records,
    run_sync,
    supplement_liquipedia_major_players,
)
from cs_guess_scraper.store import PlayerStore

FIXTURES = Path(__file__).parent / "fixtures"
SCHEMA_PATH = Path(__file__).parents[1] / "schema.sql"


class FakeLiquipediaClient:
    def iter_player_pages(self):
        yield {
            "title": "S1mple",
            "wikitext": (
                FIXTURES / "liquipedia" / "s1mple.wiki"
            ).read_text(encoding="utf-8"),
            "revid": 101,
            "timestamp": "2026-07-27T01:00:00Z",
        }
        yield {
            "title": "Not a player",
            "wikitext": "This category member has no player infobox.",
            "revid": 102,
            "timestamp": "2026-07-27T01:01:00Z",
        }

    def fetch_major_player_database(self):
        return {
            "title": "Majors/Player Database",
            "wikitext": "",
            "revid": 103,
            "timestamp": "2026-07-27T01:02:00Z",
        }


class FakePandaScoreClient:
    def iter_cs_players(self):
        yield {
            "source": "pandascore",
            "source_id": "777",
            "nickname": "s1mple-alt",
            "full_name": "Oleksandr Olehovych Kostyliev",
            "country_code": "UA",
            "birth_date": "1997-10-02",
            "age": 28,
            "image_url": "https://example.test/s1mple.png",
            "active": True,
            "current_team": {
                "source": "pandascore",
                "source_id": "99",
                "name": "BC.Game Esports",
            },
            "modified_at": "2026-07-27T00:00:00Z",
        }


class FakeBallDontLieClient:
    def iter_cs_players(self):
        yield {
            "source": "balldontlie",
            "external_id": "294",
            "nickname": "ZywOo",
            "full_name": "Mathieu Herbaut",
            "birth_date": "2000-11-09",
            "age": 25,
            "active": True,
            "current_team": {
                "source": "balldontlie",
                "external_id": "650",
                "name": "Vitality",
                "short_name": "VIT",
            },
            "pandascore_external_id": "18452",
        }


class FakeBo3Client:
    def iter_cs_players(self):
        yield {
            "source": "bo3",
            "source_id": "36613",
            "slug": "0samas",
            "nickname": "0SAMAS",
            "full_name": "Osama Orabi",
            "country_code": "PS",
            "birth_date": "2002-04-10",
            "image_url": "https://files.bo3.gg/0samas.webp",
            "active": True,
            "is_coach": False,
            "pandascore_external_id": None,
            "current_team": {
                "source": "bo3",
                "source_id": "3869",
                "slug": "jijiehao",
                "name": "JiJieHao",
            },
            "modified_at": "2026-07-27T08:31:15.331+08:00",
        }


def test_major_rows_are_grouped_into_store_events():
    events, rejected = group_liquipedia_major_records(
        [
            {
                "player_external_id": "ZywOo",
                "event_external_id": "BLAST/Major/2023",
                "event_name": "BLAST.tv Paris Major 2023",
                "game_title": "csgo",
                "starts_on": "2023-05-08",
                "team_external_id": "Team_Vitality",
                "team_name": "Team Vitality",
                "placement": "1",
                "participation_kind": "participant",
                "counts_toward_total": True,
            },
            {
                "player_external_id": "apEX",
                "event_external_id": "BLAST/Major/2023",
                "event_name": "BLAST.tv Paris Major 2023",
                "game_title": "csgo",
                "starts_on": "2023-05-08",
                "team_external_id": "Team_Vitality",
                "team_name": "Team Vitality",
                "placement": "1",
                "participation_kind": "participant",
                "counts_toward_total": True,
            },
            {
                "player_external_id": "unknown",
                "event_external_id": "Broken",
                "event_name": "Broken",
                "game_title": "cs2",
                "starts_on": None,
            },
        ]
    )

    assert rejected == 1
    assert len(events) == 1
    assert events[0]["external_id"] == "BLAST/Major/2023"
    assert events[0]["canonical_name"] == "BLAST.tv Paris Major 2023"
    assert [item["player_external_id"] for item in events[0]["appearances"]] == [
        "ZywOo",
        "apEX",
    ]
    assert events[0]["appearances"][0]["team"] == {
        "external_id": "Team_Vitality",
        "name": "Team Vitality",
    }


def test_run_sync_uses_real_store_merges_sources_and_writes_auditable_report(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        "cs_guess_scraper.pipeline._now",
        lambda: "2026-07-27T03:00:00Z",
    )
    db_path = tmp_path / "players.sqlite3"
    output_path = tmp_path / "players.json"
    report_path = tmp_path / "sync-report.json"

    with PlayerStore(db_path, schema_path=SCHEMA_PATH) as store:
        report = run_sync(
            store,
            liquipedia_client=FakeLiquipediaClient(),
            pandascore_client=FakePandaScoreClient(),
            output_path=output_path,
            report_path=report_path,
        )
        audit = store.audit()
        records = store.export_game_records()
        source_ids = store.connection.execute(
            "SELECT source, external_id FROM player_source_ids "
            "WHERE source IN ('liquipedia', 'pandascore') "
            "ORDER BY source"
        ).fetchall()
        runs = store.connection.execute(
            "SELECT source, status, records_seen FROM ingestion_runs "
            "ORDER BY source"
        ).fetchall()
        liquipedia_record = store.connection.execute(
            """
            SELECT fetched_at, source_modified_at, source_revision_id
            FROM source_records
            WHERE source = 'liquipedia' AND record_type = 'player'
            """
        ).fetchone()

    assert report["sources"]["liquipedia"]["seen"] == 2
    assert report["sources"]["liquipedia"]["stored"] == 1
    assert report["sources"]["liquipedia"]["errors"] == 1
    assert report["sources"]["pandascore"]["stored"] == 1
    assert report["merge"]["players_merged"] == 1
    assert audit["counts"]["players"] == 1
    assert [(row["source"], row["external_id"]) for row in source_ids] == [
        ("liquipedia", "S1mple"),
        ("pandascore", "777"),
    ]
    assert [(row["source"], row["status"]) for row in runs] == [
        ("liquipedia", "partial"),
        ("merge", "succeeded"),
        ("pandascore", "succeeded"),
    ]
    assert dict(liquipedia_record) == {
        "fetched_at": "2026-07-27T03:00:00Z",
        "source_modified_at": "2026-07-27T01:00:00Z",
        "source_revision_id": "101",
    }
    assert records[0]["nickname"] == "s1mple"
    assert records[0]["countryCode"] == "UA"
    assert records[0]["teamHistory"]
    assert json.loads(output_path.read_text(encoding="utf-8")) == records
    assert json.loads(report_path.read_text(encoding="utf-8")) == report


def test_balldontlie_sync_links_verified_pandascore_id_and_fills_birth_date(
    tmp_path,
):
    with PlayerStore(
        tmp_path / "players.sqlite3",
        schema_path=SCHEMA_PATH,
    ) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "18452",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
                "country_code": "FR",
                "current_team": {
                    "source_id": "3455",
                    "name": "Vitality",
                },
            },
        )

        report = run_sync(
            store,
            balldontlie_client=FakeBallDontLieClient(),
        )
        player = store.audit(player_id)

    assert report["sources"]["balldontlie"]["stored"] == 1
    assert report["sources"]["balldontlie"]["linked_pandascore"] == 1
    assert player["player"]["birth_date"] == "2000-11-09"
    assert {
        (item["source"], item["external_id"])
        for item in player["source_ids"]
    } >= {
        ("pandascore", "18452"),
        ("balldontlie", "294"),
    }


def test_balldontlie_sync_rejects_nickname_match_with_conflicting_legal_name(
    tmp_path,
):
    class ConflictingBallDontLieClient:
        def iter_cs_players(self):
            yield {
                "source": "balldontlie",
                "external_id": "4535",
                "nickname": "Koala",
                "full_name": "Fahad Khaled Alkadyan",
                "birth_date": "2002-08-01",
                "active": True,
                "current_team": {
                    "source": "balldontlie",
                    "external_id": "900",
                    "name": "Sharks",
                },
                "pandascore_external_id": "33530",
            }

    with PlayerStore(
        tmp_path / "players.sqlite3",
        schema_path=SCHEMA_PATH,
    ) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "33530",
                "nickname": "Koala",
                "full_name": "João Pedro",
            },
        )

        report = run_sync(
            store,
            balldontlie_client=ConflictingBallDontLieClient(),
        )

    assert report["sources"]["balldontlie"]["stored"] == 0
    assert report["sources"]["balldontlie"]["errors"] == 1
    assert store.resolve_player_id("pandascore", "33530") == player_id
    try:
        store.resolve_player_id("balldontlie", "4535")
    except KeyError:
        pass
    else:
        raise AssertionError("conflicting BALLDONTLIE identity was linked")


def test_bo3_sync_links_an_exact_profile_without_creating_a_duplicate(
    tmp_path,
):
    with PlayerStore(
        tmp_path / "players.sqlite3",
        schema_path=SCHEMA_PATH,
    ) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "source_id": "0SAMAS",
                "nickname": "0SAMAS",
                "full_name": "Osama Orabi",
                "country_code": "PS",
                "birth_date": "2002-04-10",
                "current_team": {
                    "source_id": "JiJieHao",
                    "name": "JiJieHao",
                },
                "roles": [{"kind": "weapon", "value": "rifler"}],
            },
        )

        report = run_sync(store, bo3_client=FakeBo3Client())
        audit = store.audit(player_id)

    assert report["sources"]["bo3"] == {
        "seen": 1,
        "stored": 1,
        "linked_pandascore": 0,
        "linked_exact_profile": 1,
        "unmatched": 0,
        "errors": 0,
        "error_details": [],
    }
    assert audit["player"]["birth_date"] == "2002-04-10"
    assert ("bo3", "36613") in {
        (item["source"], item["external_id"])
        for item in audit["source_ids"]
    }
    assert report["audit"]["counts"]["players"] == 1


def test_bo3_current_coach_is_excluded_from_the_player_pool(tmp_path):
    class CoachBo3Client:
        def iter_cs_players(self):
            record = next(FakeBo3Client().iter_cs_players())
            yield {**record, "is_coach": True}

    with PlayerStore(
        tmp_path / "players.sqlite3",
        schema_path=SCHEMA_PATH,
    ) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "source_id": "0SAMAS",
                "nickname": "0SAMAS",
                "full_name": "Osama Orabi",
                "country_code": "PS",
                "birth_date": "2002-04-10",
                "current_team": {
                    "source_id": "JiJieHao",
                    "name": "JiJieHao",
                },
                "roles": [{"kind": "weapon", "value": "rifler"}],
            },
        )

        run_sync(store, bo3_client=CoachBo3Client())
        player = store.audit(player_id)["player"]

    assert player["is_coach"] == 1
    assert player["is_guessable"] == 0
    assert player["exclusion_reason"] == "not_player:coach"


def test_bo3_sync_removes_a_stale_current_team_claim(tmp_path):
    class RecordsClient:
        def __init__(self, record):
            self.record = record

        def iter_cs_players(self):
            yield self.record

    current = {
        "source": "bo3",
        "source_id": "500",
        "slug": "known-player",
        "nickname": "known",
        "full_name": "Known Player",
        "country_code": "US",
        "birth_date": "2000-01-01",
        "active": True,
        "is_coach": False,
        "pandascore_external_id": "999",
        "current_team": {
            "source": "bo3",
            "source_id": "50",
            "slug": "old-team",
            "name": "Old Team",
            "start_value": "2024-01-01",
            "start_precision": "day",
        },
    }
    stale = {**current, "current_team": None}

    with PlayerStore(
        tmp_path / "players.sqlite3",
        schema_path=SCHEMA_PATH,
    ) as store:
        player_id = store.upsert_source_player(
            "pandascore",
            {
                "source_id": "999",
                "nickname": "known",
                "full_name": "Known Player",
                "country_code": "US",
                "birth_date": "2000-01-01",
                "roles": [{"kind": "weapon", "value": "rifler"}],
            },
        )
        run_sync(store, bo3_client=RecordsClient(current))
        assert store.export_game_records()[0]["currentTeam"]["name"] == "Old Team"

        run_sync(store, bo3_client=RecordsClient(stale))
        player = store.audit(player_id)["player"]

    assert player["is_guessable"] == 0
    assert "current_team" in player["exclusion_reason"]


def test_missing_major_players_are_fetched_by_known_title_and_linked(tmp_path):
    class KnownTitleClient:
        def iter_player_pages_by_titles(self, titles):
            assert titles == ["device"]
            yield {
                "title": "Dev1ce",
                "requested_titles": ["device"],
                "wikitext": """
                    {{Infobox player
                    |id=device
                    |name=Nicolai Hvilshøj Reedtz
                    |birth_date=1995-09-08
                    |country=Denmark
                    |status=active
                    }}
                """,
                "revid": 201,
                "timestamp": "2026-07-27T02:00:00Z",
            }

    with PlayerStore(
        tmp_path / "players.sqlite3", schema_path=SCHEMA_PATH
    ) as store:
        result = supplement_liquipedia_major_players(
            store,
            KnownTitleClient(),
            [{"player_external_id": "device"}],
        )
        player_id = store.resolve_player_id("liquipedia", "device")

    assert result == {
        "requested": 1,
        "stored": 1,
        "errors": 0,
        "error_details": [],
    }
    assert player_id.startswith("player_")
