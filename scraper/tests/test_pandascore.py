import json
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from cs_guess_scraper.pandascore import (
    PandaScoreAPIError,
    PandaScoreClient,
    parse_player,
)


FIXTURES = Path(__file__).parent / "fixtures" / "pandascore"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class StubTransport:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def __call__(self, url, headers):
        self.requests.append((url, headers))
        status, response_headers, fixture_name = next(self.responses)
        body = json.dumps(load_fixture(fixture_name)).encode()
        return status, response_headers, body


def test_parse_player_normalizes_a_complete_player():
    player = parse_player(load_fixture("player_full.json"))

    assert player == {
        "source": "pandascore",
        "source_id": "18452",
        "nickname": "ZywOo",
        "full_name": "Mathieu Herbaut",
        "country_code": "FR",
        "birth_date": "2000-11-09",
        "age": 25,
        "image_url": (
            "https://cdn-api.pandascore.co/images/player/image/18452/zywoo.png"
        ),
        "active": True,
        "current_team": {
            "source": "pandascore",
            "source_id": "3455",
            "name": "Vitality",
            "short_name": "VIT",
            "country_code": "FR",
            "image_url": (
                "https://cdn-api.pandascore.co/images/team/image/3455/vitality.png"
            ),
            "modified_at": "2026-07-17T19:47:19Z",
        },
        "modified_at": "2026-07-17T19:47:19Z",
    }


def test_parse_player_keeps_optional_fields_nullable():
    player = parse_player(load_fixture("player_sparse.json"))

    assert player == {
        "source": "pandascore",
        "source_id": "67124",
        "nickname": "demonzeal",
        "full_name": None,
        "country_code": "RU",
        "birth_date": None,
        "age": None,
        "image_url": None,
        "active": None,
        "current_team": None,
        "modified_at": None,
    }


def test_iter_cs_players_fetches_pages_until_the_last_partial_page():
    transport = StubTransport(
        [
            (200, {}, "players_page_1.json"),
            (200, {}, "players_page_2.json"),
        ]
    )
    client = PandaScoreClient(
        "test-token",
        transport=transport,
        min_interval=0,
    )

    players = list(client.iter_cs_players(per_page=2))

    assert [player["source_id"] for player in players] == ["1", "2", "3"]
    assert [player["nickname"] for player in players] == [
        "alpha",
        "bravo",
        "charlie",
    ]
    assert len(transport.requests) == 2
    first_url, first_headers = transport.requests[0]
    second_url, _ = transport.requests[1]
    assert urlparse(first_url).path == "/csgo/players"
    assert parse_qs(urlparse(first_url).query) == {
        "page": ["1"],
        "per_page": ["2"],
    }
    assert parse_qs(urlparse(second_url).query)["page"] == ["2"]
    assert first_headers["Authorization"] == "Bearer test-token"


def test_iter_cs_players_retries_a_rate_limited_page_after_retry_after(
    monkeypatch,
):
    delays = []
    monkeypatch.setattr("cs_guess_scraper.pandascore.time.sleep", delays.append)
    transport = StubTransport(
        [
            (429, {"Retry-After": "2"}, "error_rate_limit.json"),
            (200, {}, "players_page_1.json"),
        ]
    )
    client = PandaScoreClient(
        "test-token",
        transport=transport,
        min_interval=0,
    )

    players = list(client.iter_cs_players())

    assert [player["source_id"] for player in players] == ["1", "2"]
    assert len(transport.requests) == 2
    assert transport.requests[0][0] == transport.requests[1][0]
    assert delays == [2.0]


def test_iter_cs_players_stops_after_finite_server_error_retries():
    transport = StubTransport(
        [
            (503, {"Retry-After": "0"}, "error_unavailable.json"),
            (503, {"Retry-After": "0"}, "error_unavailable.json"),
            (503, {"Retry-After": "0"}, "error_unavailable.json"),
            (503, {"Retry-After": "0"}, "error_unavailable.json"),
        ]
    )
    client = PandaScoreClient(
        "test-token",
        transport=transport,
        min_interval=0,
    )

    with pytest.raises(PandaScoreAPIError) as error:
        list(client.iter_cs_players())

    assert error.value.status == 503
    assert len(transport.requests) == 4


def test_iter_cs_players_retries_a_transient_connection_drop(monkeypatch):
    delays = []
    monkeypatch.setattr("cs_guess_scraper.pandascore.time.sleep", delays.append)
    successful = StubTransport([(200, {}, "players_page_1.json")])
    calls = 0

    def flaky_transport(url, headers):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RemoteDisconnected("peer closed connection")
        return successful(url, headers)

    client = PandaScoreClient(
        "test-token",
        transport=flaky_transport,
        min_interval=0,
    )

    players = list(client.iter_cs_players())

    assert [player["source_id"] for player in players] == ["1", "2"]
    assert calls == 2
    assert delays == [1.0]
