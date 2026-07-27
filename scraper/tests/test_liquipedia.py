from pathlib import Path
from urllib.parse import parse_qs, urlparse

from cs_guess_scraper.liquipedia import (
    LiquipediaClient,
    parse_major_player_database,
    parse_player_page,
)


FIXTURES = Path(__file__).parent / "fixtures" / "liquipedia"


class StubTransport:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def __call__(self, url, headers):
        self.requests.append((url, headers))
        return next(self.responses)


def test_iter_player_pages_follows_mediawiki_continue_and_returns_revisions():
    transport = StubTransport(
        [
            {
                "continue": {
                    "gcmcontinue": "page|53494d50|1",
                    "continue": "gcmcontinue||",
                },
                "query": {
                    "pages": [
                        {
                            "title": "S1mple",
                            "revisions": [
                                {
                                    "revid": 101,
                                    "timestamp": "2026-07-26T12:00:00Z",
                                    "slots": {"main": {"content": "{{Infobox player}}"}},
                                }
                            ],
                        }
                    ]
                },
            },
            {
                "batchcomplete": True,
                "query": {
                    "pages": [
                        {
                            "title": "ZywOo",
                            "revisions": [
                                {
                                    "revid": 102,
                                    "timestamp": "2026-07-26T13:00:00Z",
                                    "slots": {"main": {"content": "{{Infobox player}}"}},
                                }
                            ],
                        }
                    ]
                },
            },
        ]
    )
    client = LiquipediaClient(
        "CSGuess/0.1 (contact@example.com)",
        transport=transport,
        min_interval=0,
    )

    pages = list(client.iter_player_pages())

    assert pages == [
        {
            "title": "S1mple",
            "wikitext": "{{Infobox player}}",
            "revid": 101,
            "timestamp": "2026-07-26T12:00:00Z",
        },
        {
            "title": "ZywOo",
            "wikitext": "{{Infobox player}}",
            "revid": 102,
            "timestamp": "2026-07-26T13:00:00Z",
        },
    ]
    first_query = parse_qs(urlparse(transport.requests[0][0]).query)
    second_query = parse_qs(urlparse(transport.requests[1][0]).query)
    assert first_query["generator"] == ["categorymembers"]
    assert first_query["gcmtitle"] == ["Category:Players"]
    assert first_query["gcmnamespace"] == ["0"]
    assert first_query["prop"] == ["revisions"]
    assert first_query["rvprop"] == ["ids|timestamp|content"]
    assert "gcmcontinue" not in first_query
    assert second_query["gcmcontinue"] == ["page|53494d50|1"]
    assert transport.requests[0][1]["User-Agent"] == (
        "CSGuess/0.1 (contact@example.com)"
    )
    assert transport.requests[0][1]["Accept-Encoding"] == "gzip"


def test_fetch_major_player_database_returns_revision_metadata_and_wikitext():
    transport = StubTransport(
        [
            {
                "batchcomplete": True,
                "query": {
                    "pages": [
                        {
                            "title": "Majors/Player Database",
                            "revisions": [
                                {
                                    "revid": 999,
                                    "timestamp": "2026-07-27T01:02:03Z",
                                    "slots": {
                                        "main": {"content": "real database wikitext"}
                                    },
                                }
                            ],
                        }
                    ]
                },
            }
        ]
    )
    client = LiquipediaClient(
        "CSGuess/0.1 (contact@example.com)",
        transport=transport,
        min_interval=0,
    )

    page = client.fetch_major_player_database()

    assert page == {
        "title": "Majors/Player Database",
        "wikitext": "real database wikitext",
        "revid": 999,
        "timestamp": "2026-07-27T01:02:03Z",
    }
    query = parse_qs(urlparse(transport.requests[0][0]).query)
    assert query["titles"] == ["Majors/Player Database"]
    assert query["rvprop"] == ["ids|timestamp|content"]


def test_iter_player_pages_by_titles_preserves_requested_redirect_aliases():
    transport = StubTransport(
        [
            {
                "batchcomplete": True,
                "query": {
                    "normalized": [{"from": "device", "to": "Device"}],
                    "redirects": [{"from": "Device", "to": "Dev1ce"}],
                    "pages": [
                        {
                            "title": "Dev1ce",
                            "revisions": [
                                {
                                    "revid": 200,
                                    "timestamp": "2026-07-27T02:00:00Z",
                                    "slots": {
                                        "main": {"content": "{{Infobox player}}"}
                                    },
                                }
                            ],
                        },
                        {"title": "Missing", "missing": True},
                    ],
                },
            }
        ]
    )
    client = LiquipediaClient(
        "CSGuess/0.1 (contact@example.com)",
        transport=transport,
        min_interval=0,
    )

    pages = list(client.iter_player_pages_by_titles(["device", "Missing"]))

    assert pages == [
        {
            "title": "Dev1ce",
            "requested_titles": ["device"],
            "wikitext": "{{Infobox player}}",
            "revid": 200,
            "timestamp": "2026-07-27T02:00:00Z",
        }
    ]
    query = parse_qs(urlparse(transport.requests[0][0]).query)
    assert query["titles"] == ["device|Missing"]
    assert query["redirects"] == ["1"]


def test_iter_player_pages_replaces_obsolete_mediawiki_continue_tokens():
    empty_query = {"query": {"pages": []}}
    transport = StubTransport(
        [
            {
                **empty_query,
                "continue": {
                    "rvcontinue": "101|0",
                    "gcmcontinue": "page|41|1",
                    "continue": "rvcontinue||gcmcontinue",
                },
            },
            {
                **empty_query,
                "continue": {
                    "gcmcontinue": "page|42|2",
                    "continue": "gcmcontinue||",
                },
            },
            {**empty_query, "batchcomplete": True},
        ]
    )
    client = LiquipediaClient(
        "CSGuess/0.1 (contact@example.com)",
        transport=transport,
        min_interval=0,
    )

    assert list(client.iter_player_pages()) == []

    second_query = parse_qs(urlparse(transport.requests[1][0]).query)
    third_query = parse_qs(urlparse(transport.requests[2][0]).query)
    assert second_query["rvcontinue"] == ["101|0"]
    assert "rvcontinue" not in third_query
    assert third_query["gcmcontinue"] == ["page|42|2"]


