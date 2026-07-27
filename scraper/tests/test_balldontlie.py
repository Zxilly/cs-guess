import json
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from cs_guess_scraper.balldontlie import BallDontLieClient, parse_player

FIXTURES = Path(__file__).parent / "fixtures" / "balldontlie"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class StubTransport:
    def __init__(self, fixture_names):
        self.fixture_names = iter(fixture_names)
        self.requests = []

    def __call__(self, url, headers):
        self.requests.append((url, headers))
        payload = load_fixture(next(self.fixture_names))
        return 200, {}, json.dumps(payload).encode()


def test_parse_player_normalizes_biography_and_keeps_vendor_link_explicit():
    player = parse_player(load_fixture("player_full.json"))

    assert player == {
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


def test_iter_cs_players_uses_cursor_pagination_and_authorization_header():
    transport = StubTransport(["players_page_1.json", "players_page_2.json"])
    client = BallDontLieClient(
        "test-token",
        transport=transport,
        min_interval=0,
    )

    players = list(client.iter_cs_players(per_page=2))

    assert [player["external_id"] for player in players] == ["3", "2", "1"]
    assert len(transport.requests) == 2
    first_url, first_headers = transport.requests[0]
    second_url, _ = transport.requests[1]
    assert parse_qs(urlparse(first_url).query) == {"per_page": ["2"]}
    assert parse_qs(urlparse(second_url).query) == {
        "cursor": ["2"],
        "per_page": ["2"],
    }
    assert first_headers["Authorization"] == "test-token"


def test_iter_cs_players_retries_rate_limit_after_retry_after(monkeypatch):
    delays = []
    monkeypatch.setattr("cs_guess_scraper.balldontlie.time.sleep", delays.append)
    calls = 0

    def transport(url, headers):
        nonlocal calls
        calls += 1
        if calls == 1:
            return 429, {"Retry-After": "2"}, b"{}"
        payload = load_fixture("players_page_2.json")
        return 200, {}, json.dumps(payload).encode()

    client = BallDontLieClient(
        "test-token",
        transport=transport,
        min_interval=0,
    )

    players = list(client.iter_cs_players())

    assert [player["external_id"] for player in players] == ["1"]
    assert calls == 2
    assert delays == [2.0]


def test_iter_cs_players_retries_a_transient_connection_drop(monkeypatch):
    delays = []
    monkeypatch.setattr("cs_guess_scraper.balldontlie.time.sleep", delays.append)
    calls = 0

    def transport(url, headers):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RemoteDisconnected("peer closed connection")
        payload = load_fixture("players_page_2.json")
        return 200, {}, json.dumps(payload).encode()

    client = BallDontLieClient(
        "test-token",
        transport=transport,
        min_interval=0,
    )

    players = list(client.iter_cs_players())

    assert [player["external_id"] for player in players] == ["1"]
    assert calls == 2
    assert delays == [1.0]
