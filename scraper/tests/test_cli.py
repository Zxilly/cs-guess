import json

import pytest
from cs_guess_scraper.cli import main
from cs_guess_scraper.config import SettingsError
from cs_guess_scraper.store import PlayerStore


def test_audit_command_prints_database_counts(tmp_path, capsys):
    db_path = tmp_path / "players.sqlite3"
    with PlayerStore(db_path):
        pass

    result = main(["audit", "--db", str(db_path)])

    assert result == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["counts"]["players"] == 0
    assert payload["counts"]["player_team_tenures"] == 0


def test_export_command_can_include_incomplete_source_players(tmp_path, capsys):
    db_path = tmp_path / "players.sqlite3"
    output_path = tmp_path / "all-players.json"
    with PlayerStore(db_path) as store:
        store.upsert_source_player(
            "pandascore",
            {"source_id": "1", "nickname": "sparse"},
        )

    result = main(
        [
            "export",
            "--db",
            str(db_path),
            "--output",
            str(output_path),
            "--include-incomplete",
        ]
    )

    assert result == 0
    assert json.loads(output_path.read_text(encoding="utf-8"))[0][
        "nickname"
    ] == "sparse"
    assert json.loads(capsys.readouterr().out)["exportedRecords"] == 1


def test_export_command_writes_compact_shared_app_catalog(
    tmp_path, capsys, monkeypatch
):
    monkeypatch.setattr(
        "cs_guess_scraper.cli._now",
        lambda: "2026-07-30T14:19:11Z",
    )
    db_path = tmp_path / "players.sqlite3"
    output_path = tmp_path / "players.json"
    catalog_path = tmp_path / "players.generated.json"
    catalog_metadata_path = tmp_path / "players.generated.meta.json"
    with PlayerStore(db_path) as store:
        store.upsert_source_player(
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
        )
        store.merge_all()

    result = main(
        [
            "export",
            "--db",
            str(db_path),
            "--output",
            str(output_path),
            "--catalog-output",
            str(catalog_path),
            "--catalog-metadata-output",
            str(catalog_metadata_path),
        ]
    )

    assert result == 0
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    assert catalog[0]["id"] == "zywoo"
    assert catalog[0]["team"] == "Team Vitality"
    assert json.loads(catalog_metadata_path.read_text(encoding="utf-8")) == {
        "updatedAt": "2026-07-30T14:19:11Z"
    }
    assert json.loads(capsys.readouterr().out)["catalogRecords"] == 1


def test_export_refreshes_game_eligibility_before_writing_catalog(tmp_path, capsys):
    db_path = tmp_path / "players.sqlite3"
    output_path = tmp_path / "players.json"
    catalog_path = tmp_path / "players.generated.json"
    with PlayerStore(db_path) as store:
        store.upsert_source_player(
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

    result = main(
        [
            "export",
            "--db",
            str(db_path),
            "--output",
            str(output_path),
            "--catalog-output",
            str(catalog_path),
        ]
    )

    assert result == 0
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    assert catalog[0]["nickname"] == "retired"
    assert catalog[0]["team"] == "无队伍"
    assert json.loads(capsys.readouterr().out)["catalogRecords"] == 1


def test_export_applies_reviewed_role_overrides(tmp_path, capsys):
    db_path = tmp_path / "players.sqlite3"
    output_path = tmp_path / "players.json"
    reviewed_path = tmp_path / "roles.reviewed.json"
    with PlayerStore(db_path) as store:
        store.upsert_source_player(
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
                    "canonical_name": "Major",
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
    reviewed_path.write_text(
        json.dumps(
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
                            "source": "HLTV",
                            "url": "https://www.hltv.org/news/35286/"
                            "is-the-entry-fragging-role-dead",
                        }
                    ],
                }
            ]
        ),
        encoding="utf-8",
    )

    result = main(
        [
            "export",
            "--db",
            str(db_path),
            "--output",
            str(output_path),
            "--reviewed-role-overrides",
            str(reviewed_path),
        ]
    )

    assert result == 0
    assert json.loads(output_path.read_text(encoding="utf-8"))[0]["role"] == "Entry"
    assert json.loads(capsys.readouterr().out)["reviewedRoleOverrides"] == {
        "applied": 1,
        "already_applied": 0,
    }


