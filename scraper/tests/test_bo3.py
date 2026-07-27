from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from cs_guess_scraper.bo3 import Bo3Client, parse_player


FIXTURES = Path(__file__).parent / "fixtures" / "bo3"


def test_parse_player_resolves_country_and_current_team() -> None:
    payload = json.loads(
        (FIXTURES / "player_0samas.json").read_text(encoding="utf-8")
    )

    parsed = parse_player(
        payload,
        countries={69: {"code": "PS", "name": "State of Palestine"}},
        teams={
            3869: {
                "id": 3869,
                "slug": "jijiehao",
                "name": "JiJieHao",
                "country_id": 61,
                "image_url": "https://files.bo3.gg/jijiehao.webp",
            }
        },
    )

    assert parsed == {
        "source": "bo3",
        "source_id": "36613",
        "slug": "0samas",
        "nickname": "0SAMAS",
        "full_name": "Osama Orabi",
        "country_code": "PS",
        "birth_date": "2002-04-10",
        "image_url": (
            "https://files.bo3.gg/uploads/player/36613/image/0samas.webp"
        ),
        "active": True,
        "is_coach": False,
        "pandascore_external_id": None,
        "current_team": {
            "source": "bo3",
            "source_id": "3869",
            "slug": "jijiehao",
            "name": "JiJieHao",
            "short_name": None,
            "country_code": None,
            "image_url": "https://files.bo3.gg/jijiehao.webp",
            "start_value": "2025-04-03",
            "start_precision": "day",
        },
        "modified_at": "2026-07-27T08:31:15.331+08:00",
    }


def test_client_paginates_lookups_and_players() -> None:
    requested: list[tuple[str, int, int]] = []
    resources = {
        "countries": [
            {"id": 69, "code": "PS", "name": "State of Palestine"}
        ],
        "teams": [
            {"id": 3869, "slug": "jijiehao", "name": "JiJieHao"}
        ],
        "players": [
            {
                "id": index,
                "slug": f"player-{index}",
                "nickname": f"player{index}",
                "first_name": "Test",
                "last_name": str(index),
                "birthday": "2000-01-01",
                "status": 1,
                "country_id": 69,
                "team_id": 3869,
                "joined_team_at": "2026-01-01T00:00:00+08:00",
                "is_coach": False,
                "ps_id": 1000 + index,
            }
            for index in range(1, 4)
        ],
    }

    def transport(url: str, _headers: dict[str, str]):
        parsed_url = urlparse(url)
        resource = parsed_url.path.rstrip("/").split("/")[-1]
        query = parse_qs(parsed_url.query)
        offset = int(query["page[offset]"][0])
        limit = int(query["page[limit]"][0])
        requested.append((resource, offset, limit))
        rows = resources[resource][offset : offset + limit]
        body = json.dumps(
            {
                "total": {
                    "count": len(resources[resource]),
                    "offset": offset,
                    "limit": limit,
                },
                "results": rows,
            }
        ).encode()
        return 200, {}, body

    players = list(
        Bo3Client(transport=transport, min_interval=0).iter_cs_players(
            page_size=2
        )
    )

    assert [player["source_id"] for player in players] == ["1", "2", "3"]
    assert players[0]["country_code"] == "PS"
    assert players[0]["current_team"]["name"] == "JiJieHao"
    assert requested == [
        ("countries", 0, 2),
        ("teams", 0, 2),
        ("players", 0, 2),
        ("players", 2, 2),
    ]


def test_client_retries_a_rate_limited_page() -> None:
    calls = 0

    def transport(_url: str, _headers: dict[str, str]):
        nonlocal calls
        calls += 1
        if calls == 1:
            return 429, {"Retry-After": "0"}, b'{"error":"slow down"}'
        return (
            200,
            {},
            b'{"total":{"count":0,"offset":0,"limit":100},"results":[]}',
        )

    assert list(
        Bo3Client(transport=transport, min_interval=0).iter_cs_players()
    ) == []
    assert calls == 4


def test_parse_player_does_not_treat_an_old_team_as_current() -> None:
    payload = {
        "id": 20940,
        "slug": "s0m",
        "nickname": "s0m",
        "first_name": "Sam",
        "last_name": "Oh",
        "birthday": "2002-06-07",
        "status": 1,
        "country_id": 10,
        "team_id": 373,
        "joined_team_at": None,
        "is_coach": False,
        "ps_id": 20306,
    }

    parsed = parse_player(
        payload,
        countries={10: {"code": "US", "name": "United States"}},
        teams={373: {"id": 373, "slug": "gen-g", "name": "Gen.G"}},
    )

    assert parsed["current_team"] is None
