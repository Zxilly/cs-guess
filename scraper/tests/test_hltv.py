from pathlib import Path

import pytest

from cs_guess_scraper.hltv import (
    HltvClient,
    HltvError,
    HltvUnavailableError,
    known_profile_mismatches,
    parse_player_profile,
)


FIXTURES = Path(__file__).parent / "fixtures" / "hltv"


def load_fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


class StubTransport:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests = []

    def __call__(self, url, headers):
        self.requests.append((url, headers))
        status, response_headers, fixture_name = next(self.responses)
        return (
            status,
            response_headers,
            load_fixture(fixture_name).encode(),
        )


def test_parse_player_profile_extracts_visible_fallback_fields():
    player = parse_player_profile(load_fixture("zywoo_profile.html"))

    assert player == {
        "external_id": "11893",
        "nickname": "ZywOo",
        "full_name": "Mathieu Herbaut",
        "country": "France",
        "current_team": {
            "external_id": "9565",
            "name": "Vitality",
            "source_url": "https://www.hltv.org/team/9565/vitality",
        },
        "team_history": [
            {
                "team": {
                    "external_id": "9565",
                    "name": "Vitality",
                    "source_url": "https://www.hltv.org/team/9565/vitality",
                },
                "membership_kind": "active",
                "from": "2018-10",
                "from_precision": "month",
                "to": None,
                "to_precision": "unknown",
                "is_current": True,
                "is_primary": True,
            },
            {
                "team": {
                    "external_id": "7331",
                    "name": "against All authority",
                    "source_url": (
                        "https://www.hltv.org/team/7331/"
                        "against-all-authority"
                    ),
                },
                "membership_kind": "active",
                "from": "2018-02",
                "from_precision": "month",
                "to": "2018-10",
                "to_precision": "month",
                "is_current": False,
                "is_primary": False,
            },
        ],
        "age": 25,
        "majors_played": 11,
        "source_url": "https://www.hltv.org/player/11893/zywoo",
    }


def test_parse_player_profile_keeps_missing_visible_fields_nullable():
    player = parse_player_profile(load_fixture("sparse_profile.html"))

    assert player == {
        "external_id": "42",
        "nickname": None,
        "full_name": None,
        "country": None,
        "current_team": None,
        "team_history": [],
        "age": None,
        "majors_played": None,
        "source_url": "https://www.hltv.org/player/42/unknown",
    }


def test_known_profile_match_accepts_provider_alias_and_longer_legal_name():
    mismatches = known_profile_mismatches(
        {
            "nickname": "device",
            "full_name": "Nicolai Reedtz",
            "country": "Denmark",
        },
        canonical_nickname="dev1ce",
        canonical_full_name="Nicolai Hvilshøj Reedtz",
        canonical_country_code="DK",
        match_external_id="device",
    )

    assert mismatches == []


def test_known_profile_match_rejects_wrong_country_or_unrelated_name():
    mismatches = known_profile_mismatches(
        {
            "nickname": "same",
            "full_name": "Different Person",
            "country": "Sweden",
        },
        canonical_nickname="same",
        canonical_full_name="Known Player",
        canonical_country_code="DK",
        match_external_id="Known_Player",
    )

    assert mismatches == ["full_name", "country_code"]


def test_fetch_player_only_requests_the_supplied_known_profile():
    transport = StubTransport([(200, {}, "zywoo_profile.html")])
    client = HltvClient(transport=transport, min_interval=0)

    player = client.fetch_player(11893, "zywoo")

    assert player["external_id"] == "11893"
    assert player["nickname"] == "ZywOo"
    assert player["source_url"] == (
        "https://www.hltv.org/player/11893/zywoo"
    )
    assert len(transport.requests) == 1
    requested_url, headers = transport.requests[0]
    assert requested_url == "https://www.hltv.org/player/11893/zywoo"
    assert headers["User-Agent"].startswith("CSGuess-HLTV-Fallback/")


def test_fetch_player_reports_403_as_an_unavailable_fallback():
    transport = StubTransport([(403, {}, "cloudflare_403.html")])
    client = HltvClient(transport=transport, min_interval=0)

    with pytest.raises(HltvUnavailableError) as error:
        client.fetch_player(11893, "zywoo")

    assert error.value.status == 403
    assert error.value.source_url == (
        "https://www.hltv.org/player/11893/zywoo"
    )
    assert "unavailable" in str(error.value).lower()
    assert len(transport.requests) == 1


def test_fetch_player_stops_after_finite_server_error_retries():
    transport = StubTransport(
        [
            (503, {"Retry-After": "0"}, "service_unavailable.html"),
            (503, {"Retry-After": "0"}, "service_unavailable.html"),
            (503, {"Retry-After": "0"}, "service_unavailable.html"),
        ]
    )
    client = HltvClient(transport=transport, min_interval=0)

    with pytest.raises(HltvError) as error:
        client.fetch_player(11893, "zywoo")

    assert error.value.status == 503
    assert len(transport.requests) == 3


def test_fetch_player_does_not_attempt_to_bypass_a_challenge_page():
    transport = StubTransport([(200, {}, "cloudflare_403.html")])
    client = HltvClient(transport=transport, min_interval=0)

    with pytest.raises(HltvUnavailableError) as error:
        client.fetch_player(11893, "zywoo")

    assert error.value.status == 200
    assert "challenge" in str(error.value).lower()
    assert len(transport.requests) == 1


def test_default_client_spacing_is_at_least_five_seconds(monkeypatch):
    times = iter([100.0, 100.0, 100.0])
    delays = []
    monkeypatch.setattr(
        "cs_guess_scraper.hltv.time.monotonic",
        lambda: next(times),
    )
    monkeypatch.setattr("cs_guess_scraper.hltv.time.sleep", delays.append)
    transport = StubTransport(
        [
            (200, {}, "zywoo_profile.html"),
            (200, {}, "zywoo_profile.html"),
        ]
    )
    client = HltvClient(transport=transport)

    client.fetch_player(11893, "zywoo")
    client.fetch_player(11893, "zywoo")

    assert delays == [5.0]


@pytest.mark.parametrize(
    ("hltv_id", "slug"),
    [
        (0, "zywoo"),
        (11893, "../players"),
        (11893, "zywoo?search=all"),
    ],
)
def test_fetch_player_rejects_non_profile_targets(hltv_id, slug):
    transport = StubTransport([])
    client = HltvClient(transport=transport, min_interval=0)

    with pytest.raises(ValueError):
        client.fetch_player(hltv_id, slug)

    assert transport.requests == []