def test_hltv_command_requires_explicit_environment_opt_in(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "PANDASCORE_API_TOKEN=test\n"
        "LIQUIPEDIA_USER_AGENT=CSGuess/test\n"
        "ALLOW_HLTV_FALLBACK=false\n",
        encoding="utf-8",
    )

    with pytest.raises(SettingsError, match="disabled"):
        main(
            [
                "hltv",
                "--db",
                str(tmp_path / "players.sqlite3"),
                "--env-file",
                str(env_path),
                "--id",
                "11893",
                "--slug",
                "zywoo",
                "--match-source",
                "liquipedia",
                "--match-external-id",
                "ZywOo",
            ]
        )


def test_hltv_batch_cross_checks_and_ingests_known_targets(
    tmp_path,
    monkeypatch,
    capsys,
):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "PANDASCORE_API_TOKEN=test\n"
        "LIQUIPEDIA_USER_AGENT=CSGuess/test\n"
        "ALLOW_HLTV_FALLBACK=true\n",
        encoding="utf-8",
    )
    db_path = tmp_path / "players.sqlite3"
    with PlayerStore(db_path) as store:
        player_id = store.upsert_source_player(
            "liquipedia",
            {
                "external_id": "ZywOo",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
                "country_code": "FR",
            },
        )
    targets_path = tmp_path / "hltv-targets.json"
    targets_path.write_text(
        json.dumps(
            [
                {
                    "hltv_id": "11893",
                    "slug": "zywoo",
                    "match_source": "liquipedia",
                    "match_external_id": "ZywOo",
                }
            ]
        ),
        encoding="utf-8",
    )

    class FakeHltvClient:
        def fetch_player(self, hltv_id, slug):
            assert (str(hltv_id), slug) == ("11893", "zywoo")
            return {
                "external_id": "11893",
                "nickname": "ZywOo",
                "full_name": "Mathieu Herbaut",
                "country": "France",
                "current_team": None,
                "team_history": [],
                "source_url": "https://www.hltv.org/player/11893/zywoo",
            }

    monkeypatch.setattr(
        "cs_guess_scraper.cli.HltvClient",
        FakeHltvClient,
    )

    result = main(
        [
            "hltv-batch",
            "--db",
            str(db_path),
            "--env-file",
            str(env_path),
            "--targets",
            str(targets_path),
        ]
    )

    assert result == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["fetched"] == 1
    assert payload["failed"] == 0
    with PlayerStore(db_path) as store:
        assert store.resolve_player_id("hltv", "11893") == player_id


def test_balldontlie_sync_requires_its_optional_api_token(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "PANDASCORE_API_TOKEN=test\n"
        "LIQUIPEDIA_USER_AGENT=CSGuess/test\n",
        encoding="utf-8",
    )

    with pytest.raises(SettingsError, match="BALLDONTLIE_API_TOKEN"):
        main(
            [
                "sync",
                "--db",
                str(tmp_path / "players.sqlite3"),
                "--env-file",
                str(env_path),
                "--source",
                "balldontlie",
                "--limit",
                "1",
            ]
        )


def test_merge_reviewed_command_applies_provider_id_mappings(tmp_path, capsys):
    db_path = tmp_path / "players.sqlite3"
    with PlayerStore(db_path) as store:
        liquipedia_id = store.upsert_source_player(
            "liquipedia",
            {"external_id": "0SAMAS", "nickname": "0SAMAS"},
        )
        store.upsert_source_player(
            "pandascore",
            {"source_id": "44168", "nickname": "0SAMAS"},
        )
    mappings_path = tmp_path / "reviewed.json"
    mappings_path.write_text(
        json.dumps(
            [
                {
                    "survivor": {
                        "source": "liquipedia",
                        "external_id": "0SAMAS",
                    },
                    "duplicate": {
                        "source": "pandascore",
                        "external_id": "44168",
                    },
                    "evidence": [
                        {
                            "source": "hltv",
                            "external_id": "22419",
                        }
                    ],
                }
            ]
        ),
        encoding="utf-8",
    )

    result = main(
        [
            "merge-reviewed",
            "--db",
            str(db_path),
            "--mappings",
            str(mappings_path),
        ]
    )

    assert result == 0
    assert json.loads(capsys.readouterr().out)["reviewed"]["merged"] == 1
    with PlayerStore(db_path) as store:
        assert store.resolve_player_id("pandascore", "44168") == liquipedia_id