def test_parse_player_page_extracts_normalized_identity_and_current_facts():
    wikitext = (FIXTURES / "s1mple.wiki").read_text(encoding="utf-8")

    player = parse_player_page("S1mple", wikitext)

    assert player["id"] == "s1mple"
    assert player["nickname"] == "s1mple"
    assert player["full_name"] == "Oleksandr Olehovych Kostyliev"
    assert player["native_name"] == "Олександр Олегович Костилєв"
    assert player["country"] == "Ukraine"
    assert player["birth_date"] == "1997-10-02"
    assert player["status"] == "active"
    assert player["team"] == "BC.Game Esports"
    assert player["roles"] == ["rifler", "awper"]
    assert player["source_ids"] == {
        "liquipedia": "S1mple",
        "steam": "76561198034202275",
        "faceit": "ac71ba3c-d3d4-45e7-8be2-26aa3986867d",
        "esea": "636916",
        "esl": "7574927",
        "gamersclub": "2234577",
    }


def test_parse_player_page_selects_first_name_from_html_separated_aliases():
    player = parse_player_page(
        "Ahang (Zheng Hang)",
        """
        {{Infobox player
        |id=Ahang
        |name=Zheng Hang<br>Zheng Ruihang
        |country=China
        }}
        """,
    )

    assert player["full_name"] == "Zheng Hang"


def test_parse_player_page_preserves_team_history_precision_and_membership_kind():
    wikitext = (FIXTURES / "s1mple.wiki").read_text(encoding="utf-8")

    history = parse_player_page("S1mple", wikitext)["team_history"]

    assert len(history) == 21
    assert history[0] == {
        "team": {"external_id": "LAN DODGERS", "name": "LAN DODGERS"},
        "membership_kind": "active",
        "start_value": "2013",
        "start_precision": "year",
        "end_value": "2014",
        "end_precision": "year",
        "is_current": False,
        "is_primary": False,
        "game_title": "csgo",
    }
    assert history[9] == {
        "team": {
            "external_id": "Evolution (Belarusian team)",
            "name": "Evolution",
        },
        "membership_kind": "loan",
        "start_value": "2015-07-20",
        "start_precision": "day",
        "end_value": "2015-07-26",
        "end_precision": "day",
        "is_current": False,
        "is_primary": False,
        "game_title": "csgo",
    }
    assert history[12]["membership_kind"] == "standin"
    assert history[17]["game_title"] == "cs2"
    assert history[-1] == {
        "team": {"external_id": "BC.Game Esports", "name": "BC.Game Esports"},
        "membership_kind": "active",
        "start_value": "2025-07-28",
        "start_precision": "day",
        "end_value": None,
        "end_precision": "unknown",
        "is_current": True,
        "is_primary": True,
        "game_title": "cs2",
    }


def test_parse_retired_teamless_player_normalizes_dates_and_game_history():
    wikitext = (FIXTURES / "-ace.wiki").read_text(encoding="utf-8")

    player = parse_player_page("-Ace", wikitext)

    assert player["nickname"] == "-Ace"
    assert player["full_name"] == "Brandon Winn"
    assert "native_name" not in player
    assert player["birth_date"] == "1995-04-07"
    assert player["status"] == "retired"
    assert player["current_team"] is None
    assert player["roles"] == ["awper"]
    assert player["team_history"][0]["start_value"] == "2016"
    assert player["team_history"][0]["start_precision"] == "year"
    assert player["team_history"][0]["game_title"] == "csgo"
    assert player["team_history"][-2]["membership_kind"] == "inactive"
    assert player["team_history"][-1]["membership_kind"] == "loan"


def test_parse_deceased_player_maps_liquipedia_status_to_canonical_value():
    wikitext = (FIXTURES / "bullen.wiki").read_text(encoding="utf-8")

    player = parse_player_page("Bullen", wikitext)

    assert player["status"] == "deceased"
    assert player["death_date"] == "2011-08-19"
    assert all(
        tenure["game_title"] == "counter-strike"
        for tenure in player["team_history"]
    )


def test_parse_major_database_returns_one_auditable_record_per_appearance():
    wikitext = (FIXTURES / "major-player-database.wiki").read_text(
        encoding="utf-8"
    )

    appearances = parse_major_player_database(wikitext)

    assert len(appearances) == 12
    assert appearances[0] == {
        "player_external_id": "AdreN (Kazakh player)",
        "player_nickname": "AdreN",
        "player_country": "kz",
        "event_external_id": "DreamHack/2013/Winter",
        "event_name": "DreamHack Winter 2013",
        "game_title": "csgo",
        "starts_on": "2013-11-28",
        "team_external_id": "astana dragons",
        "team_name": "astana dragons",
        "participation_kind": "participant",
        "placement": "5-8",
        "stage_reached": None,
        "counts_toward_total": True,
    }
    assert appearances[1]["placement"] == "1"
    assert appearances[2]["player_external_id"] == "Jame"
    assert appearances[2]["placement"] is None
    assert appearances[-1]["event_external_id"] == (
        "Intel_Extreme_Masters/2026/Cologne"
    )
    assert appearances[-1]["game_title"] == "cs2"
    assert appearances[-1]["starts_on"] == "2026-06-02"
